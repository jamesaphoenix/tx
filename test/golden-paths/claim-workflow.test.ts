/**
 * Golden Path: Claim Workflow Integration Tests
 *
 * Tests the complete claim workflow: claim → renew → release.
 * Also tests parallel claims with multiple workers and crash recovery.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 * Per PRD-018: Worker Orchestration System
 *
 * @see PRD-018: Worker Orchestration
 * @see DD-018: Worker Implementation
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import type { TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (SHA256-based IDs)
// =============================================================================

const fixtureTaskId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`claim-workflow-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const fixtureWorkerId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`claim-workflow-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

const CLAIM_FIXTURES = {
  TASK_1: fixtureTaskId("task-1"),
  TASK_2: fixtureTaskId("task-2"),
  TASK_3: fixtureTaskId("task-3"),
  TASK_4: fixtureTaskId("task-4"),
  TASK_5: fixtureTaskId("task-5"),
  WORKER_ALPHA: fixtureWorkerId("worker-alpha"),
  WORKER_BETA: fixtureWorkerId("worker-beta"),
  WORKER_GAMMA: fixtureWorkerId("worker-gamma"),
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
// Golden Path: Basic Claim Lifecycle
// =============================================================================

describe("Golden Path: Basic Claim Lifecycle", () => {
  it("claim → work → release lifecycle", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup: Create task and worker
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1, "Implement feature"))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA, "alpha-worker"))

        // Step 1: Claim the task
        const claim = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)

        expect(claim.taskId).toBe(CLAIM_FIXTURES.TASK_1)
        expect(claim.workerId).toBe(CLAIM_FIXTURES.WORKER_ALPHA)
        expect(claim.status).toBe("active")
        expect(claim.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now())

        // Step 2: Verify active claim
        const activeClaim = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_1)
        expect(activeClaim).not.toBeNull()
        expect(activeClaim!.workerId).toBe(CLAIM_FIXTURES.WORKER_ALPHA)

        // Step 3: Release the claim (work complete)
        yield* claimSvc.release(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)

        // Step 4: Verify no active claim
        const afterRelease = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_1)
        expect(afterRelease).toBeNull()

        return { claim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.claim.status).toBe("active")
  })

  it("claim → renew → release with multiple renewals", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))

        // Claim
        const initial = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        expect(initial.renewedCount).toBe(0)

        // Renew multiple times
        const renew1 = yield* claimSvc.renew(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        expect(renew1.renewedCount).toBe(1)

        const renew2 = yield* claimSvc.renew(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        expect(renew2.renewedCount).toBe(2)

        const renew3 = yield* claimSvc.renew(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        expect(renew3.renewedCount).toBe(3)

        // Release
        yield* claimSvc.release(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)

        return { initial, renew1, renew2, renew3 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.renew3.renewedCount).toBe(3)
  })
})

// =============================================================================
// Golden Path: Parallel Claims (Multiple Workers)
// =============================================================================

describe("Golden Path: Parallel Claims", () => {
  it("multiple workers can claim different tasks simultaneously", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup: Create multiple tasks and workers
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1, "Task 1"))
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_2, "Task 2"))
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_3, "Task 3"))

        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA, "alpha"))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_BETA, "beta"))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_GAMMA, "gamma"))

        // Each worker claims a different task
        const claimAlpha = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        const claimBeta = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_2, CLAIM_FIXTURES.WORKER_BETA)
        const claimGamma = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_3, CLAIM_FIXTURES.WORKER_GAMMA)

        // Verify all claims are active
        expect(claimAlpha.status).toBe("active")
        expect(claimBeta.status).toBe("active")
        expect(claimGamma.status).toBe("active")

        // Verify each task has correct owner
        const active1 = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_1)
        const active2 = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_2)
        const active3 = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_3)

        expect(active1!.workerId).toBe(CLAIM_FIXTURES.WORKER_ALPHA)
        expect(active2!.workerId).toBe(CLAIM_FIXTURES.WORKER_BETA)
        expect(active3!.workerId).toBe(CLAIM_FIXTURES.WORKER_GAMMA)

        return { claimAlpha, claimBeta, claimGamma }
      }).pipe(Effect.provide(layer))
    )

    expect(result.claimAlpha.taskId).toBe(CLAIM_FIXTURES.TASK_1)
    expect(result.claimBeta.taskId).toBe(CLAIM_FIXTURES.TASK_2)
    expect(result.claimGamma.taskId).toBe(CLAIM_FIXTURES.TASK_3)
  })

  it("rejects claim when task already claimed by another worker", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_BETA))

        // Alpha claims task
        const alphaClaim = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)

        // Beta tries to claim same task - should fail
        const error = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_BETA).pipe(
          Effect.flip
        )

        return { alphaClaim, error }
      }).pipe(Effect.provide(layer))
    )

    expect(result.alphaClaim.status).toBe("active")
    expect((result.error as any)._tag).toBe("AlreadyClaimedError")
    expect((result.error as any).claimedByWorkerId).toBe(CLAIM_FIXTURES.WORKER_ALPHA)
  })

  it("released task can be reclaimed by different worker", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_BETA))

        // Alpha claims and releases
        yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        yield* claimSvc.release(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)

        // Beta can now claim
        const betaClaim = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_BETA)

        expect(betaClaim.workerId).toBe(CLAIM_FIXTURES.WORKER_BETA)
        expect(betaClaim.status).toBe("active")

        return { betaClaim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.betaClaim.taskId).toBe(CLAIM_FIXTURES.TASK_1)
  })
})

// =============================================================================
// Golden Path: Crash Recovery (Expired Claims)
// =============================================================================

describe("Golden Path: Crash Recovery", () => {
  it("expired claims can be detected and cleaned up", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))

        // Create claim
        const claim = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)

        // Simulate crash: backdate lease to expired
        const expiredTime = new Date(Date.now() - 60000) // 1 minute ago
        yield* claimRepo.update({
          ...claim,
          leaseExpiresAt: expiredTime
        })

        // Get expired claims
        const expired = yield* claimSvc.getExpired()
        expect(expired).toHaveLength(1)
        expect(expired[0].taskId).toBe(CLAIM_FIXTURES.TASK_1)

        // Mark as expired (cleanup)
        yield* claimSvc.expire(claim.id)

        // No more expired claims
        const expiredAfter = yield* claimSvc.getExpired()
        expect(expiredAfter).toHaveLength(0)

        // Task can be reclaimed
        const activeClaim = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_1)
        expect(activeClaim).toBeNull()

        return { claim, expired }
      }).pipe(Effect.provide(layer))
    )

    expect(result.expired).toHaveLength(1)
  })

  it("releaseByWorker cleans up all claims for crashed worker", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup: Multiple tasks claimed by same worker
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_2))
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_3))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_BETA))

        // Alpha claims 2 tasks, Beta claims 1
        yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        yield* claimSvc.claim(CLAIM_FIXTURES.TASK_2, CLAIM_FIXTURES.WORKER_ALPHA)
        yield* claimSvc.claim(CLAIM_FIXTURES.TASK_3, CLAIM_FIXTURES.WORKER_BETA)

        // Simulate Alpha crashing - release all its claims
        const released = yield* claimSvc.releaseByWorker(CLAIM_FIXTURES.WORKER_ALPHA)
        expect(released).toBe(2) // Released 2 claims

        // Alpha's tasks are now available
        const task1Active = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_1)
        const task2Active = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_2)
        const task3Active = yield* claimSvc.getActiveClaim(CLAIM_FIXTURES.TASK_3)

        expect(task1Active).toBeNull()
        expect(task2Active).toBeNull()
        expect(task3Active).not.toBeNull() // Beta's claim still active

        return { released }
      }).pipe(Effect.provide(layer))
    )

    expect(result.released).toBe(2)
  })
})

// =============================================================================
// Golden Path: Claim Constraints
// =============================================================================

describe("Golden Path: Claim Constraints", () => {
  it("renew fails when lease expired", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))

        // Claim and expire
        const claim = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        yield* claimRepo.update({
          ...claim,
          leaseExpiresAt: new Date(Date.now() - 60000)
        })

        // Renew should fail
        const error = yield* claimSvc.renew(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA).pipe(
          Effect.flip
        )

        return { error }
      }).pipe(Effect.provide(layer))
    )

    expect((result.error as any)._tag).toBe("LeaseExpiredError")
  })

  it("renew fails when max renewals exceeded", async () => {
    const { ClaimService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))

        // Claim and max out renewals
        const claim = yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)
        yield* claimRepo.update({
          ...claim,
          renewedCount: 10 // Max is 10
        })

        // Renew should fail
        const error = yield* claimSvc.renew(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA).pipe(
          Effect.flip
        )

        return { error }
      }).pipe(Effect.provide(layer))
    )

    expect((result.error as any)._tag).toBe("MaxRenewalsExceededError")
  })

  it("release fails when worker does not own claim", async () => {
    const { ClaimService, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        // Setup
        yield* taskRepo.insert(createTaskData(CLAIM_FIXTURES.TASK_1))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_ALPHA))
        yield* workerRepo.insert(createWorkerData(CLAIM_FIXTURES.WORKER_BETA))

        // Alpha claims
        yield* claimSvc.claim(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_ALPHA)

        // Beta tries to release Alpha's claim
        const error = yield* claimSvc.release(CLAIM_FIXTURES.TASK_1, CLAIM_FIXTURES.WORKER_BETA).pipe(
          Effect.flip
        )

        return { error }
      }).pipe(Effect.provide(layer))
    )

    expect((result.error as any)._tag).toBe("ClaimNotFoundError")
  })
})
