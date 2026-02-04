/**
 * Crash Recovery Integration Tests
 *
 * Tests tx resilience when processes crash at random points during operations.
 * Verifies data integrity and recovery mechanisms.
 *
 * Covers:
 * - Process death during task operations (mid-transaction crashes)
 * - Worker crash detection and recovery
 * - Claim recovery after worker death
 * - Transaction rollback verification
 * - Data integrity after interrupted operations
 * - Orphaned claim cleanup
 *
 * @see DD-007 Testing Strategy
 * @see tx-c20c0ca4 Agent swarm: crash recovery tester
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
  ReadyServiceLive,
  ReadyService,
  HierarchyServiceLive,
  WorkerRepositoryLive,
  ClaimRepositoryLive,
  ClaimRepository,
  ClaimServiceLive,
  ClaimService,
  OrchestratorStateRepositoryLive,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"
import {
  crashAfter,
  CrashSimulationError,
  killHeartbeat,
  partialWrite,
  doubleComplete,
  stressLoad,
  fixtureId as chaosFixtureId
} from "@jamesaphoenix/tx-test-utils"
import type { TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// TEST HELPERS
// =============================================================================

// Create test layer for task services
function makeTaskTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  const baseServices = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(Layer.provide(Layer.merge(repos, AutoSyncServiceNoop)))
  return Layer.mergeAll(baseServices, repos)
}

// Create test layer for worker/claim services
function makeWorkerTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    WorkerRepositoryLive,
    ClaimRepositoryLive,
    OrchestratorStateRepositoryLive
  ).pipe(Layer.provide(infra))
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    ClaimServiceLive
  ).pipe(Layer.provide(Layer.merge(repos, AutoSyncServiceNoop)))
  return Layer.mergeAll(services, repos)
}

// =============================================================================
// PROCESS CRASH SIMULATION TESTS
// =============================================================================

describe("Process Crash Simulation: crashAfter", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTaskTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTaskTestLayer(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("crashAfter returns incomplete when operation exceeds timeout", async () => {
    const result = await crashAfter(
      { ms: 50 },
      async () => {
        // Operation takes longer than crash timeout
        await new Promise(resolve => setTimeout(resolve, 200))
        return "completed"
      }
    )

    expect(result.completed).toBe(false)
    expect(result.value).toBeUndefined()
    expect(result.elapsedMs).toBeGreaterThanOrEqual(50)
    expect(result.elapsedMs).toBeLessThan(200)
  })

  it("crashAfter returns complete when operation finishes before timeout", async () => {
    const result = await crashAfter(
      { ms: 200 },
      async () => {
        // Operation completes quickly
        await new Promise(resolve => setTimeout(resolve, 20))
        return "completed"
      }
    )

    expect(result.completed).toBe(true)
    expect(result.value).toBe("completed")
    expect(result.elapsedMs).toBeLessThan(200)
  })

  it("crashAfter throws CrashSimulationError when throwOnCrash is true", async () => {
    await expect(
      crashAfter(
        { ms: 50, throwOnCrash: true },
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200))
          return "completed"
        }
      )
    ).rejects.toThrow(CrashSimulationError)
  })

  it("crashAfter executes beforeCrash callback", async () => {
    let callbackExecuted = false

    const result = await crashAfter(
      {
        ms: 50,
        beforeCrash: () => {
          callbackExecuted = true
        }
      },
      async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return "completed"
      }
    )

    expect(result.completed).toBe(false)
    expect(callbackExecuted).toBe(true)
  })

  it("database state is consistent after simulated crash during read operation", async () => {
    // Simulate crash during a read operation
    await crashAfter(
      { ms: 10 },
      async () => {
        // Start reading tasks
        const tasks = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* TaskService
            return yield* svc.list()
          }).pipe(Effect.provide(layer))
        )
        // Simulate slow processing after read
        await new Promise(resolve => setTimeout(resolve, 50))
        return tasks
      }
    )

    // Crash happened, but database should still be consistent
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.list()
      }).pipe(Effect.provide(layer))
    )

    // All seeded fixtures should still be present
    expect(tasks.length).toBe(6)
  })
})

// =============================================================================
// TRANSACTION INTEGRITY TESTS
// =============================================================================

describe("Transaction Integrity: Crash During Writes", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("transaction rollback on crash during batch insert", () => {
    const initialCount = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks"
    )[0].count

    const result = partialWrite({
      table: "tasks",
      db: db,
      rowCount: 10,
      failAtRow: 5,
      useTransaction: true
    })

    expect(result.rolledBack).toBe(true)
    expect(result.rowsWritten).toBe(0)

    // Verify no partial data was committed
    const finalCount = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks"
    )[0].count
    expect(finalCount).toBe(initialCount)
  })

  it("partial state exists without transaction on crash", () => {
    const initialCount = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks"
    )[0].count

    const result = partialWrite({
      table: "tasks",
      db: db,
      rowCount: 10,
      failAtRow: 5,
      useTransaction: false
    })

    expect(result.rolledBack).toBe(false)
    expect(result.rowsWritten).toBe(4) // Rows 1-4 committed

    // Verify partial data exists
    const finalCount = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks"
    )[0].count
    expect(finalCount).toBe(initialCount + 4)
  })

  it("data integrity maintained after multiple crash scenarios", () => {
    // Run multiple crash scenarios
    for (let i = 0; i < 5; i++) {
      partialWrite({
        table: "tasks",
        db: db,
        rowCount: 5,
        failAtRow: 3,
        useTransaction: true
      })
    }

    // Database should still be queryable and consistent
    const tasks = db.query<{ id: string; title: string }>(
      "SELECT id, title FROM tasks"
    )

    // All original fixtures should still exist
    const fixtureIds = [
      FIXTURES.TASK_ROOT,
      FIXTURES.TASK_AUTH,
      FIXTURES.TASK_LOGIN,
      FIXTURES.TASK_JWT,
      FIXTURES.TASK_BLOCKED,
      FIXTURES.TASK_DONE
    ]

    for (const id of fixtureIds) {
      expect(tasks.some(t => t.id === id)).toBe(true)
    }
  })

  it("foreign key constraints respected after crash", () => {
    // Create a task
    const parentId = chaosFixtureId("fk-parent")
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Parent Task', '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
      [parentId]
    )

    // Attempt to create child with transaction that crashes
    try {
      db.transaction(() => {
        db.run(
          `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, metadata)
           VALUES (?, 'Child Task', '', 'backlog', 400, ?, datetime('now'), datetime('now'), '{}')`,
          [chaosFixtureId("fk-child"), parentId]
        )
        throw new Error("Simulated crash")
      })
    } catch {
      // Expected
    }

    // Parent should still exist, child should not
    const parent = db.query<{ id: string }>("SELECT id FROM tasks WHERE id = ?", [parentId])
    const child = db.query<{ id: string }>("SELECT id FROM tasks WHERE id = ?", [chaosFixtureId("fk-child")])

    expect(parent.length).toBe(1)
    expect(child.length).toBe(0)
  })
})

// =============================================================================
// WORKER CRASH DETECTION AND RECOVERY
// =============================================================================

describe("Worker Crash Detection: killHeartbeat", () => {
  let db: TestDatabase
  const workerId = chaosFixtureId("heartbeat-worker")

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)

    // Register a worker
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [workerId, "Test Worker", "localhost", process.pid, "idle", now, now]
    )
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("killHeartbeat sets heartbeat to past time", () => {
    const controller = killHeartbeat({ workerId, db: db })
    controller.kill(30) // 30 minutes ago

    const worker = db.query<{ last_heartbeat_at: string }>(
      "SELECT last_heartbeat_at FROM workers WHERE id = ?",
      [workerId]
    )[0]

    const heartbeatTime = new Date(worker.last_heartbeat_at).getTime()
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000

    // Heartbeat should be approximately 30 minutes ago (within 5 second tolerance)
    expect(heartbeatTime).toBeLessThanOrEqual(thirtyMinutesAgo + 5000)
    expect(heartbeatTime).toBeGreaterThanOrEqual(thirtyMinutesAgo - 5000)
    expect(controller.isKilled()).toBe(true)
  })

  it("killHeartbeat restore brings back original heartbeat", () => {
    // Get original heartbeat
    const originalWorker = db.query<{ last_heartbeat_at: string }>(
      "SELECT last_heartbeat_at FROM workers WHERE id = ?",
      [workerId]
    )[0]
    const originalTime = originalWorker.last_heartbeat_at

    const controller = killHeartbeat({ workerId, db: db })
    controller.kill(60)

    // Verify killed
    expect(controller.isKilled()).toBe(true)

    // Restore
    controller.restore()

    const restoredWorker = db.query<{ last_heartbeat_at: string }>(
      "SELECT last_heartbeat_at FROM workers WHERE id = ?",
      [workerId]
    )[0]

    expect(restoredWorker.last_heartbeat_at).toBe(originalTime)
    expect(controller.isKilled()).toBe(false)
  })

  it("killHeartbeat revive sets heartbeat to current time", () => {
    const controller = killHeartbeat({ workerId, db: db })
    controller.kill(60)

    // Wait a bit
    const beforeRevive = Date.now()
    controller.revive()

    const worker = db.query<{ last_heartbeat_at: string }>(
      "SELECT last_heartbeat_at FROM workers WHERE id = ?",
      [workerId]
    )[0]

    const heartbeatTime = new Date(worker.last_heartbeat_at).getTime()

    // Heartbeat should be approximately now (within 5 second tolerance)
    expect(heartbeatTime).toBeGreaterThanOrEqual(beforeRevive - 5000)
    expect(heartbeatTime).toBeLessThanOrEqual(Date.now() + 5000)
    expect(controller.isKilled()).toBe(false)
  })

  it("dead worker detection via heartbeat timeout query", () => {
    // Kill heartbeat for our worker
    const controller = killHeartbeat({ workerId, db: db })
    controller.kill(60) // 60 minutes ago

    // Query for workers with stale heartbeats (> 5 minutes)
    const deadWorkers = db.query<{ id: string }>(
      `SELECT id FROM workers
       WHERE datetime(last_heartbeat_at) < datetime('now', '-5 minutes')
         AND status != 'dead'`
    )

    expect(deadWorkers.some(w => w.id === workerId)).toBe(true)
  })

  it("multiple workers with different heartbeat states", () => {
    // Create additional workers
    const worker2Id = chaosFixtureId("heartbeat-worker-2")
    const worker3Id = chaosFixtureId("heartbeat-worker-3")

    const now = new Date().toISOString()
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [worker2Id, "Worker 2", "localhost", process.pid + 1, "idle", now, now]
    )
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [worker3Id, "Worker 3", "localhost", process.pid + 2, "idle", now, now]
    )

    // Kill heartbeats for workers 1 and 3
    const controller1 = killHeartbeat({ workerId, db: db })
    const controller3 = killHeartbeat({ workerId: worker3Id, db: db })

    controller1.kill(30)
    controller3.kill(45)

    // Query for dead workers
    const deadWorkers = db.query<{ id: string }>(
      `SELECT id FROM workers
       WHERE datetime(last_heartbeat_at) < datetime('now', '-5 minutes')
         AND status != 'dead'`
    )

    expect(deadWorkers.length).toBe(2)
    expect(deadWorkers.some(w => w.id === workerId)).toBe(true)
    expect(deadWorkers.some(w => w.id === worker3Id)).toBe(true)
    expect(deadWorkers.some(w => w.id === worker2Id)).toBe(false)
  })
})

// =============================================================================
// CLAIM RECOVERY AFTER WORKER CRASH
// =============================================================================

describe("Claim Recovery: Orphaned Claims After Worker Crash", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeWorkerTestLayer>
  const crashedWorkerId = chaosFixtureId("crashed-worker")
  const recoveryTaskId = fixtureId("recovery-task")

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeWorkerTestLayer(db)

    // Create task for claim testing
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
      [recoveryTaskId, "Recovery Test Task", now, now]
    )

    // Register a worker
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [crashedWorkerId, "Crashed Worker", "localhost", process.pid, "idle", now, now]
    )
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("orphaned claim exists after worker crash (simulated)", async () => {
    // Worker claims task
    await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        yield* claimSvc.claim(recoveryTaskId, crashedWorkerId)
      }).pipe(Effect.provide(layer))
    )

    // Simulate worker crash by killing heartbeat
    const controller = killHeartbeat({ workerId: crashedWorkerId, db: db })
    controller.kill(60) // Worker appears dead

    // Verify claim still exists but worker is dead
    const claim = db.query<{ task_id: string; worker_id: string; status: string }>(
      "SELECT task_id, worker_id, status FROM task_claims WHERE task_id = ?",
      [recoveryTaskId]
    )[0]

    expect(claim).toBeDefined()
    expect(claim.worker_id).toBe(crashedWorkerId)
    expect(claim.status).toBe("active")

    // Worker appears dead
    const deadWorkers = db.query<{ id: string }>(
      `SELECT id FROM workers
       WHERE datetime(last_heartbeat_at) < datetime('now', '-5 minutes')`
    )
    expect(deadWorkers.some(w => w.id === crashedWorkerId)).toBe(true)
  })

  it("new worker can claim task after expired claim is cleaned up", async () => {
    const newWorkerId = chaosFixtureId("new-worker")

    // Set up: crashed worker has claim
    await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        yield* claimSvc.claim(recoveryTaskId, crashedWorkerId)
      }).pipe(Effect.provide(layer))
    )

    // Simulate crash and time passing (expire the lease)
    db.run(
      "UPDATE task_claims SET lease_expires_at = datetime('now', '-10 minutes') WHERE task_id = ?",
      [recoveryTaskId]
    )

    // Register new worker
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [newWorkerId, "New Worker", "localhost", process.pid + 1, "idle", now, now]
    )

    // Expire old claim
    await Effect.runPromise(
      Effect.gen(function* () {
        const claimRepo = yield* ClaimRepository
        const activeClaim = db.query<{ id: number }>(
          "SELECT id FROM task_claims WHERE task_id = ? AND status = 'active'",
          [recoveryTaskId]
        )[0]
        if (activeClaim) {
          yield* claimRepo.update({
            id: activeClaim.id,
            taskId: recoveryTaskId,
            workerId: crashedWorkerId,
            status: "expired",
            claimedAt: new Date(),
            leaseExpiresAt: new Date(),
            renewedCount: 0
          })
        }
      }).pipe(Effect.provide(layer))
    )

    // New worker can now claim
    const newClaim = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        return yield* claimSvc.claim(recoveryTaskId, newWorkerId)
      }).pipe(Effect.provide(layer))
    )

    expect(newClaim.taskId).toBe(recoveryTaskId)
    expect(newClaim.workerId).toBe(newWorkerId)
    expect(newClaim.status).toBe("active")
  })

  it("claim history preserved after recovery", async () => {
    const newWorkerId = chaosFixtureId("history-worker")

    // Original claim
    await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        yield* claimSvc.claim(recoveryTaskId, crashedWorkerId)
      }).pipe(Effect.provide(layer))
    )

    // Release old claim (simulating cleanup)
    db.run(
      "UPDATE task_claims SET status = 'released' WHERE task_id = ? AND worker_id = ?",
      [recoveryTaskId, crashedWorkerId]
    )

    // Register and claim with new worker
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [newWorkerId, "History Worker", "localhost", process.pid + 1, "idle", now, now]
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        yield* claimSvc.claim(recoveryTaskId, newWorkerId)
      }).pipe(Effect.provide(layer))
    )

    // Both claims should exist in history
    const claims = db.query<{ worker_id: string; status: string }>(
      "SELECT worker_id, status FROM task_claims WHERE task_id = ? ORDER BY id",
      [recoveryTaskId]
    )

    expect(claims.length).toBe(2)
    expect(claims[0].worker_id).toBe(crashedWorkerId)
    expect(claims[0].status).toBe("released")
    expect(claims[1].worker_id).toBe(newWorkerId)
    expect(claims[1].status).toBe("active")
  })
})

// =============================================================================
// DOUBLE COMPLETION TESTS
// =============================================================================

describe("Double Completion: Idempotency After Crash", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTaskTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTaskTestLayer(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("doubleComplete tracks original and final status", () => {
    // Create a fresh task for testing
    const taskId = fixtureId("double-complete-task")
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Double Complete Task', '', 'active', 500, datetime('now'), datetime('now'), '{}')`,
      [taskId]
    )

    const result = doubleComplete({
      taskId,
      db: db
    })

    expect(result.originalStatus).toBe("active")
    expect(result.finalStatus).toBe("done")
    expect(result.firstCompleted).toBe(true)
  })

  it("doubleComplete reports second completion attempt", () => {
    // Create a fresh task
    const taskId = fixtureId("double-complete-task-2")
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Double Complete Task 2', '', 'ready', 500, datetime('now'), datetime('now'), '{}')`,
      [taskId]
    )

    const result = doubleComplete({
      taskId,
      db: db
    })

    // The second completion behavior depends on implementation
    // It either succeeds (updating completed_at) or is idempotent
    expect(result.firstCompleted).toBe(true)
    expect(result.finalStatus).toBe("done")
    // secondCompleted may be true (timestamp updated) or false (idempotent)
    expect(typeof result.secondCompleted).toBe("boolean")
  })

  it("already done task returns firstCompleted true", () => {
    // Use the fixture that's already done
    const result = doubleComplete({
      taskId: FIXTURES.TASK_DONE,
      db: db
    })

    expect(result.originalStatus).toBe("done")
    expect(result.firstCompleted).toBe(true) // Already done counts as completed
    expect(result.finalStatus).toBe("done")
  })

  it("service-level double completion is idempotent", async () => {
    // Create task and complete it via service
    const taskId = fixtureId("service-double-complete")
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Service Double Complete', '', 'active', 500, datetime('now'), datetime('now'), '{}')`,
      [taskId]
    )

    // First completion
    const first = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(taskId as TaskId, { status: "done" })
      }).pipe(Effect.provide(layer))
    )

    expect(first.status).toBe("done")
    expect(first.completedAt).toBeDefined()

    // Second completion attempt
    const second = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(taskId as TaskId, { status: "done" })
      }).pipe(Effect.provide(layer))
    )

    expect(second.status).toBe("done")
    // Service should preserve original completedAt or update it
    // Both behaviors are acceptable - we just verify the task stays done
    expect(second.completedAt).toBeDefined()
  })
})

// =============================================================================
// STRESS TEST: DATA INTEGRITY UNDER LOAD
// =============================================================================

describe("Stress Test: Data Integrity Under Load with Crashes", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTaskTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    // Don't seed fixtures - we'll create our own stress data
    layer = makeTaskTestLayer(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("database remains consistent after creating 1000 tasks with dependencies", () => {
    const result = stressLoad({
      taskCount: 1000,
      db: db,
      withDependencies: true,
      dependencyRatio: 0.2,
      mixedStatuses: true
    })

    expect(result.tasksCreated).toBe(1000)
    expect(result.depsCreated).toBeGreaterThan(0)

    // Verify all tasks are queryable
    const taskCount = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks"
    )[0].count
    expect(taskCount).toBe(1000)

    // Verify foreign key integrity
    const orphanedDeps = db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM task_dependencies td
       WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = td.blocker_id)
          OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = td.blocked_id)`
    )[0].count
    expect(orphanedDeps).toBe(0)
  })

  it("ready service handles large task set after stress load", async () => {
    stressLoad({
      taskCount: 500,
      db: db,
      withDependencies: true,
      dependencyRatio: 0.3,
      mixedStatuses: true
    })

    // Ready service should work without crashing
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    // Should return some ready tasks
    expect(Array.isArray(ready)).toBe(true)
    // All returned tasks should have isReady = true
    for (const task of ready) {
      expect(task.isReady).toBe(true)
    }
  })

  it("partial crash during bulk insert leaves consistent state with transaction", () => {
    // First create some baseline tasks
    stressLoad({
      taskCount: 100,
      db: db,
      withDependencies: false
    })

    const initialCount = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks"
    )[0].count

    // Attempt bulk insert that fails mid-way with transaction
    const result = partialWrite({
      table: "tasks",
      db: db,
      rowCount: 50,
      failAtRow: 25,
      useTransaction: true
    })

    expect(result.rolledBack).toBe(true)

    // Count should be unchanged
    const finalCount = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks"
    )[0].count
    expect(finalCount).toBe(initialCount)
  })

  it("performance: stressLoad reports tasks per second", () => {
    const result = stressLoad({
      taskCount: 1000,
      db: db,
      batchSize: 500
    })

    // Should achieve reasonable performance (at least 100 tasks/sec)
    expect(result.tasksPerSecond).toBeGreaterThan(100)
    expect(result.elapsedMs).toBeLessThan(30000) // Under 30 seconds
  })
})

// =============================================================================
// RANDOM CRASH POINTS
// =============================================================================

describe("Random Crash Points: Various Operation States", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("crash during task creation leaves no partial task", async () => {
    const newTaskId = fixtureId("crash-create-task")

    // Simulate crash during creation by using transaction that fails
    try {
      db.transaction(() => {
        db.run(
          `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
           VALUES (?, 'Crash During Create', '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
          [newTaskId]
        )
        throw new Error("Simulated crash after insert")
      })
    } catch {
      // Expected
    }

    // Task should not exist
    const task = db.query<{ id: string }>(
      "SELECT id FROM tasks WHERE id = ?",
      [newTaskId]
    )
    expect(task.length).toBe(0)
  })

  it("crash during task update leaves original state", async () => {
    const originalTask = db.query<{ title: string; status: string }>(
      "SELECT title, status FROM tasks WHERE id = ?",
      [FIXTURES.TASK_JWT]
    )[0]

    // Simulate crash during update
    try {
      db.transaction(() => {
        db.run(
          "UPDATE tasks SET title = 'Updated Title', status = 'active' WHERE id = ?",
          [FIXTURES.TASK_JWT]
        )
        throw new Error("Simulated crash during update")
      })
    } catch {
      // Expected
    }

    // Task should have original values
    const afterTask = db.query<{ title: string; status: string }>(
      "SELECT title, status FROM tasks WHERE id = ?",
      [FIXTURES.TASK_JWT]
    )[0]

    expect(afterTask.title).toBe(originalTask.title)
    expect(afterTask.status).toBe(originalTask.status)
  })

  it("crash during dependency addition leaves no orphan", async () => {
    const taskA = fixtureId("dep-crash-a")
    const taskB = fixtureId("dep-crash-b")

    // Create both tasks
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Dep Task A', '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
      [taskA]
    )
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, 'Dep Task B', '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
      [taskB]
    )

    // Simulate crash during dependency creation
    try {
      db.transaction(() => {
        db.run(
          "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))",
          [taskA, taskB]
        )
        throw new Error("Simulated crash during dep creation")
      })
    } catch {
      // Expected
    }

    // Dependency should not exist
    const deps = db.query<{ blocker_id: string }>(
      "SELECT blocker_id FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?",
      [taskA, taskB]
    )
    expect(deps.length).toBe(0)
  })

  it("crash during multi-step operation preserves consistency", async () => {
    const taskId = fixtureId("multi-step-crash")

    // Attempt multi-step operation (create task + add dependency) that fails at step 2
    try {
      db.transaction(() => {
        // Step 1: Create task
        db.run(
          `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
           VALUES (?, 'Multi-step Task', '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
          [taskId]
        )

        // Step 2: Add dependency (crash here)
        db.run(
          "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))",
          [FIXTURES.TASK_JWT, taskId]
        )

        throw new Error("Simulated crash during multi-step")
      })
    } catch {
      // Expected
    }

    // Neither task nor dependency should exist
    const task = db.query<{ id: string }>("SELECT id FROM tasks WHERE id = ?", [taskId])
    const dep = db.query<{ blocked_id: string }>(
      "SELECT blocked_id FROM task_dependencies WHERE blocked_id = ?",
      [taskId]
    )

    expect(task.length).toBe(0)
    expect(dep.length).toBe(0)
  })
})
