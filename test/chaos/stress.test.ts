/**
 * Chaos Engineering: Stress Tests
 *
 * Tests system behavior under high load conditions with thousands
 * of tasks and concurrent operations.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * @module test/chaos/stress
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
  STRESS_TASK: fixtureId("chaos-stress-task") as TaskId
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
// INVARIANT: System handles large task counts
// =============================================================================

describe("Chaos: Stress Load Tests", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  describe("Task creation at scale", () => {
    it("creates 100 tasks efficiently", () => {
      const result = chaos.stressLoad({
        taskCount: 100,
        db
      })

      expect(result.tasksCreated).toBe(100)
      expect(result.taskIds.length).toBe(100)

      // Verify all tasks exist in database
      const count = db.query<{ count: number }>("SELECT COUNT(*) as count FROM tasks")[0]
      expect(count.count).toBe(100)
    })

    it("creates 1000 tasks within reasonable time", () => {
      const result = chaos.stressLoad({
        taskCount: 1000,
        db
      })

      expect(result.tasksCreated).toBe(1000)
      expect(result.elapsedMs).toBeLessThan(10000) // Should complete in < 10 seconds

      // Verify task count
      const count = db.query<{ count: number }>("SELECT COUNT(*) as count FROM tasks")[0]
      expect(count.count).toBe(1000)
    })

    it("creates 5000 tasks with batching", () => {
      const result = chaos.stressLoad({
        taskCount: 5000,
        db,
        batchSize: 500
      })

      expect(result.tasksCreated).toBe(5000)
      expect(result.tasksPerSecond).toBeGreaterThan(100) // At least 100 tasks/sec

      // Verify task count
      const count = db.query<{ count: number }>("SELECT COUNT(*) as count FROM tasks")[0]
      expect(count.count).toBe(5000)
    })

    it("reports performance metrics", () => {
      const result = chaos.stressLoad({
        taskCount: 500,
        db
      })

      expect(result.elapsedMs).toBeGreaterThan(0)
      expect(result.tasksPerSecond).toBeGreaterThan(0)
      expect(result.tasksPerSecond).toBe(result.tasksCreated / (result.elapsedMs / 1000))
    })
  })

  describe("Task creation with dependencies", () => {
    it("creates tasks with random dependencies", () => {
      const result = chaos.stressLoad({
        taskCount: 100,
        db,
        withDependencies: true,
        dependencyRatio: 0.3
      })

      expect(result.tasksCreated).toBe(100)
      expect(result.depsCreated).toBeGreaterThan(0)

      // Verify dependencies exist (allow ±1 tolerance for constraint race conditions)
      const depCount = db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM task_dependencies"
      )[0]
      expect(depCount.count).toBeGreaterThanOrEqual(result.depsCreated - 1)
      expect(depCount.count).toBeLessThanOrEqual(result.depsCreated)
    })

    it("creates 500 tasks with 50% dependency ratio", () => {
      const result = chaos.stressLoad({
        taskCount: 500,
        db,
        withDependencies: true,
        dependencyRatio: 0.5
      })

      expect(result.tasksCreated).toBe(500)
      // Expected ~250 dependencies (some may fail due to cycles)
      expect(result.depsCreated).toBeGreaterThan(100)
    })

    it("handles dependency constraint violations gracefully", () => {
      // High dependency ratio may cause some constraint violations (cycles)
      // The stress loader should handle these gracefully
      const result = chaos.stressLoad({
        taskCount: 200,
        db,
        withDependencies: true,
        dependencyRatio: 0.8 // High ratio increases cycle chance
      })

      expect(result.tasksCreated).toBe(200)
      // Some dependencies may fail due to cycle prevention
      expect(result.depsCreated).toBeGreaterThan(0)
    })
  })

  describe("Task creation with mixed statuses", () => {
    it("creates tasks with various statuses", () => {
      const result = chaos.stressLoad({
        taskCount: 70,
        db,
        mixedStatuses: true
      })

      expect(result.tasksCreated).toBe(70)

      // Should have multiple different statuses
      const statuses = db.query<{ status: string; count: number }>(
        "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
      )

      expect(statuses.length).toBeGreaterThan(1)
    })

    it("distributes statuses across all valid values", () => {
      const result = chaos.stressLoad({
        taskCount: 700, // Multiple of 7 for even distribution
        db,
        mixedStatuses: true
      })

      expect(result.tasksCreated).toBe(700)

      const statuses = db.query<{ status: string; count: number }>(
        "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
      )

      // Should have 7 different statuses
      expect(statuses.length).toBe(7)
      // Each status should have 100 tasks (700 / 7)
      statuses.forEach(s => {
        expect(s.count).toBe(100)
      })
    })
  })

  describe("Batch size variations", () => {
    it("handles small batch size", () => {
      const result = chaos.stressLoad({
        taskCount: 100,
        db,
        batchSize: 10
      })

      expect(result.tasksCreated).toBe(100)
    })

    it("handles large batch size", () => {
      const result = chaos.stressLoad({
        taskCount: 100,
        db,
        batchSize: 1000 // Larger than task count
      })

      expect(result.tasksCreated).toBe(100)
    })

    it("handles exact batch size match", () => {
      const result = chaos.stressLoad({
        taskCount: 100,
        db,
        batchSize: 100
      })

      expect(result.tasksCreated).toBe(100)
    })

    it("handles batch size of 1", () => {
      const result = chaos.stressLoad({
        taskCount: 50,
        db,
        batchSize: 1
      })

      expect(result.tasksCreated).toBe(50)
    })
  })
})

// =============================================================================
// INVARIANT: Ready detection scales with task count
// =============================================================================

describe("Chaos: Ready Detection Under Load", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("ready detection query works with 1000 tasks", async () => {
    // Create tasks with dependencies using chaos utility
    const loadResult = chaos.stressLoad({
      taskCount: 1000,
      db,
      withDependencies: true,
      dependencyRatio: 0.2
    })

    expect(loadResult.tasksCreated).toBe(1000)

    const startTime = Date.now()

    // Query ready tasks directly from database
    // A task is "ready" if it has status in workable states and no incomplete blockers
    const ready = db.query<{ id: string; status: string }>(
      `SELECT t.id, t.status FROM tasks t
       WHERE t.status IN ('backlog', 'ready', 'planning')
       AND NOT EXISTS (
         SELECT 1 FROM task_dependencies td
         JOIN tasks blocker ON td.blocker_id = blocker.id
         WHERE td.blocked_id = t.id
         AND blocker.status != 'done'
       )
       ORDER BY t.score DESC`
    )

    const elapsedMs = Date.now() - startTime

    // Ready detection should complete in reasonable time
    expect(elapsedMs).toBeLessThan(5000) // < 5 seconds

    // Should find some ready tasks (those with no blockers)
    expect(ready.length).toBeGreaterThan(0)
  })

  it("ready detection with limit parameter scales correctly", async () => {
    const { ReadyService, TaskService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    // Create tasks via service layer (slower but ensures same database)
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        for (let i = 0; i < 100; i++) {
          yield* svc.create({ title: `Stress Task ${i}`, score: Math.floor(Math.random() * 1000) })
        }
      }).pipe(Effect.provide(layer))
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService

        const all = yield* svc.getReady()
        const limited10 = yield* svc.getReady(10)
        const limited50 = yield* svc.getReady(50)

        return { all, limited10, limited50 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.limited10.length).toBeLessThanOrEqual(10)
    expect(result.limited50.length).toBeLessThanOrEqual(50)
    expect(result.all.length).toBeGreaterThanOrEqual(result.limited50.length)
  })
})

// =============================================================================
// INVARIANT: Task service scales with task count
// =============================================================================

describe("Chaos: Task Service Under Load", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("list operation handles 1000+ tasks via direct DB query", async () => {
    // Test database-level performance with stress load
    chaos.stressLoad({
      taskCount: 1000,
      db,
      mixedStatuses: true
    })

    const startTime = Date.now()

    // Query all tasks directly
    const tasks = db.query<{ id: string; status: string }>(
      "SELECT id, status FROM tasks ORDER BY score DESC"
    )

    const elapsedMs = Date.now() - startTime

    expect(tasks.length).toBe(1000)
    expect(elapsedMs).toBeLessThan(5000) // < 5 seconds
  })

  it("list with status filter scales correctly via direct DB query", async () => {
    chaos.stressLoad({
      taskCount: 700,
      db,
      mixedStatuses: true // 100 of each status
    })

    const startTime = Date.now()

    // Query done tasks directly
    const doneTasks = db.query<{ id: string }>(
      "SELECT id FROM tasks WHERE status = 'done'"
    )

    const elapsedMs = Date.now() - startTime

    expect(doneTasks.length).toBe(100) // 700/7 statuses
    expect(elapsedMs).toBeLessThan(2000)
  })
})

// =============================================================================
// INVARIANT: Dependency operations scale
// =============================================================================

describe("Chaos: Dependency Service Under Load", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("handles task with many blockers", async () => {
    // Create a hub-and-spoke pattern: many blockers -> one blocked
    const now = new Date().toISOString()

    // Create blocked task
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Hub Task', '', 'backlog', 500, ?, ?, '{}')`,
      [FIXTURES.STRESS_TASK, now, now]
    )

    // Create many blockers
    const blockerCount = 100
    for (let i = 0; i < blockerCount; i++) {
      const blockerId = fixtureId(`stress-blocker-${i}`)
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'ready', 600, ?, ?, '{}')`,
        [blockerId, `Blocker ${i}`, now, now]
      )
      db.run(
        `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at)
         VALUES (?, ?, ?)`,
        [blockerId, FIXTURES.STRESS_TASK, now]
      )
    }

    // Query blockers
    const blockers = db.query<{ blocker_id: string }>(
      "SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?",
      [FIXTURES.STRESS_TASK]
    )

    expect(blockers.length).toBe(blockerCount)
  })

  it("handles task that blocks many others", async () => {
    // Create spoke-and-hub pattern: one blocker -> many blocked
    const now = new Date().toISOString()

    // Create blocker task
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Spoke Task', '', 'ready', 1000, ?, ?, '{}')`,
      [FIXTURES.STRESS_TASK, now, now]
    )

    // Create many blocked tasks
    const blockedCount = 100
    for (let i = 0; i < blockedCount; i++) {
      const blockedId = fixtureId(`stress-blocked-${i}`)
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 400, ?, ?, '{}')`,
        [blockedId, `Blocked ${i}`, now, now]
      )
      db.run(
        `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at)
         VALUES (?, ?, ?)`,
        [FIXTURES.STRESS_TASK, blockedId, now]
      )
    }

    // Query what this task blocks
    const blocked = db.query<{ blocked_id: string }>(
      "SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?",
      [FIXTURES.STRESS_TASK]
    )

    expect(blocked.length).toBe(blockedCount)
  })
})

// =============================================================================
// INVARIANT: Concurrent operations stability
// =============================================================================

describe("Chaos: Concurrent Operation Stability", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("handles sequential race scenarios on multiple tasks", async () => {
    // Create multiple tasks
    const taskCount = 5
    const now = new Date().toISOString()

    for (let i = 0; i < taskCount; i++) {
      const taskId = fixtureId(`concurrent-task-${i}`)
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
        [taskId, `Concurrent Task ${i}`, now, now]
      )
    }

    // Run races sequentially to avoid worker ID conflicts
    // (raceWorkers creates workers with deterministic IDs like race-worker-0)
    const raceResults = []
    for (let i = 0; i < taskCount; i++) {
      // Clear previous workers to avoid UNIQUE constraint
      db.run("DELETE FROM workers WHERE id LIKE 'tx-%'")
      db.run("DELETE FROM task_claims WHERE task_id = ?", [fixtureId(`concurrent-task-${i}`)])

      const result = await chaos.raceWorkers({
        count: 3,
        taskId: fixtureId(`concurrent-task-${i}`),
        db
      })
      raceResults.push(result)
    }

    // Each race should have exactly one winner
    raceResults.forEach(result => {
      expect(result.successfulClaims).toBe(1)
      expect(result.winner).not.toBeNull()
    })
  })
})
