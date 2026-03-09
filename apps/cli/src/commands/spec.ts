/**
 * Spec traceability commands: discover, link, unlink, tests, gaps, fci, matrix, run, batch, complete, status
 */

import { Effect } from "effect"
import { readFileSync } from "node:fs"
import {
  SpecTraceService,
  parseBatchRunInput,
  type BatchSource,
} from "@jamesaphoenix/tx-core"
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
    console.log(`Gaps: ${status.gaps}/${status.total}`)
  })
