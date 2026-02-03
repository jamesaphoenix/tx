/**
 * Worker Hooks - PRD-018
 *
 * Type definitions for the headless worker hooks system.
 * Two hooks. That's it. Extensible context for user customization.
 *
 * See PRD-018 "Worker Hooks (Customization Points)" section and
 * DD-018 "Worker Hooks Interface" section.
 */

import type { Task } from "@jamesaphoenix/tx-types"

/**
 * Result from executing a task.
 */
export interface ExecutionResult {
  /** Whether the execution succeeded */
  readonly success: boolean
  /** Optional output from the execution */
  readonly output?: string
  /** Error message if execution failed */
  readonly error?: string
}

/**
 * IO capture paths for run tracking.
 */
export interface IOCapture {
  /** Path to transcript file */
  readonly transcriptPath?: string
  /** Path to stderr capture file */
  readonly stderrPath?: string
  /** Path to stdout capture file */
  readonly stdoutPath?: string
}

/**
 * Context provided to the execute hook by tx.
 * Contains tx primitives and mutable state.
 */
export interface WorkerContext {
  /** ID of the worker processing this task */
  readonly workerId: string
  /** Unique ID for this run/execution */
  readonly runId: string
  /** Renew the lease on the current task to prevent expiration */
  readonly renewLease: () => Promise<void>
  /** Log a message (associated with this worker/run) */
  readonly log: (message: string) => void
  /** Mutable state that persists across calls within a single task execution */
  readonly state: Record<string, unknown>
}

/**
 * Worker hooks interface.
 * Two hooks. That's it.
 *
 * @template TContext - Custom context type merged with WorkerContext
 */
export interface WorkerHooks<TContext = object> {
  /**
   * Execute the work - YOUR logic lives here.
   * Called for each task claimed by the worker.
   *
   * @param task - The task to execute
   * @param ctx - Combined WorkerContext + your custom TContext
   * @returns ExecutionResult indicating success/failure
   */
  readonly execute: (
    task: Task,
    ctx: WorkerContext & TContext
  ) => Promise<ExecutionResult>

  /**
   * Where to capture IO (optional).
   * Called before execute to determine where to store run output.
   *
   * @param runId - The unique run ID
   * @param task - The task being executed
   * @returns IOCapture with paths for transcript/stderr/stdout
   */
  readonly captureIO?: (runId: string, task: Task) => IOCapture
}

/**
 * Configuration for runWorker().
 * Combines hooks with worker settings and custom context.
 *
 * @template TContext - Custom context type merged with WorkerContext
 */
export interface WorkerConfig<TContext = object> {
  /** Optional worker name. Defaults to auto-generated name. */
  readonly name?: string
  /** Heartbeat interval in seconds. Should match orchestrator config. Default: 30 */
  readonly heartbeatIntervalSeconds?: number
  /**
   * Your custom context - merged into ctx.
   * Use this to pass your own primitives (db clients, LLM clients, etc.)
   */
  readonly context?: TContext
  /**
   * Execute hook - YOUR logic lives here.
   * Called for each task claimed by the worker.
   */
  readonly execute: WorkerHooks<TContext>["execute"]
  /**
   * Optional IO capture hook.
   * Called before execute to determine where to store run output.
   */
  readonly captureIO?: WorkerHooks<TContext>["captureIO"]
}
