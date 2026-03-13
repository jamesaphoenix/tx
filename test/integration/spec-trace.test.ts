/**
 * Integration tests for SpecTraceService.
 *
 * Focus:
 * - discovery upsert paths (tag/comment/manifest)
 * - FCI phase transitions (BUILD -> HARDEN -> COMPLETE)
 * - batch ingestion adapters and unmatched handling
 * - cascade cleanup behavior on doc removal
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real SQLite + real Effect layers, no mocks.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  DocService,
  SPEC_BATCH_MAX_BYTES,
  SpecTraceService,
  SqliteClient,
  parseBatchRunInput,
} from "@jamesaphoenix/tx-core"
import type { BatchRunInput } from "@jamesaphoenix/tx-types"

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

const writeRelative = (cwd: string, relativePath: string, content: string): void => {
  const absPath = join(cwd, relativePath)
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content, "utf8")
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

describe("SpecTraceService Integration", () => {
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
    tempDir = mkdtempSync(join(tmpdir(), "tx-spec-trace-"))
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

  it("discovers mappings from tags/comments/manifest and closes gaps", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("spec-discovery-doc", [
          { id: "INV-SPEC-DISC-001", rule: "tag mapping exists" },
          { id: "INV-SPEC-DISC-002", rule: "comment mapping exists" },
          { id: "INV-SPEC-DISC-003", rule: "manifest mapping exists" },
        ])

        writeRelative(tempDir, "test/spec/discovery.test.ts", [
          "import { it } from \"vitest\"",
          "",
          "it(\"[INV-SPEC-DISC-001] tag link\", () => {})",
          "",
          "// @spec INV-SPEC-DISC-002",
          "it(\"comment link\", () => {})",
        ].join("\n"))

        writeRelative(tempDir, "test/spec/manifest.test.ts", [
          "import { it } from \"vitest\"",
          "it(\"manifest mapping\", () => {})",
        ].join("\n"))

        writeRelative(tempDir, ".tx/spec-tests.yml", [
          "mappings:",
          "  - invariant: INV-SPEC-DISC-003",
          "    tests:",
          "      - file: test/spec/manifest.test.ts",
          "        name: manifest mapping",
          "        framework: vitest",
        ].join("\n"))

        const spec = yield* SpecTraceService
        const discover = yield* spec.discover({
          rootDir: tempDir,
          patterns: ["test/**/*.test.ts"],
          doc: "spec-discovery-doc",
        })
        const tagTests = yield* spec.testsForInvariant("INV-SPEC-DISC-001")
        const commentTests = yield* spec.testsForInvariant("INV-SPEC-DISC-002")
        const manifestTests = yield* spec.testsForInvariant("INV-SPEC-DISC-003")
        const gaps = yield* spec.uncoveredInvariants({ doc: "spec-discovery-doc" })

        return { discover, tagTests, commentTests, manifestTests, gaps }
      })
    )

    expect(result.discover.scannedFiles).toBe(2)
    expect(result.discover.discoveredLinks).toBe(3)
    expect(result.discover.upserted).toBe(3)
    expect(result.discover.tagLinks).toBe(1)
    expect(result.discover.commentLinks).toBe(1)
    expect(result.discover.manifestLinks).toBe(1)

    expect(result.gaps).toHaveLength(0)

    expect(result.tagTests).toHaveLength(1)
    expect(result.tagTests[0]!.discovery).toBe("tag")
    expect(result.tagTests[0]!.testId).toBe("test/spec/discovery.test.ts::[INV-SPEC-DISC-001] tag link")

    expect(result.commentTests).toHaveLength(1)
    expect(result.commentTests[0]!.discovery).toBe("comment")
    expect(result.commentTests[0]!.testId).toBe("test/spec/discovery.test.ts::comment link")

    expect(result.manifestTests).toHaveLength(1)
    expect(result.manifestTests[0]!.discovery).toBe("manifest")
    expect(result.manifestTests[0]!.testId).toBe("test/spec/manifest.test.ts::manifest mapping")
  })

  it("prunes stale auto-discovered links while preserving manual links", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("spec-prune-doc", [
          { id: "INV-SPEC-PRUNE-001", rule: "auto mapping can be removed" },
          { id: "INV-SPEC-PRUNE-002", rule: "manual mapping is preserved" },
        ])

        writeRelative(tempDir, "test/spec/prune.test.ts", [
          "import { it } from \"vitest\"",
          "it(\"[INV-SPEC-PRUNE-001] auto prune target\", () => {})",
        ].join("\n"))

        const spec = yield* SpecTraceService
        yield* spec.link("INV-SPEC-PRUNE-002", "test/spec/manual.test.ts", "manual keep", "vitest")

        const first = yield* spec.discover({
          rootDir: tempDir,
          patterns: ["test/**/*.test.ts"],
          doc: "spec-prune-doc",
        })

        writeRelative(tempDir, "test/spec/prune.test.ts", [
          "import { it } from \"vitest\"",
          "it(\"auto mapping removed from source\", () => {})",
        ].join("\n"))

        const second = yield* spec.discover({
          rootDir: tempDir,
          patterns: ["test/**/*.test.ts"],
          doc: "spec-prune-doc",
        })

        const autoTests = yield* spec.testsForInvariant("INV-SPEC-PRUNE-001")
        const manualTests = yield* spec.testsForInvariant("INV-SPEC-PRUNE-002")
        const gaps = yield* spec.uncoveredInvariants({ doc: "spec-prune-doc" })

        return { first, second, autoTests, manualTests, gaps }
      })
    )

    expect(result.first.discoveredLinks).toBe(1)
    expect(result.first.upserted).toBe(1)
    expect(result.second.discoveredLinks).toBe(0)
    expect(result.second.upserted).toBe(0)
    expect(result.autoTests).toHaveLength(0)
    expect(result.manualTests).toHaveLength(1)
    expect(result.gaps.map((g) => g.id)).toContain("INV-SPEC-PRUNE-001")
    expect(result.gaps.map((g) => g.id)).not.toContain("INV-SPEC-PRUNE-002")
  })

  it("transitions phases BUILD -> HARDEN -> COMPLETE and regresses to BUILD on failure", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("spec-phase-doc", [
          { id: "INV-SPEC-PHASE-001", rule: "first invariant passes" },
          { id: "INV-SPEC-PHASE-002", rule: "second invariant passes" },
        ])

        const spec = yield* SpecTraceService
        const first = yield* spec.link(
          "INV-SPEC-PHASE-001",
          "test/spec/phase.test.ts",
          "phase one pass",
          "vitest"
        )
        const second = yield* spec.link(
          "INV-SPEC-PHASE-002",
          "test/spec/phase.test.ts",
          "phase two pass",
          "vitest"
        )

        const build = yield* spec.fci({ doc: "spec-phase-doc" })
        const buildStatus = yield* spec.status({ doc: "spec-phase-doc" })

        const passBatch: readonly BatchRunInput[] = [
          { testId: first.testId, passed: true, durationMs: 12 },
          { testId: second.testId, passed: true, durationMs: 11 },
        ]
        const batchResult = yield* spec.recordBatchRun(passBatch)

        const harden = yield* spec.fci({ doc: "spec-phase-doc" })
        const hardenStatus = yield* spec.status({ doc: "spec-phase-doc" })
        const signoff = yield* spec.complete({ doc: "spec-phase-doc" }, "qa@example.com", "approved")
        const complete = yield* spec.status({ doc: "spec-phase-doc" })

        yield* spec.recordRun(first.testId, false, { details: "regression failure", durationMs: 9 })
        const regressed = yield* spec.fci({ doc: "spec-phase-doc" })

        const blockedComplete = yield* spec.complete({ doc: "spec-phase-doc" }, "qa@example.com").pipe(Effect.flip)

        return {
          build,
          buildStatus,
          batchResult,
          harden,
          hardenStatus,
          signoff,
          complete,
          regressed,
          blockedComplete,
        }
      })
    )

    expect(result.build.phase).toBe("BUILD")
    expect(result.build.fci).toBe(0)
    expect(result.build.total).toBe(2)
    expect(result.build.covered).toBe(2)
    expect(result.build.untested).toBe(2)
    expect(result.buildStatus.blockers).toEqual(["2 untested invariant(s)"])
    expect(result.buildStatus.signedOff).toBe(false)

    expect(result.batchResult.received).toBe(2)
    expect(result.batchResult.recorded).toBe(2)
    expect(result.batchResult.unmatched).toEqual([])

    expect(result.harden.phase).toBe("HARDEN")
    expect(result.harden.fci).toBe(100)
    expect(result.harden.passing).toBe(2)
    expect(result.hardenStatus.blockers).toEqual(["Human COMPLETE sign-off not recorded"])
    expect(result.hardenStatus.signedOff).toBe(false)

    expect(result.signoff.scopeType).toBe("doc")
    expect(result.signoff.scopeValue).toBe("spec-phase-doc")
    expect(result.signoff.signedOffBy).toBe("qa@example.com")

    expect(result.complete.phase).toBe("COMPLETE")
    expect(result.complete.fci).toBe(100)
    expect(result.complete.gaps).toBe(0)
    expect(result.complete.blockers).toEqual([])
    expect(result.complete.signedOff).toBe(true)

    expect(result.regressed.phase).toBe("BUILD")
    expect(result.regressed.fci).toBe(50)
    expect(result.regressed.passing).toBe(1)
    expect(result.regressed.failing).toBe(1)

    expect(result.blockedComplete._tag).toBe("ValidationError")
    expect(result.blockedComplete.message).toContain("Cannot complete scope while phase is BUILD")
  })

  it("rejects ambiguous test-name fallback when recordRun cannot resolve a unique mapping", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("spec-ambiguous-run-doc", [
          { id: "INV-SPEC-AMBIG-001", rule: "first ambiguous mapping" },
          { id: "INV-SPEC-AMBIG-002", rule: "second ambiguous mapping" },
        ])

        const spec = yield* SpecTraceService
        yield* spec.link("INV-SPEC-AMBIG-001", "test/spec/ambiguous-a.test.ts", "shared fallback name", "vitest")
        yield* spec.link("INV-SPEC-AMBIG-002", "test/spec/ambiguous-b.test.ts", "shared fallback name", "vitest")

        const error = yield* spec.recordRun("test/spec/unknown.test.ts::shared fallback name", true).pipe(Effect.flip)
        const status = yield* spec.status({ doc: "spec-ambiguous-run-doc" })

        return { error, status }
      })
    )

    expect(result.error._tag).toBe("ValidationError")
    expect(result.error.message).toContain("No spec test mapping found")
    expect(result.status.phase).toBe("BUILD")
    expect(result.status.blockers).toEqual(["2 untested invariant(s)"])
  })

  it("records framework-adapter batch imports and tracks unmatched IDs", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("spec-batch-doc", [
          { id: "INV-SPEC-BATCH-001", rule: "batch import pass path" },
          { id: "INV-SPEC-BATCH-002", rule: "batch import fail path" },
        ])

        const spec = yield* SpecTraceService

        const sharedOne = yield* spec.link(
          "INV-SPEC-BATCH-001",
          "test/suite/batch.test.ts",
          "shared batch case",
          "vitest"
        )
        const sharedTwo = yield* spec.link(
          "INV-SPEC-BATCH-002",
          "test/suite/batch.test.ts",
          "shared batch case",
          "vitest"
        )
        const pyCase = yield* spec.link(
          "INV-SPEC-BATCH-002",
          "tests/test_batch.py",
          "test_py_batch",
          "pytest"
        )
        const goCase = yield* spec.link(
          "INV-SPEC-BATCH-001",
          "pkg/spec",
          "TestGoBatch",
          "go"
        )

        const vitestRows = parseBatchRunInput(
          JSON.stringify({
            testResults: [
              {
                name: "test/suite/batch.test.ts",
                assertionResults: [
                  {
                    fullName: "shared batch case",
                    status: "passed",
                    duration: 7,
                  },
                ],
              },
            ],
          }),
          "vitest"
        )

        const pytestRows = parseBatchRunInput(
          JSON.stringify({
            tests: [
              {
                nodeid: "tests/test_batch.py::test_py_batch",
                outcome: "failed",
                call: { duration: 0.013 },
                longrepr: "assert 1 == 2",
              },
            ],
          }),
          "pytest"
        )

        const goRows = parseBatchRunInput(
          [
            "{\"Action\":\"output\",\"Package\":\"pkg/spec\",\"Test\":\"TestGoBatch\",\"Output\":\"go output\"}",
            "{\"Action\":\"pass\",\"Package\":\"pkg/spec\",\"Test\":\"TestGoBatch\",\"Elapsed\":0.002}",
          ].join("\n"),
          "go"
        )

        const genericRows = parseBatchRunInput(
          JSON.stringify([{ testId: "missing::case", passed: true }]),
          "generic"
        )

        const vitestResult = yield* spec.recordBatchRun(vitestRows)
        const pytestResult = yield* spec.recordBatchRun(pytestRows)
        const goResult = yield* spec.recordBatchRun(goRows)
        const genericResult = yield* spec.recordBatchRun(genericRows)

        const fci = yield* spec.fci({ doc: "spec-batch-doc" })
        const matrix = yield* spec.matrix({ doc: "spec-batch-doc" })

        return {
          vitestRows,
          pytestRows,
          goRows,
          genericRows,
          vitestResult,
          pytestResult,
          goResult,
          genericResult,
          fci,
          matrix,
          expectedIds: {
            shared: sharedOne.testId,
            sharedAgain: sharedTwo.testId,
            py: pyCase.testId,
            go: goCase.testId,
          },
        }
      })
    )

    expect(result.vitestRows).toHaveLength(1)
    expect(result.pytestRows).toHaveLength(1)
    expect(result.goRows).toHaveLength(1)
    expect(result.genericRows).toHaveLength(1)

    expect(result.expectedIds.shared).toBe("test/suite/batch.test.ts::shared batch case")
    expect(result.expectedIds.sharedAgain).toBe("test/suite/batch.test.ts::shared batch case")
    expect(result.expectedIds.py).toBe("tests/test_batch.py::test_py_batch")
    expect(result.expectedIds.go).toBe("pkg/spec::TestGoBatch")

    expect(result.vitestResult.received).toBe(1)
    expect(result.vitestResult.recorded).toBe(2)
    expect(result.vitestResult.unmatched).toEqual([])

    expect(result.pytestResult.received).toBe(1)
    expect(result.pytestResult.recorded).toBe(1)
    expect(result.pytestResult.unmatched).toEqual([])

    expect(result.goResult.received).toBe(1)
    expect(result.goResult.recorded).toBe(1)
    expect(result.goResult.unmatched).toEqual([])

    expect(result.genericResult.received).toBe(1)
    expect(result.genericResult.recorded).toBe(0)
    expect(result.genericResult.unmatched).toEqual(["missing::case"])

    expect(result.fci.total).toBe(2)
    expect(result.fci.passing).toBe(1)
    expect(result.fci.failing).toBe(1)
    expect(result.fci.fci).toBe(50)
    expect(result.fci.phase).toBe("BUILD")

    const matrixByInvariant = new Map(result.matrix.map((entry) => [entry.invariantId, entry]))
    const inv1 = matrixByInvariant.get("INV-SPEC-BATCH-001")
    const inv2 = matrixByInvariant.get("INV-SPEC-BATCH-002")

    expect(inv1).toBeDefined()
    expect(inv2).toBeDefined()

    const inv1Shared = inv1!.tests.find((t) => t.testId === "test/suite/batch.test.ts::shared batch case")
    const inv1Go = inv1!.tests.find((t) => t.testId === "pkg/spec::TestGoBatch")
    const inv2Shared = inv2!.tests.find((t) => t.testId === "test/suite/batch.test.ts::shared batch case")
    const inv2Py = inv2!.tests.find((t) => t.testId === "tests/test_batch.py::test_py_batch")

    expect(inv1Shared?.latestRun.passed).toBe(true)
    expect(inv1Go?.latestRun.passed).toBe(true)
    expect(inv2Shared?.latestRun.passed).toBe(true)
    expect(inv2Py?.latestRun.passed).toBe(false)
  })

  it("cascades spec mappings and runs when source doc is removed", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("spec-cascade-doc", [
          { id: "INV-SPEC-CASCADE-001", rule: "cascade cleanup" },
        ])

        const docs = yield* DocService
        const spec = yield* SpecTraceService
        const db = yield* SqliteClient

        const linked = yield* spec.link(
          "INV-SPEC-CASCADE-001",
          "test/spec/cascade.test.ts",
          "cascade case",
          "vitest"
        )
        yield* spec.recordRun(linked.testId, true, { details: "green" })

        const before = {
          invariants: (db.prepare("SELECT COUNT(*) AS c FROM invariants WHERE id = ?").get("INV-SPEC-CASCADE-001") as { c: number }).c,
          links: (db.prepare("SELECT COUNT(*) AS c FROM spec_tests WHERE invariant_id = ?").get("INV-SPEC-CASCADE-001") as { c: number }).c,
          runs: (db.prepare(
            `SELECT COUNT(*) AS c
             FROM spec_test_runs r
             JOIN spec_tests st ON st.id = r.spec_test_id
             WHERE st.invariant_id = ?`
          ).get("INV-SPEC-CASCADE-001") as { c: number }).c,
        }

        yield* docs.remove("spec-cascade-doc")

        const after = {
          invariants: (db.prepare("SELECT COUNT(*) AS c FROM invariants WHERE id = ?").get("INV-SPEC-CASCADE-001") as { c: number }).c,
          links: (db.prepare("SELECT COUNT(*) AS c FROM spec_tests WHERE invariant_id = ?").get("INV-SPEC-CASCADE-001") as { c: number }).c,
          runs: (db.prepare(
            `SELECT COUNT(*) AS c
             FROM spec_test_runs r
             JOIN spec_tests st ON st.id = r.spec_test_id
             WHERE st.invariant_id = ?`
          ).get("INV-SPEC-CASCADE-001") as { c: number }).c,
          allRuns: (db.prepare("SELECT COUNT(*) AS c FROM spec_test_runs").get() as { c: number }).c,
          orphanRuns: (db.prepare(
            `SELECT COUNT(*) AS c
             FROM spec_test_runs r
             LEFT JOIN spec_tests st ON st.id = r.spec_test_id
             WHERE st.id IS NULL`
          ).get() as { c: number }).c,
        }

        return { before, after }
      })
    )

    expect(result.before.invariants).toBe(1)
    expect(result.before.links).toBe(1)
    expect(result.before.runs).toBe(1)

    expect(result.after.invariants).toBe(0)
    expect(result.after.links).toBe(0)
    expect(result.after.runs).toBe(0)
    expect(result.after.allRuns).toBe(0)
    expect(result.after.orphanRuns).toBe(0)
  })

  it("rejects repeated completion when scope is already COMPLETE", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* createDocWithInvariants("spec-complete-once-doc", [
          { id: "INV-SPEC-COMPLETE-001", rule: "complete once only" },
        ])

        const spec = yield* SpecTraceService
        const linked = yield* spec.link(
          "INV-SPEC-COMPLETE-001",
          "test/spec/complete-once.test.ts",
          "complete once",
          "vitest"
        )

        yield* spec.recordRun(linked.testId, true)
        yield* spec.complete({ doc: "spec-complete-once-doc" }, "qa-1")
        const second = yield* spec.complete({ doc: "spec-complete-once-doc" }, "qa-2").pipe(Effect.flip)

        return second
      })
    )

    expect(result._tag).toBe("ValidationError")
    expect(result.message).toContain("Cannot complete scope while phase is COMPLETE")
  })
})

describe("parseBatchRunInput JUnit adapter", () => {
  it("parses a basic passing testcase", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="example" file="test/foo.test.ts"><testcase name="passes" classname="FooTest"/></testsuite>',
      "junit"
    )

    expect(rows).toEqual([
      {
        testId: "test/foo.test.ts::passes",
        passed: true,
        durationMs: undefined,
        details: undefined,
      },
    ])
  })

  it("parses a failing testcase with failure message and stack trace", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="example" file="test/foo.test.ts"><testcase name="fails"><failure message="oops">stack trace line 1\nstack trace line 2</failure></testcase></testsuite>',
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.testId).toBe("test/foo.test.ts::fails")
    expect(rows[0]!.passed).toBe(false)
    expect(rows[0]!.details).toContain("oops")
    expect(rows[0]!.details).toContain("stack trace line 1")
  })

  it("parses an errored testcase with error element details", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="example" file="test/foo.test.ts"><testcase name="errors"><error message="runtime boom">traceback</error></testcase></testsuite>',
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.testId).toBe("test/foo.test.ts::errors")
    expect(rows[0]!.passed).toBe(false)
    expect(rows[0]!.details).toContain("runtime boom")
    expect(rows[0]!.details).toContain("traceback")
  })

  it("excludes skipped testcases", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="example" file="test/foo.test.ts"><testcase name="skip-me"><skipped/></testcase></testsuite>',
      "junit"
    )

    expect(rows).toEqual([])
  })

  it("excludes skipped testcases even when failure/error nodes are present", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="example" file="test/foo.test.ts"><testcase name="skip-with-failure"><skipped/><failure message="should be ignored">stack</failure></testcase></testsuite>',
      "junit"
    )

    expect(rows).toEqual([])
  })

  it("parses a mixed suite with pass, fail, error, and skip", () => {
    const rows = parseBatchRunInput(
      [
        '<testsuite name="mixed" file="test/mixed.test.ts">',
        '<testcase name="pass-case"/>',
        '<testcase name="fail-case"><failure>failed</failure></testcase>',
        '<testcase name="error-case"><error>errored</error></testcase>',
        '<testcase name="skip-case"><skipped/></testcase>',
        "</testsuite>",
      ].join(""),
      "junit"
    )

    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.testId)).toEqual([
      "test/mixed.test.ts::pass-case",
      "test/mixed.test.ts::fail-case",
      "test/mixed.test.ts::error-case",
    ])
    expect(rows.map((row) => row.passed)).toEqual([true, false, false])
  })

  it("supports nested testsuites wrapping multiple testsuite elements", () => {
    const rows = parseBatchRunInput(
      [
        "<testsuites>",
        '<testsuite name="s1" file="test/one.test.ts"><testcase name="case-1"/></testsuite>',
        '<testsuite name="s2" file="test/two.test.ts"><testcase name="case-2"/></testsuite>',
        "</testsuites>",
      ].join(""),
      "junit"
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]!.testId).toBe("test/one.test.ts::case-1")
    expect(rows[1]!.testId).toBe("test/two.test.ts::case-2")
  })

  it("extracts duration from time seconds into milliseconds", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="dur" file="test/duration.test.ts"><testcase name="timed" time="1.234"/></testsuite>',
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.durationMs).toBe(1234)
  })

  it("falls back to testcase classname when testsuite file is missing", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="fallback"><testcase name="class-fallback" classname="pkg.MySuite"/></testsuite>',
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.testId).toBe("pkg.MySuite::class-fallback")
  })

  it("sets durationMs to undefined when time is missing", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="missing-time" file="test/no-time.test.ts"><testcase name="no-time"/></testsuite>',
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.durationMs).toBeUndefined()
  })

  it("throws a descriptive error for malformed XML", () => {
    expect(() =>
      parseBatchRunInput("<testsuite><testcase name=\"broken\"></testsuite>", "junit")
    ).toThrowError(/Invalid JUnit XML input:/)
  })

  it("normalizes windows-style junit file paths to canonical slash format", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="windows" file="test\\\\spec\\\\windows.test.ts"><testcase name="win-case"/></testsuite>',
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.testId).toBe("test/spec/windows.test.ts::win-case")
  })

  it("routes testcase source file ahead of suite file and normalizes windows separators", () => {
    const rows = parseBatchRunInput(
      [
        '<testsuite name="suite" file="test/suite-level.test.ts">',
        '<testcase name="win-case" file=".\\\\test\\\\case-level\\\\routed.test.ts"/>',
        "</testsuite>",
      ].join(""),
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.testId).toBe("test/case-level/routed.test.ts::win-case")
  })

  it("excludes skipped testcases declared via status/result attributes", () => {
    const rows = parseBatchRunInput(
      [
        '<testsuite name="skip-status" file="test/skip-status.test.ts">',
        '<testcase name="status-skip" status="skipped"/>',
        '<testcase name="result-skip" result="skipped"/>',
        '<testcase name="pass-case"/>',
        "</testsuite>",
      ].join(""),
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.testId).toBe("test/skip-status.test.ts::pass-case")
    expect(rows[0]!.passed).toBe(true)
  })

  it("aggregates details from multiple failure/error nodes", () => {
    const rows = parseBatchRunInput(
      [
        '<testsuite name="details" file="test/details.test.ts">',
        '<testcase name="multi-detail">',
        '<failure message="fail one">stack one</failure>',
        '<error message="err two"><![CDATA[stack two]]></error>',
        "</testcase>",
        "</testsuite>",
      ].join(""),
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.passed).toBe(false)
    expect(rows[0]!.details).toContain("fail one")
    expect(rows[0]!.details).toContain("stack one")
    expect(rows[0]!.details).toContain("err two")
    expect(rows[0]!.details).toContain("stack two")
  })

  it("parses comma-decimal time attributes as milliseconds", () => {
    const rows = parseBatchRunInput(
      '<testsuite name="dur-comma" file="test/comma-duration.test.ts"><testcase name="comma" time="0,125"/></testsuite>',
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.durationMs).toBe(125)
  })

  it("collects testcases from nested testsuite hierarchies", () => {
    const rows = parseBatchRunInput(
      [
        "<testsuites>",
        '<testsuite name="outer" file="test/outer.test.ts">',
        '<testsuite name="inner" file="test/inner.test.ts">',
        '<testcase name="inner-case"/>',
        "</testsuite>",
        "</testsuite>",
        "</testsuites>",
      ].join(""),
      "junit"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.testId).toBe("test/inner.test.ts::inner-case")
  })

  it("rejects oversized raw batch payloads before parsing", () => {
    const oversize = "x".repeat(SPEC_BATCH_MAX_BYTES + 1)

    expect(() =>
      parseBatchRunInput(oversize, "junit")
    ).toThrowError(`Raw batch payload exceeds ${SPEC_BATCH_MAX_BYTES} bytes`)
  })
})
