/**
 * Worker Orchestration End-to-End Integration Tests
 *
 * Tests combined scenarios for worker registration, claims, and reconciliation
 * to verify they work correctly together as an integrated system.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-018 for implementation details
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer, Fiber } from "effect"
import { createHash } from "node:crypto"
import type { TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureTaskId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`worker-orchestration-e2e-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const fixtureWorkerId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`worker-orchestration-e2e-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

const FIXTURES = {
  TASK_1: fixtureTaskId("task-1"),
  TASK_2: fixtureTaskId("task-2"),
  TASK_3: fixtureTaskId("task-3"),
  TASK_4: fixtureTaskId("task-4"),
  WORKER_1: fixtureWorkerId("worker-1"),
  WORKER_2: fixtureWorkerId("worker-2"),
  WORKER_3: fixtureWorkerId("worker-3"),
} as const

// =============================================================================
// Helper: Create test layer with all dependencies
// =============================================================================

async function makeTestLayer() {
  const {
    SqliteClientLive,
    TaskRepositoryLive,
    DependencyRepositoryLive,
    WorkerRepositoryLive,
    ClaimRepositoryLive,
    OrchestratorStateRepositoryLive,
    WorkerServiceLive,
    ClaimServiceLive,
    OrchestratorServiceLive,
    ReadyServiceLive,
    RunRepositoryLive
  } = await import("@jamesaphoenix/tx-core")

  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    WorkerRepositoryLive,
    ClaimRepositoryLive,
    OrchestratorStateRepositoryLive,
    RunRepositoryLive
  ).pipe(Layer.provide(infra))

  const workerService = WorkerServiceLive.pipe(Layer.provide(repos))
  const claimService = ClaimServiceLive.pipe(Layer.provide(repos))
  const readyService = ReadyServiceLive.pipe(Layer.provide(repos))

  // OrchestratorService needs SqliteClient for transaction support
  const orchestratorService = OrchestratorServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, workerService, claimService, readyService, infra))
  )

  return Layer.mergeAll(repos, workerService, claimService, readyService, orchestratorService)
}

// =============================================================================
// Helper: Create test data
// =============================================================================

function createTaskData(id: string, title: string = "Test Task", status: "backlog" | "ready" | "active" = "ready") {
  return {
    id: id as TaskId,
    title,
    description: "Test description",
    status,
    parentId: null,
    score: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    metadata: {}
  }
}

function createWorkerData(id: string, name: string, status: "idle" | "busy" | "dead" | "starting" = "idle") {
  return {
    id,
    name,
    hostname: "localhost",
    pid: 12345,
    status,
    registeredAt: new Date(),
    lastHeartbeatAt: new Date(),
    currentTaskId: null,
    capabilities: ["tx-implementer"],
    metadata: {}
  }
}

// =============================================================================
// Multi-Worker Claim Competition Tests
// =============================================================================

describe("Worker Orchestration E2E: Multi-Worker Claim Competition", () => {
  it("only one worker succeeds when two workers attempt to claim same task simultaneously", async () => {
    const {
      OrchestratorService,
      WorkerService,
      ClaimService,
      TaskRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository

        // Start orchestrator
        yield* orchestrator.start({ workerPoolSize: 10 })

        // Create a task
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))

        // Register two workers
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1, name: "worker-1" })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_2, name: "worker-2" })

        // Both workers try to claim the same task
        const claim1Result = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1).pipe(Effect.either)
        const claim2Result = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_2).pipe(Effect.either)

        // Get the active claim
        const activeClaim = yield* claimSvc.getActiveClaim(FIXTURES.TASK_1)

        return { claim1Result, claim2Result, activeClaim }
      }).pipe(Effect.provide(layer))
    )

    // One should succeed, one should fail
    const successes = [result.claim1Result, result.claim2Result].filter(r => r._tag === "Right")
    const failures = [result.claim1Result, result.claim2Result].filter(r => r._tag === "Left")

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)

    // The failure should be AlreadyClaimedError
    expect(failures[0]._tag).toBe("Left")
    if (failures[0]._tag === "Left") {
      expect(failures[0].left._tag).toBe("AlreadyClaimedError")
    }

    // Active claim should match the successful worker
    expect(result.activeClaim).not.toBeNull()
    expect(result.activeClaim!.taskId).toBe(FIXTURES.TASK_1)
  })

  it("released task can be claimed by second worker", async () => {
    const {
      OrchestratorService,
      WorkerService,
      ClaimService,
      TaskRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 10 })
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))

        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1, name: "worker-1" })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_2, name: "worker-2" })

        // Worker 1 claims
        const firstClaim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Worker 1 releases
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Worker 2 can now claim
        const secondClaim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_2)

        return { firstClaim, secondClaim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.firstClaim.workerId).toBe(FIXTURES.WORKER_1)
    expect(result.secondClaim.workerId).toBe(FIXTURES.WORKER_2)
    expect(result.secondClaim.id).toBeGreaterThan(result.firstClaim.id)
  })
})

// =============================================================================
// Full Worker Lifecycle Tests
// =============================================================================

describe("Worker Orchestration E2E: Full Lifecycle", () => {
  it("complete lifecycle: register -> claim -> work -> release -> deregister", async () => {
    const {
      OrchestratorService,
      WorkerService,
      ClaimService,
      TaskRepository,
      WorkerRepository,
      ClaimRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository

        // 1. Start orchestrator
        yield* orchestrator.start({ workerPoolSize: 5 })
        const statusAfterStart = yield* orchestrator.status()

        // 2. Register worker
        yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "lifecycle-worker",
          capabilities: ["tx-implementer"]
        })
        const workersAfterRegister = yield* workerSvc.list()

        // 3. Create and claim task
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        const claim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // 4. Update worker status to busy (simulating work)
        yield* workerSvc.heartbeat({
          workerId: FIXTURES.WORKER_1,
          timestamp: new Date(),
          status: "busy",
          currentTaskId: FIXTURES.TASK_1
        })
        const workerDuringWork = yield* workerRepo.findById(FIXTURES.WORKER_1)

        // 5. Release claim (work complete)
        yield* claimSvc.release(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const claimAfterRelease = yield* claimRepo.findById(claim.id)

        // 6. Update worker status to idle
        yield* workerSvc.updateStatus(FIXTURES.WORKER_1, "idle")
        const workerAfterWork = yield* workerRepo.findById(FIXTURES.WORKER_1)

        // 7. Deregister worker
        yield* workerSvc.deregister(FIXTURES.WORKER_1)
        const workersAfterDeregister = yield* workerSvc.list()

        return {
          statusAfterStart,
          workersAfterRegister,
          claim,
          workerDuringWork,
          claimAfterRelease,
          workerAfterWork,
          workersAfterDeregister
        }
      }).pipe(Effect.provide(layer))
    )

    // Verify each step
    expect(result.statusAfterStart.status).toBe("running")
    expect(result.workersAfterRegister).toHaveLength(1)
    expect(result.claim.taskId).toBe(FIXTURES.TASK_1)
    expect(result.workerDuringWork!.status).toBe("busy")
    expect(result.workerDuringWork!.currentTaskId).toBe(FIXTURES.TASK_1)
    expect(result.claimAfterRelease!.status).toBe("released")
    expect(result.workerAfterWork!.status).toBe("idle")
    expect(result.workersAfterDeregister).toHaveLength(0)
  })

  it("claim renewal extends lease correctly", async () => {
    const {
      OrchestratorService,
      WorkerService,
      ClaimService,
      TaskRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const claimSvc = yield* ClaimService
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 5, leaseDurationMinutes: 30 })
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1, name: "renewal-worker" })

        // Claim with default duration
        const originalClaim = yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        // Renew 3 times
        const renew1 = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const renew2 = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        const renew3 = yield* claimSvc.renew(FIXTURES.TASK_1, FIXTURES.WORKER_1)

        return { originalClaim, renew1, renew2, renew3 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.originalClaim.renewedCount).toBe(0)
    expect(result.renew1.renewedCount).toBe(1)
    expect(result.renew2.renewedCount).toBe(2)
    expect(result.renew3.renewedCount).toBe(3)

    // Each renewal should extend the lease
    expect(result.renew1.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      result.originalClaim.leaseExpiresAt.getTime()
    )
    expect(result.renew2.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      result.renew1.leaseExpiresAt.getTime()
    )
    expect(result.renew3.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      result.renew2.leaseExpiresAt.getTime()
    )
  })
})

// =============================================================================
// Combined Reconciliation Scenarios
// =============================================================================

describe("Worker Orchestration E2E: Combined Reconciliation", () => {
  it("reconciliation handles multiple issues: dead worker + expired claim + orphaned task", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      WorkerRepository,
      ClaimRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository
        const claimRepo = yield* ClaimRepository

        const now = new Date()
        const oldTime = new Date(now.getTime() - 120000) // 2 minutes ago

        // Start orchestrator with short heartbeat for testing
        yield* orchestrator.start({
          workerPoolSize: 10,
          heartbeatIntervalSeconds: 1
        })

        // Create multiple tasks
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1, "Task with expired claim", "active"))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_2, "Orphaned task", "active"))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_3, "Normal task", "ready"))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_4, "Task claimed by dead worker", "active"))

        // Create dead worker (stale heartbeat, no claims - just for testing dead detection)
        yield* workerRepo.insert({
          ...createWorkerData(FIXTURES.WORKER_1, "dead-worker", "idle"),
          registeredAt: oldTime,
          lastHeartbeatAt: oldTime
        })

        // Create worker with inconsistent state (busy but no task)
        yield* workerRepo.insert({
          ...createWorkerData(FIXTURES.WORKER_2, "inconsistent-worker", "busy"),
          currentTaskId: null
        })

        // Create a live worker that has an expired claim
        yield* workerRepo.insert({
          ...createWorkerData(FIXTURES.WORKER_3, "live-with-expired-claim", "busy"),
          currentTaskId: FIXTURES.TASK_1
        })

        // Create expired claim for TASK_1 (owned by WORKER_3 who is still alive)
        yield* claimRepo.insert({
          taskId: FIXTURES.TASK_1,
          workerId: FIXTURES.WORKER_3,
          claimedAt: oldTime,
          leaseExpiresAt: new Date(now.getTime() - 60000), // expired 1 minute ago
          renewedCount: 0,
          status: "active"
        })

        // TASK_2 is orphaned (active but no claim) - already set up above

        // Run reconciliation
        const reconcileResult = yield* orchestrator.reconcile()

        // Check final states
        const task1 = yield* taskRepo.findById(FIXTURES.TASK_1)
        const task2 = yield* taskRepo.findById(FIXTURES.TASK_2)
        const worker1 = yield* workerRepo.findById(FIXTURES.WORKER_1)
        const worker2 = yield* workerRepo.findById(FIXTURES.WORKER_2)

        return {
          reconcileResult,
          task1,
          task2,
          worker1,
          worker2
        }
      }).pipe(Effect.provide(layer))
    )

    // Verify all issues were handled
    expect(result.reconcileResult.deadWorkersFound).toBe(1)
    expect(result.reconcileResult.expiredClaimsReleased).toBe(1)
    // TASK_2 is orphaned (active, no claim), TASK_4 becomes orphaned after dead worker handling
    expect(result.reconcileResult.orphanedTasksRecovered).toBeGreaterThanOrEqual(1)
    expect(result.reconcileResult.staleStatesFixed).toBeGreaterThanOrEqual(1)

    // Verify dead worker was marked dead
    expect(result.worker1!.status).toBe("dead")

    // Verify task with expired claim was returned to ready
    expect(result.task1!.status).toBe("ready")

    // Verify orphaned task was recovered
    expect(result.task2!.status).toBe("ready")

    // Verify inconsistent worker was fixed
    expect(result.worker2!.status).toBe("idle")
  })

  it("graceful shutdown releases all worker claims", async () => {
    const {
      OrchestratorService,
      WorkerService,
      ClaimService,
      TaskRepository,
      ClaimRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 10 })

        // Create tasks
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))
        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_2))

        // Register worker and claim multiple tasks
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1, name: "worker-with-claims" })
        yield* claimSvc.claim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* claimSvc.claim(FIXTURES.TASK_2, FIXTURES.WORKER_1)

        // Verify claims exist
        const claimsBeforeRelease = [
          yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_1),
          yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_2)
        ]

        // Release all claims by worker (simulates graceful shutdown)
        const releasedCount = yield* claimSvc.releaseByWorker(FIXTURES.WORKER_1)

        // Verify claims are released
        const claimsAfterRelease = [
          yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_1),
          yield* claimRepo.findActiveByTaskId(FIXTURES.TASK_2)
        ]

        return { claimsBeforeRelease, releasedCount, claimsAfterRelease }
      }).pipe(Effect.provide(layer))
    )

    // Both claims existed before
    expect(result.claimsBeforeRelease[0]).not.toBeNull()
    expect(result.claimsBeforeRelease[1]).not.toBeNull()

    // Released count is 2
    expect(result.releasedCount).toBe(2)

    // No active claims after
    expect(result.claimsAfterRelease[0]).toBeNull()
    expect(result.claimsAfterRelease[1]).toBeNull()
  })
})

// =============================================================================
// runWorker ctx.renewLease() Integration Test
// =============================================================================

describe("Worker Orchestration E2E: runWorker Integration", () => {
  // Store signal handlers to clean up after tests
  let originalSigTermHandlers: NodeJS.SignalsListener[]
  let originalSigIntHandlers: NodeJS.SignalsListener[]

  beforeEach(() => {
    // Save original handlers
    originalSigTermHandlers = [...(process.listeners("SIGTERM") as NodeJS.SignalsListener[])]
    originalSigIntHandlers = [...(process.listeners("SIGINT") as NodeJS.SignalsListener[])]
  })

  afterEach(() => {
    // Remove all handlers added during test
    process.removeAllListeners("SIGTERM")
    process.removeAllListeners("SIGINT")

    // Restore original handlers
    for (const handler of originalSigTermHandlers) {
      process.on("SIGTERM", handler)
    }
    for (const handler of originalSigIntHandlers) {
      process.on("SIGINT", handler)
    }
  })

  it("ctx.renewLease() successfully renews the claim lease", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      ClaimRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    let renewLeaseWasCalled = false
    let claimBeforeRenewal: { renewedCount: number } | null = null
    let claimAfterRenewal: { renewedCount: number } | null = null
    let capturedTaskId = ""

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const claimRepo = yield* ClaimRepository

        yield* orchestrator.start({ workerPoolSize: 5, leaseDurationMinutes: 30 })

        yield* taskRepo.insert(createTaskData(FIXTURES.TASK_1))

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "renewal-test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (task, ctx) => {
              capturedTaskId = task.id

              // Get claim before renewal
              const claimBefore = await Effect.runPromise(
                claimRepo.findActiveByTaskId(task.id).pipe(Effect.provide(layer))
              )
              claimBeforeRenewal = claimBefore

              // Call renewLease
              await ctx.renewLease()
              renewLeaseWasCalled = true

              // Get claim after renewal
              const claimAfter = await Effect.runPromise(
                claimRepo.findActiveByTaskId(task.id).pipe(Effect.provide(layer))
              )
              claimAfterRenewal = claimAfter

              // Signal shutdown
              process.emit("SIGTERM", "SIGTERM")

              return { success: true }
            }
          })
        )

        yield* Effect.sleep("2 seconds")
        yield* Fiber.interrupt(workerFiber)
      }).pipe(Effect.provide(layer))
    )

    expect(renewLeaseWasCalled).toBe(true)
    expect(capturedTaskId).toBe(FIXTURES.TASK_1)
    expect(claimBeforeRenewal).not.toBeNull()
    expect(claimAfterRenewal).not.toBeNull()
    // The renewedCount should have increased
    expect(claimAfterRenewal!.renewedCount).toBe(claimBeforeRenewal!.renewedCount + 1)
  })
})
