/**
 * Spec Traceability Route Handlers
 *
 * Implements spec-trace endpoint handlers for discovery, mapping, and FCI reporting.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import {
  SpecTraceService,
  parseBatchRunInput,
  type BatchSource,
} from "@jamesaphoenix/tx-core"
import { BadRequest, TxApi, mapCoreError } from "../api.js"
import { SPEC_BATCH_MAX_BYTES } from "../middleware/body-limit.js"

import type { BatchRunInput, TraceabilityMatrixEntry, SpecSignoff, SpecTest } from "@jamesaphoenix/tx-types"

const SPEC_BATCH_MAX_RECORDS = 50_000
const MAX_BATCH_PARSE_ERROR_LENGTH = 2_000

const truncateBatchParseError = (error: unknown): string => {
  const message = String(error)
  if (message.length <= MAX_BATCH_PARSE_ERROR_LENGTH) return message
  return `${message.slice(0, MAX_BATCH_PARSE_ERROR_LENGTH)}…[truncated ${message.length - MAX_BATCH_PARSE_ERROR_LENGTH} chars]`
}

const serializeSpecTest = (test: SpecTest) => ({
  id: test.id,
  invariantId: test.invariantId,
  testId: test.testId,
  testFile: test.testFile,
  testName: test.testName,
  framework: test.framework,
  discovery: test.discovery,
  createdAt: test.createdAt.toISOString(),
  updatedAt: test.updatedAt.toISOString(),
})

const serializeMatrixEntry = (entry: TraceabilityMatrixEntry) => ({
  invariantId: entry.invariantId,
  rule: entry.rule,
  subsystem: entry.subsystem,
  tests: entry.tests.map((test) => ({
    specTestId: test.specTestId,
    testId: test.testId,
    testFile: test.testFile,
    testName: test.testName,
    framework: test.framework,
    discovery: test.discovery,
    latestRun: {
      passed: test.latestRun.passed,
      runAt: test.latestRun.runAt ? test.latestRun.runAt.toISOString() : null,
    },
  })),
})

const serializeSignoff = (value: SpecSignoff) => ({
  id: value.id,
  scopeType: value.scopeType,
  scopeValue: value.scopeValue,
  signedOffBy: value.signedOffBy,
  notes: value.notes,
  signedOffAt: value.signedOffAt.toISOString(),
})

const normalizeScope = (scope: { doc?: string; subsystem?: string }) => {
  const doc = scope.doc?.trim()
  const subsystem = scope.subsystem?.trim()
  if (!doc && !subsystem) return undefined
  return {
    doc: doc || undefined,
    subsystem: subsystem || undefined,
  }
}

const parseBatchSource = (from: string | undefined): BatchSource | null => {
  const normalized = from?.trim().toLowerCase()
  if (!normalized || normalized === "generic") return "generic"
  if (normalized === "vitest") return "vitest"
  if (normalized === "pytest") return "pytest"
  if (normalized === "go") return "go"
  if (normalized === "junit") return "junit"
  return null
}

const parseBatchRows = (payload: {
  from?: string
  raw?: string
  results?: readonly BatchRunInput[]
}): Effect.Effect<readonly BatchRunInput[], BadRequest> =>
  Effect.gen(function* () {
    const source = payload.from !== undefined ? parseBatchSource(payload.from) : undefined
    if (payload.from !== undefined && source === null) {
      return yield* Effect.fail(new BadRequest({
        message: `Invalid 'from' value '${payload.from}'. Expected generic|vitest|pytest|go|junit`,
      }))
    }

    const raw = typeof payload.raw === "string" && payload.raw.trim().length > 0
      ? payload.raw
      : undefined
    const resultCount = payload.results?.length ?? 0

    if (raw && resultCount > 0) {
      return yield* Effect.fail(new BadRequest({
        message: "Provide either 'raw' + optional 'from', or 'results' (not both).",
      }))
    }

    if (raw) {
      if (Buffer.byteLength(raw, "utf8") > SPEC_BATCH_MAX_BYTES) {
        return yield* Effect.fail(new BadRequest({
          message: `Raw batch payload exceeds ${SPEC_BATCH_MAX_BYTES} bytes`,
        }))
      }
      try {
        const rows = parseBatchRunInput(raw, source ?? "generic")
        if (rows.length > SPEC_BATCH_MAX_RECORDS) {
          return yield* Effect.fail(new BadRequest({
            message: `Batch input exceeds ${SPEC_BATCH_MAX_RECORDS} records`,
          }))
        }
        return rows
      } catch (error) {
        return yield* Effect.fail(new BadRequest({
          message: truncateBatchParseError(error),
        }))
      }
    }

    if (payload.results && payload.results.length > 0) {
      if (payload.results.length > SPEC_BATCH_MAX_RECORDS) {
        return yield* Effect.fail(new BadRequest({
          message: `Batch input exceeds ${SPEC_BATCH_MAX_RECORDS} records`,
        }))
      }
      return payload.results
    }

    return yield* Effect.fail(new BadRequest({
      message: "No batch results supplied. Provide either 'raw' + optional 'from', or 'results'.",
    }))
  })

export const SpecTraceLive = HttpApiBuilder.group(TxApi, "spec", (handlers) =>
  handlers
    .handle("discoverSpec", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const doc = payload.doc?.trim()
        const patterns = payload.patterns
          ?.map((pattern) => pattern.trim())
          .filter((pattern) => pattern.length > 0)
        return yield* svc.discover({
          doc: doc || undefined,
          patterns: patterns && patterns.length > 0 ? patterns : undefined,
        })
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listSpecTests", ({ path }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const tests = yield* svc.testsForInvariant(path.invariantId)
        return { tests: tests.map(serializeSpecTest) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listSpecGaps", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const gaps = yield* svc.uncoveredInvariants(normalizeScope(urlParams))
        return { gaps }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getSpecFci", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.fci(normalizeScope(urlParams))
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getSpecMatrix", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const matrix = yield* svc.matrix(normalizeScope(urlParams))
        return { matrix: matrix.map(serializeMatrixEntry) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getSpecStatus", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.status(normalizeScope(urlParams))
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listSpecInvariantsForTest", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const testId = urlParams.testId.trim()
        const invariants = yield* svc.invariantsForTest(testId)
        return { testId, invariants }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("linkSpecTest", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const file = payload.file.trim()
        const name = payload.name?.trim()
        const framework = payload.framework?.trim()
        const linked = yield* svc.link(
          payload.invariantId,
          file,
          name && name.length > 0 ? name : undefined,
          framework && framework.length > 0 ? framework : undefined,
        )
        return serializeSpecTest(linked)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("unlinkSpecTest", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const removed = yield* svc.unlink(payload.invariantId, payload.testId)
        return { removed }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("recordSpecRun", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.recordRun(payload.testId, payload.passed, {
          durationMs: payload.durationMs,
          details: payload.details,
          runAt: payload.runAt,
        })
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("batchSpecRuns", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const rows = yield* parseBatchRows(payload)
        return yield* svc.recordBatchRun(rows, {
          runAt: payload.runAt,
        })
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("completeSpec", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const scope = normalizeScope({ doc: payload.doc, subsystem: payload.subsystem })
        const signoff = yield* svc.complete(scope, payload.signedOffBy, payload.notes)
        return serializeSignoff(signoff)
      }).pipe(Effect.mapError(mapCoreError))
    )
)
