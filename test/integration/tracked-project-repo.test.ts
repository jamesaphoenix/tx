/**
 * TrackedProjectRepository Integration Tests
 *
 * Tests the TrackedProjectRepository at the repository layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * This tests the repository directly, covering:
 * - CRUD operations (insert, findAll, findByPath, delete)
 * - Duplicate project_path handling
 * - Null handling for findByPath
 * - State transitions for setEnabled
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 *
 * @see PRD-015 for the JSONL daemon and knowledge promotion pipeline
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import repository and types
import { TrackedProjectRepository } from "@jamesaphoenix/tx-core"
import type { CreateTrackedProjectInput, SourceType } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`tracked-project-repo-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  PROJECT_1: fixtureId("project-1"),
  PROJECT_2: fixtureId("project-2"),
  PROJECT_3: fixtureId("project-3"),
  PATH_1: `/Users/test/projects/${fixtureId("path-1")}`,
  PATH_2: `/Users/test/projects/${fixtureId("path-2")}`,
  PATH_3: `/Users/test/projects/${fixtureId("path-3")}`,
  PATH_4: `/Users/test/projects/${fixtureId("path-4")}`,
} as const

// =============================================================================
// Helper: Create TrackedProject Input
// =============================================================================

const createProjectInput = (
  overrides?: Partial<CreateTrackedProjectInput>
): CreateTrackedProjectInput => ({
  projectPath: overrides?.projectPath ?? FIXTURES.PATH_1,
  projectId: overrides?.projectId ?? null,
  sourceType: overrides?.sourceType ?? "claude" as SourceType,
})

// =============================================================================
// TrackedProjectRepository.insert Tests
// =============================================================================

describe("TrackedProjectRepository.insert", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("creates project with required fields", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.insert(createProjectInput())
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.id).toBe(1)
    expect(result.projectPath).toBe(FIXTURES.PATH_1)
    expect(result.projectId).toBeNull()
    expect(result.sourceType).toBe("claude")
    expect(result.enabled).toBe(true) // Default enabled
    expect(result.addedAt).toBeInstanceOf(Date)
  })

  it("creates project with projectId", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.insert(createProjectInput({
          projectId: FIXTURES.PROJECT_1,
        }))
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.projectId).toBe(FIXTURES.PROJECT_1)
  })

  it("creates project with different source types", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        const claude = yield* repo.insert(createProjectInput({
          projectPath: FIXTURES.PATH_1,
          sourceType: "claude",
        }))
        const cursor = yield* repo.insert(createProjectInput({
          projectPath: FIXTURES.PATH_2,
          sourceType: "cursor",
        }))
        const windsurf = yield* repo.insert(createProjectInput({
          projectPath: FIXTURES.PATH_3,
          sourceType: "windsurf",
        }))
        const other = yield* repo.insert(createProjectInput({
          projectPath: FIXTURES.PATH_4,
          sourceType: "other",
        }))

        return { claude, cursor, windsurf, other }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.claude.sourceType).toBe("claude")
    expect(result.cursor.sourceType).toBe("cursor")
    expect(result.windsurf.sourceType).toBe("windsurf")
    expect(result.other.sourceType).toBe("other")
  })

  it("auto-increments IDs for multiple inserts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        const p1 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        const p2 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_2 }))
        const p3 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_3 }))

        return { p1, p2, p3 }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.p1.id).toBe(1)
    expect(result.p2.id).toBe(2)
    expect(result.p3.id).toBe(3)
  })

  it("fails on duplicate project_path (UNIQUE constraint)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        // Try to insert same path again
        return yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("DatabaseError")
    }
  })

  it("defaults to sourceType 'claude' when not specified", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        // Using raw input without sourceType
        return yield* repo.insert({
          projectPath: FIXTURES.PATH_1,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.sourceType).toBe("claude")
  })
})

// =============================================================================
// TrackedProjectRepository.findAll Tests
// =============================================================================

describe("TrackedProjectRepository.findAll", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns all projects", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_2 }))
        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_3 }))

        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(3)
  })

  it("returns empty array when no projects", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  it("orders by added_at DESC (most recent first)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_2 }))
        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_3 }))

        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    // All items should be returned (ordering depends on timestamp granularity,
    // which may be identical for rapid inserts, so we verify count and presence)
    expect(result).toHaveLength(3)
    const paths = result.map(p => p.projectPath)
    expect(paths).toContain(FIXTURES.PATH_1)
    expect(paths).toContain(FIXTURES.PATH_2)
    expect(paths).toContain(FIXTURES.PATH_3)

    // Verify ordering by added_at (DESC) - when timestamps differ, most recent comes first
    // When timestamps are identical (rapid inserts), fallback to insertion order is acceptable
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].addedAt.getTime()).toBeGreaterThanOrEqual(result[i + 1].addedAt.getTime())
    }
  })

  it("includes both enabled and disabled projects", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        const p1 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_2 }))

        // Disable one project
        yield* repo.setEnabled(p1.id, false)

        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    const enabledStates = result.map(p => p.enabled)
    expect(enabledStates).toContain(true)
    expect(enabledStates).toContain(false)
  })
})

// =============================================================================
// TrackedProjectRepository.findByPath Tests
// =============================================================================

describe("TrackedProjectRepository.findByPath", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns project by path", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        yield* repo.insert(createProjectInput({
          projectPath: FIXTURES.PATH_1,
          projectId: FIXTURES.PROJECT_1,
        }))
        return yield* repo.findByPath(FIXTURES.PATH_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.projectPath).toBe(FIXTURES.PATH_1)
    expect(result!.projectId).toBe(FIXTURES.PROJECT_1)
  })

  it("returns null for nonexistent path", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.findByPath("/nonexistent/path")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("returns null for empty database", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.findByPath(FIXTURES.PATH_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("handles paths with special characters", async () => {
    const specialPath = "/Users/test/My Projects/project (1)"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        yield* repo.insert(createProjectInput({ projectPath: specialPath }))
        return yield* repo.findByPath(specialPath)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.projectPath).toBe(specialPath)
  })

  it("is case-sensitive on path matching", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        yield* repo.insert(createProjectInput({ projectPath: "/Users/test/Project" }))
        return yield* repo.findByPath("/Users/test/project") // Different case
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull() // Should not find due to case difference
  })

  it("finds disabled projects", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        const p = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.setEnabled(p.id, false)
        return yield* repo.findByPath(FIXTURES.PATH_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.enabled).toBe(false)
  })
})

// =============================================================================
// TrackedProjectRepository.delete Tests
// =============================================================================

describe("TrackedProjectRepository.delete", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("deletes project by ID and returns true", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        const p = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        const deleted = yield* repo.delete(p.id)
        const found = yield* repo.findByPath(FIXTURES.PATH_1)
        return { deleted, found }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.deleted).toBe(true)
    expect(result.found).toBeNull()
  })

  it("returns false for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.delete(999)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBe(false)
  })

  it("does not affect other projects", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        const p1 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_2 }))
        yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_3 }))

        yield* repo.delete(p1.id)

        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    const paths = result.map(p => p.projectPath)
    expect(paths).not.toContain(FIXTURES.PATH_1)
    expect(paths).toContain(FIXTURES.PATH_2)
    expect(paths).toContain(FIXTURES.PATH_3)
  })

  it("allows re-inserting after delete", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        const p1 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.delete(p1.id)

        // Should be able to insert same path again
        const p2 = yield* repo.insert(createProjectInput({
          projectPath: FIXTURES.PATH_1,
          projectId: FIXTURES.PROJECT_2, // Different project ID
        }))

        return p2
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.projectPath).toBe(FIXTURES.PATH_1)
    expect(result.projectId).toBe(FIXTURES.PROJECT_2)
  })

  it("deletes disabled projects", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        const p = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.setEnabled(p.id, false)
        const deleted = yield* repo.delete(p.id)
        const found = yield* repo.findByPath(FIXTURES.PATH_1)

        return { deleted, found }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.deleted).toBe(true)
    expect(result.found).toBeNull()
  })
})

// =============================================================================
// TrackedProjectRepository.setEnabled Tests
// =============================================================================

describe("TrackedProjectRepository.setEnabled", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("disables an enabled project", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        const p = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        expect(p.enabled).toBe(true) // Initially enabled
        return yield* repo.setEnabled(p.id, false)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.enabled).toBe(false)
  })

  it("enables a disabled project", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        const p = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        yield* repo.setEnabled(p.id, false)
        return yield* repo.setEnabled(p.id, true)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.enabled).toBe(true)
  })

  it("returns null for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.setEnabled(999, false)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("is idempotent - setting same state twice works", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        const p = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))

        // Disable twice
        yield* repo.setEnabled(p.id, false)
        const afterSecondDisable = yield* repo.setEnabled(p.id, false)

        // Enable twice
        yield* repo.setEnabled(p.id, true)
        const afterSecondEnable = yield* repo.setEnabled(p.id, true)

        return { afterSecondDisable, afterSecondEnable }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.afterSecondDisable!.enabled).toBe(false)
    expect(result.afterSecondEnable!.enabled).toBe(true)
  })

  it("preserves other fields when toggling enabled", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        const p = yield* repo.insert(createProjectInput({
          projectPath: FIXTURES.PATH_1,
          projectId: FIXTURES.PROJECT_1,
          sourceType: "cursor",
        }))

        const toggled = yield* repo.setEnabled(p.id, false)

        return { original: p, toggled }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.toggled!.id).toBe(result.original.id)
    expect(result.toggled!.projectPath).toBe(result.original.projectPath)
    expect(result.toggled!.projectId).toBe(result.original.projectId)
    expect(result.toggled!.sourceType).toBe(result.original.sourceType)
    expect(result.toggled!.addedAt.getTime()).toBe(result.original.addedAt.getTime())
    expect(result.toggled!.enabled).toBe(false) // Only this changed
  })

  it("does not affect other projects when toggling", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository

        const p1 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))
        const p2 = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_2 }))

        yield* repo.setEnabled(p1.id, false)

        const all = yield* repo.findAll()
        return { p1Id: p1.id, p2Id: p2.id, all }
      }).pipe(Effect.provide(shared.layer))
    )

    const p1After = result.all.find(p => p.id === result.p1Id)
    const p2After = result.all.find(p => p.id === result.p2Id)

    expect(p1After!.enabled).toBe(false)
    expect(p2After!.enabled).toBe(true) // Unchanged
  })

  it("toggle sequence: enable -> disable -> enable", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        const p = yield* repo.insert(createProjectInput({ projectPath: FIXTURES.PATH_1 }))

        const states: boolean[] = []
        states.push(p.enabled) // Initial: true

        const r1 = yield* repo.setEnabled(p.id, false)
        states.push(r1!.enabled) // After disable: false

        const r2 = yield* repo.setEnabled(p.id, true)
        states.push(r2!.enabled) // After re-enable: true

        const r3 = yield* repo.setEnabled(p.id, false)
        states.push(r3!.enabled) // After disable again: false

        return states
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([true, false, true, false])
  })
})

// =============================================================================
// TrackedProjectRepository Edge Cases
// =============================================================================

describe("TrackedProjectRepository edge cases", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("handles empty projectPath", async () => {
    // Empty path should still work (database allows it)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.insert(createProjectInput({ projectPath: "" }))
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.projectPath).toBe("")
  })

  it("handles very long projectPath", async () => {
    const longPath = "/Users/test/" + "a".repeat(1000)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        yield* repo.insert(createProjectInput({ projectPath: longPath }))
        return yield* repo.findByPath(longPath)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.projectPath).toBe(longPath)
  })

  it("handles null projectId explicitly", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        return yield* repo.insert({
          projectPath: FIXTURES.PATH_1,
          projectId: null,
          sourceType: "claude",
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.projectId).toBeNull()
  })

  it("handles Unicode characters in projectPath", async () => {
    const unicodePath = "/Users/test/项目/プロジェクト/🚀"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TrackedProjectRepository
        yield* repo.insert(createProjectInput({ projectPath: unicodePath }))
        return yield* repo.findByPath(unicodePath)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.projectPath).toBe(unicodePath)
  })
})
