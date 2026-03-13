/**
 * Integration tests for MCP-facing spec traceability behavior.
 *
 * These tests validate the core service semantics that MCP tools delegate to:
 * - shared test-id run fanout
 * - batch run ingestion via framework adapters
 * - scoped completion transitions
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { DocService, SpecTraceService, parseBatchRunInput } from "@jamesaphoenix/tx-core"
import { registerSpecTraceTools } from "../../apps/mcp-server/src/tools/spec-trace.js"

type InvariantInput = {
  id: string
  rule: string
  subsystem?: string
}

const setupDocsWorkspace = (cwd: string): void => {
  mkdirSync(join(cwd, ".tx"), { recursive: true })
  mkdirSync(join(cwd, "specs", "prd"), { recursive: true })
  mkdirSync(join(cwd, "specs", "design"), { recursive: true })
}

const writeDocsConfig = (cwd: string, requireEars: boolean): void => {
  writeFileSync(
    join(cwd, ".tx", "config.toml"),
    ["[docs]", 'path = "specs"', `require_ears = ${requireEars}`].join("\n"),
    "utf8"
  )
}

const createDocWithInvariants = (docName: string, invariants: readonly InvariantInput[]) =>
  Effect.gen(function* () {
    const docService = yield* DocService

    const invariantBlock = invariants
      .map((inv) =>
        [
          `  - id: ${inv.id}`,
          `    rule: ${inv.rule}`,
          "    enforcement: integration_test",
          inv.subsystem ? `    subsystem: ${inv.subsystem}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      )
      .join("\n")

    const yamlContent = [
      "kind: prd",
      `name: ${docName}`,
      `title: ${docName}`,
      "status: changing",
      "",
      "invariants:",
      invariantBlock,
    ].join("\n")

    yield* docService.create({
      kind: "prd",
      name: docName,
      title: docName,
      yamlContent,
    })

    return yield* docService.syncInvariants(docName)
  })

describe("MCP Spec Trace Integration", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempDir: string

  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(shared.layer as any)) as Effect.Effect<A, E, never>
    )

  beforeAll(async () => {
    shared = await getSharedTestLayer()
    originalCwd = process.cwd()
  })

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    tempDir = mkdtempSync(join(tmpdir(), "tx-mcp-spec-trace-"))
    setupDocsWorkspace(tempDir)
    writeDocsConfig(tempDir, false)
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("fans out tx_spec_record_run behavior for shared test IDs", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-run-doc", [
          { id: "INV-MCP-RUN-001", rule: "shared test first invariant" },
          { id: "INV-MCP-RUN-002", rule: "shared test second invariant" },
        ])

        const spec = yield* SpecTraceService
        const first = yield* spec.link("INV-MCP-RUN-001", "test/mcp/shared.test.ts", "shared run", "vitest")
        const second = yield* spec.link("INV-MCP-RUN-002", "test/mcp/shared.test.ts", "shared run", "vitest")

        const runResult = yield* spec.recordRun(first.testId, true, { durationMs: 6 })
        const fci = yield* spec.fci({ doc: "mcp-run-doc" })
        const matrix = yield* spec.matrix({ doc: "mcp-run-doc" })

        return { runResult, fci, matrix, first, second }
      })
    )

    expect(payload.first.testId).toBe("test/mcp/shared.test.ts::shared run")
    expect(payload.second.testId).toBe("test/mcp/shared.test.ts::shared run")
    expect(payload.runResult.received).toBe(1)
    expect(payload.runResult.recorded).toBe(2)
    expect(payload.runResult.unmatched).toEqual([])

    expect(payload.fci.fci).toBe(100)
    expect(payload.fci.phase).toBe("HARDEN")
    expect(payload.fci.passing).toBe(2)

    expect(payload.matrix).toHaveLength(2)
    expect(payload.matrix.every((entry) => entry.tests[0]?.latestRun.passed === true)).toBe(true)
  })

  it("ingests pytest/go batch payloads and reports unmatched records", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-batch-doc", [
          { id: "INV-MCP-BATCH-001", rule: "go path" },
          { id: "INV-MCP-BATCH-002", rule: "pytest path" },
        ])

        const spec = yield* SpecTraceService
        yield* spec.link("INV-MCP-BATCH-001", "pkg/mcp", "TestMcpGo", "go")
        yield* spec.link("INV-MCP-BATCH-002", "tests/test_mcp.py", "test_mcp_case", "pytest")

        const pytestRows = parseBatchRunInput(
          JSON.stringify({
            tests: [
              {
                nodeid: "tests/test_mcp.py::test_mcp_case",
                outcome: "failed",
                call: { duration: 0.020 },
                longrepr: "assertion error",
              },
            ],
          }),
          "pytest"
        )

        const goRows = parseBatchRunInput(
          [
            "{\"Action\":\"output\",\"Package\":\"pkg/mcp\",\"Test\":\"TestMcpGo\",\"Output\":\"ok\"}",
            "{\"Action\":\"pass\",\"Package\":\"pkg/mcp\",\"Test\":\"TestMcpGo\",\"Elapsed\":0.004}",
          ].join("\n"),
          "go"
        )

        const genericRows = parseBatchRunInput(
          JSON.stringify([{ testId: "missing::mcp", passed: true }]),
          "generic"
        )

        const combined = [...pytestRows, ...goRows, ...genericRows]
        const batch = yield* spec.recordBatchRun(combined)
        const fci = yield* spec.fci({ doc: "mcp-batch-doc" })

        return { batch, fci, combined }
      })
    )

    expect(payload.combined).toHaveLength(3)
    expect(payload.batch.received).toBe(3)
    expect(payload.batch.recorded).toBe(2)
    expect(payload.batch.unmatched).toEqual(["missing::mcp"])

    expect(payload.fci.total).toBe(2)
    expect(payload.fci.passing).toBe(1)
    expect(payload.fci.failing).toBe(1)
    expect(payload.fci.fci).toBe(50)
    expect(payload.fci.phase).toBe("BUILD")
  })

  it("ingests junit batch payloads with routing normalization, skipped-status filtering, and details", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-junit-doc", [
          { id: "INV-MCP-JUNIT-001", rule: "junit passing path" },
          { id: "INV-MCP-JUNIT-002", rule: "junit failing path" },
        ])

        const spec = yield* SpecTraceService
        yield* spec.link("INV-MCP-JUNIT-001", "test/junit/example.test.ts", "passes", "junit")
        yield* spec.link("INV-MCP-JUNIT-002", "test/junit/example.test.ts", "fails", "junit")

        const rows = parseBatchRunInput(
          [
            "<testsuites>",
            '<testsuite name="example" file="test/junit/ignored-suite-file.test.ts">',
            '<testcase name="passes" file=".\\\\test\\\\junit\\\\example.test.ts" time="0,010"/>',
            '<testcase name="fails" file=".\\\\test\\\\junit\\\\example.test.ts" time="0.020"><failure message="oops">stack</failure><error message="err">trace</error></testcase>',
            '<testcase name="skip" status="skipped"/>',
            "</testsuite>",
            "</testsuites>",
          ].join(""),
          "junit"
        )

        const batch = yield* spec.recordBatchRun(rows)
        const fci = yield* spec.fci({ doc: "mcp-junit-doc" })
        const matrix = yield* spec.matrix({ doc: "mcp-junit-doc" })

        return { rows, batch, fci, matrix }
      })
    )

    expect(payload.rows).toHaveLength(2)
    expect(payload.rows.map((row) => row.testId)).toEqual([
      "test/junit/example.test.ts::passes",
      "test/junit/example.test.ts::fails",
    ])
    expect(payload.rows[0]!.durationMs).toBe(10)
    expect(payload.rows[1]!.details).toContain("oops")
    expect(payload.rows[1]!.details).toContain("stack")
    expect(payload.rows[1]!.details).toContain("err")
    expect(payload.rows[1]!.details).toContain("trace")
    expect(payload.batch.received).toBe(2)
    expect(payload.batch.recorded).toBe(2)
    expect(payload.batch.unmatched).toEqual([])

    expect(payload.fci.total).toBe(2)
    expect(payload.fci.passing).toBe(1)
    expect(payload.fci.failing).toBe(1)
    expect(payload.fci.fci).toBe(50)

    const byInvariant = new Map(payload.matrix.map((entry) => [entry.invariantId, entry]))
    expect(byInvariant.get("INV-MCP-JUNIT-001")?.tests[0]?.latestRun.passed).toBe(true)
    expect(byInvariant.get("INV-MCP-JUNIT-002")?.tests[0]?.latestRun.passed).toBe(false)
  })

  it("transitions subsystem scope to COMPLETE after HARDEN sign-off", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-scope-doc", [
          { id: "INV-MCP-SCOPE-001", rule: "scope first", subsystem: "mcp-subsystem" },
          { id: "INV-MCP-SCOPE-002", rule: "scope second", subsystem: "mcp-subsystem" },
        ])

        const spec = yield* SpecTraceService
        const first = yield* spec.link("INV-MCP-SCOPE-001", "test/mcp/scope.test.ts", "scope A", "vitest")
        const second = yield* spec.link("INV-MCP-SCOPE-002", "test/mcp/scope.test.ts", "scope B", "vitest")

        yield* spec.recordBatchRun([
          { testId: first.testId, passed: true },
          { testId: second.testId, passed: true },
        ])

        const before = yield* spec.status({ subsystem: "mcp-subsystem" })
        const signoff = yield* spec.complete({ subsystem: "mcp-subsystem" }, "mcp-reviewer", "approved")
        const after = yield* spec.status({ subsystem: "mcp-subsystem" })
        const matrix = yield* spec.matrix({ subsystem: "mcp-subsystem" })

        return { before, signoff, after, matrix }
      })
    )

    expect(payload.before.phase).toBe("HARDEN")
    expect(payload.before.fci).toBe(100)
    expect(payload.before.total).toBe(2)

    expect(payload.signoff.scopeType).toBe("subsystem")
    expect(payload.signoff.scopeValue).toBe("mcp-subsystem")
    expect(payload.signoff.signedOffBy).toBe("mcp-reviewer")

    expect(payload.after.phase).toBe("COMPLETE")
    expect(payload.after.fci).toBe(100)
    expect(payload.after.gaps).toBe(0)

    expect(payload.matrix).toHaveLength(2)
  })

  it("supports reverse lookup + unlink and reports status after mapping changes", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-unlink-doc", [
          { id: "INV-MCP-UNLINK-001", rule: "unlink first" },
          { id: "INV-MCP-UNLINK-002", rule: "unlink second" },
        ])

        const spec = yield* SpecTraceService
        const linked = yield* spec.link("INV-MCP-UNLINK-001", "test/mcp/unlink.test.ts", "unlink case", "vitest")
        yield* spec.link("INV-MCP-UNLINK-002", "test/mcp/unlink.test.ts", "unlink case", "vitest")

        const beforeInvariants = yield* spec.invariantsForTest(linked.testId)
        const removed = yield* spec.unlink("INV-MCP-UNLINK-002", linked.testId)
        const afterInvariants = yield* spec.invariantsForTest(linked.testId)
        const status = yield* spec.status({ doc: "mcp-unlink-doc" })

        return { linked, beforeInvariants, removed, afterInvariants, status }
      })
    )

    expect([...payload.beforeInvariants].sort()).toEqual(["INV-MCP-UNLINK-001", "INV-MCP-UNLINK-002"])
    expect(payload.removed).toBe(true)
    expect(payload.afterInvariants).toEqual(["INV-MCP-UNLINK-001"])
    expect(payload.status.phase).toBe("BUILD")
    expect(payload.status.total).toBe(2)
    expect(payload.status.gaps).toBe(1)
  })

  it("validates tx_spec_batch_run input in MCP tool handler before runtime execution", async () => {
    const handlers = new Map<string, (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>>()
    const fakeServer = {
      tool: (
        name: string,
        _description: string,
        _schema: unknown,
        handler: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>
      ) => {
        handlers.set(name, handler)
      },
    } as Parameters<typeof registerSpecTraceTools>[0]

    registerSpecTraceTools(fakeServer)
    const batchHandler = handlers.get("tx_spec_batch_run")
    expect(batchHandler).toBeDefined()

    const invalidFromWithoutRaw = await batchHandler!({
      from: "definitely-invalid",
      results: [],
    })
    expect(invalidFromWithoutRaw.isError).toBe(true)
    expect(invalidFromWithoutRaw.content[0]?.text ?? "").toContain("Invalid 'from' value")

    const invalidFromWithResults = await batchHandler!({
      from: "definitely-invalid",
      results: [{ testId: "missing::api-invalid-from-results", passed: true }],
    })
    expect(invalidFromWithResults.isError).toBe(true)
    expect(invalidFromWithResults.content[0]?.text ?? "").toContain("Invalid 'from' value")

    const invalidFromWithRaw = await batchHandler!({
      from: "definitely-invalid",
      raw: "[]",
    })
    expect(invalidFromWithRaw.isError).toBe(true)
    expect(invalidFromWithRaw.content[0]?.text ?? "").toContain("Invalid 'from' value")

    const mixedPayload = await batchHandler!({
      from: "generic",
      raw: JSON.stringify([{ testId: "missing::raw", passed: true }]),
      results: [{ testId: "missing::results", passed: true }],
    })
    expect(mixedPayload.isError).toBe(true)
    expect(mixedPayload.content[0]?.text ?? "").toContain("Provide either 'raw' + optional 'from', or 'results' (not both).")

    const malformedDefaultRaw = await batchHandler!({
      raw: "{not-json}",
    })
    expect(malformedDefaultRaw.isError).toBe(true)
    expect(malformedDefaultRaw.content[0]?.text ?? "").toContain("Invalid JSON input")

    const malformedJunit = await batchHandler!({
      from: "junit",
      raw: "<testsuite><testcase name=\"broken\"></testsuite>",
    })
    expect(malformedJunit.isError).toBe(true)
    expect(malformedJunit.content[0]?.text ?? "").toContain("Invalid JUnit XML input")

    const normalizedFrom = await batchHandler!({
      from: "  JUNIT  ",
      raw: "<testsuite><testcase name=\"broken\"></testsuite>",
    })
    expect(normalizedFrom.isError).toBe(true)
    expect(normalizedFrom.content[0]?.text ?? "").toContain("Invalid JUnit XML input")

    const oversizedRaw = await batchHandler!({
      from: "junit",
      raw: "x".repeat((5 * 1024 * 1024) + 1),
    })
    expect(oversizedRaw.isError).toBe(true)
    expect(oversizedRaw.content[0]?.text ?? "").toContain("Raw batch payload exceeds")

    const oversizedResults = await batchHandler!({
      results: Array.from({ length: 50_001 }, (_, i) => ({
        testId: `missing::${i}`,
        passed: true,
      })),
    })
    expect(oversizedResults.isError).toBe(true)
    expect(oversizedResults.content[0]?.text ?? "").toContain("Batch input exceeds 50000 records")
  })
})
