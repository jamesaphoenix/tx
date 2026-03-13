/**
 * Integration tests for REST API invariant endpoints.
 *
 * Tests the invariant route handlers at the service level (same pattern as api-claim tests).
 * The REST handlers in apps/api-server/src/routes/invariants.ts delegate to DocService
 * and serialize results via serializeInvariant / serializeCheck (Date -> ISO string conversion).
 *
 * The invariant lifecycle requires first creating a Doc (via DocService), which triggers
 * syncInvariants that discovers invariants from the doc's YAML frontmatter.
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { afterEach, beforeAll, beforeEach, describe, it, expect } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { DocService } from "@jamesaphoenix/tx-core"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Invariant, InvariantCheck } from "@jamesaphoenix/tx-types"

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mirrors the serializeInvariant function from apps/api-server/src/routes/invariants.ts.
 * The REST API converts Date fields to ISO strings before returning to clients.
 */
const serializeInvariant = (inv: Invariant) => ({
  id: inv.id,
  rule: inv.rule,
  enforcement: inv.enforcement,
  docId: inv.docId,
  subsystem: inv.subsystem,
  status: inv.status,
  testRef: inv.testRef,
  lintRule: inv.lintRule,
  promptRef: inv.promptRef,
  createdAt: inv.createdAt.toISOString(),
})

/**
 * Mirrors the serializeCheck function from apps/api-server/src/routes/invariants.ts.
 */
const serializeCheck = (check: InvariantCheck) => ({
  id: check.id,
  invariantId: check.invariantId,
  passed: check.passed,
  details: check.details,
  durationMs: check.durationMs,
  checkedAt: check.checkedAt.toISOString(),
})

/** Set up specs/ directory structure required by DocService. */
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

// =============================================================================
// Tests
// =============================================================================

describe("API Invariant Endpoints Integration", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempDir: string

  beforeAll(async () => {
    shared = await getSharedTestLayer()
    originalCwd = process.cwd()
  })

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    tempDir = mkdtempSync(join(tmpdir(), "tx-api-invariants-"))
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

  // ---------------------------------------------------------------------------
  // 1. listInvariants returns empty array when no docs exist
  // ---------------------------------------------------------------------------

  it("listInvariants returns empty array when no docs exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService
        const invariants = yield* docService.listInvariants()
        return { invariants: invariants.map(serializeInvariant) }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invariants).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // 2. listInvariants returns invariants from synced doc
  // ---------------------------------------------------------------------------

  it("listInvariants returns invariants from synced doc", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService

        // Create a doc with invariants in its YAML content
        const yamlContent = [
          "kind: prd",
          "name: inv-test-doc",
          "title: Invariant Test Doc",
          "status: changing",
          "",
          "invariants:",
          "  - id: INV-TEST-001",
          "    rule: All tests must pass before merge",
          "    enforcement: integration_test",
          "  - id: INV-TEST-002",
          "    rule: No console.log in production code",
          "    enforcement: linter",
          "    subsystem: code-quality",
        ].join("\n")

        yield* docService.create({
          kind: "prd",
          name: "inv-test-doc",
          title: "Invariant Test Doc",
          yamlContent,
        })

        // Sync invariants from the doc's YAML
        yield* docService.syncInvariants("inv-test-doc")

        // List them
        const invariants = yield* docService.listInvariants()
        return { invariants: invariants.map(serializeInvariant) }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invariants).toHaveLength(2)

    const ids = result.invariants.map((inv) => inv.id)
    expect(ids).toContain("INV-TEST-001")
    expect(ids).toContain("INV-TEST-002")

    const inv1 = result.invariants.find((inv) => inv.id === "INV-TEST-001")!
    expect(inv1.rule).toBe("All tests must pass before merge")
    expect(inv1.enforcement).toBe("integration_test")
    expect(inv1.status).toBe("active")
    // createdAt should be a valid ISO string
    expect(inv1.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(new Date(inv1.createdAt).getTime()).not.toBeNaN()

    const inv2 = result.invariants.find((inv) => inv.id === "INV-TEST-002")!
    expect(inv2.rule).toBe("No console.log in production code")
    expect(inv2.enforcement).toBe("linter")
    expect(inv2.subsystem).toBe("code-quality")
  })

  // ---------------------------------------------------------------------------
  // 3. recordInvariantCheck stores a passing check with ISO date
  // ---------------------------------------------------------------------------

  it("recordInvariantCheck stores a passing check with ISO date", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService

        // Create doc with an invariant
        const yamlContent = [
          "kind: prd",
          "name: inv-pass-doc",
          "title: Pass Check Doc",
          "status: changing",
          "",
          "invariants:",
          "  - id: INV-PASS-001",
          "    rule: Tests must pass",
          "    enforcement: integration_test",
        ].join("\n")

        yield* docService.create({
          kind: "prd",
          name: "inv-pass-doc",
          title: "Pass Check Doc",
          yamlContent,
        })

        yield* docService.syncInvariants("inv-pass-doc")

        // Record a passing check
        const check = yield* docService.recordInvariantCheck(
          "INV-PASS-001",
          true,
          "All 42 tests passed",
          1500
        )
        return serializeCheck(check)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invariantId).toBe("INV-PASS-001")
    expect(result.passed).toBe(true)
    expect(result.details).toBe("All 42 tests passed")
    expect(result.durationMs).toBe(1500)
    // checkedAt should be a valid ISO string
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(new Date(result.checkedAt).getTime()).not.toBeNaN()
    expect(typeof result.id).toBe("number")
  })

  // ---------------------------------------------------------------------------
  // 4. recordInvariantCheck stores a failing check
  // ---------------------------------------------------------------------------

  it("recordInvariantCheck stores a failing check", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService

        // Create doc with an invariant
        const yamlContent = [
          "kind: prd",
          "name: inv-fail-doc",
          "title: Fail Check Doc",
          "status: changing",
          "",
          "invariants:",
          "  - id: INV-FAIL-001",
          "    rule: No lint errors allowed",
          "    enforcement: linter",
        ].join("\n")

        yield* docService.create({
          kind: "prd",
          name: "inv-fail-doc",
          title: "Fail Check Doc",
          yamlContent,
        })

        yield* docService.syncInvariants("inv-fail-doc")

        // Record a failing check with details
        const check = yield* docService.recordInvariantCheck(
          "INV-FAIL-001",
          false,
          "Found 3 lint errors in src/index.ts",
          250
        )
        return serializeCheck(check)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invariantId).toBe("INV-FAIL-001")
    expect(result.passed).toBe(false)
    expect(result.details).toBe("Found 3 lint errors in src/index.ts")
    expect(result.durationMs).toBe(250)
    // checkedAt should be a valid ISO string
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(new Date(result.checkedAt).getTime()).not.toBeNaN()
  })

  // ---------------------------------------------------------------------------
  // 5. recordInvariantCheck fails for non-existent invariant id
  // ---------------------------------------------------------------------------

  it("recordInvariantCheck fails for non-existent invariant id", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService

        // Try to record a check for an invariant that does not exist
        const exit = yield* docService
          .recordInvariantCheck("INV-DOESNOTEXIST", true, "Should fail")
          .pipe(Effect.either)

        return exit
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("InvariantNotFoundError")
    }
  })
})
