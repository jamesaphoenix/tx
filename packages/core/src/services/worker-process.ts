/**
 * WorkerProcess - PRD-018
 *
 * Implements the worker process with heartbeat fiber, lease renewal,
 * Claude subprocess management, and graceful shutdown handling.
 * Uses Effect-TS patterns per DD-002.
 */

import { Effect, Duration, Fiber, Ref, Schedule } from "effect"
import { spawn, type ChildProcess } from "child_process"
import * as os from "os"
import { WorkerService } from "./worker-service.js"
import { ClaimService } from "./claim-service.js"
import { ReadyService } from "./ready-service.js"
import { TaskService } from "./task-service.js"
import type { TaskWithDeps } from "@jamesaphoenix/tx-types"

/**
 * Configuration for the worker process.
 */
export interface WorkerProcessConfig {
  /** Optional worker name. Defaults to worker-{timestamp} */
  readonly name?: string
  /** List of agent capabilities (e.g., ['tx-implementer', 'tx-tester']) */
  readonly capabilities: readonly string[]
  /** Heartbeat interval in seconds. Should match orchestrator config. */
  readonly heartbeatIntervalSeconds: number
  /** How often to renew the lease (in seconds). Should be < lease duration. */
  readonly leaseRenewalIntervalSeconds?: number
  /** Working directory for Claude subprocess. Defaults to process.cwd() */
  readonly workingDirectory?: string
}

/**
 * Result from an agent subprocess execution.
 */
interface AgentResult {
  readonly success: boolean
  readonly error?: string
  readonly exitCode?: number
}

/**
 * Mutable shared state for signal handler communication and heartbeat status.
 *
 * Uses simple mutable variables instead of Effect Refs because:
 * 1. Signal handlers must be synchronous and minimal
 * 2. Using Effect.runSync in signal handlers violates best practices
 * 3. These variables are only accessed/mutated from the main thread
 *
 * `currentStatus` and `currentTaskId` are set explicitly by the main work loop
 * so the heartbeat fiber reports accurate status. Previously, status was inferred
 * from `claudeProcess !== null`, which was unreliable during the windows between
 * claiming a task and spawning Claude, and between Claude exiting and claim release.
 *
 * Note: tasksCompleted is NOT included here because it's only accessed
 * from Effect contexts (fibers), not signal handlers. It uses Effect.Ref
 * to properly handle concurrent access between the main work loop and
 * heartbeat fiber.
 */
interface MutableWorkerState {
  shutdownRequested: boolean
  claudeProcess: ChildProcess | null
  currentStatus: "idle" | "busy"
  currentTaskId: string | undefined
}

/**
 * Run the worker process.
 *
 * This function:
 * 1. Registers the worker with the orchestrator
 * 2. Starts a background heartbeat fiber
 * 3. Runs a work loop that claims and processes tasks
 * 4. Handles graceful shutdown via SIGTERM/SIGINT
 *
 * @param config Worker process configuration
 * @returns Effect that runs until shutdown is requested
 */
export const runWorkerProcess = (config: WorkerProcessConfig) =>
  Effect.gen(function* () {
    const workerService = yield* WorkerService
    const claimService = yield* ClaimService
    const readyService = yield* ReadyService
    const taskService = yield* TaskService

    // Mutable worker state (shared with signal handlers and heartbeat fiber via closure)
    // Using plain object instead of Effect Ref to avoid Effect.runSync in signal handlers
    const state: MutableWorkerState = {
      shutdownRequested: false,
      claudeProcess: null,
      currentStatus: "idle",
      currentTaskId: undefined
    }

    // Effect Ref for tasksCompleted counter — safe for concurrent fiber access.
    // Separate from MutableWorkerState because it's only accessed from Effect
    // contexts, never from signal handlers
    const tasksCompletedRef = yield* Ref.make(0)

    // Register with orchestrator
    const worker = yield* workerService.register({
      name: config.name,
      hostname: os.hostname(),
      pid: process.pid,
      capabilities: config.capabilities
    })

    const workerId = worker.id
    yield* Effect.log(`Worker ${workerId} registered`)

    // Set up signal handlers for graceful shutdown
    // Uses direct mutation - no Effect.runSync needed
    const handleSignal = (signal: string) => {
      console.log(`Worker ${workerId} received ${signal}`)

      // Mark shutdown as requested
      state.shutdownRequested = true

      // Try to terminate Claude subprocess if running
      if (state.claudeProcess && !state.claudeProcess.killed) {
        state.claudeProcess.kill("SIGTERM")
      }
    }

    process.on("SIGTERM", () => handleSignal("SIGTERM"))
    process.on("SIGINT", () => handleSignal("SIGINT"))

    // Heartbeat fiber - runs continuously in background
    const heartbeatFiber = yield* Effect.fork(
      runHeartbeatLoop(workerId, config.heartbeatIntervalSeconds, state, tasksCompletedRef)
    )


    try {
      // Main work loop
      while (true) {
        // Check if shutdown was requested
        if (state.shutdownRequested) {
          yield* Effect.log(`Worker ${workerId} shutting down gracefully`)
          break
        }

        // Update status to idle (both orchestrator and shared state for heartbeat)
        state.currentStatus = "idle"
        state.currentTaskId = undefined
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
            `Worker ${workerId} failed to claim task ${task.id}: ${claimResult.left._tag}`
          )
          continue
        }

        const _claim = claimResult.right
        yield* Effect.log(`Worker ${workerId} claimed task ${task.id}`)

        // Mark busy in shared state immediately so heartbeat reports correctly
        // This must happen before the heartbeat call and Claude spawn to avoid
        // the race window where heartbeat would report "idle" for a claimed task
        state.currentStatus = "busy"
        state.currentTaskId = task.id

        // Update worker status to busy with current task
        const currentTasksCompleted = yield* Ref.get(tasksCompletedRef)
        yield* workerService.heartbeat({
          workerId,
          timestamp: new Date(),
          status: "busy",
          currentTaskId: task.id,
          metrics: {
            cpuPercent: process.cpuUsage().user / 1000000,
            memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
            tasksCompleted: currentTasksCompleted
          }
        })

        // Select appropriate agent for the task
        const agent = selectAgent(task)

        // Start lease renewal fiber
        const renewalInterval =
          config.leaseRenewalIntervalSeconds ??
          config.heartbeatIntervalSeconds * 10 // Default: 10x heartbeat interval

        const renewFiber = yield* Effect.fork(
          runLeaseRenewalLoop(task.id, workerId, renewalInterval, state)
        )

        try {
          // Run Claude subprocess
          const result = yield* runClaude(
            agent,
            task,
            workerId,
            config.workingDirectory ?? process.cwd(),
            state
          )

          if (result.success) {
            // Mark task as done
            yield* taskService.update(task.id, { status: "done" })
            yield* Ref.update(tasksCompletedRef, (n) => n + 1)
            yield* Effect.log(`Task ${task.id} completed successfully`)
          } else {
            yield* Effect.log(
              `Task ${task.id} failed: ${result.error ?? "Unknown error"}`
            )
          }

          // Release the claim with retry logic
          // If release fails after retries, log and continue - reconciliation will eventually clean up
          yield* claimService.release(task.id, workerId).pipe(
            Effect.retry(
              Schedule.exponential(Duration.seconds(1)).pipe(
                Schedule.jittered,
                Schedule.compose(Schedule.recurs(3))
              )
            ),
            Effect.catchAll((error) =>
              Effect.log(
                `Failed to release claim for task ${task.id} after retries: ${error.message}`
              )
            )
          )
        } finally {
          // Stop renewal fiber
          yield* Fiber.interrupt(renewFiber)
        }
      }

      // Graceful shutdown: mark as stopping
      yield* workerService.updateStatus(workerId, "stopping")
    } finally {
      // Cleanup: stop heartbeat fiber and deregister
      yield* Fiber.interrupt(heartbeatFiber)

      // Release any active claims before deregistering
      yield* claimService.releaseByWorker(workerId).pipe(
        Effect.catchAll((error) =>
          Effect.log(
            `Failed to release claims for worker ${workerId}: ${error.message}`
          ).pipe(Effect.as(0))
        )
      )

      yield* workerService.deregister(workerId).pipe(
        Effect.catchAll((error) =>
          Effect.log(`Failed to deregister worker ${workerId}: ${error.message}`)
        )
      )

      yield* Effect.log(`Worker ${workerId} shutdown complete`)
    }
  })

/**
 * Run the heartbeat loop.
 * Sends periodic heartbeats to the orchestrator.
 */
const runHeartbeatLoop = (
  workerId: string,
  intervalSeconds: number,
  state: MutableWorkerState,
  tasksCompletedRef: Ref.Ref<number>
) =>
  Effect.gen(function* () {
    const workerService = yield* WorkerService

    while (true) {
      // Check shutdown before heartbeat
      if (state.shutdownRequested) break

      // Read status from shared state (set explicitly by the main work loop)
      const { currentStatus, currentTaskId } = state

      // Read tasksCompleted from Ref (safe concurrent access)
      const tasksCompleted = yield* Ref.get(tasksCompletedRef)

      yield* workerService
        .heartbeat({
          workerId,
          timestamp: new Date(),
          status: currentStatus,
          currentTaskId,
          metrics: {
            cpuPercent: process.cpuUsage().user / 1000000,
            memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
            tasksCompleted
          }
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.log(`Heartbeat failed for ${workerId}: ${error.message}`)
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
  state: MutableWorkerState,
) =>
  Effect.gen(function* () {
    const claimService = yield* ClaimService

    while (true) {
      // Wait before first renewal
      yield* Effect.sleep(Duration.seconds(intervalSeconds))

      // Check shutdown before renewal
      if (state.shutdownRequested) break

      const renewResult = yield* claimService
        .renew(taskId, workerId)
        .pipe(
          Effect.tap(() => Effect.log(`Renewed lease on task ${taskId}`)),
          Effect.map(() => true),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Effect.log(
                `CRITICAL: Lease renewal failed for task ${taskId}: ${error.message}. Stopping worker to prevent duplicate execution.`
              )
              // Stop the worker to prevent duplicate task execution
              // Another worker may have claimed this task after lease expiry
              state.shutdownRequested = true
              // Kill Claude subprocess if running
              if (state.claudeProcess && !state.claudeProcess.killed) {
                state.claudeProcess.kill("SIGTERM")
              }
              return false
            })
          )
        )

      // Exit renewal loop if renewal failed
      if (!renewResult) break
    }
  })

/**
 * Run a Claude subprocess to work on a task.
 *
 * Uses direct mutation on state object instead of Effect.runSync
 * because this function uses Effect.async with process event callbacks.
 */
const runClaude = (
  agent: string,
  task: TaskWithDeps,
  workerId: string,
  workingDirectory: string,
  state: MutableWorkerState,
): Effect.Effect<AgentResult, never> =>
  Effect.async((resume) => {
    const prompt = buildPrompt(agent, task)

    const proc = spawn(
      "claude",
      ["--dangerously-skip-permissions", "--print", prompt],
      {
        cwd: workingDirectory,
        env: { ...process.env, TX_WORKER_ID: workerId },
        stdio: ["pipe", "pipe", "pipe"]
      }
    )

    // Store the process reference for signal handling (direct mutation)
    state.claudeProcess = proc

    let stderr = ""

    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      // Clear the process reference (direct mutation)
      state.claudeProcess = null

      if (code === 0) {
        resume(Effect.succeed({ success: true, exitCode: code ?? 0 }))
      } else {
        resume(
          Effect.succeed({
            success: false,
            error: stderr || `Exit code ${code}`,
            exitCode: code ?? 1
          })
        )
      }
    })

    proc.on("error", (err) => {
      // Clear the process reference (direct mutation)
      state.claudeProcess = null

      resume(
        Effect.succeed({
          success: false,
          error: err.message,
          exitCode: 1
        })
      )
    })
  })

/**
 * Build the prompt for the Claude subprocess.
 */
const buildPrompt = (agent: string, task: TaskWithDeps): string =>
  `Read .claude/agents/${agent}.md for your instructions.

Your assigned task: ${task.id}
Task title: ${task.title}

Run \`tx show ${task.id}\` to get full details, then follow your agent instructions.
When done, run \`tx done ${task.id}\` to mark the task complete.
If you discover new work, create subtasks with \`tx add\`.
If you hit a blocker, update the task status: \`tx update ${task.id} --status blocked\`.`

/**
 * Select the appropriate agent based on task characteristics.
 */
const selectAgent = (task: TaskWithDeps): string => {
  const title = task.title.toLowerCase()

  // Test/integration tasks go to tester
  if (
    title.includes("test") ||
    title.includes("integration") ||
    title.includes("fixture")
  ) {
    return "tx-tester"
  }

  // Review/audit tasks go to reviewer
  if (
    title.includes("review") ||
    title.includes("audit") ||
    title.includes("check")
  ) {
    return "tx-reviewer"
  }

  // High-priority tasks without children may need decomposition
  if (task.score >= 800 && task.children.length === 0) {
    return "tx-decomposer"
  }

  // Default to implementer
  return "tx-implementer"
}
