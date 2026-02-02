import { Context, Effect } from "effect"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { DaemonError } from "../errors.js"

/**
 * Default path for the daemon PID file.
 */
export const PID_FILE_PATH = ".tx/daemon.pid"

/**
 * Status information for the daemon process.
 */
export interface DaemonStatus {
  readonly running: boolean
  readonly pid: number | null
  readonly uptime: number | null
  readonly startedAt: Date | null
}

/**
 * DaemonService manages the lifecycle of the tx daemon process.
 * The daemon runs in the background and provides:
 * - File watching for auto-sync
 * - JSONL promotion on git operations
 * - Background task processing
 *
 * See DD-015 and PRD-015 for full specification.
 */
export class DaemonService extends Context.Tag("DaemonService")<
  DaemonService,
  {
    /**
     * Start the daemon process.
     * Creates PID file at .tx/daemon.pid on success.
     */
    readonly start: () => Effect.Effect<void, DaemonError>

    /**
     * Stop the daemon process.
     * Removes PID file on success.
     */
    readonly stop: () => Effect.Effect<void, DaemonError>

    /**
     * Get the current status of the daemon.
     */
    readonly status: () => Effect.Effect<DaemonStatus, DaemonError>

    /**
     * Restart the daemon process (stop then start).
     */
    readonly restart: () => Effect.Effect<void, DaemonError>
  }
>() {}

/**
 * Check if a process with the given PID is currently running.
 * Uses kill signal 0 which doesn't actually send a signal but checks if the process exists.
 *
 * @param pid - The process ID to check
 * @returns Effect that resolves to true if the process is running, false otherwise
 */
export const isProcessRunning = (pid: number): Effect.Effect<boolean, DaemonError> =>
  Effect.try({
    try: () => {
      // Signal 0 doesn't send anything but checks if process exists
      process.kill(pid, 0)
      return true
    },
    catch: (error) => {
      // ESRCH means no such process - this is expected when process isn't running
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return false
      }
      // EPERM means process exists but we don't have permission to signal it
      // The process is still running, just owned by another user
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        return true
      }
      // Any other error is unexpected
      throw error
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new DaemonError({
          code: "PROCESS_CHECK_FAILED",
          message: `Failed to check if process ${pid} is running: ${error}`,
          pid
        })
      )
    ),
    // Flatten the nested Effect<boolean, never> from the catch block
    Effect.flatMap((result) =>
      typeof result === "boolean"
        ? Effect.succeed(result)
        : Effect.succeed(result)
    )
  )

/**
 * Write a PID to the daemon PID file.
 * Creates the .tx directory if it doesn't exist.
 *
 * @param pid - The process ID to write
 * @returns Effect that resolves to void on success
 */
export const writePid = (pid: number): Effect.Effect<void, DaemonError> =>
  Effect.try({
    try: () => {
      const dir = dirname(PID_FILE_PATH)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(PID_FILE_PATH, String(pid), "utf-8")
    },
    catch: (error) =>
      new DaemonError({
        code: "PID_WRITE_FAILED",
        message: `Failed to write PID file: ${error}`,
        pid
      })
  })

/**
 * Read the PID from the daemon PID file.
 * Returns null if the file doesn't exist.
 * Handles stale PID cleanup: if the PID file exists but the process is not running,
 * the stale PID file is automatically removed and null is returned.
 *
 * @returns Effect that resolves to the PID number, or null if no valid PID file exists
 */
export const readPid = (): Effect.Effect<number | null, DaemonError> =>
  Effect.gen(function* () {
    // Check if file exists
    if (!existsSync(PID_FILE_PATH)) {
      return null
    }

    // Read the PID file
    const content = yield* Effect.try({
      try: () => readFileSync(PID_FILE_PATH, "utf-8").trim(),
      catch: (error) =>
        new DaemonError({
          code: "PID_READ_FAILED",
          message: `Failed to read PID file: ${error}`,
          pid: null
        })
    })

    // Parse the PID
    const pid = parseInt(content, 10)
    if (isNaN(pid) || pid <= 0) {
      // Invalid PID content, remove the stale file
      yield* removePid()
      return null
    }

    // Check if the process is still running
    const running = yield* isProcessRunning(pid)
    if (!running) {
      // Process is not running, remove the stale PID file
      yield* removePid()
      return null
    }

    return pid
  })

/**
 * Remove the daemon PID file.
 * Does nothing if the file doesn't exist.
 *
 * @returns Effect that resolves to void on success
 */
export const removePid = (): Effect.Effect<void, DaemonError> =>
  Effect.try({
    try: () => {
      if (existsSync(PID_FILE_PATH)) {
        unlinkSync(PID_FILE_PATH)
      }
    },
    catch: (error) =>
      new DaemonError({
        code: "PID_REMOVE_FAILED",
        message: `Failed to remove PID file: ${error}`,
        pid: null
      })
  })
