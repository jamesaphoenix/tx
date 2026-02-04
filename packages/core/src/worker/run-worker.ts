/**
 * runWorker - PRD-018
 *
 * Headless worker that executes tasks using user-provided hooks.
 * Two hooks: execute (required), captureIO (optional).
 * Extensible context for user customization.
 *
 * See PRD-018 "Worker Hooks (Customization Points)" section and
 * DD-018 "Headless Worker Design" section.
 */

import { Effect, Duration, Fiber, Ref } from "effect"
import * as os from "os"
import { WorkerService } from "../services/worker-service.js"
import { ClaimService } from "../services/claim-service.js"
import { ReadyService } from "../services/ready-service.js"
import { RunRepository } from "../repo/run-repo.js"
import type { WorkerConfig, WorkerContext, ExecutionResult, IOCapture } from "./hooks.js"
import type { Task } from "@jamesaphoenix/tx-types"

/**
 * Default heartbeat interval in seconds.
 */
const DEFAULT_HEARTBEAT_INTERVAL = 30

/**
 * Default lease renewal interval multiplier (10x heartbeat = 5 minutes at default).
 */
const LEASE_RENEWAL_MULTIPLIER = 10

/**
 * Internal shutdown state shared between signal handlers and worker loop.
 */
interface ShutdownState {
  readonly requested: boolean
}

/**
 * Run a headless worker that executes tasks using user-provided hooks.
 *
 * This function:
 * 1. Registers the worker with the orchestrator
 * 2. Starts a background heartbeat fiber
 * 3. Runs a work loop that claims and processes tasks
 * 4. Calls user's execute hook for each task with merged context
 * 5. Creates run records with optional IO capture
 * 6. Handles graceful shutdown via SIGTERM/SIGINT
 *
 * @template TContext - Custom context type merged with WorkerContext
 * @param config - Worker configuration with hooks and optional custom context
 * @returns Effect that runs until shutdown is requested
 */
export const runWorker = <TContext = object>(
  config: WorkerConfig<TContext>
) =>
  Effect.gen(function* () {
    const workerService = yield* WorkerService
    const claimService = yield* ClaimService
    const readyService = yield* ReadyService
    const runRepo = yield* RunRepository

    const heartbeatInterval = config.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL

    // Shutdown state ref (mutable, shared with signal handlers)
    const shutdownState = yield* Ref.make<ShutdownState>({
      requested: false
    })

    // Register with orchestrator
    const worker = yield* workerService.register({
      name: config.name,
      hostname: os.hostname(),
      pid: process.pid
    })

    const workerId = worker.id
    yield* Effect.log(`runWorker: Worker ${workerId} registered`)

    // Set up signal handlers for graceful shutdown
    const handleSignal = (signal: string) => {
      console.log(`runWorker: Worker ${workerId} received ${signal}`)

      // Mark shutdown as requested (sync since signal handlers can't use async)
      Effect.runSync(
        Ref.update(shutdownState, (state) => ({
          ...state,
          requested: true
        }))
      )
    }

    process.on("SIGTERM", () => handleSignal("SIGTERM"))
    process.on("SIGINT", () => handleSignal("SIGINT"))

    // Completed tasks counter for metrics
    const tasksCompletedRef = yield* Ref.make(0)

    // Heartbeat fiber - runs continuously in background
    const heartbeatFiber = yield* Effect.fork(
      runHeartbeatLoop(workerId, heartbeatInterval, shutdownState, tasksCompletedRef)
    )

    try {
      // Main work loop
      while (true) {
        // Check if shutdown was requested
        const state = yield* Ref.get(shutdownState)
        if (state.requested) {
          yield* Effect.log(`runWorker: Worker ${workerId} shutting down gracefully`)
          break
        }

        // Update status to idle
        yield* workerService.updateStatus(workerId, "idle")

        // Check for available work
        const readyTasks = yield* readyService.getReady(1)

        if (readyTasks.length === 0) {
          // No work available, wait and try again
          yield* Effect.sleep(Duration.seconds(5))
          continue
        }

        const task = readyTasks[0]

        // Try to claim the task
        const claimResult = yield* claimService.claim(task.id, workerId).pipe(
          Effect.either
        )

        if (claimResult._tag === "Left") {
          // Someone else claimed it, try again
          yield* Effect.log(
            `runWorker: Worker ${workerId} failed to claim task ${task.id}: ${claimResult.left._tag}`
          )
          continue
        }

        yield* Effect.log(`runWorker: Worker ${workerId} claimed task ${task.id}`)

        // Create run record (this generates the run ID)
        const runRecord = yield* runRepo.create({
          taskId: task.id,
          agent: workerId,
          pid: process.pid
        })

        const runId = runRecord.id

        // Get IO capture paths from user's hook if provided
        const ioCapture: IOCapture = config.captureIO?.(runId, task as Task) ?? {}

        // Update run record with IO paths if provided
        if (ioCapture.transcriptPath || ioCapture.stderrPath || ioCapture.stdoutPath) {
          yield* runRepo.update(runId, {
            transcriptPath: ioCapture.transcriptPath,
            stderrPath: ioCapture.stderrPath,
            stdoutPath: ioCapture.stdoutPath
          })
        }

        // Update worker status to busy
        const tasksCompleted = yield* Ref.get(tasksCompletedRef)
        yield* workerService.heartbeat({
          workerId,
          timestamp: new Date(),
          status: "busy",
          currentTaskId: task.id,
          metrics: {
            cpuPercent: process.cpuUsage().user / 1000000,
            memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
            tasksCompleted
          }
        })

        // Start lease renewal fiber
        const renewalInterval = heartbeatInterval * LEASE_RENEWAL_MULTIPLIER
        const renewFiber = yield* Effect.fork(
          runLeaseRenewalLoop(task.id, workerId, renewalInterval, shutdownState)
        )

        // Build worker context with tx primitives
        const baseContext: WorkerContext = {
          workerId,
          runId,
          renewLease: async () => {
            await Effect.runPromise(
              claimService.renew(task.id, workerId).pipe(
                Effect.catchAll((error) => {
                  console.error(`runWorker: renewLease failed: ${error._tag}`)
                  return Effect.void
                })
              )
            )
          },
          log: (message: string) => {
            console.log(`[${workerId}] ${message}`)
          },
          state: {}
        }

        // Merge user's custom context
        const mergedContext = {
          ...baseContext,
          ...(config.context ?? {})
        } as WorkerContext & TContext

        let result: ExecutionResult

        try {
          // USER HOOK: Execute (all your logic here)
          // Use Effect.tryPromise to properly handle the async execute hook
          result = yield* Effect.tryPromise({
            try: () => config.execute(task as Task, mergedContext),
            catch: (error) => error
          }).pipe(
            Effect.catchAll((error) => {
              const errorMessage = error instanceof Error ? error.message : String(error)
              return Effect.succeed<ExecutionResult>({
                success: false,
                error: errorMessage
              })
            })
          )

          // Update run status based on result
          yield* runRepo.update(runId, {
            status: result.success ? "completed" : "failed",
            endedAt: new Date(),
            exitCode: result.success ? 0 : 1,
            summary: result.output,
            errorMessage: result.error
          })

          if (result.success) {
            yield* Ref.update(tasksCompletedRef, (n) => n + 1)
            yield* Effect.log(`runWorker: Task ${task.id} completed successfully`)
          } else {
            yield* Effect.log(`runWorker: Task ${task.id} failed: ${result.error ?? "Unknown error"}`)
          }
        } finally {
          // Stop renewal fiber
          yield* Fiber.interrupt(renewFiber)
        }

        // Release the claim
        yield* claimService.release(task.id, workerId).pipe(
          Effect.catchAll((error) =>
            Effect.log(`runWorker: Failed to release claim for task ${task.id}: ${error.message}`)
          )
        )
      }

      // Graceful shutdown: mark as stopping
      yield* workerService.updateStatus(workerId, "stopping")
    } finally {
      // Cleanup: stop heartbeat fiber and deregister
      yield* Fiber.interrupt(heartbeatFiber)

      // Release any active claims before deregistering
      yield* claimService.releaseByWorker(workerId).pipe(
        Effect.catchAll((error) =>
          Effect.log(`runWorker: Failed to release claims for worker ${workerId}: ${error.message}`).pipe(
            Effect.as(0)
          )
        )
      )

      yield* workerService.deregister(workerId).pipe(
        Effect.catchAll((error) =>
          Effect.log(`runWorker: Failed to deregister worker ${workerId}: ${error.message}`)
        )
      )

      yield* Effect.log(`runWorker: Worker ${workerId} shutdown complete`)
    }
  })

/**
 * Run the heartbeat loop.
 * Sends periodic heartbeats to the orchestrator.
 */
const runHeartbeatLoop = (
  workerId: string,
  intervalSeconds: number,
  shutdownState: Ref.Ref<ShutdownState>,
  tasksCompletedRef: Ref.Ref<number>
) =>
  Effect.gen(function* () {
    const workerService = yield* WorkerService

    while (true) {
      // Check shutdown before heartbeat
      const state = yield* Ref.get(shutdownState)
      if (state.requested) break

      const tasksCompleted = yield* Ref.get(tasksCompletedRef)

      yield* workerService
        .heartbeat({
          workerId,
          timestamp: new Date(),
          status: "idle", // Will be updated by main loop when busy
          currentTaskId: undefined,
          metrics: {
            cpuPercent: process.cpuUsage().user / 1000000,
            memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
            tasksCompleted
          }
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.log(`runWorker: Heartbeat failed for ${workerId}: ${error.message}`)
          )
        )

      yield* Effect.sleep(Duration.seconds(intervalSeconds))
    }
  })

/**
 * Run the lease renewal loop.
 * Periodically renews the lease on a claimed task.
 */
const runLeaseRenewalLoop = (
  taskId: string,
  workerId: string,
  intervalSeconds: number,
  shutdownState: Ref.Ref<ShutdownState>
) =>
  Effect.gen(function* () {
    const claimService = yield* ClaimService

    while (true) {
      // Wait before first renewal
      yield* Effect.sleep(Duration.seconds(intervalSeconds))

      // Check shutdown before renewal
      const state = yield* Ref.get(shutdownState)
      if (state.requested) break

      const renewResult = yield* claimService
        .renew(taskId, workerId)
        .pipe(
          Effect.tap(() => Effect.log(`runWorker: Renewed lease on task ${taskId}`)),
          Effect.map(() => true),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Effect.log(
                `runWorker: CRITICAL: Lease renewal failed for task ${taskId}: ${error.message}. Stopping worker to prevent duplicate execution.`
              )
              // Stop the worker to prevent duplicate task execution
              // Another worker may have claimed this task after lease expiry
              yield* Ref.update(shutdownState, (state) => ({
                ...state,
                requested: true
              }))
              return false
            })
          )
        )

      // Exit renewal loop if renewal failed
      if (!renewResult) break
    }
  })
