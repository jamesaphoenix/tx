/**
 * Doc commands: doc add, doc edit, doc show, doc list, doc render, doc lock,
 * doc version, doc link, doc attach, doc patch, doc validate, doc drift,
 * doc lint-ears
 */

import { Effect, Either } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execSync } from "node:child_process"
import {
  DocService,
  formatEarsValidationErrors,
  parseMdDocSync,
  readTxConfig,
  validateEarsRequirements,
} from "@jamesaphoenix/tx-core"
import { DOC_KINDS } from "@jamesaphoenix/tx-types"
import type { DocKind, DocLinkType, TaskDocLinkType } from "@jamesaphoenix/tx-types"
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
    case "render": return docRender(rest, flags)
    case "lock": return docLock(rest, flags)
    case "version": return docVersion(rest, flags)
    case "link": return docLink(rest, flags)
    case "attach": return docAttach(rest, flags)
    case "patch": return docPatch(rest, flags)
    case "validate": return docValidate(rest, flags)
    case "drift": return docDrift(rest, flags)
    case "lint-ears": return docLintEars(rest, flags)
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
      console.error("Usage: tx doc add <kind> <name> [--title <title>]")
      console.error("  Kinds: overview, prd, design")
      throw new CliExitError(1)
    }
    if (!docKindStrings.includes(kind)) {
      console.error(`Invalid kind: ${kind}. Must be one of: ${DOC_KINDS.join(", ")}`)
      throw new CliExitError(1)
    }

    const title = opt(flags, "title", "t") ?? name
    const requestedKind = kind as DocKind
    const normalizedKind = normalizeDocKind(requestedKind)
    const content = generateTemplate(
      kind as DocKind,
      name,
      title
    )

    const svc = yield* DocService
    const doc = yield* svc.create({
      kind: normalizedKind,
      name,
      title,
      content,
    })

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Created doc: ${doc.name} (${doc.kind} v${doc.version})`)
      console.log(`  File: ${doc.filePath}`)
      console.log(`  Hash: ${doc.hash.slice(0, 12)}...`)
    }
  })

const docEdit = (pos: string[], _flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx doc edit <name>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.get(name)
    const editor = process.env.EDITOR ?? "vi"
    const docsPath = doc.filePath

    try {
      execSync(`${editor} "${docsPath}"`, { stdio: "inherit" })
    } catch {
      console.error(`Failed to open editor: ${editor}`)
      throw new CliExitError(1)
    }
  })

const docShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx doc show <name> [--md] [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.get(name)

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

const docRender = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0] || undefined

    const svc = yield* DocService
    const rendered = yield* svc.render(name)

    if (flag(flags, "json")) {
      console.log(toJson({ rendered }))
    } else {
      if (rendered.length === 0) {
        console.log("No docs rendered")
      } else {
        console.log(`Rendered ${rendered.length} doc(s):`)
        for (const path of rendered) {
          console.log(`  ${path}`)
        }
        console.log("  + index.md (index.yml retained for compatibility)")
      }
    }
  })

const docLock = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx doc lock <name>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.lock(name)
    yield* svc.render(name)

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
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx doc version <name>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const doc = yield* svc.createVersion(name)

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
      console.error("Usage: tx doc link <from-name> <to-name> [--type <link-type>]")
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
      console.error("Usage: tx doc attach <task-id> <doc-name> [--type implements|references]")
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
    const warnings = yield* svc.validate()

    if (flag(flags, "json")) {
      console.log(toJson({ warnings }))
    } else {
      if (warnings.length === 0) {
        console.log("All tasks are linked to docs")
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
    if (!target) {
      console.error("Usage: tx doc lint-ears <doc-name-or-markdown-path> [--json]")
      throw new CliExitError(1)
    }

    let docPath = target
    let docName: string | null = null
    if (!existsSync(docPath)) {
      const svc = yield* DocService
      const doc = yield* svc.get(target)
      if (doc.kind !== "prd") {
        const message = `Doc '${target}' is kind '${doc.kind}'. EARS validation is only supported for PRD docs.`
        if (jsonMode) {
          console.log(toJson({ valid: false, doc: target, errors: [{ field: "kind", message }] }))
        } else {
          console.error(message)
        }
        throw new CliExitError(1)
      }
      docName = doc.name
      docPath = resolve(readTxConfig().docs.path, doc.filePath)
    }

    let markdownContent: string
    try {
      markdownContent = readFileSync(docPath, "utf8")
    } catch (error) {
      if (jsonMode) {
        console.log(
          toJson({
            valid: false,
            doc: docName ?? null,
            path: docPath,
            errors: [
              {
                field: "markdown",
                message: `Read error: ${String(error)}`,
              },
            ],
          })
        )
      } else {
        console.error(`Read error in ${docPath}: ${String(error)}`)
      }
      throw new CliExitError(1)
    }

    const parsed = parseMdDocSync(markdownContent)
    if (Either.isLeft(parsed)) {
      if (jsonMode) {
        console.log(
          toJson({
            valid: false,
            doc: docName ?? null,
            path: docPath,
            errors: [{ field: "markdown", message: parsed.left.reason }],
          })
        )
      } else {
        console.error(`Markdown parse error in ${docPath}: ${parsed.left.reason}`)
      }
      throw new CliExitError(1)
    }

    if (parsed.right.kind !== "spec") {
      const message = "Only markdown spec docs are supported for EARS validation."
      if (jsonMode) {
        console.log(
          toJson({
            valid: false,
            doc: docName ?? null,
            path: docPath,
            errors: [{ field: "kind", message }],
          })
        )
      } else {
        console.error(message)
      }
      throw new CliExitError(1)
    }

    if (parsed.right.frontmatter.spec_type !== "prd") {
      const message =
        `Doc is spec_type '${parsed.right.frontmatter.spec_type}'. ` +
        "EARS validation is only supported for PRD docs."
      if (jsonMode) {
        console.log(
          toJson({
            valid: false,
            doc: docName ?? parsed.right.frontmatter.name,
            path: docPath,
            errors: [{ field: "spec_type", message }],
          })
        )
      } else {
        console.error(message)
      }
      throw new CliExitError(1)
    }

    docName = docName ?? parsed.right.frontmatter.name
    const earsRequirements = parsed.right.blocks.ears_requirements ?? []
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

/** Generate markdown-first template content for a doc kind. */
function generateTemplate(
  kind: DocKind,
  name: string,
  title: string
): string {
  const today = new Date().toISOString().slice(0, 10)

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
        `summary: Architectural overview of ${title}`,
        `domain: product-area`,
        `tags:`,
        `  - overview`,
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
        `summary: One-line summary of ${title}`,
        `domain: product-area`,
        `tags:`,
        `  - prd`,
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
        `summary: Technical approach for ${title}`,
        `domain: product-area`,
        `tags:`,
        `  - design`,
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
        `summary: Operational runbook for ${title}`,
        `domain: product-area`,
        `tags:`,
        `  - runbook`,
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
        `summary: Architecture decision for ${title}`,
        `domain: product-area`,
        `tags:`,
        `  - decision`,
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
