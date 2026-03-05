/**
 * Spec traceability MCP tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import {
  SpecTraceService,
  ValidationError,
  parseBatchRunInput,
  type BatchSource,
} from "@jamesaphoenix/tx-core"
import type { SpecTest, TraceabilityMatrixEntry } from "@jamesaphoenix/tx-types"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

const SPEC_BATCH_MAX_BYTES = 5 * 1024 * 1024
const SPEC_BATCH_MAX_RECORDS = 50_000

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

const normalizeBatchRows = (
  rows: ReadonlyArray<{
    readonly testId: string
    readonly passed: boolean
    readonly durationMs?: number | null
    readonly details?: string | null
  }>
): Array<{
  testId: string
  passed: boolean
  durationMs?: number
  details?: string
}> =>
  rows.map((row) => ({
    testId: row.testId,
    passed: row.passed,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : undefined,
    details: typeof row.details === "string" ? row.details : undefined,
  }))

const handleSpecDiscover = async (args: { doc?: string; patterns?: string[] }): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const doc = args.doc?.trim()
        const patterns = args.patterns
          ?.map((pattern) => pattern.trim())
          .filter((pattern) => pattern.length > 0)
        return yield* svc.discover({
          doc: doc || undefined,
          patterns: patterns && patterns.length > 0 ? patterns : undefined,
        })
      })
    )
    return {
      content: [
        { type: "text", text: `Scanned ${result.scannedFiles} file(s), discovered ${result.discoveredLinks} mapping(s)` },
        { type: "text", text: JSON.stringify(result) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_discover", args, error)
  }
}

const handleSpecLink = async (args: {
  invariantId: string
  file: string
  name?: string
  framework?: string
}): Promise<McpToolResult> => {
  try {
    const linked = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const file = args.file.trim()
        const name = args.name?.trim()
        const framework = args.framework?.trim()
        return yield* svc.link(
          args.invariantId,
          file,
          name && name.length > 0 ? name : undefined,
          framework && framework.length > 0 ? framework : undefined
        )
      })
    )
    const serialized = serializeSpecTest(linked)
    return {
      content: [
        { type: "text", text: `Linked ${linked.invariantId} -> ${linked.testId}` },
        { type: "text", text: JSON.stringify(serialized) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_link", args, error)
  }
}

const handleSpecUnlink = async (args: { invariantId: string; testId: string }): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        const removed = yield* svc.unlink(args.invariantId, args.testId)
        return { removed }
      })
    )
    return {
      content: [
        { type: "text", text: result.removed ? "Mapping removed" : "No mapping removed" },
        { type: "text", text: JSON.stringify(result) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_unlink", args, error)
  }
}

const handleSpecTests = async (args: { invariantId: string }): Promise<McpToolResult> => {
  try {
    const tests = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.testsForInvariant(args.invariantId)
      })
    )
    const serialized = tests.map(serializeSpecTest)
    return {
      content: [
        { type: "text", text: `Found ${serialized.length} linked test(s)` },
        { type: "text", text: JSON.stringify(serialized) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_tests", args, error)
  }
}

const handleSpecInvariantsForTest = async (args: { testId: string }): Promise<McpToolResult> => {
  try {
    const invariants = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.invariantsForTest(args.testId)
      })
    )
    return {
      content: [
        { type: "text", text: `Found ${invariants.length} invariant(s) for test` },
        { type: "text", text: JSON.stringify({ testId: args.testId, invariants }) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_invariants_for_test", args, error)
  }
}

const handleSpecGaps = async (args: { doc?: string; subsystem?: string }): Promise<McpToolResult> => {
  try {
    const gaps = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.uncoveredInvariants(normalizeScope(args))
      })
    )
    return {
      content: [
        { type: "text", text: `Found ${gaps.length} uncovered invariant(s)` },
        { type: "text", text: JSON.stringify(gaps) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_gaps", args, error)
  }
}

const handleSpecFci = async (args: { doc?: string; subsystem?: string }): Promise<McpToolResult> => {
  try {
    const fci = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.fci(normalizeScope(args))
      })
    )
    return {
      content: [
        { type: "text", text: `FCI ${fci.fci}% (${fci.phase})` },
        { type: "text", text: JSON.stringify(fci) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_fci", args, error)
  }
}

const handleSpecMatrix = async (args: { doc?: string; subsystem?: string }): Promise<McpToolResult> => {
  try {
    const matrix = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.matrix(normalizeScope(args))
      })
    )
    const serialized = matrix.map(serializeMatrixEntry)
    return {
      content: [
        { type: "text", text: `Matrix includes ${serialized.length} invariant row(s)` },
        { type: "text", text: JSON.stringify(serialized) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_matrix", args, error)
  }
}

const handleSpecStatus = async (args: { doc?: string; subsystem?: string }): Promise<McpToolResult> => {
  try {
    const status = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.status(normalizeScope(args))
      })
    )
    return {
      content: [
        { type: "text", text: `Phase ${status.phase}, FCI ${status.fci}%` },
        { type: "text", text: JSON.stringify(status) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_status", args, error)
  }
}

const handleSpecRecordRun = async (args: {
  testId: string
  passed: boolean
  durationMs?: number
  details?: string
  runAt?: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.recordRun(args.testId, args.passed, {
          durationMs: args.durationMs,
          details: args.details,
          runAt: args.runAt,
        })
      })
    )
    return {
      content: [
        { type: "text", text: `Recorded ${args.passed ? "PASS" : "FAIL"} for ${args.testId}` },
        { type: "text", text: JSON.stringify(result) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_record_run", args, error)
  }
}

const handleSpecBatchRun = async (args: {
  from?: string
  raw?: string
  results?: Array<{
    testId: string
    passed: boolean
    durationMs?: number | null
    details?: string | null
  }>
  runAt?: string
}): Promise<McpToolResult> => {
  const validationError = (reason: string): McpToolResult =>
    handleToolError("tx_spec_batch_run", args, new ValidationError({ reason }))

  try {
    const source = args.from !== undefined ? parseBatchSource(args.from) : undefined
    if (args.from !== undefined && source === null) {
      return validationError(`Invalid 'from' value '${args.from}'. Expected generic|vitest|pytest|go|junit`)
    }

    const raw = typeof args.raw === "string" && args.raw.trim().length > 0 ? args.raw : undefined
    const hasRaw = raw !== undefined
    const hasResults = Array.isArray(args.results) && args.results.length > 0
    if (hasRaw && hasResults) {
      return validationError("Provide either 'raw' + optional 'from', or 'results' (not both).")
    }

    let rows = normalizeBatchRows(args.results ?? [])
    if (hasRaw) {
      if (Buffer.byteLength(raw, "utf8") > SPEC_BATCH_MAX_BYTES) {
        return validationError(`Raw batch payload exceeds ${SPEC_BATCH_MAX_BYTES} bytes`)
      }
      rows = normalizeBatchRows(parseBatchRunInput(raw, source ?? "generic"))
    }

    if (rows.length === 0) {
      return validationError("No batch results supplied. Provide either 'raw' + optional 'from', or 'results'.")
    }
    if (rows.length > SPEC_BATCH_MAX_RECORDS) {
      return validationError(`Batch input exceeds ${SPEC_BATCH_MAX_RECORDS} records`)
    }

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.recordBatchRun(rows, {
          runAt: args.runAt,
        })
      })
    )

    return {
      content: [
        { type: "text", text: `Recorded ${result.recorded} mapping run(s) from ${result.received} input row(s)` },
        { type: "text", text: JSON.stringify(result) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_batch_run", args, error)
  }
}

const handleSpecComplete = async (args: {
  doc?: string
  subsystem?: string
  by: string
  notes?: string
}): Promise<McpToolResult> => {
  try {
    const signoff = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SpecTraceService
        return yield* svc.complete(normalizeScope(args), args.by, args.notes)
      })
    )

    return {
      content: [
        { type: "text", text: `Scope signed off by ${signoff.signedOffBy}` },
        { type: "text", text: JSON.stringify({
          id: signoff.id,
          scopeType: signoff.scopeType,
          scopeValue: signoff.scopeValue,
          signedOffBy: signoff.signedOffBy,
          notes: signoff.notes,
          signedOffAt: signoff.signedOffAt.toISOString(),
        }) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_spec_complete", args, error)
  }
}

export const registerSpecTraceTools = (server: McpServer): void => {
  registerEffectTool(server,
    "tx_spec_discover",
    "Discover invariant-to-test mappings from source annotations and .tx/spec-tests.yml",
    {
      doc: z.string().optional().describe("Optional doc name to sync before discovery"),
      patterns: z.array(z.string()).optional().describe("Optional file globs overriding configured [spec].test_patterns"),
    },
    handleSpecDiscover,
  )

  registerEffectTool(server,
    "tx_spec_link",
    "Manually link an invariant to a test",
    {
      invariantId: z.string().describe("Invariant ID (e.g. INV-EARS-FL-001)"),
      file: z.string().describe("Relative test file path"),
      name: z.string().optional().describe("Human-readable test name"),
      framework: z.string().optional().describe("Framework label (vitest, pytest, go, etc.)"),
    },
    handleSpecLink,
  )

  registerEffectTool(server,
    "tx_spec_unlink",
    "Remove an invariant-to-test mapping",
    {
      invariantId: z.string().describe("Invariant ID (e.g. INV-EARS-FL-001)"),
      testId: z.string().describe("Canonical test ID: {file}::{name}"),
    },
    handleSpecUnlink,
  )

  registerEffectTool(server,
    "tx_spec_tests",
    "List tests currently linked to an invariant",
    {
      invariantId: z.string().describe("Invariant ID (e.g. INV-EARS-FL-001)"),
    },
    handleSpecTests,
  )

  registerEffectTool(server,
    "tx_spec_invariants_for_test",
    "List invariants currently linked to a canonical test ID",
    {
      testId: z.string().describe("Canonical test ID: {file}::{name}"),
    },
    handleSpecInvariantsForTest,
  )

  registerEffectTool(server,
    "tx_spec_gaps",
    "List uncovered invariants (no linked tests)",
    {
      doc: z.string().optional().describe("Filter by doc name"),
      subsystem: z.string().optional().describe("Filter by subsystem"),
    },
    handleSpecGaps,
  )

  registerEffectTool(server,
    "tx_spec_fci",
    "Compute Feature Completion Index (FCI) and phase for a scope",
    {
      doc: z.string().optional().describe("Filter by doc name"),
      subsystem: z.string().optional().describe("Filter by subsystem"),
    },
    handleSpecFci,
  )

  registerEffectTool(server,
    "tx_spec_matrix",
    "Return full invariant-to-test traceability matrix",
    {
      doc: z.string().optional().describe("Filter by doc name"),
      subsystem: z.string().optional().describe("Filter by subsystem"),
    },
    handleSpecMatrix,
  )

  registerEffectTool(server,
    "tx_spec_status",
    "Return compact scope status (phase, fci, gaps, total)",
    {
      doc: z.string().optional().describe("Filter by doc name"),
      subsystem: z.string().optional().describe("Filter by subsystem"),
    },
    handleSpecStatus,
  )

  registerEffectTool(server,
    "tx_spec_record_run",
    "Record a pass/fail result for a canonical test ID",
    {
      testId: z.string().describe("Canonical test ID: {file}::{name}"),
      passed: z.boolean().describe("Whether the test passed"),
      durationMs: z.number().int().nonnegative().optional().describe("Optional duration in milliseconds"),
      details: z.string().max(100000).optional().describe("Optional details or failure message"),
      runAt: z.string().optional().describe("Optional explicit run timestamp (ISO 8601)"),
    },
    handleSpecRecordRun,
  )

  registerEffectTool(server,
    "tx_spec_batch_run",
    "Record multiple test results in one call (generic rows or framework-native raw output)",
    {
      from: z.string().optional().describe("Parser to use when 'raw' is supplied: generic|vitest|pytest|go|junit"),
      raw: z.string().max(SPEC_BATCH_MAX_BYTES).optional().describe("Raw framework output (JSON/go test -json lines)"),
      results: z.array(z.object({
        testId: z.string(),
        passed: z.boolean(),
        durationMs: z.number().int().nonnegative().optional(),
        details: z.string().max(100000).optional(),
      })).max(SPEC_BATCH_MAX_RECORDS).optional().describe(`Already-normalized batch rows (max ${SPEC_BATCH_MAX_RECORDS})`),
      runAt: z.string().optional().describe("Optional explicit run timestamp (ISO 8601)"),
    },
    handleSpecBatchRun,
  )

  registerEffectTool(server,
    "tx_spec_complete",
    "Record human sign-off and transition scope from HARDEN to COMPLETE",
    {
      doc: z.string().optional().describe("Sign-off doc scope"),
      subsystem: z.string().optional().describe("Sign-off subsystem scope"),
      by: z.string().min(1).describe("Human reviewer identifier"),
      notes: z.string().optional().describe("Optional sign-off notes"),
    },
    handleSpecComplete,
  )
}
