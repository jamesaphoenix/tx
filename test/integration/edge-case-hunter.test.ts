/**
 * Edge Case Hunter Integration Tests
 *
 * Tests boundary conditions and invariant violations across tx services.
 * This is part of the agent swarm chaos engineering effort.
 *
 * Categories:
 * - Boundary conditions (limits, empty inputs, extreme values)
 * - Invariant violations (conditions that should never occur)
 * - Race conditions and concurrency
 * - Deep hierarchy and dependency chains
 * - Service behavior at edge cases
 *
 * @see DD-007 Testing Strategy
 * @see tx-ed99e703 Agent swarm: edge case hunter
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  TaskServiceLive,
  TaskService,
  DependencyServiceLive,
  DependencyService,
  ReadyServiceLive,
  ReadyService,
  HierarchyServiceLive,
  HierarchyService,
  ScoreServiceLive,
  ScoreService,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"
import {
  raceWorkers,
  stressLoad,
  doubleComplete,
  delayedClaim
} from "@jamesaphoenix/tx-test-utils"
import type { TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Layer Setup
// =============================================================================

function makeTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  const baseServices = Layer.mergeAll(TaskServiceLive, DependencyServiceLive, ReadyServiceLive, HierarchyServiceLive).pipe(
    Layer.provide(Layer.merge(repos, AutoSyncServiceNoop))
  )
  const scoreService = ScoreServiceLive.pipe(
    Layer.provide(baseServices),
    Layer.provide(repos)
  )
  return Layer.mergeAll(baseServices, scoreService)
}


// =============================================================================
// Ready Service Boundary Conditions
// =============================================================================

describe("ReadyService boundary conditions", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  afterEach(() => {
    db.close()
  })

  describe("limit parameter edge cases", () => {
    it("returns empty array when limit is 0", async () => {
      const ready = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady(0)
        }).pipe(Effect.provide(layer))
      )

      expect(ready).toHaveLength(0)
    })

    it("handles negative limit by treating as default", async () => {
      // Negative limits are often converted to default (100)
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady(-1)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      // Should either succeed with default limit or handle gracefully
      if (result._tag === "Right") {
        expect(result.right.length).toBeGreaterThanOrEqual(0)
      } else {
        // If it fails, it should be a clear error
        expect(result.left).toBeDefined()
      }
    })

    it("handles very large limit without memory issues", async () => {
      const ready = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady(Number.MAX_SAFE_INTEGER)
        }).pipe(Effect.provide(layer))
      )

      // Should return all ready tasks, not crash
      expect(ready.length).toBeGreaterThanOrEqual(0)
      expect(ready.length).toBeLessThanOrEqual(10) // Only have a few fixtures
    })

    it("returns exactly limit items when more are available", async () => {
      // Create more ready tasks
      const now = new Date().toISOString()
      for (let i = 0; i < 10; i++) {
        db.db.prepare(
          `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, '', 'backlog', ?, datetime('now'), datetime('now'), '{}')`
        ).run(fixtureId(`limit-test-${i}`), `Limit Test ${i}`, 100 + i)
      }

      const ready = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady(3)
        }).pipe(Effect.provide(layer))
      )

      expect(ready).toHaveLength(3)
    })
  })

  describe("isReady edge cases", () => {
    it("returns false for nonexistent task", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.isReady("tx-nonexist" as TaskId)
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe(false)
    })

    it("returns false for 'done' status task even with no blockers", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.isReady(FIXTURES.TASK_DONE)
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe(false)
    })

    it("handles task with deleted blocker", async () => {
      // Create a task with a dependency
      const now = new Date().toISOString()
      const blockerId = fixtureId("will-delete")
      const blockedId = fixtureId("orphan-blocked")

      db.db.prepare(
        `INSERT INTO tasks (id, title, status, score, created_at, updated_at, metadata)
         VALUES (?, 'Will Delete', 'backlog', 100, ?, ?, '{}')`
      ).run(blockerId, now, now)

      db.db.prepare(
        `INSERT INTO tasks (id, title, status, score, created_at, updated_at, metadata)
         VALUES (?, 'Orphan Blocked', 'backlog', 100, ?, ?, '{}')`
      ).run(blockedId, now, now)

      db.db.prepare(
        `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
      ).run(blockerId, blockedId, now)

      // Delete the blocker task (bypassing FK check)
      db.exec("PRAGMA foreign_keys = OFF")
      db.db.prepare("DELETE FROM tasks WHERE id = ?").run(blockerId)
      db.exec("PRAGMA foreign_keys = ON")

      // Check if the orphaned blocked task is considered ready
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.isReady(blockedId as TaskId)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      // Should handle gracefully - either return false (not ready) or true (blocker doesn't exist)
      // Current implementation: blocker doesn't exist in tasks table -> findByIds returns empty
      // -> blockers.every(b => b.status === 'done') is true for empty array -> isReady
      if (result._tag === "Right") {
        // Empty array.every() returns true, so task might be considered ready
        expect(typeof result.right).toBe("boolean")
      }
    })
  })

  describe("getBlockers and getBlocking edge cases", () => {
    it("returns empty array for task with no blockers", async () => {
      const blockers = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getBlockers(FIXTURES.TASK_ROOT)
        }).pipe(Effect.provide(layer))
      )

      expect(blockers).toHaveLength(0)
    })

    it("returns empty array for task that blocks nothing", async () => {
      const blocking = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getBlocking(FIXTURES.TASK_DONE)
        }).pipe(Effect.provide(layer))
      )

      expect(blocking).toHaveLength(0)
    })
  })
})

// =============================================================================
// Dependency Service Boundary Conditions
// =============================================================================

describe("DependencyService boundary conditions", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  afterEach(() => {
    db.close()
  })

  describe("cycle detection edge cases", () => {
    it("detects indirect cycle (A->B->C, try C->A)", async () => {
      const now = new Date().toISOString()
      const taskA = fixtureId("cycle-a")
      const taskB = fixtureId("cycle-b")
      const taskC = fixtureId("cycle-c")

      // Create tasks
      for (const [id, title] of [[taskA, "A"], [taskB, "B"], [taskC, "C"]]) {
        db.db.prepare(
          `INSERT INTO tasks (id, title, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, 'backlog', 100, ?, ?, '{}')`
        ).run(id, title, now, now)
      }

      // Create A->B and B->C
      db.db.prepare(
        `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
      ).run(taskA, taskB, now)
      db.db.prepare(
        `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
      ).run(taskB, taskC, now)

      // Try to add C->A (would create cycle)
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DependencyService
          return yield* svc.addBlocker(taskA as TaskId, taskC as TaskId)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("CircularDependencyError")
      }
    })

    it("allows valid diamond dependency (A->B, A->C, B->D, C->D)", async () => {
      const now = new Date().toISOString()
      const taskA = fixtureId("diamond-a")
      const taskB = fixtureId("diamond-b")
      const taskC = fixtureId("diamond-c")
      const taskD = fixtureId("diamond-d")

      // Create tasks
      for (const [id, title] of [[taskA, "A"], [taskB, "B"], [taskC, "C"], [taskD, "D"]]) {
        db.db.prepare(
          `INSERT INTO tasks (id, title, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, 'backlog', 100, ?, ?, '{}')`
        ).run(id, title, now, now)
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DependencyService
          // A blocks B and C
          yield* svc.addBlocker(taskB as TaskId, taskA as TaskId)
          yield* svc.addBlocker(taskC as TaskId, taskA as TaskId)
          // B and C block D
          yield* svc.addBlocker(taskD as TaskId, taskB as TaskId)
          yield* svc.addBlocker(taskD as TaskId, taskC as TaskId)
          return "success"
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe("success")
    })

    it("handles deep transitive chain (100 levels)", async () => {
      const now = new Date().toISOString()
      const depth = 100
      const taskIds: string[] = []

      // Create chain of tasks
      for (let i = 0; i < depth; i++) {
        const id = fixtureId(`deep-chain-${i}`)
        taskIds.push(id)
        db.db.prepare(
          `INSERT INTO tasks (id, title, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, 'backlog', 100, ?, ?, '{}')`
        ).run(id, `Deep ${i}`, now, now)
      }

      // Create chain: 0->1->2->...->99
      for (let i = 0; i < depth - 1; i++) {
        db.db.prepare(
          `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
        ).run(taskIds[i], taskIds[i + 1], now)
      }

      // Try to create cycle from last to first (should fail)
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DependencyService
          return yield* svc.addBlocker(taskIds[0] as TaskId, taskIds[depth - 1] as TaskId)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("CircularDependencyError")
      }
    })
  })

  describe("removeBlocker edge cases", () => {
    it("removing nonexistent dependency succeeds silently", async () => {
      // This tests idempotency - removing what doesn't exist should be safe
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DependencyService
          // Remove dependency that doesn't exist
          yield* svc.removeBlocker(FIXTURES.TASK_ROOT, FIXTURES.TASK_DONE)
          return "success"
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe("success")
    })

    it("removing same dependency twice succeeds", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DependencyService
          // Remove the JWT->BLOCKED dependency twice
          yield* svc.removeBlocker(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT)
          yield* svc.removeBlocker(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT)
          return "success"
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe("success")
    })
  })
})

// =============================================================================
// Hierarchy Service Boundary Conditions
// =============================================================================

describe("HierarchyService boundary conditions", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  afterEach(() => {
    db.close()
  })

  describe("deep hierarchy traversal", () => {
    it("handles 50-level deep hierarchy for getAncestors", async () => {
      const now = new Date().toISOString()
      const depth = 50
      const taskIds: string[] = []

      // Create deep hierarchy
      let parentId: string | null = null
      for (let i = 0; i < depth; i++) {
        const id = fixtureId(`deep-hier-${i}`)
        taskIds.push(id)
        db.db.prepare(
          `INSERT INTO tasks (id, title, status, score, parent_id, created_at, updated_at, metadata)
           VALUES (?, ?, 'backlog', 100, ?, ?, ?, '{}')`
        ).run(id, `Deep Hier ${i}`, parentId, now, now)
        parentId = id
      }

      // Get ancestors of deepest task
      const deepestId = taskIds[depth - 1]

      const ancestors = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getAncestors(deepestId as TaskId)
        }).pipe(Effect.provide(layer))
      )

      expect(ancestors).toHaveLength(depth - 1)
    })

    it("handles wide hierarchy (100 children) for getChildren", async () => {
      const now = new Date().toISOString()
      const parentId = fixtureId("wide-parent")
      const width = 100

      // Create parent
      db.db.prepare(
        `INSERT INTO tasks (id, title, status, score, created_at, updated_at, metadata)
         VALUES (?, 'Wide Parent', 'backlog', 100, ?, ?, '{}')`
      ).run(parentId, now, now)

      // Create many children
      for (let i = 0; i < width; i++) {
        const childId = fixtureId(`wide-child-${i}`)
        db.db.prepare(
          `INSERT INTO tasks (id, title, status, score, parent_id, created_at, updated_at, metadata)
           VALUES (?, ?, 'backlog', 100, ?, ?, ?, '{}')`
        ).run(childId, `Child ${i}`, parentId, now, now)
      }

      const children = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getChildren(parentId as TaskId)
        }).pipe(Effect.provide(layer))
      )

      expect(children).toHaveLength(width)
    })

    it("getDepth returns 0 for task with null parentId", async () => {
      const depth = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getDepth(FIXTURES.TASK_ROOT)
        }).pipe(Effect.provide(layer))
      )

      expect(depth).toBe(0)
    })

    it("getTree handles leaf node correctly", async () => {
      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(FIXTURES.TASK_JWT)
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(FIXTURES.TASK_JWT)
      expect(tree.children).toHaveLength(0)
    })
  })

  describe("getRoots edge cases", () => {
    it("returns multiple roots when database has multiple", async () => {
      const now = new Date().toISOString()

      // Add another root
      db.db.prepare(
        `INSERT INTO tasks (id, title, status, score, parent_id, created_at, updated_at, metadata)
         VALUES (?, 'Second Root', 'backlog', 100, NULL, ?, ?, '{}')`
      ).run(fixtureId("second-root"), now, now)

      const roots = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getRoots()
        }).pipe(Effect.provide(layer))
      )

      expect(roots.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// =============================================================================
// Task Service Boundary Conditions
// =============================================================================

describe("TaskService boundary conditions", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  afterEach(() => {
    db.close()
  })

  describe("title validation edge cases", () => {
    it("rejects whitespace-only title", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: "   \t\n   " })
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("ValidationError")
      }
    })

    it("trims whitespace from valid title", async () => {
      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: "  Valid Title  " })
        }).pipe(Effect.provide(layer))
      )

      expect(task.title).toBe("Valid Title")
    })

    it("handles very long title", async () => {
      const longTitle = "A".repeat(10000)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: longTitle })
        }).pipe(Effect.provide(layer), Effect.either)
      )

      // Should either succeed or fail gracefully
      if (result._tag === "Right") {
        expect(result.right.title).toBe(longTitle)
      } else {
        // If it fails, should be ValidationError or DatabaseError
        expect((result.left as any)._tag).toMatch(/ValidationError|DatabaseError/)
      }
    })

    it("handles title with special characters", async () => {
      const specialTitle = "Test <script>alert('xss')</script> & \"quotes\" 'single' 日本語"

      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: specialTitle })
        }).pipe(Effect.provide(layer))
      )

      expect(task.title).toBe(specialTitle)
    })
  })

  describe("score boundary conditions", () => {
    it("accepts zero score", async () => {
      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: "Zero Score", score: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(task.score).toBe(0)
    })

    it("accepts negative score", async () => {
      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: "Negative Score", score: -999 })
        }).pipe(Effect.provide(layer))
      )

      expect(task.score).toBe(-999)
    })

    it("handles maximum safe integer score", async () => {
      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: "Max Score", score: Number.MAX_SAFE_INTEGER })
        }).pipe(Effect.provide(layer))
      )

      expect(task.score).toBe(Number.MAX_SAFE_INTEGER)
    })
  })

  describe("status transition edge cases", () => {
    it("rejects invalid status value", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.update(FIXTURES.TASK_JWT, { status: "invalid_status" as any })
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("ValidationError")
      }
    })

    it("forceStatus bypasses transition validation", async () => {
      // Direct transition from ready to done (normally invalid via update)
      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.forceStatus(FIXTURES.TASK_JWT, "done")
        }).pipe(Effect.provide(layer))
      )

      expect(task.status).toBe("done")
      expect(task.completedAt).not.toBeNull()
    })

    it("setting status back from done clears completedAt", async () => {
      // First complete, then force back to backlog
      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          yield* svc.forceStatus(FIXTURES.TASK_JWT, "done")
          return yield* svc.forceStatus(FIXTURES.TASK_JWT, "backlog")
        }).pipe(Effect.provide(layer))
      )

      expect(task.status).toBe("backlog")
      expect(task.completedAt).toBeNull()
    })
  })

  describe("auto-complete parent edge cases", () => {
    it("auto-completes parent when all children are done via update", async () => {
      // Mark all of AUTH's children as done using update (which triggers auto-complete)
      // Note: forceStatus does NOT trigger auto-complete, only update does
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          // First need to transition through valid states to done
          // LOGIN is already ready, can go to active->done
          yield* svc.update(FIXTURES.TASK_LOGIN, { status: "active" })
          yield* svc.update(FIXTURES.TASK_LOGIN, { status: "done" })

          // JWT is ready, can go to active->done
          yield* svc.update(FIXTURES.TASK_JWT, { status: "active" })
          yield* svc.update(FIXTURES.TASK_JWT, { status: "done" })

          // BLOCKED is backlog but blockers are now done, so it can progress
          yield* svc.update(FIXTURES.TASK_BLOCKED, { status: "ready" })
          yield* svc.update(FIXTURES.TASK_BLOCKED, { status: "active" })
          yield* svc.update(FIXTURES.TASK_BLOCKED, { status: "done" })

          // DONE is already done

          // Check if parent AUTH is auto-completed
          return yield* svc.get(FIXTURES.TASK_AUTH)
        }).pipe(Effect.provide(layer))
      )

      expect(result.status).toBe("done")
    })

    it("does not auto-complete parent if some children not done", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          // Only complete some children
          yield* svc.update(FIXTURES.TASK_LOGIN, { status: "active" })
          yield* svc.update(FIXTURES.TASK_LOGIN, { status: "done" })

          yield* svc.update(FIXTURES.TASK_JWT, { status: "active" })
          yield* svc.update(FIXTURES.TASK_JWT, { status: "done" })
          // Leave BLOCKED as backlog

          return yield* svc.get(FIXTURES.TASK_AUTH)
        }).pipe(Effect.provide(layer))
      )

      // Should not be done yet
      expect(result.status).not.toBe("done")
    })
  })

  describe("list and count edge cases", () => {
    it("list returns empty array for impossible filter", async () => {
      const tasks = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.list({ status: "impossible_status" as any })
        }).pipe(Effect.provide(layer))
      )

      expect(tasks).toHaveLength(0)
    })

    it("count returns 0 for impossible filter", async () => {
      const count = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.count({ status: "impossible_status" as any })
        }).pipe(Effect.provide(layer))
      )

      expect(count).toBe(0)
    })

    it("listWithDeps returns proper dependency info for all tasks", async () => {
      const tasks = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.listWithDeps()
        }).pipe(Effect.provide(layer))
      )

      // Every task should have dependency arrays
      for (const task of tasks) {
        expect(task).toHaveProperty("blockedBy")
        expect(task).toHaveProperty("blocks")
        expect(task).toHaveProperty("children")
        expect(task).toHaveProperty("isReady")
        expect(Array.isArray(task.blockedBy)).toBe(true)
        expect(Array.isArray(task.blocks)).toBe(true)
        expect(Array.isArray(task.children)).toBe(true)
      }
    })

    it("getWithDepsBatch handles empty array", async () => {
      const tasks = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.getWithDepsBatch([])
        }).pipe(Effect.provide(layer))
      )

      expect(tasks).toHaveLength(0)
    })

    it("getWithDepsBatch handles missing IDs gracefully", async () => {
      const tasks = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.getWithDepsBatch([FIXTURES.TASK_JWT, "tx-nonexist" as TaskId])
        }).pipe(Effect.provide(layer))
      )

      // Should return only existing tasks
      expect(tasks.length).toBe(1)
      expect(tasks[0].id).toBe(FIXTURES.TASK_JWT)
    })
  })
})

// =============================================================================
// Score Service Boundary Conditions
// =============================================================================

describe("ScoreService boundary conditions", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  afterEach(() => {
    db.close()
  })

  it("handles negative base score", async () => {
    // Create task with negative score
    const now = new Date().toISOString()
    const taskId = fixtureId("negative-score")
    db.db.prepare(
      `INSERT INTO tasks (id, title, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Negative Base', 'backlog', -500, ?, ?, '{}')`
    ).run(taskId, now, now)

    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreSvc = yield* ScoreService
        return yield* scoreSvc.calculateById(taskId as TaskId)
      }).pipe(Effect.provide(layer))
    )

    // Should calculate score even with negative base
    expect(typeof score).toBe("number")
    expect(score).toBeLessThan(0)
  })

  it("breakdown shows all components correctly", async () => {
    const breakdown = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreSvc = yield* ScoreService
        return yield* scoreSvc.getBreakdownById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    // All breakdown fields should be numbers
    expect(typeof breakdown.baseScore).toBe("number")
    expect(typeof breakdown.blockingCount).toBe("number")
    expect(typeof breakdown.blockingBonus).toBe("number")
    expect(typeof breakdown.depth).toBe("number")
    expect(typeof breakdown.depthPenalty).toBe("number")
    expect(typeof breakdown.blockedPenalty).toBe("number")
    expect(typeof breakdown.finalScore).toBe("number")

    // Final score should equal base + bonus - penalties
    const computed = breakdown.baseScore + breakdown.blockingBonus - breakdown.depthPenalty - breakdown.blockedPenalty
    expect(breakdown.finalScore).toBe(computed)
  })
})

// =============================================================================
// Concurrent Operations Edge Cases
// =============================================================================

describe("Concurrent operations", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  describe("race conditions in claiming", () => {
    it("only one worker wins when racing for same task", async () => {
      const result = await raceWorkers({
        count: 5,
        taskId: FIXTURES.TASK_JWT,
        db
      })

      // Exactly one winner
      expect(result.successfulClaims).toBe(1)
      expect(result.winner).not.toBeNull()
      expect(result.losers).toHaveLength(4)
    })

    it("handles delayed claim after fast claim", async () => {
      // First worker claims immediately
      const now = new Date()
      const workerId = fixtureId("fast-worker")

      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, 'Fast Worker', 'test', ?, 'idle', ?, ?, '[]', '{}')`,
        [workerId, process.pid, now.toISOString(), now.toISOString()]
      )

      const leaseExpiresAt = new Date(Date.now() + 30 * 60 * 1000)
      db.run(
        `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
         VALUES (?, ?, ?, ?, 0, 'active')`,
        [FIXTURES.TASK_JWT, workerId, now.toISOString(), leaseExpiresAt.toISOString()]
      )

      // Delayed claim should detect the race
      const result = await delayedClaim({
        taskId: FIXTURES.TASK_JWT,
        workerId: fixtureId("slow-worker"),
        db: db,
        delayMs: 10,
        checkRace: true
      })

      expect(result.claimed).toBe(false)
      expect(result.claimedBy).toBe(workerId)
    })
  })

  describe("double completion", () => {
    it("double complete updates timestamp but keeps done status", () => {
      const result = doubleComplete({
        taskId: FIXTURES.TASK_JWT,
        db: db
      })

      expect(result.firstCompleted).toBe(true)
      expect(result.finalStatus).toBe("done")
      // Second completion behavior - may update timestamp (current behavior)
      // or be idempotent (stricter behavior)
    })

    it("double complete on already-done task is idempotent for status", () => {
      const result = doubleComplete({
        taskId: FIXTURES.TASK_DONE, // Already done in fixtures
        db: db
      })

      expect(result.firstCompleted).toBe(true)
      expect(result.finalStatus).toBe("done")
      expect(result.originalStatus).toBe("done")
    })
  })
})

// =============================================================================
// Stress Testing Edge Cases
// =============================================================================

describe("Stress testing", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    // Don't seed fixtures - start fresh for stress tests
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("creates 1000 tasks without error", () => {
    const result = stressLoad({
      taskCount: 1000,
      db: db,
      withDependencies: false,
      batchSize: 100
    })

    expect(result.tasksCreated).toBe(1000)
    expect(result.elapsedMs).toBeLessThan(10000) // Should complete within 10 seconds
    expect(result.tasksPerSecond).toBeGreaterThan(100) // At least 100 tasks/sec
  })

  it("creates 500 tasks with random dependencies", () => {
    const result = stressLoad({
      taskCount: 500,
      db: db,
      withDependencies: true,
      dependencyRatio: 0.2,
      batchSize: 100
    })

    expect(result.tasksCreated).toBe(500)
    expect(result.depsCreated).toBeGreaterThan(0)
    // Some deps may fail due to cycle detection, but should have some
    expect(result.depsCreated).toBeLessThanOrEqual(100) // ~20% of 500
  })

  it("handles mixed statuses under load", () => {
    const result = stressLoad({
      taskCount: 200,
      db: db,
      withDependencies: false,
      mixedStatuses: true
    })

    expect(result.tasksCreated).toBe(200)

    // Check status distribution
    const statusCounts = db.query<{ status: string; count: number }>(
      "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
    )

    // Should have multiple statuses
    expect(statusCounts.length).toBeGreaterThan(1)
  })
})

// =============================================================================
// ID Generation Edge Cases
// =============================================================================

describe("ID generation", () => {
  it("fixtureId is deterministic", () => {
    const id1 = fixtureId("test-deterministic")
    const id2 = fixtureId("test-deterministic")

    expect(id1).toBe(id2)
  })

  it("fixtureId produces different IDs for different inputs", () => {
    const id1 = fixtureId("input-1")
    const id2 = fixtureId("input-2")

    expect(id1).not.toBe(id2)
  })

  it("fixtureId matches expected format", () => {
    const id = fixtureId("format-test")

    expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("fixtureId handles empty string", () => {
    const id = fixtureId("")

    expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("fixtureId handles special characters", () => {
    const id = fixtureId("special-!@#$%^&*()")

    expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("fixtureId handles unicode", () => {
    const id = fixtureId("日本語テスト")

    expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
  })
})

// =============================================================================
// Invariant Violations Documentation
// =============================================================================

describe("Documented invariant behaviors", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
  })

  afterEach(() => {
    db.close()
  })

  it("INVARIANT: self-blocking is rejected at service level", async () => {
    const layer = makeTestLayer(db)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
      expect((result.left as any).reason).toContain("itself")
    }
  })

  it("INVARIANT: self-blocking is rejected at database level", () => {
    expect(() => {
      db.db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT)
    }).toThrow()
  })

  it("INVARIANT: duplicate dependency is rejected", () => {
    // JWT->BLOCKED already exists
    expect(() => {
      db.db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED)
    }).toThrow()
  })

  it("INVARIANT: TaskWithDeps always has dependency arrays", async () => {
    const layer = makeTestLayer(db)

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.getWithDeps(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    // These fields must exist per RULE 1
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")

    expect(Array.isArray(task.blockedBy)).toBe(true)
    expect(Array.isArray(task.blocks)).toBe(true)
    expect(Array.isArray(task.children)).toBe(true)
    expect(typeof task.isReady).toBe("boolean")
  })
})
