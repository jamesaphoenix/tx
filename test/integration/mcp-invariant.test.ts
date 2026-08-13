/**
 * Integration tests for MCP invariant tools.
 *
 * Tests exercise the DocService at the Effect service level, covering the same
 * operations that the MCP tool handlers (apps/cli/src/mcp/tools/invariant.ts)
 * delegate to:
 *
 * 1. List invariants — empty initially, returns results after creating some
 * 2. List invariants with filter — filter by subsystem or enforcement type
 * 3. Get invariant by ID — returns the correct invariant
 * 4. Get non-existent invariant — returns appropriate error
 * 5. Record invariant check — creates a new check and verifies retrieval
 * 6. Record with all optional fields — test all optional parameters work
 * 7. Record check for non-existent invariant — returns InvariantNotFoundError
 * 8. Multiple invariants from a single doc — sync discovers all of them
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks. Temp directories with real YAML files.
 */

import { afterEach, beforeAll, beforeEach, describe, it, expect } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx/testing"
import { DocService } from "@jamesaphoenix/tx"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Invariant, InvariantCheck } from "@jamesaphoenix/tx/types"
import { asDocKind } from "@jamesaphoenix/tx/types"

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mirrors the serializeInvariant function from apps/cli/src/mcp/tools/invariant.ts.
 * The MCP tool converts Date fields to ISO strings before returning to clients.
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
 * Mirrors the serializeInvariantCheck function from apps/cli/src/mcp/tools/invariant.ts.
 */
const serializeInvariantCheck = (check: InvariantCheck) => ({
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

/**
 * Create a PRD doc with explicit invariants via DocService.
 * Yields DocService from context, so callers don't need to pass it.
 * Returns the synced invariants.
 *
 * Note: The markdown-first invariant schema uses { id, statement, severity, verified_by }.
 * The derive function maps: rule = statement, enforcement = "integration_test" (always),
 * subsystem = doc.kind ("prd"), testRef = verified_by[0].
 * Legacy fields like lintRule, promptRef are not part of the embedded block schema.
 */
const createDocWithInvariants = (
  name: string,
  title: string,
  invariants: Array<{
    id: string
    rule: string
    enforcement: string
    subsystem?: string
    testRef?: string
    lintRule?: string
    promptRef?: string
  }>
) =>
  Effect.gen(function* () {
    const docService = yield* DocService

    const invariantYaml = invariants
      .map((inv) => {
        const verifiedBy = inv.testRef ?? "test/integration/mcp-invariant.test.ts"
        const lines = [
          `  - id: ${inv.id}`,
          `    statement: ${inv.rule}`,
          "    severity: high",
          "    verified_by:",
          `      - ${verifiedBy}`,
        ]
        return lines.join("\n")
      })
      .join("\n")

    const content = [
      "---",
      "kind: spec",
      "spec_type: prd",
      `name: ${name}`,
      `title: ${title}`,
      "status: draft",
      "version: 1",
      "owners: [test]",
      'summary: ""',
      'domain: ""',
      "tags: []",
      "depends_on: []",
      "supersedes: []",
      "implements: null",
      "last_reviewed_at: 2026-03-15",
      "---",
      "",
      `# ${title}`,
      "",
      "## Summary",
      "",
      "Test document for MCP invariant integration.",
      "",
      "## Problem",
      "",
      "Need to verify MCP invariant tool behavior.",
      "",
      "## Scope",
      "",
      "Integration test scope.",
      "",
      "## Requirements",
      "",
      "Test requirements.",
      "",
      "## Acceptance Criteria",
      "",
      "Tests pass.",
      "",
      "## Invariants",
      "",
      "```yaml",
      "invariants:",
      invariantYaml,
      "```",
    ].join("\n")

    yield* docService.create({ kind: asDocKind("prd"), name, title, content })
    const synced = yield* docService.syncInvariants(name)
    return synced
  })

// =============================================================================
// Tests
// =============================================================================

describe("MCP Invariant Tools Integration", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempDir: string

  beforeAll(async () => {
    shared = await getSharedTestLayer()
    originalCwd = process.cwd()
  })

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    tempDir = mkdtempSync(join(tmpdir(), "tx-mcp-invariant-"))
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
  // 1. listInvariants returns empty array when no invariants exist
  // ---------------------------------------------------------------------------

  it("listInvariants returns empty array when no invariants exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService
        const invariants = yield* docService.listInvariants()
        return invariants.map(serializeInvariant)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // 2. listInvariants returns invariants after syncing from doc
  // ---------------------------------------------------------------------------

  it("listInvariants returns invariants after syncing from doc", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-list", "List Test Doc", [
          {
            id: "INV-MCP-LIST-001",
            rule: "Tasks must have titles",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-LIST-002",
            rule: "No raw SQL in service layer",
            enforcement: "linter",
            subsystem: "database",
          },
        ])

        const docService = yield* DocService
        const invariants = yield* docService.listInvariants()
        return invariants.map(serializeInvariant)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)

    const ids = result.map((inv) => inv.id)
    expect(ids).toContain("INV-MCP-LIST-001")
    expect(ids).toContain("INV-MCP-LIST-002")

    const inv1 = result.find((inv) => inv.id === "INV-MCP-LIST-001")!
    expect(inv1.rule).toBe("Tasks must have titles")
    expect(inv1.enforcement).toBe("integration_test")
    expect(inv1.status).toBe("active")
    // In markdown-first, subsystem is derived from doc.kind
    expect(inv1.subsystem).toBe("prd")

    const inv2 = result.find((inv) => inv.id === "INV-MCP-LIST-002")!
    expect(inv2.rule).toBe("No raw SQL in service layer")
    // In markdown-first, enforcement is always "integration_test" (derived from severity)
    expect(inv2.enforcement).toBe("integration_test")
    expect(inv2.subsystem).toBe("prd")
  })

  // ---------------------------------------------------------------------------
  // 3. listInvariants with subsystem filter
  // ---------------------------------------------------------------------------

  it("listInvariants filters by subsystem", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-sub", "Subsystem Filter Doc", [
          {
            id: "INV-MCP-SUB-001",
            rule: "API responses must include CORS headers",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-SUB-002",
            rule: "Database migrations must be reversible",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-SUB-003",
            rule: "API routes must validate input",
            enforcement: "integration_test",
          },
        ])

        const docService = yield* DocService
        // In markdown-first, subsystem is derived from doc.kind ("prd")
        const prdInvariants = yield* docService.listInvariants({ subsystem: "prd" })
        const noMatchInvariants = yield* docService.listInvariants({ subsystem: "nonexistent" })
        return {
          prd: prdInvariants.map(serializeInvariant),
          noMatch: noMatchInvariants.map(serializeInvariant),
        }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.prd).toHaveLength(3)
    expect(result.prd.every((inv) => inv.subsystem === "prd")).toBe(true)

    expect(result.noMatch).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 4. listInvariants with enforcement filter
  // ---------------------------------------------------------------------------

  it("listInvariants filters by enforcement type", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-enf", "Enforcement Filter Doc", [
          {
            id: "INV-MCP-ENF-001",
            rule: "All endpoints must have integration tests",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-ENF-002",
            rule: "No unused imports",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-ENF-003",
            rule: "Code must follow naming conventions",
            enforcement: "integration_test",
          },
        ])

        const docService = yield* DocService
        // In markdown-first, all enforcement is "integration_test" (derived from severity)
        const testInvariants = yield* docService.listInvariants({ enforcement: "integration_test" })
        const linterInvariants = yield* docService.listInvariants({ enforcement: "linter" })
        return {
          test: testInvariants.map(serializeInvariant),
          linter: linterInvariants.map(serializeInvariant),
        }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.test).toHaveLength(3)
    expect(result.test.map((inv) => inv.id)).toEqual(
      expect.arrayContaining(["INV-MCP-ENF-001", "INV-MCP-ENF-002", "INV-MCP-ENF-003"])
    )

    // No invariants match "linter" since markdown-first always derives "integration_test"
    expect(result.linter).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 5. listInvariants with both subsystem and enforcement filter
  // ---------------------------------------------------------------------------

  it("listInvariants filters by both subsystem and enforcement", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-both", "Both Filters Doc", [
          {
            id: "INV-MCP-BOTH-001",
            rule: "API integration tests required",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-BOTH-002",
            rule: "API lint rules required",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-BOTH-003",
            rule: "DB integration tests required",
            enforcement: "integration_test",
          },
        ])

        const docService = yield* DocService
        // In markdown-first, subsystem = doc.kind ("prd") and enforcement = "integration_test"
        const prdTests = yield* docService.listInvariants({
          subsystem: "prd",
          enforcement: "integration_test",
        })
        return prdTests.map(serializeInvariant)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(3)
    expect(result[0].subsystem).toBe("prd")
    expect(result[0].enforcement).toBe("integration_test")
  })

  // ---------------------------------------------------------------------------
  // 6. Get invariant by ID — simulate the MCP tx_invariant_get handler
  // ---------------------------------------------------------------------------

  it("get invariant by ID returns the correct invariant", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-get", "Get By ID Doc", [
          {
            id: "INV-MCP-GET-001",
            rule: "Effect-TS patterns are mandatory",
            enforcement: "integration_test",
          },
          {
            id: "INV-MCP-GET-002",
            rule: "No circular dependencies",
            enforcement: "integration_test",
          },
        ])

        // Simulate the MCP tx_invariant_get handler: list all, find by id
        const docService = yield* DocService
        const all = yield* docService.listInvariants()
        const found = all.find((inv) => inv.id === "INV-MCP-GET-001")
        return found ? serializeInvariant(found) : null
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.id).toBe("INV-MCP-GET-001")
    expect(result!.rule).toBe("Effect-TS patterns are mandatory")
    expect(result!.enforcement).toBe("integration_test")
    expect(result!.subsystem).toBe("prd")
    expect(result!.status).toBe("active")
    expect(result!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(new Date(result!.createdAt).getTime()).not.toBeNaN()
  })

  // ---------------------------------------------------------------------------
  // 7. Get non-existent invariant — returns null (no match in list)
  // ---------------------------------------------------------------------------

  it("get non-existent invariant returns null from list lookup", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService

        // Simulate the MCP tx_invariant_get handler with a non-existent ID
        const all = yield* docService.listInvariants()
        const found = all.find((inv) => inv.id === "INV-NONEXISTENT")
        return found ?? null
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 8. Record invariant check — passing check
  // ---------------------------------------------------------------------------

  it("recordInvariantCheck stores a passing check", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-pass", "Pass Check Doc", [
          {
            id: "INV-MCP-PASS-001",
            rule: "All tests must pass",
            enforcement: "integration_test",
          },
        ])

        const docService = yield* DocService
        const check = yield* docService.recordInvariantCheck(
          "INV-MCP-PASS-001",
          true,
          "All 42 tests passed",
          1500
        )
        return serializeInvariantCheck(check)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invariantId).toBe("INV-MCP-PASS-001")
    expect(result.passed).toBe(true)
    expect(result.details).toBe("All 42 tests passed")
    expect(result.durationMs).toBe(1500)
    expect(typeof result.id).toBe("number")
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(new Date(result.checkedAt).getTime()).not.toBeNaN()
  })

  // ---------------------------------------------------------------------------
  // 9. Record invariant check — failing check
  // ---------------------------------------------------------------------------

  it("recordInvariantCheck stores a failing check", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-fail", "Fail Check Doc", [
          {
            id: "INV-MCP-FAIL-001",
            rule: "No console.log in production",
            enforcement: "linter",
          },
        ])

        const docService = yield* DocService
        const check = yield* docService.recordInvariantCheck(
          "INV-MCP-FAIL-001",
          false,
          "Found 3 console.log calls in src/index.ts",
          250
        )
        return serializeInvariantCheck(check)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invariantId).toBe("INV-MCP-FAIL-001")
    expect(result.passed).toBe(false)
    expect(result.details).toBe("Found 3 console.log calls in src/index.ts")
    expect(result.durationMs).toBe(250)
    expect(typeof result.id).toBe("number")
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  // ---------------------------------------------------------------------------
  // 10. Record invariant check — with no optional fields (details=null, durationMs=null)
  // ---------------------------------------------------------------------------

  it("recordInvariantCheck works with no optional fields", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-noopt", "No Optionals Doc", [
          {
            id: "INV-MCP-NOOPT-001",
            rule: "Basic check",
            enforcement: "integration_test",
          },
        ])

        const docService = yield* DocService
        const check = yield* docService.recordInvariantCheck(
          "INV-MCP-NOOPT-001",
          true
        )
        return serializeInvariantCheck(check)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invariantId).toBe("INV-MCP-NOOPT-001")
    expect(result.passed).toBe(true)
    expect(result.details).toBeNull()
    expect(result.durationMs).toBeNull()
    expect(typeof result.id).toBe("number")
  })

  // ---------------------------------------------------------------------------
  // 11. Record invariant check — non-existent invariant returns error
  // ---------------------------------------------------------------------------

  it("recordInvariantCheck fails for non-existent invariant", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const docService = yield* DocService

        const exit = yield* docService
          .recordInvariantCheck("INV-DOES-NOT-EXIST", true, "Should fail")
          .pipe(Effect.either)

        return exit
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("InvariantNotFoundError")
    }
  })

  // ---------------------------------------------------------------------------
  // 12. Record invariant with all optional fields populated
  // ---------------------------------------------------------------------------

  it("record with all optional fields stores everything correctly", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-allfields", "All Fields Doc", [
          {
            id: "INV-MCP-ALL-001",
            rule: "Comprehensive invariant with all metadata",
            enforcement: "integration_test",
            testRef: "test/integration/core.test.ts",
          },
        ])

        // Verify the invariant has all fields
        const docService = yield* DocService
        const invariants = yield* docService.listInvariants()
        const inv = invariants.find((i) => i.id === "INV-MCP-ALL-001")
        if (!inv) throw new Error("Invariant not found")

        // Record a check with all optional fields
        const check = yield* docService.recordInvariantCheck(
          "INV-MCP-ALL-001",
          false,
          "Failed: raw SQL detected in TaskService.create",
          3200
        )

        return {
          invariant: serializeInvariant(inv),
          check: serializeInvariantCheck(check),
        }
      }).pipe(Effect.provide(shared.layer))
    )

    // Verify invariant fields
    expect(result.invariant.id).toBe("INV-MCP-ALL-001")
    expect(result.invariant.rule).toBe("Comprehensive invariant with all metadata")
    expect(result.invariant.enforcement).toBe("integration_test")
    // In markdown-first, subsystem is derived from doc.kind
    expect(result.invariant.subsystem).toBe("prd")
    // testRef comes from verified_by[0] in the embedded block
    expect(result.invariant.testRef).toBe("test/integration/core.test.ts")
    // lintRule and promptRef are not part of the embedded block schema
    expect(result.invariant.lintRule).toBeNull()
    expect(result.invariant.promptRef).toBeNull()
    expect(result.invariant.status).toBe("active")

    // Verify check fields
    expect(result.check.invariantId).toBe("INV-MCP-ALL-001")
    expect(result.check.passed).toBe(false)
    expect(result.check.details).toBe("Failed: raw SQL detected in TaskService.create")
    expect(result.check.durationMs).toBe(3200)
  })

  // ---------------------------------------------------------------------------
  // 13. Multiple invariants synced from a single doc
  // ---------------------------------------------------------------------------

  it("syncInvariants discovers multiple invariants from one doc", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const synced = yield* createDocWithInvariants(
          "mcp-inv-multi",
          "Multi Invariant Doc",
          [
            {
              id: "INV-MCP-MULTI-001",
              rule: "Rule one",
              enforcement: "integration_test",
            },
            {
              id: "INV-MCP-MULTI-002",
              rule: "Rule two",
              enforcement: "integration_test",
            },
            {
              id: "INV-MCP-MULTI-003",
              rule: "Rule three",
              enforcement: "integration_test",
            },
          ]
        )

        return synced.map(serializeInvariant)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(3)
    const ids = result.map((inv) => inv.id)
    expect(ids).toContain("INV-MCP-MULTI-001")
    expect(ids).toContain("INV-MCP-MULTI-002")
    expect(ids).toContain("INV-MCP-MULTI-003")

    // In markdown-first, all enforcement is "integration_test" (derived from severity)
    const byId = Object.fromEntries(result.map((inv) => [inv.id, inv]))
    expect(byId["INV-MCP-MULTI-001"].enforcement).toBe("integration_test")
    expect(byId["INV-MCP-MULTI-002"].enforcement).toBe("integration_test")
    expect(byId["INV-MCP-MULTI-003"].enforcement).toBe("integration_test")
  })

  // ---------------------------------------------------------------------------
  // 14. listInvariants with no-match filter returns empty
  // ---------------------------------------------------------------------------

  it("listInvariants with non-matching filter returns empty array", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createDocWithInvariants("mcp-inv-nomatch", "No Match Doc", [
          {
            id: "INV-MCP-NOMATCH-001",
            rule: "Some rule",
            enforcement: "integration_test",
          },
        ])

        const docService = yield* DocService
        const noSubMatch = yield* docService.listInvariants({ subsystem: "nonexistent-subsystem" })
        const noEnfMatch = yield* docService.listInvariants({ enforcement: "llm_as_judge" })
        return {
          noSubMatch: noSubMatch.map(serializeInvariant),
          noEnfMatch: noEnfMatch.map(serializeInvariant),
        }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.noSubMatch).toEqual([])
    expect(result.noEnfMatch).toEqual([])
  })
})
