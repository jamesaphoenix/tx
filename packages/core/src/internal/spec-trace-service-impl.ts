import { Context, Effect, Layer } from "effect"
import { resolve } from "node:path"
import { XMLParser, XMLValidator } from "fast-xml-parser"
import { SpecTraceRepository, type InvariantSummary, type SpecTraceFilter } from "../repo/spec-trace-repo.js"
import { DocService } from "../services/doc-service.js"
import { DatabaseError, ValidationError } from "../errors.js"
import { defaultSpecTestPatterns, discoverSpecTests } from "../utils/spec-discovery.js"
import { readTxConfig } from "../utils/toml-config.js"
import { toNormalizedRelativePath } from "../utils/file-path.js"
import type {
  BatchRunInput,
  DiscoverResult,
  FciResult,
  SpecScopeType,
  SpecTest,
  SpecSignoff,
  TraceabilityMatrix,
  TraceabilityMatrixEntry,
  TraceabilityMatrixTest,
} from "@jamesaphoenix/tx-types"

export type BatchSource = "generic" | "vitest" | "pytest" | "go" | "junit"

export type BatchRunResult = {
  readonly received: number
  readonly recorded: number
  readonly unmatched: readonly string[]
}

export type SpecTraceStatus = {
  readonly phase: FciResult["phase"]
  readonly fci: number
  readonly gaps: number
  readonly total: number
}

const MAX_RUN_DETAILS_LENGTH = 20_000
export const SPEC_BATCH_MAX_BYTES = 5 * 1024 * 1024
export const SPEC_BATCH_MAX_RECORDS = 50_000

const normalizeDetails = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null
  if (value.length <= MAX_RUN_DETAILS_LENGTH) return value
  return value.slice(0, MAX_RUN_DETAILS_LENGTH)
}

const extractTestNameFromCanonicalId = (testId: string): string | null => {
  const splitAt = testId.lastIndexOf("::")
  if (splitAt < 0) return null
  const name = testId.slice(splitAt + 2).trim()
  return name.length > 0 ? name : null
}

const toCanonicalTestId = (testFile: string, testName: string | null): string => {
  const name = testName && testName.trim().length > 0 ? testName.trim() : "manual"
  return `${testFile}::${name}`
}

const resolveSignoffScope = (filter?: SpecTraceFilter): {
  scopeType: SpecScopeType
  scopeValue: string | null
} | null => {
  const doc = filter?.doc?.trim()
  const subsystem = filter?.subsystem?.trim()

  if (doc && subsystem) return null
  if (doc) return { scopeType: "doc", scopeValue: doc }
  if (subsystem) return { scopeType: "subsystem", scopeValue: subsystem }
  return { scopeType: "global", scopeValue: null }
}

const classifyInvariants = (params: {
  invariants: readonly InvariantSummary[]
  testsByInvariant: ReadonlyMap<string, readonly SpecTest[]>
  latestRunBySpecTestId: ReadonlyMap<number, { passed: boolean }>
}): Omit<FciResult, "fci" | "phase"> & { fciRaw: number } => {
  const { invariants, testsByInvariant, latestRunBySpecTestId } = params

  let covered = 0
  let uncovered = 0
  let passing = 0
  let failing = 0
  let untested = 0

  for (const invariant of invariants) {
    const tests = testsByInvariant.get(invariant.id) ?? []
    if (tests.length === 0) {
      uncovered += 1
      continue
    }

    covered += 1

    const hasFailure = tests.some((test) => {
      const latest = latestRunBySpecTestId.get(test.id)
      return latest ? !latest.passed : false
    })

    if (hasFailure) {
      failing += 1
      continue
    }

    const allPassed = tests.every((test) => {
      const latest = latestRunBySpecTestId.get(test.id)
      return latest ? latest.passed : false
    })

    if (allPassed) {
      passing += 1
    } else {
      untested += 1
    }
  }

  const total = invariants.length
  const fciRaw = total === 0 ? 0 : (passing / total) * 100

  return {
    total,
    covered,
    uncovered,
    passing,
    failing,
    untested,
    fciRaw,
  }
}

export class SpecTraceService extends Context.Tag("SpecTraceService")<
  SpecTraceService,
  {
    readonly discover: (options?: {
      rootDir?: string
      patterns?: readonly string[]
      doc?: string
    }) => Effect.Effect<DiscoverResult, DatabaseError | ValidationError>

    readonly link: (invariantId: string, testFile: string, testName?: string, framework?: string | null) => Effect.Effect<SpecTest, DatabaseError | ValidationError>

    readonly unlink: (invariantId: string, testId: string) => Effect.Effect<boolean, DatabaseError>

    readonly testsForInvariant: (invariantId: string) => Effect.Effect<readonly SpecTest[], DatabaseError>

    readonly invariantsForTest: (testId: string) => Effect.Effect<readonly string[], DatabaseError>

    readonly uncoveredInvariants: (filter?: SpecTraceFilter) => Effect.Effect<readonly InvariantSummary[], DatabaseError>

    readonly recordRun: (testId: string, passed: boolean, options?: {
      durationMs?: number | null
      details?: string | null
      runAt?: string
    }) => Effect.Effect<BatchRunResult, DatabaseError | ValidationError>

    readonly recordBatchRun: (results: readonly BatchRunInput[], options?: {
      runAt?: string
    }) => Effect.Effect<BatchRunResult, DatabaseError>

    readonly fci: (filter?: SpecTraceFilter) => Effect.Effect<FciResult, DatabaseError>

    readonly matrix: (filter?: SpecTraceFilter) => Effect.Effect<TraceabilityMatrix, DatabaseError>

    readonly complete: (filter: SpecTraceFilter | undefined, signedOffBy: string, notes?: string | null) => Effect.Effect<SpecSignoff, DatabaseError | ValidationError>

    readonly status: (filter?: SpecTraceFilter) => Effect.Effect<SpecTraceStatus, DatabaseError>
  }
>() {}

export const SpecTraceServiceLive = Layer.effect(
  SpecTraceService,
  Effect.gen(function* () {
    const repo = yield* SpecTraceRepository
    const docService = yield* DocService

    const resolveLinksForTestId = (testId: string) =>
      Effect.gen(function* () {
        const direct = yield* repo.findSpecTestsByTestId(testId)
        if (direct.length > 0) return direct

        const testName = extractTestNameFromCanonicalId(testId)
        if (!testName) return [] as readonly SpecTest[]

        const byName = yield* repo.findSpecTestsByTestName(testName)
        // Only accept fallback when unambiguous.
        return byName.length === 1 ? byName : []
      })

    const computeFci = (filter?: SpecTraceFilter) =>
      Effect.gen(function* () {
        const invariants = yield* repo.listActiveInvariants(filter)
        const tests = yield* repo.findSpecTestsByInvariantIds(invariants.map((i) => i.id))

        const testsByInvariant = new Map<string, SpecTest[]>()
        for (const test of tests) {
          const current = testsByInvariant.get(test.invariantId) ?? []
          current.push(test)
          testsByInvariant.set(test.invariantId, current)
        }

        const latestRuns = yield* repo.findLatestRunsBySpecTestIds(tests.map((t) => t.id))
        const rollup = classifyInvariants({
          invariants,
          testsByInvariant,
          latestRunBySpecTestId: latestRuns,
        })

        const fci = Number(rollup.fciRaw.toFixed(2))
        let phase: FciResult["phase"] = fci < 100 ? "BUILD" : "HARDEN"

        if (fci === 100) {
          const signoffScope = resolveSignoffScope(filter)
          if (signoffScope) {
            const signoff = yield* repo.findSignoff(signoffScope.scopeType, signoffScope.scopeValue)
            if (signoff) {
              phase = "COMPLETE"
            }
          }
        }

        return {
          total: rollup.total,
          covered: rollup.covered,
          uncovered: rollup.uncovered,
          passing: rollup.passing,
          failing: rollup.failing,
          untested: rollup.untested,
          fci,
          phase,
        } satisfies FciResult
      })

    return {
      discover: (options) =>
        Effect.gen(function* () {
          const rootDir = resolve(options?.rootDir ?? process.cwd())
          const config = readTxConfig(rootDir)
          const patterns = options?.patterns ?? config.spec.testPatterns ?? defaultSpecTestPatterns()

          if (patterns.length === 0) {
            return yield* Effect.fail(new ValidationError({
              reason: "No spec test patterns configured. Set [spec].test_patterns in .tx/config.toml",
            }))
          }

          yield* docService.syncInvariants(options?.doc).pipe(
            Effect.catchTag("DocNotFoundError", (error) =>
              Effect.fail(new ValidationError({
                reason: `Document '${error.name}' not found while syncing invariants`,
              }))
            )
          )

          const discovered = yield* Effect.tryPromise({
            try: () => discoverSpecTests(rootDir, patterns),
            catch: (cause) => new ValidationError({ reason: `Discovery failed: ${String(cause)}` }),
          })

          const activeInvariants = yield* repo.listActiveInvariants(options?.doc ? { doc: options.doc } : undefined)
          const activeInvariantIds = activeInvariants.map((i) => i.id)
          const activeSet = new Set(activeInvariantIds)

          const validRows = discovered.discovered.filter((row) => activeSet.has(row.invariantId))

          const persisted = yield* repo.syncDiscoveredSpecTests({
            rows: validRows,
            invariantIds: activeInvariantIds,
          })

          let tagLinks = 0
          let commentLinks = 0
          let manifestLinks = 0
          for (const row of validRows) {
            if (row.discovery === "tag") tagLinks += 1
            if (row.discovery === "comment") commentLinks += 1
            if (row.discovery === "manifest") manifestLinks += 1
          }

          return {
            scannedFiles: discovered.scannedFiles,
            discoveredLinks: validRows.length,
            upserted: persisted.upserted,
            tagLinks,
            commentLinks,
            manifestLinks,
          }
        }),

      link: (invariantId, testFile, testName, framework) =>
        Effect.gen(function* () {
          const rootDir = resolve(process.cwd())
          const normalizedFile = toNormalizedRelativePath(rootDir, testFile)
          const normalizedName = testName && testName.trim().length > 0 ? testName.trim() : null
          const testId = toCanonicalTestId(normalizedFile, normalizedName)

          return yield* repo.upsertSpecTest({
            invariantId,
            testId,
            testFile: normalizedFile,
            testName: normalizedName,
            framework: framework ?? null,
            discovery: "manual",
          })
        }),

      unlink: (invariantId, testId) => repo.deleteSpecTest(invariantId, testId),

      testsForInvariant: (invariantId) => repo.findSpecTestsByInvariant(invariantId),

      invariantsForTest: (testId) =>
        Effect.gen(function* () {
          const rows = yield* repo.findSpecTestsByTestId(testId)
          return rows.map((row) => row.invariantId)
        }),

      uncoveredInvariants: (filter) => repo.listUncoveredInvariants(filter),

      recordRun: (testId, passed, options) =>
        Effect.gen(function* () {
          const links = yield* resolveLinksForTestId(testId)
          if (links.length === 0) {
            return yield* Effect.fail(new ValidationError({
              reason: `No spec test mapping found for testId '${testId}'`,
            }))
          }

          const inserted = yield* repo.insertRunsBatch(
            links.map((link) => ({
              specTestId: link.id,
              passed,
              durationMs: options?.durationMs,
              details: normalizeDetails(options?.details),
              runAt: options?.runAt,
            }))
          )

          return {
            received: 1,
            recorded: inserted.length,
            unmatched: [],
          }
        }),

      recordBatchRun: (results, options) =>
        Effect.gen(function* () {
          if (results.length === 0) {
            return {
              received: 0,
              recorded: 0,
              unmatched: [],
            }
          }

          const uniqueTestIds = [...new Set(results.map((row) => row.testId))]
          const byTestId = yield* repo.findSpecTestsByTestIds(uniqueTestIds)
          const byNameCache = new Map<string, readonly SpecTest[]>()

          const unmatched = new Set<string>()
          const inserts: Array<{
            specTestId: number
            passed: boolean
            durationMs?: number | null
            details?: string | null
            runAt?: string
          }> = []

          for (const row of results) {
            let links = byTestId.get(row.testId) ?? []

            if (links.length === 0) {
              const testName = extractTestNameFromCanonicalId(row.testId)
              if (testName) {
                let cached = byNameCache.get(testName)
                if (!cached) {
                  cached = yield* repo.findSpecTestsByTestName(testName)
                  byNameCache.set(testName, cached)
                }
                if (cached.length === 1) {
                  links = cached
                }
              }
            }

            if (links.length === 0) {
              unmatched.add(row.testId)
              continue
            }

            for (const link of links) {
              inserts.push({
                specTestId: link.id,
                passed: row.passed,
                durationMs: row.durationMs ?? null,
                details: normalizeDetails(row.details ?? null),
                runAt: options?.runAt,
              })
            }
          }

          const inserted = yield* repo.insertRunsBatch(inserts)

          return {
            received: results.length,
            recorded: inserted.length,
            unmatched: [...unmatched],
          }
        }),

      fci: (filter) => computeFci(filter),

      matrix: (filter) =>
        Effect.gen(function* () {
          const invariants = yield* repo.listActiveInvariants(filter)
          const tests = yield* repo.findSpecTestsByInvariantIds(invariants.map((i) => i.id))
          const latestRuns = yield* repo.findLatestRunsBySpecTestIds(tests.map((t) => t.id))

          const testsByInvariant = new Map<string, TraceabilityMatrixTest[]>()
          for (const test of tests) {
            const latest = latestRuns.get(test.id)
            const row: TraceabilityMatrixTest = {
              specTestId: test.id,
              testId: test.testId,
              testFile: test.testFile,
              testName: test.testName,
              framework: test.framework,
              discovery: test.discovery,
              latestRun: {
                passed: latest ? latest.passed : null,
                runAt: latest ? latest.runAt : null,
              },
            }
            const current = testsByInvariant.get(test.invariantId) ?? []
            current.push(row)
            testsByInvariant.set(test.invariantId, current)
          }

          const out: TraceabilityMatrixEntry[] = invariants.map((invariant) => ({
            invariantId: invariant.id,
            rule: invariant.rule,
            subsystem: invariant.subsystem,
            tests: (testsByInvariant.get(invariant.id) ?? []).sort((a, b) => a.testId.localeCompare(b.testId)),
          }))

          return out
        }),

      complete: (filter, signedOffBy, notes) =>
        Effect.gen(function* () {
          const normalizedBy = signedOffBy.trim()
          if (normalizedBy.length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "signedOffBy is required" }))
          }

          const scope = resolveSignoffScope(filter)
          if (!scope) {
            return yield* Effect.fail(new ValidationError({
              reason: "Sign-off scope must be global, --doc, or --subsystem (not both)",
            }))
          }

          const result = yield* computeFci(filter)
          if (result.phase !== "HARDEN") {
            return yield* Effect.fail(new ValidationError({
              reason: `Cannot complete scope while phase is ${result.phase} (must be HARDEN with FCI 100)`,
            }))
          }

          return yield* repo.upsertSignoff(scope.scopeType, scope.scopeValue, normalizedBy, notes ?? null)
        }),

      status: (filter) =>
        Effect.gen(function* () {
          const fci = yield* computeFci(filter)
          return {
            phase: fci.phase,
            fci: fci.fci,
            gaps: fci.uncovered,
            total: fci.total,
          }
        }),
    }
  })
)

const parseGenericBatch = (value: unknown): BatchRunInput[] => {
  if (!Array.isArray(value)) {
    throw new ValidationError({ reason: "Generic batch input must be an array" })
  }

  const out: BatchRunInput[] = []
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue
    const row = item as {
      testId?: unknown
      passed?: unknown
      durationMs?: unknown
      details?: unknown
    }

    if (typeof row.testId !== "string" || row.testId.trim().length === 0) continue
    if (typeof row.passed !== "boolean") continue

    const durationMs = typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
      ? Math.max(0, Math.trunc(row.durationMs))
      : undefined
    const details = typeof row.details === "string" ? row.details : undefined

    out.push({
      testId: row.testId,
      passed: row.passed,
      durationMs,
      details,
    })
  }

  return out
}

const parseVitestBatch = (value: unknown): BatchRunInput[] => {
  const out: BatchRunInput[] = []

  if (typeof value !== "object" || value === null) {
    return out
  }

  const obj = value as {
    testResults?: unknown
    files?: unknown
  }

  if (Array.isArray(obj.testResults)) {
    for (const fileEntry of obj.testResults) {
      if (typeof fileEntry !== "object" || fileEntry === null) continue
      const fileObj = fileEntry as {
        name?: unknown
        assertionResults?: unknown
      }
      const fileName = typeof fileObj.name === "string" ? fileObj.name.replace(/\\/g, "/") : "vitest"
      if (!Array.isArray(fileObj.assertionResults)) continue

      for (const assertion of fileObj.assertionResults) {
        if (typeof assertion !== "object" || assertion === null) continue
        const a = assertion as {
          fullName?: unknown
          title?: unknown
          status?: unknown
          duration?: unknown
          failureMessages?: unknown
        }
        const testName = typeof a.fullName === "string" && a.fullName.length > 0
          ? a.fullName
          : typeof a.title === "string"
            ? a.title
            : "vitest"
        const status = typeof a.status === "string" ? a.status : "failed"
        if (status !== "passed" && status !== "pass" && status !== "failed" && status !== "fail") {
          continue
        }
        const details = Array.isArray(a.failureMessages)
          ? a.failureMessages.filter((x): x is string => typeof x === "string").join("\n")
          : undefined

        out.push({
          testId: `${fileName}::${testName}`,
          passed: status === "passed" || status === "pass",
          durationMs: typeof a.duration === "number" ? Math.max(0, Math.trunc(a.duration)) : undefined,
          details,
        })
      }
    }
  }

  if (Array.isArray(obj.files)) {
    const collectTasks = (prefixFile: string, tasks: unknown): void => {
      if (!Array.isArray(tasks)) return
      for (const task of tasks) {
        if (typeof task !== "object" || task === null) continue
        const t = task as {
          type?: unknown
          name?: unknown
          result?: unknown
          tasks?: unknown
        }

        const result = typeof t.result === "object" && t.result !== null
          ? (t.result as { state?: unknown; duration?: unknown; errors?: unknown })
          : null

        if (typeof t.name === "string" && result && typeof result.state === "string") {
          if (result.state !== "pass" && result.state !== "fail") {
            collectTasks(prefixFile, t.tasks)
            continue
          }
          const errors = Array.isArray(result.errors)
            ? result.errors.map((e) => String(e)).join("\n")
            : undefined
          out.push({
            testId: `${prefixFile}::${t.name}`,
            passed: result.state === "pass",
            durationMs: typeof result.duration === "number" ? Math.max(0, Math.trunc(result.duration)) : undefined,
            details: errors,
          })
        }

        collectTasks(prefixFile, t.tasks)
      }
    }

    for (const fileEntry of obj.files) {
      if (typeof fileEntry !== "object" || fileEntry === null) continue
      const fileObj = fileEntry as { filepath?: unknown; name?: unknown; tasks?: unknown }
      const fileName = typeof fileObj.filepath === "string"
        ? fileObj.filepath.replace(/\\/g, "/")
        : typeof fileObj.name === "string"
          ? fileObj.name.replace(/\\/g, "/")
          : "vitest"
      collectTasks(fileName, fileObj.tasks)
    }
  }

  return out
}

const parsePytestBatch = (value: unknown): BatchRunInput[] => {
  const out: BatchRunInput[] = []
  if (typeof value !== "object" || value === null) return out

  const obj = value as { tests?: unknown }
  if (!Array.isArray(obj.tests)) return out

  for (const entry of obj.tests) {
    if (typeof entry !== "object" || entry === null) continue
    const test = entry as {
      nodeid?: unknown
      outcome?: unknown
      call?: unknown
      longrepr?: unknown
    }

    if (typeof test.nodeid !== "string" || test.nodeid.length === 0) continue
    const outcome = typeof test.outcome === "string" ? test.outcome : "failed"
    if (outcome !== "passed" && outcome !== "failed" && outcome !== "error") {
      continue
    }
    const call = (typeof test.call === "object" && test.call !== null)
      ? (test.call as { duration?: unknown })
      : null

    out.push({
      testId: test.nodeid,
      passed: outcome === "passed",
      durationMs: call && typeof call.duration === "number"
        ? Math.max(0, Math.trunc(call.duration * 1000))
        : undefined,
      details: typeof test.longrepr === "string" ? test.longrepr : undefined,
    })
  }

  return out
}

const getXmlNodeText = (node: unknown): string | undefined => {
  if (typeof node === "string") {
    const text = node.trim()
    return text.length > 0 ? text : undefined
  }

  if (typeof node !== "object" || node === null) return undefined
  const obj = node as Record<string, unknown>
  const parts: string[] = []

  if (typeof obj["@_message"] === "string" && obj["@_message"].trim().length > 0) {
    parts.push(obj["@_message"].trim())
  }
  if (typeof obj["#text"] === "string" && obj["#text"].trim().length > 0) {
    parts.push(obj["#text"].trim())
  }
  if (typeof obj["__cdata"] === "string" && obj["__cdata"].trim().length > 0) {
    parts.push(obj["__cdata"].trim())
  }

  return parts.length > 0 ? parts.join("\n") : undefined
}

const getXmlNodeTexts = (node: unknown): readonly string[] => {
  if (Array.isArray(node)) {
    return node.flatMap((entry) => getXmlNodeTexts(entry))
  }
  const text = getXmlNodeText(node)
  return text ? [text] : []
}

const normalizeJunitFilePath = (value: string): string =>
  value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")

const parseJunitDurationMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value * 1000))
  }
  if (typeof value !== "string") return undefined

  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const normalized = trimmed.includes(",") && !trimmed.includes(".")
    ? trimmed.replace(",", ".")
    : trimmed
  const seconds = Number.parseFloat(normalized)
  if (!Number.isFinite(seconds)) return undefined
  return Math.max(0, Math.trunc(seconds * 1000))
}

const isSkippedJunitCase = (testcase: Record<string, unknown>): boolean => {
  if (testcase.skipped !== undefined) return true

  const status = typeof testcase["@_status"] === "string"
    ? testcase["@_status"].trim().toLowerCase()
    : null
  if (status === "skip" || status === "skipped") return true

  const result = typeof testcase["@_result"] === "string"
    ? testcase["@_result"].trim().toLowerCase()
    : null
  return result === "skip" || result === "skipped"
}

const collectJunitSuites = (node: unknown, out: Array<Record<string, unknown>>): void => {
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectJunitSuites(entry, out)
    }
    return
  }

  if (typeof node !== "object" || node === null) return
  const suite = node as Record<string, unknown>
  out.push(suite)

  if (suite.testsuite !== undefined) {
    collectJunitSuites(suite.testsuite, out)
  }
}

const parseJunitBatch = (rawXml: string): BatchRunInput[] => {
  const validation = XMLValidator.validate(rawXml)
  if (validation !== true) {
    const reason = typeof validation.err?.msg === "string"
      ? validation.err.msg
      : "Malformed XML payload"
    throw new ValidationError({ reason: `Invalid JUnit XML input: ${reason}` })
  }

  let parsed: unknown
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) => name === "testsuite" || name === "testcase",
    })
    parsed = parser.parse(rawXml)
  } catch (error) {
    throw new ValidationError({ reason: `Invalid JUnit XML input: ${String(error)}` })
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError({ reason: "Invalid JUnit XML input: expected XML object root" })
  }

  const root = parsed as Record<string, unknown>
  const suites: Array<Record<string, unknown>> = []

  const testsuitesRoot = root.testsuites
  if (typeof testsuitesRoot === "object" && testsuitesRoot !== null) {
    const testsuitesNode = (testsuitesRoot as Record<string, unknown>).testsuite
    if (testsuitesNode !== undefined) {
      collectJunitSuites(testsuitesNode, suites)
    }
  }

  if (root.testsuite !== undefined) {
    collectJunitSuites(root.testsuite, suites)
  }

  const out: BatchRunInput[] = []

  for (const suite of suites) {
    const suiteFile = typeof suite["@_file"] === "string" && suite["@_file"].trim().length > 0
      ? normalizeJunitFilePath(suite["@_file"])
      : null
    const testcases = Array.isArray(suite.testcase)
      ? suite.testcase
      : suite.testcase !== undefined && suite.testcase !== null
        ? [suite.testcase]
        : []

    for (const testcaseNode of testcases) {
      if (typeof testcaseNode !== "object" || testcaseNode === null) continue
      const testcase = testcaseNode as Record<string, unknown>
      const testName = typeof testcase["@_name"] === "string"
        ? testcase["@_name"].trim()
        : ""
      if (testName.length === 0) continue
      if (isSkippedJunitCase(testcase)) continue

      const className = typeof testcase["@_classname"] === "string" && testcase["@_classname"].trim().length > 0
        ? testcase["@_classname"].trim()
        : null
      const testcaseFile = typeof testcase["@_file"] === "string" && testcase["@_file"].trim().length > 0
        ? normalizeJunitFilePath(testcase["@_file"])
        : null
      const rawTestFile = testcaseFile ?? suiteFile ?? className ?? "junit"
      const testFile = rawTestFile.includes("/")
        ? normalizeJunitFilePath(rawTestFile)
        : rawTestFile
      const failed = testcase.failure !== undefined || testcase.error !== undefined

      const durationMs = parseJunitDurationMs(testcase["@_time"])

      let details: string | undefined
      if (failed) {
        const detailsChunks = [
          ...getXmlNodeTexts(testcase.failure),
          ...getXmlNodeTexts(testcase.error),
        ]
        details = detailsChunks.length > 0 ? detailsChunks.join("\n\n") : undefined
      }

      out.push({
        testId: `${testFile}::${testName}`,
        passed: !failed,
        durationMs,
        details,
      })
    }
  }

  return out
}

const parseGoBatch = (rawText: string): BatchRunInput[] => {
  const outputs = new Map<string, string[]>()
  const final = new Map<string, BatchRunInput>()

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (typeof parsed !== "object" || parsed === null) continue
    const row = parsed as {
      Action?: unknown
      Package?: unknown
      Test?: unknown
      Output?: unknown
      Elapsed?: unknown
    }

    if (typeof row.Test !== "string" || row.Test.length === 0) continue
    const pkg = typeof row.Package === "string" && row.Package.length > 0
      ? row.Package
      : "go"
    const testId = `${pkg}::${row.Test}`

    if (row.Action === "output" && typeof row.Output === "string") {
      const current = outputs.get(testId) ?? []
      current.push(row.Output.trimEnd())
      outputs.set(testId, current)
      continue
    }

    if (row.Action === "pass" || row.Action === "fail") {
      final.set(testId, {
        testId,
        passed: row.Action === "pass",
        durationMs: typeof row.Elapsed === "number"
          ? Math.max(0, Math.trunc(row.Elapsed * 1000))
          : undefined,
        details: row.Action === "fail"
          ? (outputs.get(testId)?.filter((s) => s.length > 0).join("\n") || undefined)
          : undefined,
      })
    }
  }

  return [...final.values()]
}

/** Parse framework-native batch payloads into generic run records. */
export const parseBatchRunInput = (raw: string, source: BatchSource): BatchRunInput[] => {
  if (Buffer.byteLength(raw, "utf8") > SPEC_BATCH_MAX_BYTES) {
    throw new ValidationError({ reason: `Raw batch payload exceeds ${SPEC_BATCH_MAX_BYTES} bytes` })
  }
  if (source === "go") return parseGoBatch(raw)
  if (source === "junit") return parseJunitBatch(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ValidationError({ reason: `Invalid JSON input: ${String(error)}` })
  }

  if (source === "generic") return parseGenericBatch(parsed)
  if (source === "vitest") return parseVitestBatch(parsed)
  if (source === "pytest") return parsePytestBatch(parsed)

  return []
}
