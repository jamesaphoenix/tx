/**
 * OrchestratorService Integration Tests
 *
 * Tests the OrchestratorService with full dependency injection.
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
    .update(`orchestrator-service-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const fixtureWorkerId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`orchestrator-service-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

const FIXTURES = {
  TASK_1: fixtureTaskId("task-1"),
  TASK_2: fixtureTaskId("task-2"),
  WORKER_1: fixtureWorkerId("worker-1"),
  WORKER_2: fixtureWorkerId("worker-2"),
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
    ReadyServiceLive,
    OrchestratorServiceLive
  } = await import("@jamesaphoenix/tx-core")

  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    WorkerRepositoryLive,
    ClaimRepositoryLive,
    OrchestratorStateRepositoryLive
  ).pipe(Layer.provide(infra))

  // WorkerService needs WorkerRepository and OrchestratorStateRepository
  const workerService = WorkerServiceLive.pipe(Layer.provide(repos))

  // ClaimService needs ClaimRepository, TaskRepository, and OrchestratorStateRepository
  const claimService = ClaimServiceLive.pipe(Layer.provide(repos))

  // ReadyService needs TaskRepository and DependencyRepository
  const readyService = ReadyServiceLive.pipe(Layer.provide(repos))

  // OrchestratorService needs everything
  const orchestratorService = OrchestratorServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, workerService, claimService, readyService))
  )

  return Layer.mergeAll(repos, workerService, claimService, readyService, orchestratorService)
}

// =============================================================================
// OrchestratorService.start Tests
// =============================================================================

describe("OrchestratorService.start", () => {
  it("starts orchestrator from stopped state", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        yield* svc.start()
        return yield* svc.status()
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("running")
    expect(result.pid).toBe(process.pid)
    expect(result.startedAt).not.toBeNull()
    expect(result.workerPoolSize).toBe(1) // default
  })

  it("applies custom configuration", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        yield* svc.start({
          workerPoolSize: 5,
          heartbeatIntervalSeconds: 15,
          leaseDurationMinutes: 60
        })
        return yield* svc.status()
      }).pipe(Effect.provide(layer))
    )

    expect(result.workerPoolSize).toBe(5)
    expect(result.heartbeatIntervalSeconds).toBe(15)
    expect(result.leaseDurationMinutes).toBe(60)
  })

  it("fails when already running", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        yield* svc.start()
        return yield* svc.start().pipe(
          Effect.flip
        )
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("OrchestratorError")
    expect((error as { code: string }).code).toBe("ALREADY_RUNNING")
  })
})

// =============================================================================
// OrchestratorService.stop Tests
// =============================================================================

describe("OrchestratorService.stop", () => {
  it("stops running orchestrator", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        yield* svc.start()
        yield* svc.stop(false)
        return yield* svc.status()
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("stopped")
    expect(result.pid).toBeNull()
  })

  it("fails when not running", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        return yield* svc.stop(false).pipe(
          Effect.flip
        )
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("OrchestratorError")
    expect((error as { code: string }).code).toBe("NOT_RUNNING")
  })

  it("marks workers as dead on non-graceful stop", async () => {
    const { OrchestratorService, WorkerService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const worker = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        // Start orchestrator
        yield* svc.start({ workerPoolSize: 5 })

        // Register a worker
        const w = yield* workerSvc.register({
          name: "test-worker",
          capabilities: ["tx-implementer"]
        })
        yield* workerSvc.updateStatus(w.id, "idle")

        // Stop orchestrator
        yield* svc.stop(false)

        // Check worker status
        return yield* workerRepo.findById(w.id)
      }).pipe(Effect.provide(layer))
    )

    expect(worker).not.toBeNull()
    expect(worker!.status).toBe("dead")
  })
})

// =============================================================================
// OrchestratorService.status Tests
// =============================================================================

describe("OrchestratorService.status", () => {
  it("returns current state", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        return yield* svc.status()
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("stopped")
    expect(result.workerPoolSize).toBe(1)
    expect(result.reconcileIntervalSeconds).toBe(60)
    expect(result.heartbeatIntervalSeconds).toBe(30)
    expect(result.leaseDurationMinutes).toBe(30)
  })
})

// =============================================================================
// OrchestratorService.reconcile Tests
// =============================================================================

describe("OrchestratorService.reconcile", () => {
  it("returns zero counts when nothing to reconcile", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        return yield* svc.reconcile()
      }).pipe(Effect.provide(layer))
    )

    expect(result.deadWorkersFound).toBe(0)
    expect(result.expiredClaimsReleased).toBe(0)
    expect(result.orphanedTasksRecovered).toBe(0)
    expect(result.staleStatesFixed).toBe(0)
    expect(result.reconcileTime).toBeGreaterThanOrEqual(0)
  })

  it("detects dead workers", async () => {
    const { OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const workerRepo = yield* WorkerRepository

        // Start orchestrator (so workers can be registered)
        yield* svc.start({ heartbeatIntervalSeconds: 1 })

        // Insert a stale worker directly (simulate worker with old heartbeat)
        const now = new Date()
        const oldTime = new Date(now.getTime() - 5000) // 5 seconds ago (> 2*1s)
        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "stale-worker",
          hostname: "localhost",
          pid: 12345,
          status: "idle",
          registeredAt: oldTime,
          lastHeartbeatAt: oldTime,
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Run reconciliation
        const reconcileResult = yield* svc.reconcile()

        // Check worker was marked dead
        const worker = yield* workerRepo.findById(FIXTURES.WORKER_1)

        return { reconcileResult, worker }
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileResult.deadWorkersFound).toBe(1)
    expect(result.worker).not.toBeNull()
    expect(result.worker!.status).toBe("dead")
  })

  it("expires stale claims and returns tasks to ready", async () => {
    const { OrchestratorService, ClaimRepository, TaskRepository, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository

        const now = new Date()

        // Insert a task with active status
        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as TaskId,
          title: "Test task",
          description: "Test description",
          status: "active",
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          metadata: {}
        })

        // Insert a worker (needed for FK constraint on claim)
        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "expired-worker",
          hostname: "localhost",
          pid: 12345,
          status: "dead",
          registeredAt: now,
          lastHeartbeatAt: now,
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Insert an expired claim
        const pastExpiry = new Date(now.getTime() - 60000) // expired 1 minute ago
        yield* claimRepo.insert({
          taskId: FIXTURES.TASK_1,
          workerId: FIXTURES.WORKER_1,
          claimedAt: new Date(now.getTime() - 120000),
          leaseExpiresAt: pastExpiry,
          renewedCount: 0,
          status: "active"
        })

        // Run reconciliation
        const reconcileResult = yield* svc.reconcile()

        // Check task status
        const task = yield* taskRepo.findById(FIXTURES.TASK_1)

        return { reconcileResult, task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileResult.expiredClaimsReleased).toBe(1)
    expect(result.task).not.toBeNull()
    expect(result.task!.status).toBe("ready")
  })

  it("recovers orphaned tasks (active but no claim)", async () => {
    const { OrchestratorService, TaskRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const taskRepo = yield* TaskRepository

        const now = new Date()

        // Insert an orphaned task (active status but no claim)
        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as TaskId,
          title: "Orphaned task",
          description: "Test description",
          status: "active",
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          metadata: {}
        })

        // Run reconciliation
        const reconcileResult = yield* svc.reconcile()

        // Check task status
        const task = yield* taskRepo.findById(FIXTURES.TASK_1)

        return { reconcileResult, task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileResult.orphanedTasksRecovered).toBe(1)
    expect(result.task).not.toBeNull()
    expect(result.task!.status).toBe("ready")
  })

  it("fixes busy workers with no currentTaskId", async () => {
    const { OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const workerRepo = yield* WorkerRepository

        // Start orchestrator
        yield* svc.start()

        // Insert a worker that's busy but has no current task
        const now = new Date()
        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "broken-worker",
          hostname: "localhost",
          pid: 12345,
          status: "busy",
          registeredAt: now,
          lastHeartbeatAt: now,
          currentTaskId: null, // No task but status is busy
          capabilities: [],
          metadata: {}
        })

        // Run reconciliation
        const reconcileResult = yield* svc.reconcile()

        // Check worker status
        const worker = yield* workerRepo.findById(FIXTURES.WORKER_1)

        return { reconcileResult, worker }
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileResult.staleStatesFixed).toBe(1)
    expect(result.worker).not.toBeNull()
    expect(result.worker!.status).toBe("idle")
  })

  it("updates lastReconcileAt timestamp", async () => {
    const { OrchestratorService, OrchestratorStateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const before = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const stateRepo = yield* OrchestratorStateRepository

        yield* svc.reconcile()
        return yield* stateRepo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.lastReconcileAt).not.toBeNull()
    expect(result.lastReconcileAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it("sets orphaned task with incomplete blockers to blocked status", async () => {
    const { OrchestratorService, TaskRepository, DependencyRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const depRepo = yield* DependencyRepository

        const now = new Date()

        // Insert a blocker task that is NOT done
        yield* taskRepo.insert({
          id: FIXTURES.TASK_2 as TaskId,
          title: "Blocker task",
          description: "This task blocks another",
          status: "ready", // NOT done
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          metadata: {}
        })

        // Insert an orphaned task (active status but no claim) that is blocked
        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as TaskId,
          title: "Blocked orphaned task",
          description: "Test description",
          status: "active",
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          metadata: {}
        })

        // Create dependency: TASK_1 is blocked by TASK_2
        yield* depRepo.insert(FIXTURES.TASK_2, FIXTURES.TASK_1)

        // Run reconciliation
        const reconcileResult = yield* svc.reconcile()

        // Check task status - should be blocked, not ready
        const task = yield* taskRepo.findById(FIXTURES.TASK_1)

        return { reconcileResult, task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileResult.orphanedTasksRecovered).toBe(1)
    expect(result.task).not.toBeNull()
    expect(result.task!.status).toBe("blocked") // CRITICAL: must be blocked, not ready
  })

  it("sets orphaned task with completed blockers to ready status", async () => {
    const { OrchestratorService, TaskRepository, DependencyRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const depRepo = yield* DependencyRepository

        const now = new Date()

        // Insert a blocker task that IS done
        yield* taskRepo.insert({
          id: FIXTURES.TASK_2 as TaskId,
          title: "Completed blocker task",
          description: "This task blocks another but is done",
          status: "done", // done
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
          metadata: {}
        })

        // Insert an orphaned task (active status but no claim) that has a completed blocker
        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as TaskId,
          title: "Orphaned task with done blocker",
          description: "Test description",
          status: "active",
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          metadata: {}
        })

        // Create dependency: TASK_1 is blocked by TASK_2 (but TASK_2 is done)
        yield* depRepo.insert(FIXTURES.TASK_2, FIXTURES.TASK_1)

        // Run reconciliation
        const reconcileResult = yield* svc.reconcile()

        // Check task status - should be ready since blocker is done
        const task = yield* taskRepo.findById(FIXTURES.TASK_1)

        return { reconcileResult, task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileResult.orphanedTasksRecovered).toBe(1)
    expect(result.task).not.toBeNull()
    expect(result.task!.status).toBe("ready")
  })

  it("sets expired claim task with incomplete blockers to blocked status", async () => {
    const { OrchestratorService, ClaimRepository, TaskRepository, WorkerRepository, DependencyRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService
        const claimRepo = yield* ClaimRepository
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository
        const depRepo = yield* DependencyRepository

        const now = new Date()

        // Insert a blocker task that is NOT done
        yield* taskRepo.insert({
          id: FIXTURES.TASK_2 as TaskId,
          title: "Blocker task",
          description: "This task blocks another",
          status: "ready", // NOT done
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          metadata: {}
        })

        // Insert a task with active status
        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as TaskId,
          title: "Task with expired claim and blocker",
          description: "Test description",
          status: "active",
          parentId: null,
          score: 500,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          metadata: {}
        })

        // Create dependency: TASK_1 is blocked by TASK_2
        yield* depRepo.insert(FIXTURES.TASK_2, FIXTURES.TASK_1)

        // Insert a worker (needed for FK constraint on claim)
        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "expired-worker",
          hostname: "localhost",
          pid: 12345,
          status: "dead",
          registeredAt: now,
          lastHeartbeatAt: now,
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Insert an expired claim
        const pastExpiry = new Date(now.getTime() - 60000) // expired 1 minute ago
        yield* claimRepo.insert({
          taskId: FIXTURES.TASK_1,
          workerId: FIXTURES.WORKER_1,
          claimedAt: new Date(now.getTime() - 120000),
          leaseExpiresAt: pastExpiry,
          renewedCount: 0,
          status: "active"
        })

        // Run reconciliation
        const reconcileResult = yield* svc.reconcile()

        // Check task status - should be blocked, not ready
        const task = yield* taskRepo.findById(FIXTURES.TASK_1)

        return { reconcileResult, task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileResult.expiredClaimsReleased).toBe(1)
    expect(result.task).not.toBeNull()
    expect(result.task!.status).toBe("blocked") // CRITICAL: must be blocked, not ready
  })
})

// =============================================================================
// Full Lifecycle Tests
// =============================================================================

describe("OrchestratorService full lifecycle", () => {
  it("start -> reconcile -> stop works correctly", async () => {
    const { OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* OrchestratorService

        // Start
        yield* svc.start({ workerPoolSize: 3 })
        const afterStart = yield* svc.status()

        // Reconcile
        const reconcileResult = yield* svc.reconcile()

        // Stop
        yield* svc.stop(true)
        const afterStop = yield* svc.status()

        return { afterStart, reconcileResult, afterStop }
      }).pipe(Effect.provide(layer))
    )

    expect(result.afterStart.status).toBe("running")
    expect(result.afterStart.workerPoolSize).toBe(3)
    expect(result.reconcileResult.reconcileTime).toBeGreaterThanOrEqual(0)
    expect(result.afterStop.status).toBe("stopped")
  })
})
