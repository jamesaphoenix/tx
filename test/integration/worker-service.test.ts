/**
 * WorkerService Integration Tests
 *
 * Tests the WorkerService with full dependency injection.
 * Uses real SQLite database (in-memory) per Rule 3.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-018 for implementation details
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureWorkerId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`worker-service-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

const FIXTURES = {
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
    WorkerRepositoryLive,
    OrchestratorStateRepositoryLive,
    OrchestratorServiceLive,
    WorkerServiceLive,
    ClaimServiceLive,
    ClaimRepositoryLive,
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

  const workerService = WorkerServiceLive.pipe(Layer.provide(repos))
  const claimService = ClaimServiceLive.pipe(Layer.provide(repos))

  const orchestratorService = OrchestratorServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, workerService, claimService))
  )

  return Layer.mergeAll(repos, workerService, claimService, orchestratorService)
}

// =============================================================================
// WorkerService.register Tests
// =============================================================================

describe("WorkerService.register", () => {
  it("registers worker when orchestrator is running and pool has capacity", async () => {
    const { WorkerService, OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService

        // Start orchestrator first
        yield* orchestrator.start({ workerPoolSize: 5 })

        // Register worker
        const worker = yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "test-worker",
          capabilities: ["tx-implementer", "tx-tester"]
        })

        return worker
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toBe(FIXTURES.WORKER_1)
    expect(result.name).toBe("test-worker")
    expect(result.status).toBe("starting")
    expect(result.capabilities).toEqual(["tx-implementer", "tx-tester"])
    expect(result.currentTaskId).toBeNull()
    expect(result.registeredAt).toBeInstanceOf(Date)
    expect(result.lastHeartbeatAt).toBeInstanceOf(Date)
  })

  it("generates worker ID if not provided", async () => {
    const { WorkerService, OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService

        yield* orchestrator.start({ workerPoolSize: 5 })
        return yield* workerSvc.register({ name: "auto-id-worker" })
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toMatch(/^worker-[a-z0-9]{8}$/)
  })

  it("fails when orchestrator is not running", async () => {
    const { WorkerService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const workerSvc = yield* WorkerService

        // Try to register without starting orchestrator
        return yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "test-worker"
        }).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("RegistrationError")
    expect((error as { reason: string }).reason).toContain("not running")
  })

  it("fails when worker pool is at capacity", async () => {
    const { WorkerService, OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService

        // Start with pool size of 1
        yield* orchestrator.start({ workerPoolSize: 1 })

        // Register first worker successfully
        yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "worker-1"
        })

        // Second registration should fail
        return yield* workerSvc.register({
          workerId: FIXTURES.WORKER_2,
          name: "worker-2"
        }).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("RegistrationError")
    expect((error as { reason: string }).reason).toContain("capacity")
  })

  it("uses default capabilities when not provided", async () => {
    const { WorkerService, OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService

        yield* orchestrator.start()
        return yield* workerSvc.register({ workerId: FIXTURES.WORKER_1 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.capabilities).toEqual(["tx-implementer"])
  })
})

// =============================================================================
// WorkerService.heartbeat Tests
// =============================================================================

describe("WorkerService.heartbeat", () => {
  it("updates worker heartbeat timestamp and status", async () => {
    const { WorkerService, OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        yield* orchestrator.start()

        // Register worker
        yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "test-worker"
        })

        // Wait a bit then send heartbeat
        const heartbeatTime = new Date()
        yield* workerSvc.heartbeat({
          workerId: FIXTURES.WORKER_1,
          timestamp: heartbeatTime,
          status: "idle"
        })

        return yield* workerRepo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("idle")
  })

  it("updates currentTaskId when provided", async () => {
    const {
      WorkerService,
      OrchestratorService,
      WorkerRepository,
      TaskRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const taskId = "tx-12345678"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start()

        // Create a task for the FK constraint
        yield* taskRepo.insert({
          id: taskId as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test task",
          description: "",
          status: "backlog",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        // Register worker
        yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "test-worker"
        })

        // Send heartbeat with currentTaskId
        yield* workerSvc.heartbeat({
          workerId: FIXTURES.WORKER_1,
          timestamp: new Date(),
          status: "busy",
          currentTaskId: taskId
        })

        return yield* workerRepo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("busy")
    expect(result!.currentTaskId).toBe(taskId)
  })

  it("stores metrics in metadata when provided", async () => {
    const { WorkerService, OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        yield* orchestrator.start()

        yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "test-worker"
        })

        yield* workerSvc.heartbeat({
          workerId: FIXTURES.WORKER_1,
          timestamp: new Date(),
          status: "idle",
          metrics: {
            cpuPercent: 25.5,
            memoryMb: 512,
            tasksCompleted: 3
          }
        })

        return yield* workerRepo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.metadata).toHaveProperty("lastMetrics")
    const metrics = (result!.metadata as { lastMetrics: { cpuPercent: number } }).lastMetrics
    expect(metrics.cpuPercent).toBe(25.5)
  })

  it("fails for nonexistent worker", async () => {
    const { WorkerService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const workerSvc = yield* WorkerService

        return yield* workerSvc.heartbeat({
          workerId: "nonexistent-worker",
          timestamp: new Date(),
          status: "idle"
        }).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("WorkerNotFoundError")
  })
})

// =============================================================================
// WorkerService.deregister Tests
// =============================================================================

describe("WorkerService.deregister", () => {
  it("removes worker from registry", async () => {
    const { WorkerService, OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        yield* orchestrator.start()

        yield* workerSvc.register({
          workerId: FIXTURES.WORKER_1,
          name: "test-worker"
        })

        yield* workerSvc.deregister(FIXTURES.WORKER_1)

        return yield* workerRepo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })

  it("fails for nonexistent worker", async () => {
    const { WorkerService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const workerSvc = yield* WorkerService
        return yield* workerSvc.deregister("nonexistent-worker").pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("WorkerNotFoundError")
  })
})

// =============================================================================
// WorkerService.list Tests
// =============================================================================

describe("WorkerService.list", () => {
  it("returns all workers when no filter provided", async () => {
    const { WorkerService, OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1, name: "worker-1" })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_2, name: "worker-2" })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_3, name: "worker-3" })

        return yield* workerSvc.list()
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(3)
  })

  it("filters by status", async () => {
    const { WorkerService, OrchestratorService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1 })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_2 })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_3 })

        // Update one to idle
        yield* workerSvc.updateStatus(FIXTURES.WORKER_1, "idle")

        return yield* workerSvc.list({ status: ["idle"] })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(FIXTURES.WORKER_1)
  })

  it("filters by noCurrentTask", async () => {
    const {
      WorkerService,
      OrchestratorService,
      TaskRepository,
      WorkerRepository
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const taskId = "tx-abcd1234"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        // Create task for FK constraint
        yield* taskRepo.insert({
          id: taskId as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test task",
          description: "",
          status: "backlog",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1 })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_2 })

        // Update one to have a current task
        yield* workerSvc.updateStatus(FIXTURES.WORKER_1, "busy")
        const worker = yield* workerRepo.findById(FIXTURES.WORKER_1)
        if (worker) {
          yield* workerRepo.update({ ...worker, currentTaskId: taskId })
        }

        return yield* workerSvc.list({ noCurrentTask: true })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(FIXTURES.WORKER_2)
  })
})

// =============================================================================
// WorkerService.findDead Tests
// =============================================================================

describe("WorkerService.findDead", () => {
  it("finds workers with stale heartbeats", async () => {
    const { WorkerService, OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        // Start with 1 second heartbeat interval for faster testing
        yield* orchestrator.start({
          workerPoolSize: 5,
          heartbeatIntervalSeconds: 1
        })

        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1 })
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_2 })

        // Make one worker stale by backdating its heartbeat
        const worker1 = yield* workerRepo.findById(FIXTURES.WORKER_1)
        if (worker1) {
          const oldTime = new Date(Date.now() - 5000) // 5 seconds ago
          yield* workerRepo.update({ ...worker1, lastHeartbeatAt: oldTime, status: "idle" })
        }

        // Keep worker2 fresh
        yield* workerSvc.updateStatus(FIXTURES.WORKER_2, "idle")

        return yield* workerSvc.findDead({ missedHeartbeats: 2 })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(FIXTURES.WORKER_1)
  })

  it("excludes workers already marked dead", async () => {
    const { WorkerService, OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        yield* orchestrator.start({
          workerPoolSize: 5,
          heartbeatIntervalSeconds: 1
        })

        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1 })

        // Make worker stale and mark as dead
        const worker1 = yield* workerRepo.findById(FIXTURES.WORKER_1)
        if (worker1) {
          const oldTime = new Date(Date.now() - 5000)
          yield* workerRepo.update({
            ...worker1,
            lastHeartbeatAt: oldTime,
            status: "dead"
          })
        }

        return yield* workerSvc.findDead({ missedHeartbeats: 2 })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(0)
  })
})

// =============================================================================
// WorkerService.markDead Tests
// =============================================================================

describe("WorkerService.markDead", () => {
  it("marks worker as dead", async () => {
    const { WorkerService, OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        yield* orchestrator.start()
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1 })
        yield* workerSvc.markDead(FIXTURES.WORKER_1)

        return yield* workerRepo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("dead")
  })

  it("fails for nonexistent worker", async () => {
    const { WorkerService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const workerSvc = yield* WorkerService
        return yield* workerSvc.markDead("nonexistent-worker").pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("WorkerNotFoundError")
  })
})

// =============================================================================
// WorkerService.updateStatus Tests
// =============================================================================

describe("WorkerService.updateStatus", () => {
  it("updates worker status", async () => {
    const { WorkerService, OrchestratorService, WorkerRepository } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const workerSvc = yield* WorkerService
        const workerRepo = yield* WorkerRepository

        yield* orchestrator.start()
        yield* workerSvc.register({ workerId: FIXTURES.WORKER_1 })

        yield* workerSvc.updateStatus(FIXTURES.WORKER_1, "idle")
        const afterIdle = yield* workerRepo.findById(FIXTURES.WORKER_1)

        yield* workerSvc.updateStatus(FIXTURES.WORKER_1, "busy")
        const afterBusy = yield* workerRepo.findById(FIXTURES.WORKER_1)

        yield* workerSvc.updateStatus(FIXTURES.WORKER_1, "stopping")
        const afterStopping = yield* workerRepo.findById(FIXTURES.WORKER_1)

        return { afterIdle, afterBusy, afterStopping }
      }).pipe(Effect.provide(layer))
    )

    expect(result.afterIdle!.status).toBe("idle")
    expect(result.afterBusy!.status).toBe("busy")
    expect(result.afterStopping!.status).toBe("stopping")
  })

  it("fails for nonexistent worker", async () => {
    const { WorkerService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const workerSvc = yield* WorkerService
        return yield* workerSvc.updateStatus("nonexistent-worker", "idle").pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("WorkerNotFoundError")
  })
})
