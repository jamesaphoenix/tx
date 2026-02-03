/**
 * ClaimService Integration Tests
 *
 * Tests the ClaimService with full dependency injection.
 * Uses real SQLite database (in-memory) per Rule 3.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-018 for implementation details
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import type { TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureTaskId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`claim-service-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const fixtureWorkerId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`claim-service-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

const FIXTURES = {
  TASK_1: fixtureTaskId("task-1"),
  TASK_2: fixtureTaskId("task-2"),
  TASK_3: fixtureTaskId("task-3"),
  WORKER_1: fixtureWorkerId("worker-1"),
  WORKER_2: fixtureWorkerId("worker-2"),
} as const

// =============================================================================
// Helper: Create test layer with all dependencies
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
// Helper: Create test data
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
// ClaimService.claim Tests
// =============================================================================

describe("ClaimService.claim", () => {
  it("creates claim for task with correct fields", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        return yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toBe(1)
    expect(result.taskId).toBe(FIXTURES.TASK_1)
    expect(result.workerId).toBe(FIXTURES.WORKER_1)
    expect(result.status).toBe("active")
    expect(result.renewedCount).toBe(0)
    expect(result.claimedAt).toBeInstanceOf(Date)
    expect(result.leaseExpiresAt).toBeInstanceOf(Date)
    expect(result.leaseExpiresAt.getTime()).toBeGreaterThan(result.claimedAt.getTime())
  })

  it("uses custom lease duration when provided", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        const before = Date.now()
        const claim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1, 60) // 60 minutes

        return { claim, before }
      }).pipe(Effect.provide(layer))
    )

    // Lease should expire in ~60 minutes
    const expectedExpiryMin = result.before + 59 * 60 * 1000
    const expectedExpiryMax = result.before + 61 * 60 * 1000
    expect(result.claim.leaseExpiresAt.getTime()).toBeGreaterThan(expectedExpiryMin)
    expect(result.claim.leaseExpiresAt.getTime()).toBeLessThan(expectedExpiryMax)
  })

  it("fails when task does not exist", async () => {
    const { ClaimService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository

        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        return yield* claimSvc.claim("tx-nonexist", FIXTURES.WORKER_1).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("TaskNotFoundError")
  })

  it("fails when task is already claimed", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        // First claim succeeds
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Second claim fails
        return yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_2).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("AlreadyClaimedError")
    expect((error as { claimedByWorkerId: string }).claimedByWorkerId).toBe(FIXTURES.WORKER_1)
  })
})

// =============================================================================
// ClaimService.release Tests
// =============================================================================

describe("ClaimService.release", () => {
  it("releases claim and sets status to released", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        const claim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Active claim should be null now
        const activeClaim = yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_1)
        // Check the original claim was marked as released
        const releasedClaim = yield* claimRepo.findById(claim.id)

        return { activeClaim, releasedClaim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.activeClaim).toBeNull()
    expect(result.releasedClaim).not.toBeNull()
    expect(result.releasedClaim!.status).toBe("released")
  })

  it("fails when no active claim exists", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        return yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  it("fails when worker does not own the claim", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        // Worker 1 claims
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Worker 2 tries to release
        return yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_2).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })
})

// =============================================================================
// ClaimService.renew Tests
// =============================================================================

describe("ClaimService.renew", () => {
  it("extends lease and increments renewedCount", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        const originalClaim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const renewedClaim = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        return { originalClaim, renewedClaim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.renewedClaim.renewedCount).toBe(1)
    // The renewed lease should be at least as long as the original (may be same in fast tests)
    expect(result.renewedClaim.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      result.originalClaim.leaseExpiresAt.getTime()
    )
  })

  it("fails when no active claim exists", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        return yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  it("fails when worker does not own the claim", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        return yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_2).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  it("fails when lease has already expired", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        const claim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Backdate the lease to expired
        const expiredTime = new Date(Date.now() - 60000) // 1 minute ago
        yield* claimRepo.update({
          ...claim,
          leaseExpiresAt: expiredTime
        })

        return yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("LeaseExpiredError")
  })

  it("fails when max renewals exceeded", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        const claim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Set renewedCount to max (10)
        yield* claimRepo.update({
          ...claim,
          renewedCount: 10
        })

        return yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("MaxRenewalsExceededError")
  })
})

// =============================================================================
// ClaimService.getExpired Tests
// =============================================================================

describe("ClaimService.getExpired", () => {
  it("returns expired active claims", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_2))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const claim2 = yield* claimSvc.claim(FIXTURES.TASK_2, FIXTURES.WORKER_1)

        // Backdate claim2 to expired
        const expiredTime = new Date(Date.now() - 60000)
        yield* claimRepo.update({
          ...claim2,
          leaseExpiresAt: expiredTime
        })

        return yield* claimSvc.getExpired()
      }).pipe(Effect.provide(layer))
    )

    // Should only find one expired claim (claim1 was released, not expired)
    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe(FIXTURES.TASK_2)
  })

  it("returns empty array when no expired claims", async () => {
    const { ClaimService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        return yield* claimSvc.getExpired()
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(0)
  })
})

// =============================================================================
// ClaimService.expire Tests
// =============================================================================

describe("ClaimService.expire", () => {
  it("marks claim as expired", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        const claim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.expire(claim.id)

        const expiredClaim = yield* claimRepo.findById(claim.id)
        const activeClaim = yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_1)

        return { expiredClaim, activeClaim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.expiredClaim).not.toBeNull()
    expect(result.expiredClaim!.status).toBe("expired")
    expect(result.activeClaim).toBeNull()
  })

  it("fails for nonexistent claim ID", async () => {
    const { ClaimService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        return yield* claimSvc.expire(999).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("ClaimIdNotFoundError")
  })
})

// =============================================================================
// ClaimService.releaseByWorker Tests
// =============================================================================

describe("ClaimService.releaseByWorker", () => {
  it("releases all active claims for a worker", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_2))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_3))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        // Worker 1 claims 2 tasks
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.claim(FIXTURES.TASK_2, FIXTURES.WORKER_1)

        // Worker 2 claims 1 task
        yield* claimSvc.claim(FIXTURES.TASK_3, FIXTURES.WORKER_2)

        // Release all claims for worker 1
        const released = yield* claimSvc.releaseByWorker(FIXTURES.WORKER_1)

        // Check remaining active claims
        const task1Active = yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_1)
        const task2Active = yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_2)
        const task3Active = yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_3)

        return { released, task1Active, task2Active, task3Active }
      }).pipe(Effect.provide(layer))
    )

    expect(result.released).toBe(2)
    expect(result.task1Active).toBeNull()
    expect(result.task2Active).toBeNull()
    expect(result.task3Active).not.toBeNull() // Worker 2's claim should remain
  })

  it("returns 0 when worker has no active claims", async () => {
    const { ClaimService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository

        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        return yield* claimSvc.releaseByWorker(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(0)
  })
})

// =============================================================================
// ClaimService.getActiveClaim Tests
// =============================================================================

describe("ClaimService.getActiveClaim", () => {
  it("returns active claim for task", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        return yield* claimSvc.getActiveClaim(FIXTURES.TASK_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.taskId).toBe(FIXTURES.TASK_1)
    expect(result!.workerId).toBe(FIXTURES.WORKER_1)
    expect(result!.status).toBe("active")
  })

  it("returns null when no active claim exists", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        return yield* claimSvc.getActiveClaim(FIXTURES.TASK_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })

  it("returns null for task with no claims", async () => {
    const { ClaimService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        return yield* claimSvc.getActiveClaim("tx-nonexist")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// Full Lifecycle Tests
// =============================================================================

describe("ClaimService full lifecycle", () => {
  it("claim -> renew -> release lifecycle works correctly", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))

        // Claim
        const originalClaim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Renew multiple times
        const renew1 = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const renew2 = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const renew3 = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Release
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        const finalClaim = yield* claimRepo.findById(originalClaim.id)
        const activeClaim = yield* claimSvc.getActiveClaim(FIXTURES.TASK_1)

        return { originalClaim, renew1, renew2, renew3, finalClaim, activeClaim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.originalClaim.renewedCount).toBe(0)
    expect(result.renew1.renewedCount).toBe(1)
    expect(result.renew2.renewedCount).toBe(2)
    expect(result.renew3.renewedCount).toBe(3)
    expect(result.finalClaim!.status).toBe("released")
    expect(result.activeClaim).toBeNull()
  })

  it("multiple tasks can be claimed by different workers", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_2))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        const claim1 = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const claim2 = yield* claimSvc.claim(FIXTURES.TASK_2, FIXTURES.WORKER_2)

        return { claim1, claim2 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.claim1.taskId).toBe(FIXTURES.TASK_1)
    expect(result.claim1.workerId).toBe(FIXTURES.WORKER_1)
    expect(result.claim2.taskId).toBe(FIXTURES.TASK_2)
    expect(result.claim2.workerId).toBe(FIXTURES.WORKER_2)
  })

  it("released task can be reclaimed by another worker", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_1))
        yield* workerRepo.insert(createWorkerData(FIXTURES.WORKER_2))

        // Worker 1 claims and releases
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Worker 2 reclaims
        const newClaim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_2)

        return newClaim
      }).pipe(Effect.provide(layer))
    )

    expect(result.taskId).toBe(FIXTURES.TASK_1)
    expect(result.workerId).toBe(FIXTURES.WORKER_2)
    expect(result.id).toBe(2) // Should be a new claim (id=2)
  })
})
