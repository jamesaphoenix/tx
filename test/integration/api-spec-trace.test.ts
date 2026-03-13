/**
 * Integration tests for API-facing spec traceability behavior.
 *
 * These tests exercise real services/layers and assert API-shaped outputs
 * (serialized dates, status fields, and error mapping behavior).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { DocService, SpecTraceService, parseBatchRunInput } from "@jamesaphoenix/tx-core"
import { mapCoreError } from "../../apps/api-server/src/api.js"
import type { SpecSignoff, TraceabilityMatrix } from "@jamesaphoenix/tx-types"

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

const serializeSignoff = (value: SpecSignoff) => ({
  id: value.id,
  scopeType: value.scopeType,
  scopeValue: value.scopeValue,
  signedOffBy: value.signedOffBy,
  notes: value.notes,
  signedOffAt: value.signedOffAt.toISOString(),
})

const serializeMatrix = (matrix: TraceabilityMatrix) =>
  matrix.map((entry) => ({
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
  }))

describe("API Spec Trace Integration", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempDir: string

  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect.pipe(Effect.provide(shared.layer)) as Effect.Effect<A, E, never>)

  beforeAll(async () => {
    shared = await getSharedTestLayer()
    originalCwd = process.cwd()
  })

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    tempDir = mkdtempSync(join(tmpdir(), "tx-api-spec-trace-"))
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

  it("returns API-shaped phase transitions for BUILD/HARDEN/COMPLETE", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("api-phase-doc", [
          { id: "INV-API-PHASE-001", rule: "api phase transition invariant" },
        ])

        const spec = yield* SpecTraceService
        const linked = yield* spec.link(
          "INV-API-PHASE-001",
          "test/api/phase.test.ts",
          "api phase case",
          "vitest"
        )

        const build = yield* spec.fci({ doc: "api-phase-doc" })
        yield* spec.recordRun(linked.testId, true, { durationMs: 8 })
        const harden = yield* spec.fci({ doc: "api-phase-doc" })
        const signoff = yield* spec.complete({ doc: "api-phase-doc" }, "api-reviewer", "ship it")
        const status = yield* spec.status({ doc: "api-phase-doc" })

        return {
          build: { ...build },
          harden: { ...harden },
          signoff: serializeSignoff(signoff),
          status: { ...status },
        }
      })
    )

    expect(payload.build.phase).toBe("BUILD")
    expect(payload.build.fci).toBe(0)

    expect(payload.harden.phase).toBe("HARDEN")
    expect(payload.harden.fci).toBe(100)

    expect(payload.signoff.scopeType).toBe("doc")
    expect(payload.signoff.scopeValue).toBe("api-phase-doc")
    expect(payload.signoff.signedOffBy).toBe("api-reviewer")
    expect(typeof payload.signoff.signedOffAt).toBe("string")
    expect(new Date(payload.signoff.signedOffAt).toString()).not.toBe("Invalid Date")

    expect(payload.status.phase).toBe("COMPLETE")
    expect(payload.status.fci).toBe(100)
    expect(payload.status.gaps).toBe(0)
    expect(payload.status.total).toBe(1)
    expect(payload.status.blockers).toEqual([])
    expect(payload.status.signedOff).toBe(true)
  })

  it("ingests vitest batch payloads and returns matrix/latest-run values for API responses", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("api-batch-doc", [
          { id: "INV-API-BATCH-001", rule: "api batch pass" },
          { id: "INV-API-BATCH-002", rule: "api batch fail" },
        ])

        const spec = yield* SpecTraceService
        yield* spec.link("INV-API-BATCH-001", "test/api/spec-a.test.ts", "API spec A", "vitest")
        yield* spec.link("INV-API-BATCH-002", "test/api/spec-b.test.ts", "API spec B", "vitest")

        const rows = parseBatchRunInput(
          JSON.stringify({
            files: [
              {
                filepath: "test/api/spec-a.test.ts",
                tasks: [
                  {
                    name: "API spec A",
                    result: { state: "pass", duration: 5 },
                  },
                ],
              },
              {
                filepath: "test/api/spec-b.test.ts",
                tasks: [
                  {
                    name: "API spec B",
                    result: { state: "fail", duration: 12, errors: ["boom"] },
                  },
                ],
              },
            ],
          }),
          "vitest"
        )

        const batch = yield* spec.recordBatchRun(rows)
        const fci = yield* spec.fci({ doc: "api-batch-doc" })
        const matrix = yield* spec.matrix({ doc: "api-batch-doc" })

        return {
          batch,
          fci,
          matrix: serializeMatrix(matrix),
        }
      })
    )

    expect(payload.batch.received).toBe(2)
    expect(payload.batch.recorded).toBe(2)
    expect(payload.batch.unmatched).toEqual([])

    expect(payload.fci.phase).toBe("BUILD")
    expect(payload.fci.fci).toBe(50)
    expect(payload.fci.passing).toBe(1)
    expect(payload.fci.failing).toBe(1)

    expect(payload.matrix).toHaveLength(2)
    const byInvariant = new Map(payload.matrix.map((entry) => [entry.invariantId, entry]))
    const a = byInvariant.get("INV-API-BATCH-001")
    const b = byInvariant.get("INV-API-BATCH-002")

    expect(a?.tests[0]?.latestRun.passed).toBe(true)
    expect(typeof a?.tests[0]?.latestRun.runAt).toBe("string")
    expect(b?.tests[0]?.latestRun.passed).toBe(false)
    expect(typeof b?.tests[0]?.latestRun.runAt).toBe("string")
  })

  it("ingests junit batch payloads with testcase file routing, skipped-status filtering, and details", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("api-junit-doc", [
          { id: "INV-API-JUNIT-001", rule: "api junit pass" },
          { id: "INV-API-JUNIT-002", rule: "api junit fail" },
        ])

        const spec = yield* SpecTraceService
        yield* spec.link("INV-API-JUNIT-001", "test/api/junit-route.test.ts", "passes", "junit")
        yield* spec.link("INV-API-JUNIT-002", "test/api/junit-route.test.ts", "fails", "junit")

        const rows = parseBatchRunInput(
          [
            "<testsuites>",
            '<testsuite name="suite" file="test/api/ignored-suite-file.test.ts">',
            '<testcase name="passes" file=".\\\\test\\\\api\\\\junit-route.test.ts" time="0,003"/>',
            '<testcase name="fails" file=".\\\\test\\\\api\\\\junit-route.test.ts" time="0.011"><failure message="boom">stack</failure></testcase>',
            '<testcase name="skip-this" status="skipped"/>',
            "</testsuite>",
            "</testsuites>",
          ].join(""),
          "junit"
        )

        const batch = yield* spec.recordBatchRun(rows)
        const matrix = yield* spec.matrix({ doc: "api-junit-doc" })

        return {
          rows,
          batch,
          matrix: serializeMatrix(matrix),
        }
      })
    )

    expect(payload.rows).toHaveLength(2)
    expect(payload.rows.map((row) => row.testId)).toEqual([
      "test/api/junit-route.test.ts::passes",
      "test/api/junit-route.test.ts::fails",
    ])
    expect(payload.rows[0]!.durationMs).toBe(3)
    expect(payload.rows[1]!.details).toContain("boom")
    expect(payload.rows[1]!.details).toContain("stack")

    expect(payload.batch.received).toBe(2)
    expect(payload.batch.recorded).toBe(2)
    expect(payload.batch.unmatched).toEqual([])

    const byInvariant = new Map(payload.matrix.map((entry) => [entry.invariantId, entry]))
    expect(byInvariant.get("INV-API-JUNIT-001")?.tests[0]?.latestRun.passed).toBe(true)
    expect(byInvariant.get("INV-API-JUNIT-002")?.tests[0]?.latestRun.passed).toBe(false)
  })

  it("maps premature complete errors to API BadRequest", async () => {
    const mapped = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("api-error-doc", [
          { id: "INV-API-ERR-001", rule: "must fail completion in BUILD" },
        ])

        const spec = yield* SpecTraceService
        yield* spec.link("INV-API-ERR-001", "test/api/error.test.ts", "api error", "vitest")

        const error = yield* spec.complete({ doc: "api-error-doc" }, "api-reviewer").pipe(Effect.flip)
        return mapCoreError(error)
      })
    )

    expect(mapped._tag).toBe("BadRequest")
    expect(mapped.message).toContain("Cannot complete scope while phase is BUILD")
  })

  it("serializes unlink + reverse lookup + status fields for API parity", async () => {
    const payload = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("api-unlink-doc", [
          { id: "INV-API-UNLINK-001", rule: "unlink first" },
          { id: "INV-API-UNLINK-002", rule: "unlink second" },
        ])

        const spec = yield* SpecTraceService
        const linked = yield* spec.link("INV-API-UNLINK-001", "test/api/unlink.test.ts", "unlink case", "vitest")
        yield* spec.link("INV-API-UNLINK-002", "test/api/unlink.test.ts", "unlink case", "vitest")

        const before = yield* spec.invariantsForTest(linked.testId)
        const removed = yield* spec.unlink("INV-API-UNLINK-002", linked.testId)
        const after = yield* spec.invariantsForTest(linked.testId)
        const status = yield* spec.status({ doc: "api-unlink-doc" })

        return { linked, before, removed, after, status: { ...status } }
      })
    )

    expect([...payload.before].sort()).toEqual(["INV-API-UNLINK-001", "INV-API-UNLINK-002"])
    expect(payload.removed).toBe(true)
    expect(payload.after).toEqual(["INV-API-UNLINK-001"])
    expect(payload.status.phase).toBe("BUILD")
    expect(payload.status.total).toBe(2)
    expect(payload.status.gaps).toBe(1)
    expect(payload.status.blockers).toEqual(["1 uncovered invariant(s)", "1 untested invariant(s)"])
    expect(payload.status.signedOff).toBe(false)
  })
})
