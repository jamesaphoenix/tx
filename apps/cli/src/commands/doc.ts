/**
 * Doc commands: doc add, doc edit, doc show, doc list, doc render, doc lock,
 * doc version, doc link, doc attach, doc patch, doc validate, doc drift
 */

import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { DocService } from "@jamesaphoenix/tx-core"
import { DOC_KINDS } from "@jamesaphoenix/tx-types"
import type { DocKind, DocLinkType, TaskDocLinkType } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

const docKindStrings: readonly string[] = DOC_KINDS

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
    const yamlContent = generateTemplate(kind as DocKind, name, title)

    const svc = yield* DocService
    const doc = yield* svc.create({
      kind: kind as DocKind,
      name,
      title,
      yamlContent,
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
      const rendered = yield* svc.render(name)
      if (rendered.length > 0) {
        console.log(readFileSync(rendered[0], "utf8"))
      }
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
        console.log("  + index.yml, index.md")
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

/** Generate template YAML content for a doc kind. */
function generateTemplate(kind: DocKind, name: string, title: string): string {
  switch (kind) {
    case "overview":
      return [
        `kind: overview`,
        `name: ${name}`,
        `title: "${title}"`,
        ``,
        `problem_definition: |`,
        `  Describe the problem this system solves.`,
        ``,
        `subsystems: |`,
        `  ## Subsystem 1`,
        `  - Boundary: packages/core/src/services/...`,
        ``,
        `object_model: |`,
        `  ## Entity`,
        `  - Table: ...`,
        `  - Lifecycle: ...`,
        ``,
        `storage_schema: |`,
        `  ## Table Name`,
        `  | Column | Type | Constraints |`,
        `  |--------|------|-------------|`,
        ``,
        `invariants: []`,
        ``,
        `failure_modes: []`,
        ``,
        `edge_cases: []`,
        ``,
        `constraints: []`,
        ``,
        `cross_cutting: |`,
        `  - Error handling: ...`,
        ``,
        `data_retention: |`,
        `  - Retained indefinitely`,
        ``,
      ].join("\n")
    case "prd":
      return [
        `kind: prd`,
        `name: ${name}`,
        `title: "${title}"`,
        `status: changing`,
        ``,
        `problem: |`,
        `  Describe the problem.`,
        ``,
        `solution: |`,
        `  Describe the solution approach.`,
        ``,
        `requirements:`,
        `  - Requirement 1`,
        ``,
        `acceptance_criteria:`,
        `  - Criterion 1`,
        ``,
        `out_of_scope:`,
        `  - Item 1`,
        ``,
      ].join("\n")
    case "design":
      return [
        `kind: design`,
        `name: ${name}`,
        `title: "${title}"`,
        `status: changing`,
        `version: 1`,
        ``,
        `problem_definition: |`,
        `  Why this change is needed.`,
        ``,
        `goals:`,
        `  - Goal 1`,
        ``,
        `architecture: |`,
        `  ## Components`,
        `  ...`,
        ``,
        `data_model: |`,
        `  ## Table Name`,
        `  | Column | Type | Constraints |`,
        `  |--------|------|-------------|`,
        ``,
        `invariants: []`,
        ``,
        `failure_modes: []`,
        ``,
        `edge_cases: []`,
        ``,
        `work_breakdown:`,
        `  - description: "Phase 1"`,
        ``,
        `retention: |`,
        `  - docs: All versions retained`,
        ``,
        `testing_strategy: |`,
        `  ## Requirement Traceability`,
        `  | Requirement | Test Type | Test Name | Assertions | File Path |`,
        `  |-------------|-----------|-----------|------------|-----------|`,
        `  | Req 1 | integration | should_do_x | Expected output/state | test/integration/feature.test.ts |`,
        ``,
        `  ## Unit Tests`,
        `  - Target functions/services:`,
        `  - Mock boundaries (what is mocked vs real):`,
        `  - Error branches to cover:`,
        ``,
        `  ## Integration Tests (REQUIRED)`,
        `  - Test layer: getSharedTestLayer()`,
        `  - Deterministic IDs: fixtureId(name)`,
        `  - Scenarios (minimum 8):`,
        `    1. Setup / Action / Assert`,
        `    2. Setup / Action / Assert`,
        `    3. Setup / Action / Assert`,
        `    4. Setup / Action / Assert`,
        `    5. Setup / Action / Assert`,
        `    6. Setup / Action / Assert`,
        `    7. Setup / Action / Assert`,
        `    8. Setup / Action / Assert`,
        ``,
        `  ## Failure Injection`,
        `  - Timeout behavior:`,
        `  - Malformed input handling:`,
        `  - Partial failure and retry/idempotency behavior:`,
        ``,
        `  ## Edge Cases`,
        `  - Boundary conditions:`,
        `  - Recovery scenarios:`,
        `  - Concurrent/race scenarios (if applicable):`,
        ``,
        `  ## Performance (if applicable)`,
        `  - Latency target:`,
        `  - Throughput target:`,
        `  - Memory limits:`,
        ``,
      ].join("\n")
  }
}
