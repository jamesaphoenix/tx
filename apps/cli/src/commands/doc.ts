/**
 * Doc commands: doc add, doc edit, doc show, doc list, doc rm,
 * doc lock, doc version, doc link, doc attach, doc patch,
 * doc validate, doc drift, doc lint-ears
 */

import { Effect, Either } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import {
  DocService,
  formatEarsValidationErrors,
  parseMdDocSync,
  readTxConfig,
  validateEarsRequirements,
} from "@jamesaphoenix/tx"
import { DOC_KINDS } from "@jamesaphoenix/tx/types"
import type { DocKind, DocLinkType, TaskDocLinkType } from "@jamesaphoenix/tx/types"
import { toJson } from "../output.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

const docKindStrings: readonly string[] = DOC_KINDS

const toEarsAreaSegment = (name: string): string => {
  const normalized = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12)
  return normalized.length > 0 ? normalized : "DOC"
}

const normalizeDocKind = (kind: DocKind): DocKind => {
  if (kind === "requirement") {
    return "prd"
  }
  if (kind === "system_design") {
    return "design"
  }
  return kind
}

type ListedDoc = {
  docId: string
  name: string
  kind: DocKind
  version: number
  filePath: string
}

const selectLatestDoc = <T extends { version: number }>(docs: readonly T[]): T =>
  [...docs].sort((left, right) => right.version - left.version)[0]!

const resolveDocRefFromList = (
  docs: readonly ListedDoc[],
  ref: string,
): { doc: ListedDoc | null; reason?: string } => {
  const scopedMatch = ref.match(/^([^/]+)\/(.+)$/)
  if (scopedMatch) {
    const scope = scopedMatch[1]
    const name = scopedMatch[2]
    if (docKindStrings.includes(scope as DocKind)) {
      const normalizedScope = normalizeDocKind(scope as DocKind)
      const matches = docs.filter((doc) =>
        normalizeDocKind(doc.kind) === normalizedScope && doc.name === name
      )
      return matches.length > 0 ? { doc: selectLatestDoc(matches) } : { doc: null }
    }
  }

  const docIdMatches = docs.filter((doc) => doc.docId === ref)
  if (docIdMatches.length > 0) {
    return { doc: selectLatestDoc(docIdMatches) }
  }

  const nameMatches = docs.filter((doc) => doc.name === ref)
  if (nameMatches.length === 0) {
    return { doc: null }
  }

  const normalizedKinds = Array.from(
    new Set(nameMatches.map((doc) => normalizeDocKind(doc.kind)))
  )
  if (normalizedKinds.length > 1) {
    return {
      doc: null,
      reason: `Doc reference '${ref}' is ambiguous across kinds (${normalizedKinds.join(", ")}). Use kind/name or doc_id instead.`,
    }
  }

  return { doc: selectLatestDoc(nameMatches) }
}

/** Dispatch doc subcommands. */
export const doc = (pos: string[], flags: Flags) => {
  const sub = pos[0]
  const rest = pos.slice(1)
  if (!sub) {
    return docList([], flags)
  }
  switch (sub) {
    case "add": return docAdd(rest, flags)
    case "edit": return docEdit(rest, flags)
    case "show": return docShow(rest, flags)
    case "list": return docList(rest, flags)
    case "rm":
    case "remove":
      return docRemove(rest, flags)
    case "lock": return docLock(rest, flags)
    case "version": return docVersion(rest, flags)
    case "link": return docLink(rest, flags)
    case "attach": return docAttach(rest, flags)
    case "patch": return docPatch(rest, flags)
    case "validate": return docValidate(rest, flags)
    case "drift": return docDrift(rest, flags)
    case "lint-ears": return docLintEars(rest, flags)
    case "sync": return docSync(rest, flags)
    default:
      return Effect.sync(() => {
        console.error(`Unknown doc subcommand: ${sub ?? "(none)"}`)
        console.error("Run 'tx doc --help' for usage information")
        throw new CliExitError(1)
      })
  }
}

const docAdd = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const kind = pos[0]
    const name = pos[1]
    if (!kind || !name) {
      console.error("Usage: tx doc add <kind> <name> [--title <title>] [--path <file>]")
      console.error("  Kinds: overview, prd, design")
      console.error("  --path: register an existing file instead of scaffolding")
      throw new CliExitError(1)
    }
    if (!docKindStrings.includes(kind)) {
      console.error(`Invalid kind: ${kind}. Must be one of: ${DOC_KINDS.join(", ")}`)
      throw new CliExitError(1)
    }

    const pathFlag = opt(flags, "path", "p")
    const requestedKind = kind as DocKind
    const normalizedKind = normalizeDocKind(requestedKind)

    let content: string
    let relFilePath: string | undefined
    if (pathFlag) {
      // Register an existing file at a custom path
      const config = readTxConfig()
      const absPath = resolve(config.docs.path, pathFlag)
      if (!existsSync(absPath)) {
        console.error(`File not found: ${absPath}`)
        console.error(`Provide a path relative to '${config.docs.path}'`)
        throw new CliExitError(1)
      }
      content = readFileSync(absPath, "utf8")
      relFilePath = pathFlag
    } else {
      const title = opt(flags, "title", "t") ?? name
      content = generateTemplate(kind as DocKind, name, title)
    }

    // Parse frontmatter to get title (used for both modes)
    const parsed = parseMdDocSync(content)
    const title = Either.isRight(parsed) && parsed.right.kind === "spec"
      ? parsed.right.frontmatter.title ?? name
      : opt(flags, "title", "t") ?? name

    const svc = yield* DocService
    const doc = yield* svc.create({
      kind: normalizedKind,
      name,
      title,
      content,
      relFilePath,
    })

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      const verb = pathFlag ? "Registered" : "Created"
      console.log(`${verb} doc: ${doc.name} (${doc.kind} v${doc.version})`)
      console.log(`  File: ${doc.filePath}`)
      console.log(`  Hash: ${doc.hash.slice(0, 12)}...`)
    }
  })

const docEdit = (pos: string[], _flags: Flags) =>
  Effect.gen(function* () {
    const ref = pos[0]
    if (!ref) {
      console.error("Usage: tx doc edit <ref>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.get(ref)
    const editor = process.env.EDITOR ?? "vi"
    const config = readTxConfig()
    const absPath = resolve(config.docs.path, doc.filePath)

    const [editorCmd, ...editorArgs] = editor.split(/\s+/).filter(Boolean)
    if (!editorCmd) {
      console.error(`$EDITOR is empty or invalid: "${editor}". Set EDITOR to a valid editor command.`)
      throw new CliExitError(1)
    }
    const result = spawnSync(editorCmd, [...editorArgs, absPath], { stdio: "inherit" })
    if (result.error || (result.status !== null && result.status !== 0)) {
      console.error(`Failed to open editor: ${editor}`)
      throw new CliExitError(1)
    }

    // Re-sync DB hash after editor closes (markdown-first docs only)
    if (!doc.filePath.endsWith(".yml") && existsSync(absPath)) {
      const content = readFileSync(absPath, "utf8")
      yield* svc.update(ref, content)
    }
  })

const docShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const ref = pos[0]
    if (!ref) {
      console.error("Usage: tx doc show <ref> [--md] [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.get(ref)

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else if (flag(flags, "md")) {
      const config = readTxConfig()
      const markdownPath = resolve(config.docs.path, doc.filePath)
      if (!existsSync(markdownPath)) {
        console.error(`File not found: ${markdownPath}`)
        throw new CliExitError(1)
      }
      console.log(readFileSync(markdownPath, "utf8"))
    } else {
      console.log(`Doc: ${doc.name}`)
      console.log(`  Doc ID: ${doc.docId}`)
      console.log(`  Kind: ${doc.kind}`)
      console.log(`  Title: ${doc.title}`)
      console.log(`  Version: ${doc.version}`)
      console.log(`  Status: ${doc.status}`)
      console.log(`  Hash: ${doc.hash.slice(0, 12)}...`)
      console.log(`  File: ${doc.filePath}`)
      console.log(`  Created: ${doc.createdAt.toISOString()}`)
      if (doc.lockedAt) console.log(`  Locked: ${doc.lockedAt.toISOString()}`)
      if (doc.parentDocId) console.log(`  Parent doc ID: ${doc.parentDocId}`)
    }
  })

const docList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const kind = opt(flags, "kind", "k")
    const status = opt(flags, "status", "s")

    const svc = yield* DocService
    const docs = yield* svc.list({ kind, status })

    if (flag(flags, "json")) {
      console.log(toJson(docs))
    } else {
      if (docs.length === 0) {
        console.log("No docs found")
      } else {
        console.log(`${docs.length} doc(s):`)
        for (const d of docs) {
          const statusIcon = d.status === "locked" ? "🔒" : "📝"
          console.log(`  ${statusIcon} ${d.name} (${d.kind} v${d.version}) [${d.status}] ${d.title}`)
        }
      }
    }
  })

const docRemove = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const ref = pos[0]
    if (!ref) {
      console.error("Usage: tx doc rm <ref> [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.get(ref)
    yield* svc.remove(ref)

    const payload = {
      deleted: true,
      name: doc.name,
      kind: doc.kind,
      version: doc.version,
      filePath: doc.filePath,
    }

    if (flag(flags, "json")) {
      console.log(toJson(payload))
    } else {
      console.log(`Removed doc: ${doc.name} (${doc.kind} v${doc.version})`)
      console.log(`  File: ${doc.filePath}`)
    }
  })

const docLock = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const ref = pos[0]
    if (!ref) {
      console.error("Usage: tx doc lock <ref>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.lock(ref)
    yield* svc.render(ref)

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Locked: ${doc.name} v${doc.version}`)
      console.log(`  Status: ${doc.status}`)
      if (doc.lockedAt) console.log(`  Locked at: ${doc.lockedAt.toISOString()}`)
    }
  })

const docVersion = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const ref = pos[0]
    if (!ref) {
      console.error("Usage: tx doc version <ref>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.createVersion(ref)

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Created version: ${doc.name} v${doc.version}`)
      console.log(`  Copied from v${doc.version - 1}`)
      console.log(`  Status: ${doc.status}`)
    }
  })

const docLink = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const from = pos[0]
    const to = pos[1]
    if (!from || !to) {
      console.error("Usage: tx doc link <from-ref> <to-ref> [--type <link-type>]")
      throw new CliExitError(1)
    }

    const linkType = opt(flags, "type") as DocLinkType | undefined
    const svc = yield* DocService
    const link = yield* svc.linkDocs(from, to, linkType)

    if (flag(flags, "json")) {
      console.log(toJson(link))
    } else {
      console.log(`Linked: ${from} → ${to} (${link.linkType})`)
    }
  })

const docAttach = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const taskId = pos[0]
    const docName = pos[1]
    if (!taskId || !docName) {
      console.error("Usage: tx doc attach <task-id> <doc-ref> [--type implements|references]")
      throw new CliExitError(1)
    }

    const linkType = (opt(flags, "type") ?? "implements") as TaskDocLinkType
    const svc = yield* DocService
    yield* svc.attachTask(taskId, docName, linkType)

    if (flag(flags, "json")) {
      console.log(toJson({ taskId, docName, linkType }))
    } else {
      console.log(`Attached: task ${taskId} → doc ${docName} (${linkType})`)
    }
  })

const docPatch = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const designName = pos[0]
    const patchName = pos[1]
    if (!designName || !patchName) {
      console.error("Usage: tx doc patch <design-name> <patch-name> [--title <title>]")
      throw new CliExitError(1)
    }

    const title = opt(flags, "title", "t") ?? patchName
    const svc = yield* DocService
    const doc = yield* svc.createPatch(designName, patchName, title)

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Created patch: ${doc.name} → ${designName}`)
      console.log(`  Title: ${doc.title}`)
      console.log(`  File: ${doc.filePath}`)
    }
  })

const docValidate = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* DocService
    const coverageWarnings = yield* svc.validate()
    const indexWarnings = yield* svc.validateIndexSearchability()
    const warnings = [...coverageWarnings, ...indexWarnings]

    if (flag(flags, "json")) {
      console.log(toJson({ warnings }))
    } else {
      if (warnings.length === 0) {
        console.log("Docs validation passed: all tasks are linked and searchable index metadata is populated")
      } else {
        console.log(`${warnings.length} warning(s):`)
        for (const w of warnings) {
          console.log(`  ⚠ ${w}`)
        }
      }
    }
  })

const docDrift = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx doc drift <name>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const warnings = yield* svc.detectDrift(name)

    if (flag(flags, "json")) {
      console.log(toJson({ name, warnings }))
    } else {
      if (warnings.length === 0) {
        console.log(`No drift detected for: ${name}`)
      } else {
        console.log(`${warnings.length} drift warning(s) for ${name}:`)
        for (const w of warnings) {
          console.log(`  ⚠ ${w}`)
        }
      }
    }
  })

const docLintEars = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const target = pos[0]
    const jsonMode = flag(flags, "json")
    const emitLintFailure = (payload: {
      doc: string | null
      path?: string
      errors: Array<{ field: string; message: string }>
    }): never => {
      if (jsonMode) {
        console.log(
          toJson({
            valid: false,
            doc: payload.doc,
            path: payload.path,
            errors: payload.errors,
          })
        )
      } else {
        for (const error of payload.errors) {
          if (payload.path) {
            console.error(`${error.field === "markdown" ? "Markdown parse error" : "Validation error"} in ${payload.path}: ${error.message}`)
          } else {
            console.error(error.message)
          }
        }
      }
      throw new CliExitError(1)
    }

    if (!target) {
      console.error("Usage: tx doc lint-ears <doc-name-or-markdown-path> [--json]")
      throw new CliExitError(1)
    }

    let docPath = target
    let docName: string | null = null
    if (!existsSync(docPath)) {
      const svc = yield* DocService
      const docs = yield* svc.list()
      const resolution = resolveDocRefFromList(docs, target)
      const doc = resolution.doc ?? emitLintFailure({
        doc: target,
        errors: [{
          field: "ref",
          message: resolution.reason ?? `Doc not found: ${target}`,
        }],
      })
      if (doc.kind !== "prd") {
        const message = `Doc '${target}' is kind '${doc.kind}'. EARS validation is only supported for PRD docs.`
        emitLintFailure({
          doc: target,
          path: resolve(readTxConfig().docs.path, doc.filePath),
          errors: [{ field: "kind", message }],
        })
      }
      docName = doc.name
      docPath = resolve(readTxConfig().docs.path, doc.filePath)
    }

    let markdownContent = ""
    try {
      markdownContent = readFileSync(docPath, "utf8")
    } catch (error) {
      emitLintFailure({
        doc: docName ?? null,
        path: docPath,
        errors: [
          {
            field: "markdown",
            message: `Read error: ${String(error)}`,
          },
        ],
      })
    }

    const parsed = parseMdDocSync(markdownContent)
    const parsedDoc = Either.isRight(parsed)
      ? parsed.right
      : emitLintFailure({
        doc: docName ?? null,
        path: docPath,
        errors: [{ field: "markdown", message: parsed.left.reason }],
      })
    const parsedDocName = String(parsedDoc.frontmatter.name)

    if (parsedDoc.kind !== "spec") {
      const message = "Only markdown spec docs are supported for EARS validation."
      emitLintFailure({
        doc: docName ?? null,
        path: docPath,
        errors: [{ field: "kind", message }],
      })
    }

    if (parsedDoc.frontmatter.spec_type !== "prd") {
      const message =
        `Doc is spec_type '${parsedDoc.frontmatter.spec_type}'. ` +
        "EARS validation is only supported for PRD docs."
      emitLintFailure({
        doc: docName ?? parsedDocName,
        path: docPath,
        errors: [{ field: "spec_type", message }],
      })
    }

    docName = docName ?? parsedDocName
    const earsRequirements = parsedDoc.blocks.ears_requirements ?? []
    if (earsRequirements.length === 0) {
      if (jsonMode) {
        console.log(
          toJson({
            valid: true,
            doc: docName ?? null,
            path: docPath,
            count: 0,
            errors: [],
            message: "No ears_requirements section found",
          })
        )
      } else {
        console.log(`No ears_requirements section found in: ${docPath}`)
      }
      return
    }

    const errors = validateEarsRequirements(earsRequirements)
    if (jsonMode) {
      console.log(
        toJson({
          valid: errors.length === 0,
          doc: docName ?? null,
          path: docPath,
          count: earsRequirements.length,
          errors,
          errorSummary: errors.length > 0 ? formatEarsValidationErrors(errors) : null,
        })
      )
    } else if (errors.length === 0) {
      console.log(`EARS validation passed: ${docPath}`)
    } else {
      console.error(`EARS validation failed for ${docPath}:`)
      for (const error of errors) {
        const location = error.id ? `${error.id}` : `entry #${error.index + 1}`
        console.error(`- ${location} (${error.field}) ${error.message}`)
      }
    }

    if (errors.length > 0) {
      throw new CliExitError(1)
    }
  })

const docSync = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* DocService
    const config = readTxConfig()
    const targetName = pos[0]

    const docs = targetName
      ? [yield* svc.get(targetName)]
      : yield* svc.list()

    let synced = 0
    let skipped = 0
    const results: Array<{ name: string; status: string }> = []

    for (const doc of docs) {
      const absPath = resolve(config.docs.path, doc.filePath)
      if (!existsSync(absPath)) {
        results.push({ name: doc.name, status: "file_missing" })
        skipped++
        continue
      }
      const content = readFileSync(absPath, "utf8")
      yield* svc.update(doc.docId, content)
      results.push({ name: doc.name, status: "synced" })
      synced++
    }

    if (flag(flags, "json")) {
      console.log(toJson({ synced, skipped, results }))
    } else {
      console.log(`Synced ${synced} doc(s)${skipped > 0 ? `, ${skipped} skipped (file missing)` : ""}`)
      for (const r of results) {
        const icon = r.status === "synced" ? "\u2713" : "\u2717"
        console.log(`  ${icon} ${r.name}`)
      }
    }
  })

const defaultSummary = (kind: DocKind, title: string): string => {
  switch (kind) {
    case "overview":
      return `System overview for ${title}.`
    case "prd":
    case "requirement":
      return `Product requirements for ${title}.`
    case "design":
    case "system_design":
      return `Technical design for ${title}.`
    case "runbook":
      return `Operational runbook for ${title}.`
    case "decision":
      return `Architecture decision for ${title}.`
  }
}

const defaultDomain = (name: string, kind: DocKind): string => {
  const normalizedKind = normalizeDocKind(kind)
  return name.replace(new RegExp(`-(?:${normalizedKind}|overview|runbook|decision)$`), "") || name
}

const defaultTags = (kind: DocKind, domain: string): string[] => {
  const baseKind = normalizeDocKind(kind)
  const tokens = domain
    .split("-")
    .map((token) => token.trim())
    .filter(Boolean)

  return Array.from(new Set([baseKind, ...tokens]))
}

/** Generate markdown-first template content for a doc kind. */
function generateTemplate(
  kind: DocKind,
  name: string,
  title: string
): string {
  const today = new Date().toISOString().slice(0, 10)
  const summary = defaultSummary(kind, title)
  const domain = defaultDomain(name, kind)
  const tags = defaultTags(kind, domain)

  switch (kind) {
    case "overview":
      return [
        `---`,
        `kind: spec`,
        `spec_type: overview`,
        `name: ${name}`,
        `title: "${title}"`,
        `status: draft`,
        `version: 1`,
        `owners:`,
        `  - docs-team`,
        `summary: ${JSON.stringify(summary)}`,
        `domain: ${domain}`,
        `tags:`,
        ...tags.map((tag) => `  - ${tag}`),
        `depends_on: []`,
        `supersedes: []`,
        `implements: null`,
        `last_reviewed_at: ${today}`,
        `---`,
        ``,
        `# Summary`,
        `Describe the system overview.`,
        ``,
        `# Architecture`,
        `High-level architecture narrative for this system.`,
        ``,
        `# Components`,
        `- Component 1`,
        ``,
        `# Data Flows`,
        `Describe primary data and control flows.`,
        ``,
        `# Problem`,
        `What problem this system solves.`,
        ``,
        `# Scope`,
        `What's included and excluded.`,
        ``,
        `# Requirements`,
        `No requirements for overview docs.`,
        ``,
        `# Non-goals`,
        `- Item 1`,
        ``,
      ].join("\n")
    case "prd": {
      const earsArea = toEarsAreaSegment(name)
      return [
        `---`,
        `kind: spec`,
        `spec_type: prd`,
        `name: ${name}`,
        `title: "${title}"`,
        `status: draft`,
        `version: 1`,
        `owners:`,
        `  - docs-team`,
        `summary: ${JSON.stringify(summary)}`,
        `domain: ${domain}`,
        `tags:`,
        ...tags.map((tag) => `  - ${tag}`),
        `depends_on: []`,
        `supersedes: []`,
        `implements: null`,
        `last_reviewed_at: ${today}`,
        `---`,
        ``,
        `# Summary`,
        `Describe the purpose of this PRD.`,
        ``,
        `# Problem`,
        `Describe the problem this feature solves.`,
        ``,
        `# Scope`,
        `Included: ...`,
        `Excluded: ...`,
        ``,
        `# Requirements`,
        `\`\`\`yaml`,
        `ears_requirements:`,
        `  - id: REQ-${earsArea}-001`,
        `    kind: ubiquitous`,
        `    statement: the system shall do X`,
        `    priority: must`,
        `    rationale: why this matters`,
        `\`\`\``,
        ``,
        `# Acceptance Criteria`,
        `\`\`\`yaml`,
        `acceptance_criteria:`,
        `  - id: AC-001`,
        `    statement: criterion description`,
        `\`\`\``,
        ``,
        `# Non-goals`,
        `- Item 1`,
        ``,
      ].join("\n")
    }
    case "design":
      return [
        `---`,
        `kind: spec`,
        `spec_type: design`,
        `name: ${name}`,
        `title: "${title}"`,
        `status: draft`,
        `version: 1`,
        `owners:`,
        `  - docs-team`,
        `summary: ${JSON.stringify(summary)}`,
        `domain: ${domain}`,
        `tags:`,
        ...tags.map((tag) => `  - ${tag}`),
        `depends_on: []`,
        `supersedes: []`,
        `implements: null`,
        `last_reviewed_at: ${today}`,
        `---`,
        ``,
        `# Summary`,
        `Describe the design approach.`,
        ``,
        `# Architecture`,
        `## Components`,
        `...`,
        ``,
        `# Interfaces`,
        `\`\`\`yaml`,
        `interfaces: []`,
        `\`\`\``,
        ``,
        `# Data Model`,
        `No data model changes.`,
        ``,
        `# Invariants`,
        `\`\`\`yaml`,
        `invariants: []`,
        `\`\`\``,
        ``,
        `# Failure Modes`,
        `\`\`\`yaml`,
        `failure_modes: []`,
        `\`\`\``,
        ``,
        `# Verification`,
        `\`\`\`yaml`,
        `verification: []`,
        `\`\`\``,
        ``,
        `# Testing Strategy`,
        `## Unit Tests`,
        `...`,
        ``,
        `## Integration Tests`,
        `...`,
        ``,
        `# Open Questions`,
        `- [ ] Unresolved design decisions`,
        ``,
      ].join("\n")
    case "runbook":
      return [
        `---`,
        `kind: spec`,
        `spec_type: runbook`,
        `name: ${name}`,
        `title: "${title}"`,
        `status: draft`,
        `version: 1`,
        `owners:`,
        `  - docs-team`,
        `summary: ${JSON.stringify(summary)}`,
        `domain: ${domain}`,
        `tags:`,
        ...tags.map((tag) => `  - ${tag}`),
        `depends_on: []`,
        `supersedes: []`,
        `implements: null`,
        `last_reviewed_at: ${today}`,
        `---`,
        ``,
        `# Summary`,
        `Describe when to use this runbook.`,
        ``,
        `# Symptoms`,
        `Describe observable symptoms.`,
        ``,
        `# Diagnosis`,
        `How to confirm root cause.`,
        ``,
        `# Mitigation`,
        `Step-by-step mitigation actions.`,
        ``,
        `# Escalation`,
        `When and how to escalate.`,
        ``,
      ].join("\n")
    case "decision":
      return [
        `---`,
        `kind: spec`,
        `spec_type: decision`,
        `name: ${name}`,
        `title: "${title}"`,
        `status: draft`,
        `version: 1`,
        `owners:`,
        `  - docs-team`,
        `summary: ${JSON.stringify(summary)}`,
        `domain: ${domain}`,
        `tags:`,
        ...tags.map((tag) => `  - ${tag}`),
        `depends_on: []`,
        `supersedes: []`,
        `implements: null`,
        `last_reviewed_at: ${today}`,
        `---`,
        ``,
        `# Summary`,
        `One-line decision summary.`,
        ``,
        `# Context`,
        `Describe the context and constraints.`,
        ``,
        `# Alternatives`,
        `List alternatives considered.`,
        ``,
        `# Decision`,
        `Record the chosen option.`,
        ``,
        `# Consequences`,
        `Document expected trade-offs and impacts.`,
        ``,
      ].join("\n")
    case "requirement":
      console.error("The 'requirement' kind is deprecated. Use 'prd' instead.")
      console.error("Creating as 'prd' with spec_type: prd...")
      return generateTemplate("prd", name, title)
    case "system_design":
      console.error("The 'system_design' kind is deprecated. Use 'design' instead.")
      console.error("Creating as 'design' with spec_type: design...")
      return generateTemplate("design", name, title)
  }
}
