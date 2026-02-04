/**
 * runWorker Integration Tests
 *
 * Tests the runWorker() function with user-provided hooks.
 * Uses real SQLite database (in-memory) per Rule 3.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-018 for implementation details
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect, Layer, Fiber } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureTaskId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`run-worker-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const FIXTURES = {
  TASK_1: fixtureTaskId("task-1"),
  TASK_2: fixtureTaskId("task-2"),
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
    DependencyRepositoryLive,
    ReadyServiceLive,
    RunRepositoryLive
  } = await import("@jamesaphoenix/tx-core")

  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    WorkerRepositoryLive,
    OrchestratorStateRepositoryLive,
    ClaimRepositoryLive,
    TaskRepositoryLive,
    DependencyRepositoryLive,
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
// runWorker Basic Tests
// =============================================================================

describe("runWorker", () => {
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

  it("execute hook receives task and WorkerContext with correct properties", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    // Track what the execute hook receives
    const receivedContext = {
      workerId: "",
      runId: "",
      hasRenewLease: false,
      hasLog: false,
      hasState: false
    }

    // Run everything in a single Effect.runPromise to share the same runtime/database
    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test execute hook",
          description: "Test task for runWorker",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        // Start worker in a fiber so we can interrupt it
        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              // Capture context properties
              receivedContext.workerId = ctx.workerId
              receivedContext.runId = ctx.runId
              receivedContext.hasRenewLease = typeof ctx.renewLease === "function"
              receivedContext.hasLog = typeof ctx.log === "function"
              receivedContext.hasState = typeof ctx.state === "object"

              // Signal shutdown after this task
              process.emit("SIGTERM", "SIGTERM")

              return { success: true, output: "Test completed" }
            }
          })
        )

        // Wait a bit for the task to be processed
        yield* Effect.sleep("1 second")

        // Interrupt the worker
        yield* Fiber.interrupt(workerFiber)
      }).pipe(Effect.provide(layer))
    )

    // Verify context properties
    expect(receivedContext.workerId).toMatch(/^worker-[a-z0-9]{8}$/)
    expect(receivedContext.runId).toMatch(/^run-[a-z0-9]{8}$/)
    expect(receivedContext.hasRenewLease).toBe(true)
    expect(receivedContext.hasLog).toBe(true)
    expect(receivedContext.hasState).toBe(true)
  })

  it("execute hook receives merged custom context", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    // Custom context to merge
    interface CustomContext {
      customValue: string
      customFunction: (x: number) => number
    }

    const receivedCustomContext = {
      customValue: "",
      customFunctionResult: 0
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test custom context",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker<CustomContext>({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            context: {
              customValue: "hello-world",
              customFunction: (x) => x * 2
            },
            execute: async (_task, ctx) => {
              // Access custom context
              receivedCustomContext.customValue = ctx.customValue
              receivedCustomContext.customFunctionResult = ctx.customFunction(21)

              // Signal shutdown
              process.emit("SIGTERM", "SIGTERM")

              return { success: true }
            }
          })
        )

        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)
      }).pipe(Effect.provide(layer))
    )

    expect(receivedCustomContext.customValue).toBe("hello-world")
    expect(receivedCustomContext.customFunctionResult).toBe(42)
  })

  it("captureIO hook provides paths to run record", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      RunRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    let capturedRunId = ""
    let runRecord: any = null

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const runRepo = yield* RunRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test IO capture",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              capturedRunId = ctx.runId
              process.emit("SIGTERM", "SIGTERM")
              return { success: true }
            },
            captureIO: (runId, _task) => ({
              transcriptPath: `.tx/runs/${runId}.jsonl`,
              stderrPath: `.tx/runs/${runId}.stderr`,
              stdoutPath: `.tx/runs/${runId}.stdout`
            })
          })
        )

        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)

        // Verify run record has IO capture paths
        runRecord = yield* runRepo.findById(capturedRunId as `run-${string}`)
      }).pipe(Effect.provide(layer))
    )

    expect(runRecord).not.toBeNull()
    expect(runRecord!.transcriptPath).toBe(`.tx/runs/${capturedRunId}.jsonl`)
    expect(runRecord!.stderrPath).toBe(`.tx/runs/${capturedRunId}.stderr`)
    expect(runRecord!.stdoutPath).toBe(`.tx/runs/${capturedRunId}.stdout`)
  })

  it("creates run record with correct status on success", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      RunRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    let capturedRunId = ""
    let runRecord: any = null

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const runRepo = yield* RunRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test successful run",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              capturedRunId = ctx.runId
              process.emit("SIGTERM", "SIGTERM")
              return { success: true, output: "Task completed successfully" }
            }
          })
        )

        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)

        runRecord = yield* runRepo.findById(capturedRunId as `run-${string}`)
      }).pipe(Effect.provide(layer))
    )

    expect(runRecord).not.toBeNull()
    expect(runRecord!.status).toBe("completed")
    expect(runRecord!.exitCode).toBe(0)
    expect(runRecord!.summary).toBe("Task completed successfully")
  })

  it("creates run record with correct status on failure", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      RunRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    let capturedRunId = ""
    let runRecord: any = null

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const runRepo = yield* RunRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test failed run",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              capturedRunId = ctx.runId
              process.emit("SIGTERM", "SIGTERM")
              return { success: false, error: "Something went wrong" }
            }
          })
        )

        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)

        runRecord = yield* runRepo.findById(capturedRunId as `run-${string}`)
      }).pipe(Effect.provide(layer))
    )

    expect(runRecord).not.toBeNull()
    expect(runRecord!.status).toBe("failed")
    expect(runRecord!.exitCode).toBe(1)
    expect(runRecord!.errorMessage).toBe("Something went wrong")
  })

  it("handles thrown errors in execute hook", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      RunRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    let capturedRunId = ""
    let runRecord: any = null

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const runRepo = yield* RunRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test thrown error",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              capturedRunId = ctx.runId
              // Signal shutdown before throwing
              setTimeout(() => process.emit("SIGTERM", "SIGTERM"), 100)
              throw new Error("Execute hook threw an error")
            }
          })
        )

        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)

        runRecord = yield* runRepo.findById(capturedRunId as `run-${string}`)
      }).pipe(Effect.provide(layer))
    )

    expect(runRecord).not.toBeNull()
    expect(runRecord!.status).toBe("failed")
    expect(runRecord!.errorMessage).toBe("Execute hook threw an error")
  })

  it("ctx.log() outputs to console", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const consoleSpy = vi.spyOn(console, "log")

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test log function",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              ctx.log("Test message from execute hook")
              process.emit("SIGTERM", "SIGTERM")
              return { success: true }
            }
          })
        )

        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)
      }).pipe(Effect.provide(layer))
    )

    // Verify log was called with the test message
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Test message from execute hook"))

    consoleSpy.mockRestore()
  })

  it("ctx.state is mutable within task execution", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const stateSnapshots: Record<string, unknown>[] = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test state mutation",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              // Capture initial state
              stateSnapshots.push({ ...ctx.state })

              // Mutate state
              ctx.state.counter = 1
              stateSnapshots.push({ ...ctx.state })

              ctx.state.counter = 2
              ctx.state.message = "hello"
              stateSnapshots.push({ ...ctx.state })

              process.emit("SIGTERM", "SIGTERM")
              return { success: true }
            }
          })
        )

        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)
      }).pipe(Effect.provide(layer))
    )

    // Verify state mutations
    expect(stateSnapshots[0]).toEqual({})
    expect(stateSnapshots[1]).toEqual({ counter: 1 })
    expect(stateSnapshots[2]).toEqual({ counter: 2, message: "hello" })
  })

  it("worker registers and deregisters on shutdown", async () => {
    const {
      OrchestratorService,
      TaskRepository,
      WorkerService,
      runWorker
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    let registeredWorkerId = ""
    let workersAfterShutdown: readonly { id: string }[] = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const orchestrator = yield* OrchestratorService
        const taskRepo = yield* TaskRepository
        const workerSvc = yield* WorkerService

        yield* orchestrator.start({ workerPoolSize: 5 })

        yield* taskRepo.insert({
          id: FIXTURES.TASK_1 as Parameters<typeof taskRepo.insert>[0]["id"],
          title: "Test worker lifecycle",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        })

        const workerFiber = yield* Effect.fork(
          runWorker({
            name: "lifecycle-test-worker",
            heartbeatIntervalSeconds: 1,
            execute: async (_task, ctx) => {
              registeredWorkerId = ctx.workerId
              // Complete quickly and signal shutdown
              process.emit("SIGTERM", "SIGTERM")
              return { success: true }
            }
          })
        )

        // Wait for the worker to complete shutdown
        yield* Effect.sleep("1 second")
        yield* Fiber.interrupt(workerFiber)

        // Wait a bit more for cleanup
        yield* Effect.sleep("200 millis")

        // Check worker is deregistered after shutdown
        workersAfterShutdown = yield* workerSvc.list()
      }).pipe(Effect.provide(layer))
    )

    // The worker ran and was assigned a workerId (proves registration happened)
    expect(registeredWorkerId).toMatch(/^worker-[a-z0-9]{8}$/)
    // After shutdown, the worker should be deregistered (no longer in the list)
    expect(workersAfterShutdown.every(w => w.id !== registeredWorkerId)).toBe(true)
  })
})
