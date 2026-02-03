/**
 * Chaos Engineering: Claim Race Condition Tests
 *
 * Tests race conditions, deadlocks, and concurrent claim scenarios.
 * Uses chaos utilities from @tx/test-utils to inject failures.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * @module test/chaos/claim-race
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
  TASK_1: fixtureId("chaos-claim-task-1") as TaskId,
  TASK_2: fixtureId("chaos-claim-task-2") as TaskId,
  TASK_3: fixtureId("chaos-claim-task-3") as TaskId,
  WORKER_1: fixtureId("chaos-claim-worker-1"),
  WORKER_2: fixtureId("chaos-claim-worker-2"),
  WORKER_3: fixtureId("chaos-claim-worker-3")
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
    DependencyRepositoryLive
  } = await import("@jamesaphoenix/tx-core")

  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    WorkerRepositoryLive,
    OrchestratorStateRepositoryLive,
    ClaimRepositoryLive,
    TaskRepositoryLive,
    DependencyRepositoryLive
  ).pipe(Layer.provide(infra))

  const claimService = ClaimServiceLive.pipe(Layer.provide(repos))

  return Layer.mergeAll(repos, claimService)
}

// =============================================================================
// Helper Functions
// =============================================================================

function createTaskData(id: string, title: string = "Test Task") {
  return {
    id: id as TaskId,
    title,
    description: "Test description",
    status: "ready" as const,
    parentId: null,
    score: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    metadata: {}
  }
}

function createWorkerData(id: string, name: string = "test-worker") {
  return {
    id,
    name,
    hostname: "localhost",
    pid: 12345,
    status: "idle" as const,
    registeredAt: new Date(),
    lastHeartbeatAt: new Date(),
    currentTaskId: null,
    capabilities: ["tx-implementer"],
    metadata: {}
  }
}

// =============================================================================
// INVARIANT: Only one worker can successfully claim a task at a time
// =============================================================================

describe("Chaos: Claim Race Conditions", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  describe("INVARIANT: Single winner per task claim", () => {
    it("only one worker wins when 5 workers race to claim same task", async () => {
      // Setup: Create task for workers to claim
      const now = new Date().toISOString()
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
        [FIXTURES.TASK_1, "Race Condition Task", now, now]
      )

      // Chaos: Race 5 workers
      const result = await chaos.raceWorkers({
        count: 5,
        taskId: FIXTURES.TASK_1,
        db
      })

      // INVARIANT ASSERTION: Exactly one winner
      expect(result.successfulClaims).toBe(1)
      expect(result.winner).not.toBeNull()
      expect(result.losers).toHaveLength(4)
      expect(result.errors).toHaveLength(0)

      // Verify database state
      const activeClaims = db.query<{ worker_id: string }>(
        "SELECT worker_id FROM task_claims WHERE task_id = ? AND status = 'active'",
        [FIXTURES.TASK_1]
      )
      expect(activeClaims).toHaveLength(1)
      expect(activeClaims[0].worker_id).toBe(result.winner)
    })

    it("only one worker wins when 10 workers race with delays", async () => {
      const now = new Date().toISOString()
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
        [FIXTURES.TASK_2, "Delayed Race Task", now, now]
      )

      // Chaos: Race with artificial delays
      const result = await chaos.raceWorkers({
        count: 10,
        taskId: FIXTURES.TASK_2,
        db,
        delayBetweenMs: 5 // Small delay to stagger attempts
      })

      // INVARIANT ASSERTION: Still only one winner
      expect(result.successfulClaims).toBe(1)
      expect(result.winner).not.toBeNull()
      expect(result.losers).toHaveLength(9)
    })

    it("maintains invariant under rapid sequential claiming", async () => {
      const now = new Date().toISOString()
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
        [FIXTURES.TASK_3, "Sequential Race Task", now, now]
      )

      // Run multiple race batches sequentially
      const results: Array<{ successfulClaims: number; winner: string | null }> = []

      for (let batch = 0; batch < 3; batch++) {
        // Clear previous claims first
        db.run("DELETE FROM task_claims WHERE task_id = ?", [FIXTURES.TASK_3])
        db.run("DELETE FROM workers")

        const result = await chaos.raceWorkers({
          count: 5,
          taskId: FIXTURES.TASK_3,
          db
        })
        results.push({ successfulClaims: result.successfulClaims, winner: result.winner })
      }

      // Each batch should have exactly one winner
      for (const result of results) {
        expect(result.successfulClaims).toBe(1)
        expect(result.winner).not.toBeNull()
      }
    })
  })

  describe("Delayed claim race detection", () => {
    it("detects when fast worker beats slow worker", async () => {
      const now = new Date().toISOString()
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
        [FIXTURES.TASK_1, "Delayed Claim Task", now, now]
      )

      // Register both workers
      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
        [FIXTURES.WORKER_1, "Slow Worker", "localhost", process.pid, "idle", now, now]
      )
      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
        [FIXTURES.WORKER_2, "Fast Worker", "localhost", process.pid, "idle", now, now]
      )

      // Start delayed claim (will take 100ms)
      const delayedPromise = chaos.delayedClaim({
        taskId: FIXTURES.TASK_1,
        workerId: FIXTURES.WORKER_1,
        db,
        delayMs: 100,
        checkRace: true
      })

      // Fast worker claims immediately
      await new Promise(resolve => setTimeout(resolve, 10))
      db.run(
        `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
         VALUES (?, ?, ?, ?, 0, 'active')`,
        [FIXTURES.TASK_1, FIXTURES.WORKER_2, now, new Date(Date.now() + 30 * 60 * 1000).toISOString()]
      )

      // Verify delayed claim detects the race
      const result = await delayedPromise

      expect(result.raceDetected).toBe(true)
      expect(result.claimed).toBe(false)
      expect(result.claimedBy).toBe(FIXTURES.WORKER_2)
    })
  })
})

// =============================================================================
// INVARIANT: Claim lifecycle integrity
// =============================================================================

describe("Chaos: Claim Lifecycle", () => {
  describe("Double completion handling", () => {
    let db: TestDatabase

    beforeEach(async () => {
      db = await Effect.runPromise(createTestDatabase())

      const now = new Date().toISOString()
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'active', 500, ?, ?, '{}')`,
        [FIXTURES.TASK_1, "Double Complete Task", now, now]
      )
    })

    it("handles double completion attempt gracefully", () => {
      const result = chaos.doubleComplete({
        taskId: FIXTURES.TASK_1,
        db
      })

      expect(result.firstCompleted).toBe(true)
      expect(result.originalStatus).toBe("active")
      expect(result.finalStatus).toBe("done")
      // The system should handle idempotent completion
    })

    it("tracks completion timestamp correctly", () => {
      const result = chaos.doubleComplete({
        taskId: FIXTURES.TASK_1,
        db
      })

      expect(result.finalStatus).toBe("done")

      const task = db.query<{ completed_at: string | null; status: string }>(
        "SELECT completed_at, status FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(task.status).toBe("done")
      expect(task.completed_at).not.toBeNull()
    })
  })

  describe("Claim expiration handling", () => {
    it("expired claims can be reclaimed by another worker", async () => {
      const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } =
        await import("@jamesaphoenix/tx-core")
      const layer = await makeTestLayer()

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const claimSvc = yield* ClaimService
          const claimRepo = yield* ClaimRepository
          const taskRepo = yield* TaskRepository
          const workerRepo = yield* WorkerRepository

          // Setup
          yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
          yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
          yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

          // Worker 1 claims
          const claim1 = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

          // Expire the claim
          const expiredTime = new Date(Date.now() - 60000)
          yield* claimRepo.update({
            ...claim1,
            leaseExpiresAt: expiredTime
          })

          // Mark as expired
          yield* claimSvc.expire(claim1.id)

          // Worker 2 should be able to claim now
          const claim2 = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_2)

          return { claim1, claim2 }
        }).pipe(Effect.provide(layer))
      )

      expect(result.claim1.workerId).toBe(FIXTURES.WORKER_1)
      expect(result.claim2.workerId).toBe(FIXTURES.WORKER_2)
      expect(result.claim2.id).toBeGreaterThan(result.claim1.id)
    })
  })
})

// =============================================================================
// INVARIANT: Service layer claim operations via Effect-TS
// =============================================================================

describe("Chaos: Service Layer Claim Operations", () => {
  it("claim service rejects concurrent claims properly", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        // First claim succeeds
        const claim1 = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Second claim should fail
        const claim2Error = yield* claimSvc
          .claim(FIXTURES.TASK_1, FIXTURES.WORKER_2)
          .pipe(Effect.flip)

        return { claim1, claim2Error }
      }).pipe(Effect.provide(layer))
    )

    expect(result.claim1.workerId).toBe(FIXTURES.WORKER_1)
    expect(result.claim2Error._tag).toBe("AlreadyClaimedError")
    expect((result.claim2Error as { claimedByWorkerId: string }).claimedByWorkerId).toBe(
      FIXTURES.WORKER_1
    )
  })

  it("release then reclaim works correctly", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        // Claim, release, reclaim cycle
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const newClaim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_2)

        return newClaim
      }).pipe(Effect.provide(layer))
    )

    expect(result.workerId).toBe(FIXTURES.WORKER_2)
    expect(result.status).toBe("active")
  })
})
