import { Effect, Duration, Ref } from "effect"
import { spawn, type ChildProcess } from "child_process"
import { WorkerService } from "../worker-service.js"
import { ClaimService } from "../claim-service.js"
import type { TaskWithDeps } from "@jamesaphoenix/tx-types"

/**
 * Timeout in milliseconds to wait after SIGTERM before escalating to SIGKILL.
 * If the agent subprocess doesn't exit within this window, it will be forcefully killed.
 */
export const SIGKILL_ESCALATION_TIMEOUT_MS = 5_000

/**
 * Kill a child process with SIGTERM, escalating to SIGKILL after a timeout.
 */
export const killWithEscalation = (proc: ChildProcess): void => {
  if (proc.killed) return

  proc.kill("SIGTERM")

  const escalationTimer = setTimeout(() => {
    try {
      if (!proc.killed) {
        console.log(
          `Agent process ${proc.pid} did not exit after SIGTERM, escalating to SIGKILL`
        )
        proc.kill("SIGKILL")
      }
    } catch {
      // Process may have already exited between the check and kill call
    }
  }, SIGKILL_ESCALATION_TIMEOUT_MS)

  escalationTimer.unref()
}

/**
 * Result from an agent subprocess execution.
 */
type AgentResult = {
  readonly success: boolean
  readonly error?: string
  readonly exitCode?: number
}

/**
 * Mutable shared state for signal handler communication and heartbeat status.
 */
export type MutableWorkerState = {
  shutdownRequested: boolean
  agentProcess: ChildProcess | null
  currentStatus: "idle" | "busy"
  currentTaskId: string | undefined
}

/**
 * Run the heartbeat loop.
 * Sends periodic heartbeats to the orchestrator.
 */
export const runHeartbeatLoop = (
  workerId: string,
  intervalSeconds: number,
  state: MutableWorkerState,
  tasksCompletedRef: Ref.Ref<number>
) =>
  Effect.gen(function* () {
    const workerService = yield* WorkerService

    while (true) {
      if (state.shutdownRequested) break

      const { currentStatus, currentTaskId } = state
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
export const runLeaseRenewalLoop = (
  taskId: string,
  workerId: string,
  intervalSeconds: number,
  state: MutableWorkerState,
) =>
  Effect.gen(function* () {
    const claimService = yield* ClaimService

    while (true) {
      yield* Effect.sleep(Duration.seconds(intervalSeconds))
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
              state.shutdownRequested = true
              if (state.agentProcess) {
                killWithEscalation(state.agentProcess)
              }
              return false
            })
          )
        )

      if (!renewResult) break
    }
  })

/**
 * Run an agent subprocess to work on a task.
 */
export const runAgent = (
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

    state.agentProcess = proc

    let stderr = ""

    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      state.agentProcess = null

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
      state.agentProcess = null

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
 * Select the appropriate agent based on task characteristics.
 */
export const selectAgent = (task: TaskWithDeps): string => {
  const title = task.title.toLowerCase()

  if (
    title.includes("test") ||
    title.includes("integration") ||
    title.includes("fixture")
  ) {
    return "tx-tester"
  }

  if (
    title.includes("review") ||
    title.includes("audit") ||
    title.includes("check")
  ) {
    return "tx-reviewer"
  }

  if (task.score >= 800 && task.children.length === 0) {
    return "tx-decomposer"
  }

  return "tx-implementer"
}

/**
 * Build the prompt for the agent subprocess.
 */
const buildPrompt = (agent: string, task: TaskWithDeps): string =>
  `Read .claude/agents/${agent}.md for your instructions.

Your assigned task: ${task.id}
Task title: ${task.title}

Run \`tx show ${task.id}\` to get full details, then follow your agent instructions.
When done, run \`tx done ${task.id}\` to mark the task complete.
If you discover new work, create subtasks with \`tx add\`.
If you hit a blocker, update the task status: \`tx update ${task.id} --status blocked\`.`
