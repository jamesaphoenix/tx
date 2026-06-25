/**
 * Spec traceability commands: discover, link, unlink, tests, gaps, fci, matrix, run, batch, complete, status
 */

import { Effect, Either } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  DocService,
  SpecTraceService,
  parseBatchRunInput,
  parseMdDocSync,
  readTxConfig,
  validateEarsRequirements,
  type BatchSource,
} from "@jamesaphoenix/tx"
import { triangle as specHealthImpl } from "./triangle.js"
import { toJson } from "../output.js"
import { CliExitError } from "../cli-exit.js"
import { type Flags, flag, opt, parseIntOpt } from "../utils/parse.js"

const MAX_BATCH_STDIN_BYTES = 5 * 1024 * 1024
const MAX_BATCH_RECORDS = 50_000

const parseScopeFilter = (flags: Flags): { doc?: string; subsystem?: string } => {
  const doc = opt(flags, "doc")
  const subsystem = opt(flags, "sub", "subsystem")
  return {
    doc: doc?.trim() || undefined,
    subsystem: subsystem?.trim() || undefined,
  }
}

const readStdin = (): string | null => {
  if (process.stdin.isTTY) return null
  const raw = readFileSync(0, "utf-8")
  if (Buffer.byteLength(raw, "utf8") > MAX_BATCH_STDIN_BYTES) {
    console.error(`Batch input exceeds ${MAX_BATCH_STDIN_BYTES} bytes`)
    throw new CliExitError(1)
  }
  return raw.length > 0 ? raw : null
}

const parseBatchSource = (value: string | undefined): BatchSource => {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return "generic"
  if (normalized === "generic" || normalized === "vitest" || normalized === "pytest" || normalized === "go" || normalized === "junit") {
    return normalized
  }
  console.error(`Invalid --from value '${value}'. Expected: generic|vitest|pytest|go|junit`)
  throw new CliExitError(1)
}

const DESIGN_DOC_MISSING_TASK_LINKS_WARNING = /^Design doc '.+' has no linked tasks$/

const shouldReportDriftWarning = (
  doc: { status: string },
  warning: string,
  config: ReturnType<typeof readTxConfig>
): boolean => {
  if (!DESIGN_DOC_MISSING_TASK_LINKS_WARNING.test(warning)) return true
  switch (config.spec.designDocMissingTaskLinks) {
    case "always":
      return true
    case "locked_only":
      return doc.status === "locked"
    case "never":
      return false
  }
  return true
}

/** Dispatch spec subcommands. */
export const spec = (pos: string[], flags: Flags) => {
  const sub = pos[0]
  const rest = pos.slice(1)

  switch (sub) {
    case "discover": return specDiscover(rest, flags)
    case "link": return specLink(rest, flags)
    case "unlink": return specUnlink(rest, flags)
    case "tests": return specTests(rest, flags)
    case "gaps": return specGaps(rest, flags)
    case "fci": return specFci(rest, flags)
    case "matrix": return specMatrix(rest, flags)
    case "run": return specRun(rest, flags)
    case "batch": return specBatch(rest, flags)
    case "complete": return specComplete(rest, flags)
    case "status": return specStatus(rest, flags)
    case "health": return specHealthImpl(rest, flags)
    case "lint": return specLint(rest, flags)
    default:
      return Effect.sync(() => {
        console.error(`Unknown spec subcommand: ${sub ?? "(none)"}`)
        console.error("Run 'tx spec --help' for usage information")
        throw new CliExitError(1)
      })
  }
}

const specDiscover = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const doc = opt(flags, "doc")
    const patternsRaw = opt(flags, "patterns", "p")
    const patterns = patternsRaw
      ? patternsRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : undefined

    const svc = yield* SpecTraceService
    const result = yield* svc.discover({ doc, patterns })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Scanned ${result.scannedFiles} file(s)`)
      console.log(`Discovered links: ${result.discoveredLinks}`)
      console.log(`Upserted links: ${result.upserted}`)
      console.log(`By source: tag=${result.tagLinks}, comment=${result.commentLinks}, manifest=${result.manifestLinks}`)
    }
  })

const specLink = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const invariantId = pos[0]
    const file = pos[1]
    const name = pos[2]

    if (!invariantId || !file) {
      console.error("Usage: tx spec link <inv-id> <file> [name] [--framework <name>]")
      throw new CliExitError(1)
    }

    const framework = opt(flags, "framework")
    const svc = yield* SpecTraceService
    const linked = yield* svc.link(invariantId, file, name, framework)

    if (flag(flags, "json")) {
      console.log(toJson(linked))
    } else {
      console.log(`Linked ${linked.invariantId} -> ${linked.testId}`)
    }
  })

const specUnlink = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const invariantId = pos[0]
    const testId = pos[1]

    if (!invariantId || !testId) {
      console.error("Usage: tx spec unlink <inv-id> <test-id>")
      throw new CliExitError(1)
    }

    const svc = yield* SpecTraceService
    const removed = yield* svc.unlink(invariantId, testId)

    if (flag(flags, "json")) {
      console.log(toJson({ removed }))
    } else {
      console.log(removed ? "Unlinked" : "No link found")
    }
  })

const specTests = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const invariantId = pos[0]
    if (!invariantId) {
      console.error("Usage: tx spec tests <inv-id>")
      throw new CliExitError(1)
    }

    const svc = yield* SpecTraceService
    const tests = yield* svc.testsForInvariant(invariantId)

    if (flag(flags, "json")) {
      console.log(toJson(tests))
      return
    }

    if (tests.length === 0) {
      console.log("No tests linked")
      return
    }

    console.log(`${tests.length} linked test(s):`)
    for (const test of tests) {
      console.log(`  - ${test.testId} [${test.discovery}]`)
    }
  })

const specGaps = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const filter = parseScopeFilter(flags)
    const svc = yield* SpecTraceService
    const gaps = yield* svc.uncoveredInvariants(filter)

    if (flag(flags, "json")) {
      console.log(toJson(gaps))
      return
    }

    if (gaps.length === 0) {
      console.log("No uncovered invariants")
      return
    }

    console.log(`${gaps.length} uncovered invariant(s):`)
    for (const inv of gaps) {
      const scope = inv.subsystem ? ` [${inv.subsystem}]` : ""
      console.log(`  - ${inv.id}${scope} (${inv.docName})`)
    }
  })

const specFci = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const filter = parseScopeFilter(flags)
    const svc = yield* SpecTraceService
    const fci = yield* svc.fci(filter)

    if (flag(flags, "json")) {
      console.log(toJson(fci))
      return
    }

    console.log(`FCI: ${fci.fci}% (${fci.phase})`)
    console.log(`total=${fci.total} covered=${fci.covered} uncovered=${fci.uncovered}`)
    console.log(`passing=${fci.passing} failing=${fci.failing} untested=${fci.untested}`)
  })

const specMatrix = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const filter = parseScopeFilter(flags)
    const svc = yield* SpecTraceService
    const matrix = yield* svc.matrix(filter)

    if (flag(flags, "json")) {
      console.log(toJson(matrix))
      return
    }

    if (matrix.length === 0) {
      console.log("No invariants in selected scope")
      return
    }

    for (const entry of matrix) {
      console.log(`${entry.invariantId}: ${entry.rule}`)
      if (entry.tests.length === 0) {
        console.log("  (no linked tests)")
        continue
      }
      for (const t of entry.tests) {
        const latest = t.latestRun.passed === null
          ? "no-runs"
          : (t.latestRun.passed ? "PASS" : "FAIL")
        console.log(`  - ${t.testId} [${t.discovery}] latest=${latest}`)
      }
    }
  })

const specRun = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const testId = pos[0]
    if (!testId) {
      console.error("Usage: tx spec run <test-id> --passed|--failed [--duration <ms>] [--details <text>]")
      throw new CliExitError(1)
    }

    const passedFlag = flag(flags, "passed")
    const failedFlag = flag(flags, "failed")
    if ((!passedFlag && !failedFlag) || (passedFlag && failedFlag)) {
      console.error("Must specify exactly one of --passed or --failed")
      throw new CliExitError(1)
    }

    const durationMs = parseIntOpt(flags, "duration", "duration")
    const details = opt(flags, "details")

    const svc = yield* SpecTraceService
    const result = yield* svc.recordRun(testId, passedFlag && !failedFlag, {
      durationMs,
      details,
    })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Recorded ${passedFlag ? "PASS" : "FAIL"} for ${testId}`)
      console.log(`Affected mappings: ${result.recorded}`)
    }
  })

const specBatch = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const source = parseBatchSource(opt(flags, "from"))
    const stdin = readStdin()

    if (!stdin || stdin.trim().length === 0) {
      console.error("No input received on stdin. Pipe JSON payload into tx spec batch.")
      throw new CliExitError(1)
    }

    let parsed
    try {
      parsed = parseBatchRunInput(stdin, source)
    } catch (error) {
      console.error(String(error))
      throw new CliExitError(1)
    }
    if (parsed.length > MAX_BATCH_RECORDS) {
      console.error(`Batch input exceeds ${MAX_BATCH_RECORDS} records`)
      throw new CliExitError(1)
    }

    const svc = yield* SpecTraceService
    const result = yield* svc.recordBatchRun(parsed)

    if (flag(flags, "json")) {
      console.log(toJson(result))
      return
    }

    console.log(`Batch source: ${source}`)
    console.log(`Received: ${result.received}`)
    console.log(`Recorded: ${result.recorded}`)
    if (result.unmatched.length > 0) {
      console.log(`Unmatched: ${result.unmatched.length}`)
      for (const testId of result.unmatched) {
        console.log(`  - ${testId}`)
      }
    }
  })

const specComplete = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const filter = parseScopeFilter(flags)
    const signedOffBy = opt(flags, "by")
    if (!signedOffBy) {
      console.error("Usage: tx spec complete [--doc <name> | --sub <name>] --by <human> [--notes <text>]")
      throw new CliExitError(1)
    }

    const notes = opt(flags, "notes") ?? null
    const svc = yield* SpecTraceService
    const signoff = yield* svc.complete(filter, signedOffBy, notes)

    if (flag(flags, "json")) {
      console.log(toJson(signoff))
      return
    }

    const scope = signoff.scopeValue ? `${signoff.scopeType}:${signoff.scopeValue}` : signoff.scopeType
    console.log(`Recorded COMPLETE sign-off for ${scope}`)
    console.log(`By: ${signoff.signedOffBy}`)
  })

const specStatus = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const filter = parseScopeFilter(flags)
    const svc = yield* SpecTraceService
    const status = yield* svc.status(filter)

    if (flag(flags, "json")) {
      console.log(toJson(status))
      return
    }

    console.log(`Phase: ${status.phase}`)
    console.log(`FCI: ${status.fci}%`)
    console.log(`Coverage: ${status.covered}/${status.total}`)
    console.log(
      `State: ${status.passing} passing, ${status.failing} failing, ${status.untested} untested, ${status.uncovered} uncovered`
    )
    if (status.blockers.length > 0) {
      console.log("Blockers:")
      for (const blocker of status.blockers) {
        console.log(`  - ${blocker}`)
      }
    } else {
      console.log("Blockers: none")
    }
  })

const earsFixHint = (e: { field: string; code: string }): string | undefined => {
  if (e.code === "missing_required") {
    switch (e.field) {
      case "when": return 'Add `when: "<trigger condition>"` to this requirement'
      case "while": return 'Add `while: "<state condition>"` to this requirement'
      case "if": return 'Add `if: "<unwanted condition>"` to this requirement'
      case "where": return 'Add `where: "<feature flag>"` to this requirement'
      case "kind": return "Add `kind:` — one of: ubiquitous, event-driven, state-driven, unwanted, optional, complex"
      case "statement": return 'Add `statement: "the system shall …"`'
      case "priority": return "Add `priority:` — one of: must, should, could, wont"
      case "id": return "Add `id: REQ-<SCOPE>-<NNN>` (e.g. REQ-DOCS-001)"
      case "pattern": return "Add `pattern:` — one of: ubiquitous, event_driven, state_driven, unwanted, optional, complex"
      case "system": return 'Add `system: "<system name>"`'
      case "response": return 'Add `response: "<what the system does>"`'
      default: return `Add the missing '${e.field}' field`
    }
  }
  if (e.code === "duplicate_id") return "Change the id to be unique across all requirements"
  if (e.code === "invalid_type") return "Each requirement must be a YAML object with id, kind, statement, and priority fields"
  return undefined
}

/**
 * spec lint — all-in-one check: drift, EARS validation, task-doc coverage, spec status, health rollup.
 */
const specLint = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const jsonMode = flag(flags, "json")
    const docSvc = yield* DocService
    const specTraceSvc = yield* SpecTraceService
    const config = readTxConfig()

    let hasErrors = false
    type LintIssue = { section: string; severity: "error" | "warn"; message: string; hint?: string }
    const issues: LintIssue[] = []

    const addIssue = (section: string, severity: "error" | "warn", message: string, hint?: string) => {
      issues.push({ section, severity, message, hint })
      if (severity === "error") hasErrors = true
    }

    // --- 1. Doc drift (hash mismatch between disk and DB) ---
    const docs = yield* docSvc.list()
    let driftCount = 0
    for (const doc of docs) {
      const driftWarnings = yield* docSvc.detectDrift(doc.name).pipe(
        Effect.catchAll(() => Effect.succeed([] as string[]))
      )
      const reportedDriftWarnings = driftWarnings.filter((warning) =>
        shouldReportDriftWarning(doc, warning, config)
      )
      if (reportedDriftWarnings.length > 0) {
        driftCount++
        for (const w of reportedDriftWarnings) {
          addIssue("drift", "warn", `${doc.name}: ${w}`)
        }
      }
    }

    // --- 2. Task-doc coverage (unlinked tasks) ---
    const taskWarnings = yield* docSvc.validate()
    for (const w of taskWarnings) {
      addIssue("coverage", "warn", w)
    }

    // --- 3. Searchable index metadata (summary/domain/tags -> specs/index.md) ---
    const indexWarnings = yield* docSvc.validateIndexSearchability()
    for (const w of indexWarnings) {
      addIssue("index", "warn", w)
    }

    // --- 4. EARS lint (validate PRD requirements) ---
    const prdDocs = docs.filter(d => d.kind === "prd")
    for (const doc of prdDocs) {
      const absPath = resolve(config.docs.path, doc.filePath)
      if (!existsSync(absPath)) {
        addIssue("ears", "error", `${doc.name}: file not found at ${doc.filePath}`)
        continue
      }
      let content: string
      try {
        content = readFileSync(absPath, "utf8")
      } catch {
        addIssue("ears", "error", `${doc.name}: unreadable file`)
        continue
      }
      const parsed = parseMdDocSync(content)
      if (Either.isLeft(parsed)) {
        addIssue("ears", "error", `${doc.name}: parse error — ${parsed.left.reason}`)
        continue
      }
      if (parsed.right.kind !== "spec" || parsed.right.frontmatter.spec_type !== "prd") continue
      const earsReqs = parsed.right.blocks.ears_requirements ?? []
      if (earsReqs.length === 0) continue
      const earsErrors = validateEarsRequirements(earsReqs)
      for (const e of earsErrors) {
        const loc = e.id ? e.id : `entry #${e.index + 1}`
        addIssue("ears", "error", `${doc.filePath}: ${loc} (${e.field}) ${e.message}`, earsFixHint(e))
      }
    }

    // --- 5. Spec-test status ---
    const fci = yield* specTraceSvc.fci().pipe(
      Effect.catchAll(() => Effect.succeed({ total: 0, covered: 0, uncovered: 0, passing: 0, failing: 0, untested: 0, fci: 100, phase: "BUILD" as const }))
    )
    if (fci.failing > 0) {
      addIssue("spec", "error", `${fci.failing} invariant(s) with failing tests`)
    }
    if (fci.uncovered > 0) {
      addIssue("spec", "warn", `${fci.uncovered} invariant(s) with no linked tests`)
    }

    // --- Output ---
    if (jsonMode) {
      console.log(toJson({
        ok: !hasErrors,
        total_docs: docs.length,
        drift_count: driftCount,
        coverage_warnings: taskWarnings.length,
        index_warnings: indexWarnings.length,
        fci: fci.fci,
        phase: fci.phase,
        issues,
      }))
    } else {
      const ok = issues.length === 0
      console.log(`Spec Lint: ${ok ? "CLEAN" : hasErrors ? "FAIL" : "WARN"}`)
      console.log("")
      console.log(`  Docs:      ${docs.length} total, ${driftCount} drifted`)
      console.log(`  Coverage:  ${taskWarnings.length} unlinked task(s)`)
      console.log(`  Index:     ${indexWarnings.length} searchable metadata warning(s)`)
      console.log(`  EARS:      ${prdDocs.length} PRD(s) checked`)
      if (fci.total > 0) {
        console.log(`  Spec-Test: ${fci.covered}/${fci.total} covered (${fci.fci}%, ${fci.phase})`)
      } else {
        console.log("  Spec-Test: no invariants")
      }

      if (issues.length > 0) {
        const sectionOrder = ["drift", "coverage", "index", "ears", "spec"] as const
        const sectionLabels: Record<string, string> = {
          drift: "Drift",
          coverage: "Coverage",
          index: "Index Searchability",
          ears: "EARS Requirements",
          spec: "Spec Tests",
        }
        for (const section of sectionOrder) {
          const sectionIssues = issues.filter(i => i.section === section)
          if (sectionIssues.length === 0) continue
          console.log("")
          console.log(`  ${sectionLabels[section]}:`)
          for (const issue of sectionIssues) {
            const icon = issue.severity === "error" ? "\u2717" : "\u26a0"
            console.log(`    ${icon} ${issue.message}`)
            if (issue.hint) {
              console.log(`      \u2192 ${issue.hint}`)
            }
          }
          if (section === "ears" && sectionIssues.length > 0) {
            console.log("")
            console.log("    Fix: edit the spec file directly, then run `tx doc sync`. Do NOT use `tx doc rm` + `tx doc add` (this overwrites content).")
          }
        }
      }
    }

    if (hasErrors) {
      throw new CliExitError(1)
    }
  })
