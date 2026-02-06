/**
 * Chaos Engineering: State Corruption and Recovery Tests
 *
 * Tests system behavior under corrupted state conditions and
 * validates recovery mechanisms.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * @module test/chaos/state-corruption
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import type { TaskId } from "@jamesaphoenix/tx-types"
import {
  createTestDatabase,
  fixtureId,
  chaos,
  type TestDatabase
} from "@jamesaphoenix/tx-test-utils"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const FIXTURES = {
  TASK_1: fixtureId("chaos-corrupt-task-1") as TaskId,
  TASK_2: fixtureId("chaos-corrupt-task-2") as TaskId,
  TASK_3: fixtureId("chaos-corrupt-task-3") as TaskId,
  TASK_PARENT: fixtureId("chaos-corrupt-parent") as TaskId
} as const

// =============================================================================
// Test Layer Factory
// =============================================================================

async function makeTestLayer() {
  const {
    SqliteClientLive,
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive,
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    AutoSyncServiceNoop
  } = await import("@jamesaphoenix/tx-core")

  const infra = SqliteClientLive(":memory:")
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive
  ).pipe(Layer.provide(infra))

  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(Layer.provide(Layer.merge(repos, AutoSyncServiceNoop)))

  return Layer.mergeAll(services, repos)
}

// =============================================================================
// INVARIANT: System handles invalid data gracefully
// =============================================================================

describe("Chaos: State Corruption", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())

    // Seed base task
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`,
      [FIXTURES.TASK_1, "Corruption Test Task", now, now]
    )
  })

  describe("Invalid status corruption", () => {
    it("corrupts task with invalid status value", () => {
      const result = chaos.corruptState({
        table: "tasks",
        type: "invalid_status",
        db,
        rowId: FIXTURES.TASK_1
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ status: string }>(
        "SELECT status FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(task.status).toBe("INVALID_STATUS")
    })

    it("creates new corrupted row when rowId not provided", () => {
      const result = chaos.corruptState({
        table: "tasks",
        type: "invalid_status",
        db
      })

      expect(result.corrupted).toBe(true)
      expect(result.rowId).toMatch(/^tx-/)
      expect(result.rowId).not.toBe(FIXTURES.TASK_1)
    })
  })

  describe("Invalid JSON metadata corruption", () => {
    it("corrupts task metadata with invalid JSON", () => {
      const result = chaos.corruptState({
        table: "tasks",
        type: "invalid_json",
        db,
        rowId: FIXTURES.TASK_1
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ metadata: string }>(
        "SELECT metadata FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(() => JSON.parse(task.metadata)).toThrow()
    })
  })

  describe("Negative score corruption", () => {
    it("corrupts task with negative score", () => {
      const result = chaos.corruptState({
        table: "tasks",
        type: "negative_score",
        db,
        rowId: FIXTURES.TASK_1
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ score: number }>(
        "SELECT score FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(task.score).toBe(-1000)
    })
  })

  describe("Future timestamp corruption", () => {
    it("corrupts task with future created_at timestamp", () => {
      const result = chaos.corruptState({
        table: "tasks",
        type: "future_timestamp",
        db,
        rowId: FIXTURES.TASK_1
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ created_at: string }>(
        "SELECT created_at FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      const createdAt = new Date(task.created_at)
      expect(createdAt.getTime()).toBeGreaterThan(Date.now())
    })
  })

  describe("Self-reference corruption", () => {
    it("corrupts task with self-referencing parent_id", () => {
      const result = chaos.corruptState({
        table: "tasks",
        type: "self_reference",
        db,
        rowId: FIXTURES.TASK_1
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ parent_id: string | null }>(
        "SELECT parent_id FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(task.parent_id).toBe(FIXTURES.TASK_1)
    })
  })

  describe("Orphaned dependency corruption", () => {
    it("creates orphaned dependency pointing to non-existent task", () => {
      const result = chaos.corruptState({
        table: "task_dependencies",
        type: "orphaned_dependency",
        db,
        rowId: FIXTURES.TASK_1
      })

      expect(result.corrupted).toBe(true)

      // Verify there's a dependency with a non-existent blocker
      const deps = db.query<{ blocker_id: string }>(
        "SELECT blocker_id FROM task_dependencies"
      )

      // At least one dependency should have a non-existent blocker
      const blocker = deps.find(d =>
        !db.query<{ id: string }>("SELECT id FROM tasks WHERE id = ?", [d.blocker_id]).length
      )
      expect(blocker).toBeDefined()
    })
  })
})

// =============================================================================
// INVARIANT: Partial writes handle transaction integrity
// =============================================================================

describe("Chaos: Partial Write Handling", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  describe("Without transactions (atomic failure)", () => {
    it("writes partial data when failure occurs mid-batch", () => {
      const result = chaos.partialWrite({
        table: "tasks",
        db,
        rowCount: 10,
        failAtRow: 5,
        useTransaction: false
      })

      expect(result.rowsWritten).toBe(4) // Rows 1-4 succeed
      expect(result.rowsFailed).toBe(6) // Rows 5-10 fail
      expect(result.rolledBack).toBe(false)
      expect(result.error).toContain("Simulated failure at row 5")

      // Verify partial data exists
      const tasks = db.query<{ id: string }>(
        "SELECT id FROM tasks WHERE title LIKE 'Partial Write%'"
      )
      expect(tasks.length).toBe(4)
    })
  })

  describe("With transactions (rollback on failure)", () => {
    it("rolls back all data when failure occurs mid-batch", () => {
      const result = chaos.partialWrite({
        table: "tasks",
        db,
        rowCount: 10,
        failAtRow: 5,
        useTransaction: true
      })

      expect(result.rowsWritten).toBe(0)
      expect(result.rolledBack).toBe(true)
      expect(result.writtenIds.length).toBe(0)
      expect(result.error).toContain("Simulated failure at row 5")

      // Verify no partial data exists
      const tasks = db.query<{ id: string }>(
        "SELECT id FROM tasks WHERE title LIKE 'Partial Write%'"
      )
      expect(tasks.length).toBe(0)
    })
  })

  describe("Full success when failure point beyond batch", () => {
    it("succeeds when failAtRow > rowCount", () => {
      const result = chaos.partialWrite({
        table: "tasks",
        db,
        rowCount: 5,
        failAtRow: 100,
        useTransaction: false
      })

      expect(result.rowsWritten).toBe(5)
      expect(result.rowsFailed).toBe(0)
      expect(result.error).toBeUndefined()
    })
  })

  describe("Additional task partial writes", () => {
    it("handles partial write with larger batch", () => {
      const result = chaos.partialWrite({
        table: "tasks",
        db,
        rowCount: 20,
        failAtRow: 15,
        useTransaction: false
      })

      expect(result.rowsWritten).toBe(14)
      expect(result.rowsFailed).toBe(6)

      const tasks = db.query<{ id: string }>(
        "SELECT id FROM tasks WHERE title LIKE 'Partial Write%'"
      )
      expect(tasks.length).toBe(14)
    })
  })
})

// =============================================================================
// INVARIANT: CrashAfter properly simulates process death
// =============================================================================

describe("Chaos: Crash Simulation", () => {
  describe("Operation completion tracking", () => {
    it("returns completed=true when operation finishes before timeout", async () => {
      const result = await chaos.crashAfter({ ms: 100 }, async () => {
        return "success"
      })

      expect(result.completed).toBe(true)
      expect(result.value).toBe("success")
      expect(result.elapsedMs).toBeLessThan(100)
    })

    it("returns completed=false when timeout occurs first", async () => {
      const result = await chaos.crashAfter({ ms: 50 }, async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return "should not complete"
      })

      expect(result.completed).toBe(false)
      expect(result.value).toBeUndefined()
      expect(result.elapsedMs).toBeGreaterThanOrEqual(45)
      expect(result.elapsedMs).toBeLessThan(200)
    })

    it("calls beforeCrash callback when crash occurs", async () => {
      let callbackCalled = false

      await chaos.crashAfter(
        {
          ms: 50,
          beforeCrash: () => {
            callbackCalled = true
          }
        },
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      )

      expect(callbackCalled).toBe(true)
    })

    it("throws CrashSimulationError when throwOnCrash is true", async () => {
      await expect(
        chaos.crashAfter({ ms: 50, throwOnCrash: true }, async () => {
          await new Promise(resolve => setTimeout(resolve, 200))
        })
      ).rejects.toBeInstanceOf(chaos.CrashSimulationError)
    })
  })

  describe("Database operation crash scenarios", () => {
    let db: TestDatabase

    beforeEach(async () => {
      db = await Effect.runPromise(createTestDatabase())
    })

    it("simulates crash during task creation batch", async () => {
      const result = await chaos.crashAfter({ ms: 10 }, async () => {
        // Simulate slow batch insert
        for (let i = 0; i < 100; i++) {
          db.run(
            `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
             VALUES (?, ?, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')`,
            [fixtureId(`crash-task-${i}`), `Crash Task ${i}`]
          )
          await new Promise(resolve => setTimeout(resolve, 1))
        }
        return "complete"
      })

      // May or may not complete depending on timing
      // Just verify we don't hang (allow 5ms tolerance for timer imprecision)
      expect(result.elapsedMs).toBeGreaterThanOrEqual(5)
    })
  })
})

// =============================================================================
// INVARIANT: Service layer handles corrupted data gracefully
// =============================================================================

describe("Chaos: Service Layer Corruption Handling", () => {
  it("TaskService.getWithDeps returns proper TaskWithDeps fields", async () => {
    const { TaskService, DependencyService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService

        // Setup hierarchy via service layer
        const parent = yield* taskSvc.create({ title: "Parent Task", score: 1000 })
        const child = yield* taskSvc.create({ title: "Child Task", score: 500, parentId: parent.id })
        const blocker = yield* taskSvc.create({ title: "Blocker Task", score: 600, parentId: parent.id })
        yield* taskSvc.update(blocker.id, { status: "ready" })

        // Add dependency: blocker blocks child
        yield* depSvc.addBlocker(child.id, blocker.id)

        return yield* taskSvc.getWithDeps(child.id)
      }).pipe(Effect.provide(layer))
    )

    // INVARIANT (Rule 1): TaskWithDeps must have all dependency fields
    expect(result).toHaveProperty("blockedBy")
    expect(result).toHaveProperty("blocks")
    expect(result).toHaveProperty("children")
    expect(result).toHaveProperty("isReady")

    expect(result.blockedBy.length).toBeGreaterThan(0)
    expect(result.isReady).toBe(false) // Blocked
  })

  it("DependencyService rejects self-blocking (Rule 4)", async () => {
    const { DependencyService, TaskService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService

        yield* taskSvc.create({ title: "Self Block Test", score: 500 })

        // Try to create self-blocking dependency
        return yield* depSvc.addBlocker(FIXTURES.TASK_1, FIXTURES.TASK_1).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    // INVARIANT (Rule 4): Self-blocking must be rejected
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("ValidationError")
    }
  })
})
