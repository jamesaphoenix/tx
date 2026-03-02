/**
 * Claims Integration Tests
 *
 * Tests the ClaimService worker-level leasing system with full dependency injection.
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-018 for implementation details
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import {
  getSharedTestLayer,
  fixtureId,
  type SharedTestLayerResult
} from "@jamesaphoenix/tx-test-utils"
import {
  ClaimService,
  ClaimRepository,
  TaskRepository,
  WorkerRepository,
  AlreadyClaimedError,
  LeaseExpiredError,
  TaskNotFoundError
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based deterministic IDs)
// =============================================================================

const TASK_ALPHA = fixtureId("claims-task-alpha") as TaskId
const TASK_BETA = fixtureId("claims-task-beta") as TaskId
const TASK_GAMMA = fixtureId("claims-task-gamma") as TaskId
const TASK_NONEXISTENT = fixtureId("claims-task-nonexistent") as TaskId

// Orphaned claims test fixtures
const TASK_ORPHAN_1 = fixtureId("claims-orphan-task-1") as TaskId
const TASK_ORPHAN_2 = fixtureId("claims-orphan-task-2") as TaskId
const TASK_ORPHAN_3 = fixtureId("claims-orphan-task-3") as TaskId
const TASK_ORPHAN_ACTIVE = fixtureId("claims-orphan-task-active") as TaskId

const WORKER_A = "worker-claims-alpha"
const WORKER_B = "worker-claims-beta"
const WORKER_ORPHAN = "worker-claims-orphan"

// =============================================================================
// Helpers
// =============================================================================

/**
 * Insert a minimal task into the database using the TaskRepository.
 */
function insertTask(taskId: TaskId, title: string = "Test Task") {
  return Effect.gen(function* () {
    const taskRepo = yield* TaskRepository
    yield* taskRepo.insert({
      id: taskId,
      title,
      description: `Test task: ${title}`,
      status: "ready",
      parentId: null,
      score: 500,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      assigneeType: null,
      assigneeId: null,
      assignedAt: null,
      assignedBy: null,
      metadata: {}
    })
  })
}

/**
 * Insert a worker into the workers table to satisfy FK constraints on task_claims.
 */
function insertWorker(workerId: string, name: string = "test-worker") {
  return Effect.gen(function* () {
    const workerRepo = yield* WorkerRepository
    yield* workerRepo.insert({
      id: workerId,
      name,
      hostname: "localhost",
      pid: process.pid,
      status: "idle",
      registeredAt: new Date(),
      lastHeartbeatAt: new Date(),
      currentTaskId: null,
      capabilities: ["tx-implementer"],
      metadata: {}
    })
  })
}

// =============================================================================
// ClaimService Integration Tests
// =============================================================================

describe("ClaimService", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // ---------------------------------------------------------------------------
  // 1. Claim a task
  // ---------------------------------------------------------------------------

  it("claims a task with default lease and returns a valid claim object", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA, "Implement auth")
        yield* insertWorker(WORKER_A, "worker-alpha")

        const claim = yield* claimSvc.claim(TASK_ALPHA, WORKER_A)

        return claim
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.taskId).toBe(TASK_ALPHA)
    expect(result.workerId).toBe(WORKER_A)
    expect(result.status).toBe("active")
    expect(result.renewedCount).toBe(0)
    expect(result.id).toBeGreaterThan(0)
    expect(result.claimedAt).toBeInstanceOf(Date)
    expect(result.leaseExpiresAt).toBeInstanceOf(Date)
    // Lease should expire in the future (default is 30 minutes)
    expect(result.leaseExpiresAt.getTime()).toBeGreaterThan(result.claimedAt.getTime())
  })

  // ---------------------------------------------------------------------------
  // 2. Release a claim
  // ---------------------------------------------------------------------------

  it("releases a claim so the task is no longer actively claimed", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")

        const claim = yield* claimSvc.claim(TASK_ALPHA, WORKER_A)
        yield* claimSvc.release(TASK_ALPHA, WORKER_A)

        // Verify no active claim remains
        const activeClaim = yield* claimSvc.getActiveClaim(TASK_ALPHA)
        // Verify the original claim row was updated to "released"
        const releasedClaim = yield* claimRepo.findById(claim.id)

        return { activeClaim, releasedClaim }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.activeClaim).toBeNull()
    expect(result.releasedClaim).not.toBeNull()
    expect(result.releasedClaim!.status).toBe("released")
  })

  // ---------------------------------------------------------------------------
  // 3. Renew a claim
  // ---------------------------------------------------------------------------

  it("renews a claim before expiry, extending the lease", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")

        const original = yield* claimSvc.claim(TASK_ALPHA, WORKER_A)
        const renewed = yield* claimSvc.renew(TASK_ALPHA, WORKER_A)

        return { original, renewed }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.renewed.renewedCount).toBe(1)
    expect(result.renewed.status).toBe("active")
    // The renewed lease should be at or beyond the original expiry
    expect(result.renewed.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      result.original.leaseExpiresAt.getTime()
    )
  })

  // ---------------------------------------------------------------------------
  // 4. Get active claim
  // ---------------------------------------------------------------------------

  it("retrieves the active claim for a task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")
        yield* claimSvc.claim(TASK_ALPHA, WORKER_A)

        const active = yield* claimSvc.getActiveClaim(TASK_ALPHA)

        return active
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.taskId).toBe(TASK_ALPHA)
    expect(result!.workerId).toBe(WORKER_A)
    expect(result!.status).toBe("active")
  })

  it("returns null when no active claim exists for a task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA)

        // No claim made, so getActiveClaim should return null
        return yield* claimSvc.getActiveClaim(TASK_ALPHA)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 5. LeaseExpiredError on renew
  // ---------------------------------------------------------------------------

  it("fails with LeaseExpiredError when renewing an expired lease", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")

        const claim = yield* claimSvc.claim(TASK_ALPHA, WORKER_A)

        // Manually backdate the lease to simulate expiration
        const pastTime = new Date(Date.now() - 120_000) // 2 minutes ago
        yield* claimRepo.update({
          ...claim,
          leaseExpiresAt: pastTime
        })

        // Attempting to renew should fail with LeaseExpiredError
        return yield* claimSvc.renew(TASK_ALPHA, WORKER_A).pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("LeaseExpiredError")
    expect((error as LeaseExpiredError).taskId).toBe(TASK_ALPHA)
  })

  // ---------------------------------------------------------------------------
  // 6. AlreadyClaimedError
  // ---------------------------------------------------------------------------

  it("fails with AlreadyClaimedError when a second worker claims an already-claimed task", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")
        yield* insertWorker(WORKER_B, "worker-beta")

        // Worker A claims first
        yield* claimSvc.claim(TASK_ALPHA, WORKER_A)

        // Worker B tries to claim the same task
        return yield* claimSvc.claim(TASK_ALPHA, WORKER_B).pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("AlreadyClaimedError")
    expect((error as AlreadyClaimedError).taskId).toBe(TASK_ALPHA)
    expect((error as AlreadyClaimedError).claimedByWorkerId).toBe(WORKER_A)
  })

  // ---------------------------------------------------------------------------
  // 7. Claim non-existent task
  // ---------------------------------------------------------------------------

  it("fails with TaskNotFoundError when claiming a task that does not exist", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertWorker(WORKER_A, "worker-alpha")

        // Do NOT insert any task -- use a fixture ID that has no matching row
        return yield* claimSvc.claim(TASK_NONEXISTENT, WORKER_A).pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("TaskNotFoundError")
    expect((error as TaskNotFoundError).id).toBe(TASK_NONEXISTENT)
  })

  // ---------------------------------------------------------------------------
  // 8. Release by wrong worker
  // ---------------------------------------------------------------------------

  it("fails with ClaimNotFoundError when worker B tries to release worker A's claim", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")
        yield* insertWorker(WORKER_B, "worker-beta")

        // Worker A claims
        yield* claimSvc.claim(TASK_ALPHA, WORKER_A)

        // Worker B attempts to release -- should fail
        return yield* claimSvc.release(TASK_ALPHA, WORKER_B).pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  // ---------------------------------------------------------------------------
  // Additional lifecycle tests
  // ---------------------------------------------------------------------------

  it("allows re-claim after release by a different worker", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")
        yield* insertWorker(WORKER_B, "worker-beta")

        // Worker A claims and releases
        yield* claimSvc.claim(TASK_ALPHA, WORKER_A)
        yield* claimSvc.release(TASK_ALPHA, WORKER_A)

        // Worker B should now be able to claim
        const newClaim = yield* claimSvc.claim(TASK_ALPHA, WORKER_B)

        return newClaim
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.taskId).toBe(TASK_ALPHA)
    expect(result.workerId).toBe(WORKER_B)
    expect(result.status).toBe("active")
  })

  it("supports full lifecycle: claim -> renew multiple times -> release", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")

        // Claim
        const original = yield* claimSvc.claim(TASK_ALPHA, WORKER_A)

        // Renew three times
        const r1 = yield* claimSvc.renew(TASK_ALPHA, WORKER_A)
        const r2 = yield* claimSvc.renew(TASK_ALPHA, WORKER_A)
        const r3 = yield* claimSvc.renew(TASK_ALPHA, WORKER_A)

        // Release
        yield* claimSvc.release(TASK_ALPHA, WORKER_A)

        const finalClaim = yield* claimRepo.findById(original.id)
        const activeClaim = yield* claimSvc.getActiveClaim(TASK_ALPHA)

        return { original, r1, r2, r3, finalClaim, activeClaim }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.original.renewedCount).toBe(0)
    expect(result.r1.renewedCount).toBe(1)
    expect(result.r2.renewedCount).toBe(2)
    expect(result.r3.renewedCount).toBe(3)
    expect(result.finalClaim!.status).toBe("released")
    expect(result.activeClaim).toBeNull()
  })

  it("multiple tasks can be claimed concurrently by different workers", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA, "Task Alpha")
        yield* insertTask(TASK_BETA, "Task Beta")
        yield* insertWorker(WORKER_A, "worker-alpha")
        yield* insertWorker(WORKER_B, "worker-beta")

        const claimA = yield* claimSvc.claim(TASK_ALPHA, WORKER_A)
        const claimB = yield* claimSvc.claim(TASK_BETA, WORKER_B)

        return { claimA, claimB }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.claimA.taskId).toBe(TASK_ALPHA)
    expect(result.claimA.workerId).toBe(WORKER_A)
    expect(result.claimB.taskId).toBe(TASK_BETA)
    expect(result.claimB.workerId).toBe(WORKER_B)
  })

  // ---------------------------------------------------------------------------
  // getOrphanedClaims
  // ---------------------------------------------------------------------------

  describe("getOrphanedClaims", () => {
    it("returns empty array when no orphaned claims exist", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const claimSvc = yield* ClaimService

          // Insert a task with 'active' status and claim it — this is a legitimate claim
          yield* insertTask(TASK_ORPHAN_ACTIVE, "Active task with claim")
          const taskRepo = yield* TaskRepository
          const task = yield* taskRepo.findById(TASK_ORPHAN_ACTIVE)
          yield* taskRepo.update({ ...task!, status: "active", updatedAt: new Date() })

          yield* insertWorker(WORKER_ORPHAN, "worker-orphan")
          yield* claimSvc.claim(TASK_ORPHAN_ACTIVE, WORKER_ORPHAN)

          // Since the task is 'active' and the claim is 'active', this is NOT orphaned
          const orphaned = yield* claimSvc.getOrphanedClaims()

          return orphaned
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toEqual([])
    })

    it("detects orphaned claim when task status is no longer active", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const claimSvc = yield* ClaimService
          const taskRepo = yield* TaskRepository

          // Create a task in 'active' status, claim it, then move task to 'done'
          yield* insertTask(TASK_ORPHAN_1, "Task that completed without releasing claim")
          const task = yield* taskRepo.findById(TASK_ORPHAN_1)
          yield* taskRepo.update({ ...task!, status: "active", updatedAt: new Date() })

          yield* insertWorker(WORKER_ORPHAN, "worker-orphan")
          yield* claimSvc.claim(TASK_ORPHAN_1, WORKER_ORPHAN)

          // Simulate the task completing without the claim being released
          const activeTask = yield* taskRepo.findById(TASK_ORPHAN_1)
          yield* taskRepo.update({
            ...activeTask!,
            status: "done",
            completedAt: new Date(),
            updatedAt: new Date()
          })

          // Now the claim is orphaned: claim is active but task is 'done'
          const orphaned = yield* claimSvc.getOrphanedClaims()

          return orphaned
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(1)
      expect(result[0].taskId).toBe(TASK_ORPHAN_1)
      expect(result[0].workerId).toBe(WORKER_ORPHAN)
      expect(result[0].status).toBe("active")
    })

    it("does not return active claims on tasks that are still in active status", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const claimSvc = yield* ClaimService
          const taskRepo = yield* TaskRepository

          // Task 1: active status with claim — NOT orphaned
          yield* insertTask(TASK_ORPHAN_ACTIVE, "Legitimately active task")
          const task1 = yield* taskRepo.findById(TASK_ORPHAN_ACTIVE)
          yield* taskRepo.update({ ...task1!, status: "active", updatedAt: new Date() })

          yield* insertWorker(WORKER_A, "worker-alpha")
          yield* claimSvc.claim(TASK_ORPHAN_ACTIVE, WORKER_A)

          // Task 2: active status -> done with claim — IS orphaned
          yield* insertTask(TASK_ORPHAN_1, "Task moved to done")
          const task2 = yield* taskRepo.findById(TASK_ORPHAN_1)
          yield* taskRepo.update({ ...task2!, status: "active", updatedAt: new Date() })

          yield* insertWorker(WORKER_B, "worker-beta")
          yield* claimSvc.claim(TASK_ORPHAN_1, WORKER_B)

          // Move task 2 to done
          const activeTask2 = yield* taskRepo.findById(TASK_ORPHAN_1)
          yield* taskRepo.update({
            ...activeTask2!,
            status: "done",
            completedAt: new Date(),
            updatedAt: new Date()
          })

          const orphaned = yield* claimSvc.getOrphanedClaims()

          return orphaned
        }).pipe(Effect.provide(shared.layer))
      )

      // Only the claim on the 'done' task should appear
      expect(result).toHaveLength(1)
      expect(result[0].taskId).toBe(TASK_ORPHAN_1)
      expect(result[0].workerId).toBe(WORKER_B)
    })

    it("returns multiple orphaned claims across different tasks", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const claimSvc = yield* ClaimService
          const taskRepo = yield* TaskRepository

          // Create three tasks, all start as 'active', all get claimed
          yield* insertTask(TASK_ORPHAN_1, "Orphan 1")
          yield* insertTask(TASK_ORPHAN_2, "Orphan 2")
          yield* insertTask(TASK_ORPHAN_3, "Orphan 3")

          // Set all to 'active' status
          for (const taskId of [TASK_ORPHAN_1, TASK_ORPHAN_2, TASK_ORPHAN_3]) {
            const t = yield* taskRepo.findById(taskId)
            yield* taskRepo.update({ ...t!, status: "active", updatedAt: new Date() })
          }

          yield* insertWorker(WORKER_ORPHAN, "worker-orphan")

          // Claim all three tasks (need different workers since one worker can't claim multiple with same ID)
          yield* insertWorker(WORKER_A, "worker-alpha")
          yield* insertWorker(WORKER_B, "worker-beta")

          yield* claimSvc.claim(TASK_ORPHAN_1, WORKER_ORPHAN)
          yield* claimSvc.claim(TASK_ORPHAN_2, WORKER_A)
          yield* claimSvc.claim(TASK_ORPHAN_3, WORKER_B)

          // Move all three tasks to non-active statuses without releasing claims
          const t1 = yield* taskRepo.findById(TASK_ORPHAN_1)
          yield* taskRepo.update({
            ...t1!,
            status: "done",
            completedAt: new Date(),
            updatedAt: new Date()
          })

          const t2 = yield* taskRepo.findById(TASK_ORPHAN_2)
          yield* taskRepo.update({
            ...t2!,
            status: "review",
            updatedAt: new Date()
          })

          const t3 = yield* taskRepo.findById(TASK_ORPHAN_3)
          yield* taskRepo.update({
            ...t3!,
            status: "done",
            completedAt: new Date(),
            updatedAt: new Date()
          })

          const orphaned = yield* claimSvc.getOrphanedClaims()

          return orphaned
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(3)

      // Verify all three orphaned claims are returned
      const taskIds = result.map((c) => c.taskId).sort()
      const expectedIds = [TASK_ORPHAN_1, TASK_ORPHAN_2, TASK_ORPHAN_3].sort()
      expect(taskIds).toEqual(expectedIds)

      // All should still have 'active' claim status (the claim was never released)
      for (const claim of result) {
        expect(claim.status).toBe("active")
      }
    })
  })

  it("uses custom lease duration when provided", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA)
        yield* insertWorker(WORKER_A, "worker-alpha")

        const before = Date.now()
        const claim = yield* claimSvc.claim(TASK_ALPHA, WORKER_A, 120) // 120 minutes

        return { claim, before }
      }).pipe(Effect.provide(shared.layer))
    )

    // Lease should expire in ~120 minutes from now
    const expectedMinExpiry = result.before + 119 * 60 * 1000
    const expectedMaxExpiry = result.before + 121 * 60 * 1000
    expect(result.claim.leaseExpiresAt.getTime()).toBeGreaterThan(expectedMinExpiry)
    expect(result.claim.leaseExpiresAt.getTime()).toBeLessThan(expectedMaxExpiry)
  })

  it("releaseByWorker releases all active claims for a worker", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService

        yield* insertTask(TASK_ALPHA, "Task Alpha")
        yield* insertTask(TASK_BETA, "Task Beta")
        yield* insertTask(TASK_GAMMA, "Task Gamma")
        yield* insertWorker(WORKER_A, "worker-alpha")
        yield* insertWorker(WORKER_B, "worker-beta")

        // Worker A claims two tasks
        yield* claimSvc.claim(TASK_ALPHA, WORKER_A)
        yield* claimSvc.claim(TASK_BETA, WORKER_A)

        // Worker B claims one task
        yield* claimSvc.claim(TASK_GAMMA, WORKER_B)

        // Release all of Worker A's claims
        const released = yield* claimSvc.releaseByWorker(WORKER_A)

        // Verify state
        const alphaActive = yield* claimSvc.getActiveClaim(TASK_ALPHA)
        const betaActive = yield* claimSvc.getActiveClaim(TASK_BETA)
        const gammaActive = yield* claimSvc.getActiveClaim(TASK_GAMMA)

        return { released, alphaActive, betaActive, gammaActive }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.released).toBe(2)
    expect(result.alphaActive).toBeNull()
    expect(result.betaActive).toBeNull()
    // Worker B's claim should be untouched
    expect(result.gammaActive).not.toBeNull()
    expect(result.gammaActive!.workerId).toBe(WORKER_B)
  })
})
