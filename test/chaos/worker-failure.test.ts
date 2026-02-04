/**
 * Chaos Engineering: Worker Failure and Recovery Tests
 *
 * Tests worker heartbeat failures, dead worker detection,
 * and orphan cleanup scenarios.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * @module test/chaos/worker-failure
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
  TASK_1: fixtureId("chaos-worker-task-1") as TaskId,
  TASK_2: fixtureId("chaos-worker-task-2") as TaskId,
  TASK_3: fixtureId("chaos-worker-task-3") as TaskId,
  WORKER_1: fixtureId("chaos-worker-1"),
  WORKER_2: fixtureId("chaos-worker-2"),
  WORKER_3: fixtureId("chaos-worker-3"),
  WORKER_DEAD: fixtureId("chaos-worker-dead")
} as const

// =============================================================================
// Test Layer Factory
// =============================================================================

async function makeTestLayer() {
  const {
    SqliteClientLive,
    WorkerRepositoryLive,
    OrchestratorStateRepositoryLive,
    ClaimRepositoryLive,
    ClaimServiceLive,
    TaskRepositoryLive,
    DependencyRepositoryLive,
    WorkerServiceLive
  } = await import("@jamesaphoenix/tx-core")

  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    WorkerRepositoryLive,
    OrchestratorStateRepositoryLive,
    ClaimRepositoryLive,
    TaskRepositoryLive,
    DependencyRepositoryLive
  ).pipe(Layer.provide(infra))

  const services = Layer.mergeAll(
    ClaimServiceLive,
    WorkerServiceLive
  ).pipe(Layer.provide(repos))

  return Layer.mergeAll(repos, services)
}

// =============================================================================
// INVARIANT: Heartbeat manipulation affects worker detection
// =============================================================================

describe("Chaos: Worker Heartbeat Failures", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())

    // Create a worker
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [FIXTURES.WORKER_1, "Test Worker", "localhost", process.pid, "idle", now, now]
    )
  })

  describe("Kill heartbeat controller", () => {
    it("creates controller with killHeartbeat", () => {
      const controller = chaos.killHeartbeat({
        workerId: FIXTURES.WORKER_1,
        db
      })

      expect(controller).toBeInstanceOf(chaos.WorkerHeartbeatController)
      expect(controller.isKilled()).toBe(false)
    })

    it("kill sets heartbeat to past time", () => {
      const controller = chaos.killHeartbeat({
        workerId: FIXTURES.WORKER_1,
        db
      })

      controller.kill(60) // 60 minutes ago

      expect(controller.isKilled()).toBe(true)

      const worker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [FIXTURES.WORKER_1]
      )[0]

      const heartbeatTime = new Date(worker.last_heartbeat_at)
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

      // Heartbeat should be approximately 60 minutes ago
      expect(heartbeatTime.getTime()).toBeLessThanOrEqual(hourAgo.getTime() + 60000)
    })

    it("restore reverts to original heartbeat", () => {
      const originalWorker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [FIXTURES.WORKER_1]
      )[0]

      const controller = chaos.killHeartbeat({
        workerId: FIXTURES.WORKER_1,
        db
      })

      controller.kill()
      controller.restore()

      const restoredWorker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [FIXTURES.WORKER_1]
      )[0]

      expect(restoredWorker.last_heartbeat_at).toBe(originalWorker.last_heartbeat_at)
      expect(controller.isKilled()).toBe(false)
    })

    it("revive sets heartbeat to current time", () => {
      const controller = chaos.killHeartbeat({
        workerId: FIXTURES.WORKER_1,
        db
      })

      controller.kill()

      const beforeRevive = Date.now()
      controller.revive()
      const afterRevive = Date.now()

      const worker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [FIXTURES.WORKER_1]
      )[0]

      const heartbeatTime = new Date(worker.last_heartbeat_at).getTime()
      expect(heartbeatTime).toBeGreaterThanOrEqual(beforeRevive - 1000)
      expect(heartbeatTime).toBeLessThanOrEqual(afterRevive + 1000)
      expect(controller.isKilled()).toBe(false)
    })
  })

  describe("Dead worker detection scenarios", () => {
    it("worker with old heartbeat should be detectable as dead", () => {
      const controller = chaos.killHeartbeat({
        workerId: FIXTURES.WORKER_1,
        db
      })

      controller.kill(30) // 30 minutes ago

      // Query for workers with old heartbeats (dead worker detection)
      const deadThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString() // 15 min threshold
      const deadWorkers = db.query<{ id: string }>(
        "SELECT id FROM workers WHERE last_heartbeat_at < ?",
        [deadThreshold]
      )

      expect(deadWorkers.length).toBe(1)
      expect(deadWorkers[0].id).toBe(FIXTURES.WORKER_1)
    })

    it("revived worker should not be detected as dead", () => {
      const controller = chaos.killHeartbeat({
        workerId: FIXTURES.WORKER_1,
        db
      })

      controller.kill(30)
      controller.revive()

      // Query for dead workers
      const deadThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const deadWorkers = db.query<{ id: string }>(
        "SELECT id FROM workers WHERE last_heartbeat_at < ?",
        [deadThreshold]
      )

      expect(deadWorkers.length).toBe(0)
    })
  })
})

// =============================================================================
// INVARIANT: Orphan claims from dead workers can be released
// =============================================================================

describe("Chaos: Orphan Claim Cleanup", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())

    const now = new Date().toISOString()

    // Create task
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
      [FIXTURES.TASK_1, "Orphan Test Task", now, now]
    )

    // Create worker
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
      [FIXTURES.WORKER_DEAD, "Dead Worker", "localhost", process.pid, "busy", now, now]
    )

    // Create claim
    const leaseExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    db.run(
      `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
       VALUES (?, ?, ?, ?, 0, 'active')`,
      [FIXTURES.TASK_1, FIXTURES.WORKER_DEAD, now, leaseExpires]
    )
  })

  it("identifies orphan claims when worker heartbeat is killed", () => {
    const controller = chaos.killHeartbeat({
      workerId: FIXTURES.WORKER_DEAD,
      db
    })

    controller.kill(30) // Worker appears dead

    // Find orphan claims (claims from dead workers)
    const deadThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const orphanClaims = db.query<{ task_id: string; worker_id: string }>(
      `SELECT c.task_id, c.worker_id
       FROM task_claims c
       JOIN workers w ON c.worker_id = w.id
       WHERE c.status = 'active'
         AND w.last_heartbeat_at < ?`,
      [deadThreshold]
    )

    expect(orphanClaims.length).toBe(1)
    expect(orphanClaims[0].task_id).toBe(FIXTURES.TASK_1)
    expect(orphanClaims[0].worker_id).toBe(FIXTURES.WORKER_DEAD)
  })

  it("orphan claims can be detected via direct database query", async () => {
    // First kill the heartbeat to simulate dead worker
    const controller = chaos.killHeartbeat({
      workerId: FIXTURES.WORKER_DEAD,
      db
    })
    controller.kill(30)

    // Test orphan detection via direct database query
    const deadThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    // Find orphan claims (claims from dead workers)
    const orphanClaims = db.query<{ task_id: string; worker_id: string }>(
      `SELECT c.task_id, c.worker_id
       FROM task_claims c
       JOIN workers w ON c.worker_id = w.id
       WHERE c.status = 'active'
         AND w.last_heartbeat_at < ?`,
      [deadThreshold]
    )

    // Should find the orphan claim
    expect(orphanClaims.length).toBe(1)
    expect(orphanClaims[0].task_id).toBe(FIXTURES.TASK_1)
    expect(orphanClaims[0].worker_id).toBe(FIXTURES.WORKER_DEAD)

    // Expire the orphan claim
    db.run(
      `UPDATE task_claims SET status = 'expired' WHERE task_id = ? AND worker_id = ?`,
      [FIXTURES.TASK_1, FIXTURES.WORKER_DEAD]
    )

    // Verify task can now be reclaimed
    const activeClaims = db.query<{ task_id: string }>(
      "SELECT task_id FROM task_claims WHERE task_id = ? AND status = 'active'",
      [FIXTURES.TASK_1]
    )
    expect(activeClaims.length).toBe(0) // No active claim after expiration
  })
})

// =============================================================================
// INVARIANT: Worker service operations
// =============================================================================

describe("Chaos: Worker Service Operations", () => {
  it("releaseByWorker cleans up all claims for a dead worker", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup: Create multiple tasks and a worker
        yield* taskRepo.insert({
          id: FIXTURES.TASK_1,
          title: "Task 1",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })
        yield* taskRepo.insert({
          id: FIXTURES.TASK_2,
          title: "Task 2",
          description: "",
          status: "ready",
          parentId: null,
          score: 400,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })
        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "Worker 1",
          hostname: "localhost",
          pid: 12345,
          status: "busy",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker claims both tasks
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.claim(FIXTURES.TASK_2, FIXTURES.WORKER_1)

        // Verify both claims exist
        const claimsBefore = [
          yield* claimSvc.getActiveClaim(FIXTURES.TASK_1),
          yield* claimSvc.getActiveClaim(FIXTURES.TASK_2)
        ]

        // Release all claims for worker
        const released = yield* claimSvc.releaseByWorker(FIXTURES.WORKER_1)

        // Verify claims are released
        const claimsAfter = [
          yield* claimSvc.getActiveClaim(FIXTURES.TASK_1),
          yield* claimSvc.getActiveClaim(FIXTURES.TASK_2)
        ]

        return { claimsBefore, claimsAfter, released }
      }).pipe(Effect.provide(layer))
    )

    expect(result.claimsBefore[0]).not.toBeNull()
    expect(result.claimsBefore[1]).not.toBeNull()
    expect(result.released).toBe(2)
    expect(result.claimsAfter[0]).toBeNull()
    expect(result.claimsAfter[1]).toBeNull()
  })
})

// =============================================================================
// INVARIANT: Multiple worker heartbeat scenarios
// =============================================================================

describe("Chaos: Multiple Worker Heartbeat Scenarios", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())

    const now = new Date().toISOString()

    // Create multiple workers
    for (const workerId of [FIXTURES.WORKER_1, FIXTURES.WORKER_2, FIXTURES.WORKER_3]) {
      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
        [workerId, `Worker ${workerId}`, "localhost", process.pid, "idle", now, now]
      )
    }
  })

  it("can kill multiple worker heartbeats independently", () => {
    const controller1 = chaos.killHeartbeat({ workerId: FIXTURES.WORKER_1, db })
    const controller2 = chaos.killHeartbeat({ workerId: FIXTURES.WORKER_2, db })
    const controller3 = chaos.killHeartbeat({ workerId: FIXTURES.WORKER_3, db })

    // Kill only workers 1 and 2
    controller1.kill(60)
    controller2.kill(30)
    // Worker 3 remains alive

    const deadThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const deadWorkers = db.query<{ id: string }>(
      "SELECT id FROM workers WHERE last_heartbeat_at < ? ORDER BY id",
      [deadThreshold]
    )

    expect(deadWorkers.length).toBe(2)
    expect(deadWorkers.map(w => w.id)).toContain(FIXTURES.WORKER_1)
    expect(deadWorkers.map(w => w.id)).toContain(FIXTURES.WORKER_2)
    expect(deadWorkers.map(w => w.id)).not.toContain(FIXTURES.WORKER_3)

    // Verify controller state
    expect(controller1.isKilled()).toBe(true)
    expect(controller2.isKilled()).toBe(true)
    expect(controller3.isKilled()).toBe(false)
  })

  it("can selectively revive workers", () => {
    const controller1 = chaos.killHeartbeat({ workerId: FIXTURES.WORKER_1, db })
    const controller2 = chaos.killHeartbeat({ workerId: FIXTURES.WORKER_2, db })

    // Kill both
    controller1.kill(60)
    controller2.kill(60)

    // Revive only worker 1
    controller1.revive()

    const deadThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const deadWorkers = db.query<{ id: string }>(
      "SELECT id FROM workers WHERE last_heartbeat_at < ?",
      [deadThreshold]
    )

    expect(deadWorkers.length).toBe(1)
    expect(deadWorkers[0].id).toBe(FIXTURES.WORKER_2)
  })
})

// =============================================================================
// INVARIANT: Lease renewal failure triggers worker shutdown
// =============================================================================

describe("Chaos: Lease Renewal Failure", () => {
  it("renew fails when claim has been released (simulating lease expiry)", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup: Create task and workers
        yield* taskRepo.insert({
          id: FIXTURES.TASK_1,
          title: "Lease Renewal Test Task",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "Worker 1",
          hostname: "localhost",
          pid: 12345,
          status: "busy",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims the task
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Verify claim exists
        const claimBefore = yield* claimSvc.getActiveClaim(FIXTURES.TASK_1)

        // Simulate another worker stealing the claim (as would happen after lease expiry)
        // This is done by releasing the claim
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Now try to renew - should fail
        const renewResult = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((error) => Effect.succeed({ success: false as const, error: error._tag }))
        )

        return { claimBefore, renewResult }
      }).pipe(Effect.provide(layer))
    )

    // Claim existed before release
    expect(result.claimBefore).not.toBeNull()
    // Renew fails after claim is released
    expect(result.renewResult.success).toBe(false)
  })

  it("renew fails when another worker has claimed the task", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup: Create task and two workers
        yield* taskRepo.insert({
          id: FIXTURES.TASK_2,
          title: "Contested Claim Task",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "Worker 1",
          hostname: "localhost",
          pid: 12345,
          status: "busy",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_2,
          name: "Worker 2",
          hostname: "localhost",
          pid: 12346,
          status: "busy",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims the task
        yield* claimSvc.claim(FIXTURES.TASK_2, FIXTURES.WORKER_1)

        // Release worker 1's claim (simulating expiry)
        yield* claimSvc.release(FIXTURES.TASK_2, FIXTURES.WORKER_1)

        // Worker 2 claims the task (as orchestrator would do after detecting expired lease)
        yield* claimSvc.claim(FIXTURES.TASK_2, FIXTURES.WORKER_2)

        // Worker 1 tries to renew - should fail because worker 2 now has the claim
        const renewResultWorker1 = yield* claimSvc.renew(FIXTURES.TASK_2, FIXTURES.WORKER_1).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((error) => Effect.succeed({ success: false as const, error: error._tag }))
        )

        // Worker 2 can still renew
        const renewResultWorker2 = yield* claimSvc.renew(FIXTURES.TASK_2, FIXTURES.WORKER_2).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((error) => Effect.succeed({ success: false as const, error: error._tag }))
        )

        return { renewResultWorker1, renewResultWorker2 }
      }).pipe(Effect.provide(layer))
    )

    // Worker 1's renewal fails (they lost the claim)
    expect(result.renewResultWorker1.success).toBe(false)
    // Worker 2's renewal succeeds (they have the active claim)
    expect(result.renewResultWorker2.success).toBe(true)
  })
})
