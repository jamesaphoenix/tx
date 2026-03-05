import { Context, Effect, Layer } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
import { DaemonError } from "../errors.js"
import {
  acquirePidLock,
  PID_FILE_PATH,
  isProcessRunning,
  readPid,
  readStartedAt,
  removePid,
  removePidIfContentMatches,
  removeStartedAt,
  sendSignal,
  tryAtomicPidCreate,
  waitForExit,
  writePid,
  writeStartedAt
} from "./daemon-service/process.js"
import {
  generateLaunchdPlist,
  generateSystemdService,
  LAUNCHD_PLIST_PATH,
  SYSTEMD_SERVICE_PATH,
  type LaunchdPlistOptions,
  type SystemdServiceOptions
} from "./daemon-service/templates.js"

export {
  acquirePidLock,
  generateLaunchdPlist,
  generateSystemdService,
  isProcessRunning,
  LAUNCHD_PLIST_PATH,
  PID_FILE_PATH,
  readPid,
  removePid,
  removePidIfContentMatches,
  SYSTEMD_SERVICE_PATH,
  tryAtomicPidCreate,
  writePid
}

export type { LaunchdPlistOptions, SystemdServiceOptions }

/**
 * Status information for the daemon process.
 */
export type DaemonStatus = {
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
 * Configuration for the daemon service.
 */
export type DaemonConfig = {
  /**
   * The command to run the daemon (e.g., "tx", "node").
   * Defaults to "tx".
   */
  readonly command: string
  /**
   * Arguments to pass to the command.
   * Defaults to ["daemon", "run"].
   */
  readonly args: readonly string[]
  /**
   * Working directory for the daemon process.
   * Defaults to current working directory.
   */
  readonly cwd?: string
  /**
   * Environment variables for the daemon process.
   * Defaults to current environment.
   */
  readonly env?: NodeJS.ProcessEnv
  /**
   * Path to redirect stdout (optional).
   */
  readonly stdoutPath?: string
  /**
   * Path to redirect stderr (optional).
   */
  readonly stderrPath?: string
}

/**
 * Default daemon configuration.
 */
export const defaultDaemonConfig: DaemonConfig = {
  command: "tx",
  args: ["daemon", "run"]
}

/**
 * Spawn a daemon process and wait for it to either start successfully or fail.
 * This properly handles the async ENOENT error that spawn emits.
 *
 * Uses a settlement flag to prevent race conditions between:
 * - The synchronous PID check
 * - The 'error' event handler
 * - The setImmediate fallback
 */
const spawnDaemonProcess = (config: DaemonConfig): Promise<{ child: ChildProcess; pid: number }> =>
  new Promise((resolve, reject) => {
    // Track whether the promise has been settled to prevent double resolution/rejection
    let settled = false

    const spawnedProcess = spawn(config.command, [...config.args], {
      detached: true,
      stdio: "ignore",
      cwd: config.cwd ?? process.cwd(),
      env: config.env ?? process.env
    })

    // Handle spawn errors (like ENOENT when command doesn't exist)
    spawnedProcess.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true

      if (error.code === "ENOENT") {
        reject(new DaemonError({
          code: "COMMAND_NOT_FOUND",
          reason: `Command '${config.command}' not found. Make sure it is installed and in PATH.`,
          pid: null
        }))
      } else {
        reject(new DaemonError({
          code: "SPAWN_FAILED",
          reason: `Failed to spawn daemon process: ${error.message}`,
          pid: null
        }))
      }
    })

    // Check if we got a PID (spawn succeeded synchronously)
    if (spawnedProcess.pid !== undefined) {
      settled = true
      spawnedProcess.unref()
      resolve({ child: spawnedProcess, pid: spawnedProcess.pid })
      return
    }

    // Wait a tick for either the error event to fire or the PID to become available
    setImmediate(() => {
      if (settled) return
      settled = true

      if (spawnedProcess.pid !== undefined) {
        spawnedProcess.unref()
        resolve({ child: spawnedProcess, pid: spawnedProcess.pid })
      } else {
        // No PID and no error - reject to prevent the promise from hanging forever
        reject(new DaemonError({
          code: "SPAWN_FAILED",
          reason: "Failed to spawn daemon process: no PID was assigned",
          pid: null
        }))
      }
    })
  })

/**
 * Internal start implementation for the daemon.
 * Extracted to allow reuse in restart without circular dependency.
 *
 * Uses atomic PID file locking (O_EXCL) to prevent the TOCTOU race condition
 * where two concurrent starts could both pass the existence check.
 */
const startDaemonImpl = (config: DaemonConfig): Effect.Effect<void, DaemonError> =>
  Effect.gen(function* () {
    // Atomically acquire PID file lock (prevents TOCTOU race)
    yield* acquirePidLock()

    // Spawn the daemon process with proper error handling
    const { pid } = yield* Effect.tryPromise({
      try: () => spawnDaemonProcess(config),
      catch: (error) => {
        if (error instanceof DaemonError) {
          return error
        }
        return new DaemonError({
          code: "SPAWN_FAILED",
          reason: `Failed to spawn daemon process: ${error}`,
          pid: null
        })
      }
    }).pipe(
      // If spawn fails, clean up the lock file we acquired
      Effect.tapError(() => removePid())
    )

    // Update the lock file with the actual PID
    yield* writePid(pid)

    // Write started timestamp
    yield* writeStartedAt(new Date())

    // Wait a short time and verify process is still running
    yield* Effect.sleep("100 millis")
    const running = yield* isProcessRunning(pid)

    if (!running) {
      // Process died immediately, clean up
      yield* removePid()
      yield* removeStartedAt()
      return yield* Effect.fail(
        new DaemonError({
          code: "PROCESS_DIED",
          reason: "Daemon process exited immediately after starting",
          pid
        })
      )
    }
  })

/**
 * Internal stop implementation for the daemon.
 * Extracted to allow reuse in restart without circular dependency.
 */
const stopDaemonImpl = (): Effect.Effect<void, DaemonError> =>
  Effect.gen(function* () {
    // Read PID from file
    const pid = yield* readPid()

    if (pid === null) {
      // No daemon running (readPid handles stale cleanup)
      return
    }

    // Send SIGTERM
    const termSent = yield* sendSignal(pid, "SIGTERM")

    if (!termSent) {
      // Process already gone, clean up files
      yield* removePid()
      yield* removeStartedAt()
      return
    }

    // Wait for process to exit (timeout 10s)
    const exited = yield* waitForExit(pid, 10000)

    if (!exited) {
      // Process didn't exit gracefully, send SIGKILL
      yield* sendSignal(pid, "SIGKILL")

      // Wait a bit more for SIGKILL to take effect
      yield* waitForExit(pid, 1000)
    }

    // Clean up files
    yield* removePid()
    yield* removeStartedAt()
  })

/**
 * Internal status implementation for the daemon.
 */
const statusDaemonImpl = (): Effect.Effect<DaemonStatus, DaemonError> =>
  Effect.gen(function* () {
    const pid = yield* readPid()

    if (pid === null) {
      return {
        running: false,
        pid: null,
        uptime: null,
        startedAt: null
      } satisfies DaemonStatus
    }

    // Process is running (readPid already verified this)
    const startedAt = yield* readStartedAt()
    const uptime = startedAt ? Date.now() - startedAt.getTime() : null

    return {
      running: true,
      pid,
      uptime,
      startedAt
    } satisfies DaemonStatus
  })

/**
 * DaemonServiceLive implementation that manages a real daemon process.
 * Uses child_process.spawn with detached:true to fork the daemon.
 */
export const DaemonServiceLive = Layer.succeed(DaemonService, {
  start: () => startDaemonImpl(defaultDaemonConfig),
  stop: () => stopDaemonImpl(),
  status: () => statusDaemonImpl(),
  restart: () =>
    Effect.gen(function* () {
      // Stop if running
      yield* stopDaemonImpl()

      // Small delay before starting again
      yield* Effect.sleep("200 millis")

      // Start fresh
      yield* startDaemonImpl(defaultDaemonConfig)
    })
})

/**
 * DaemonServiceNoop - no-op implementation for testing.
 * All operations succeed but don't actually manage a process.
 */
export const DaemonServiceNoop = Layer.succeed(DaemonService, {
  start: () => Effect.void,
  stop: () => Effect.void,
  status: () =>
    Effect.succeed({
      running: false,
      pid: null,
      uptime: null,
      startedAt: null
    } satisfies DaemonStatus),
  restart: () => Effect.void
})
