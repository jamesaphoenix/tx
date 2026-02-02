import { Context, Effect, Layer } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { DaemonError } from "../errors.js"

/**
 * Default path for the daemon PID file.
 */
export const PID_FILE_PATH = ".tx/daemon.pid"

/**
 * Default install path for the launchd plist file.
 * Located in the user's LaunchAgents directory for per-user daemons.
 */
export const LAUNCHD_PLIST_PATH = "~/Library/LaunchAgents/com.tx.daemon.plist"

/**
 * Default install path for the systemd service file.
 * Located in the user's systemd user directory for per-user services.
 */
export const SYSTEMD_SERVICE_PATH = "~/.config/systemd/user/tx-daemon.service"

/**
 * Options for generating a launchd plist file.
 */
export interface LaunchdPlistOptions {
  /**
   * The label for the launchd job (e.g., "com.tx.daemon").
   * This must be unique among all launchd jobs.
   */
  readonly label: string
  /**
   * The absolute path to the executable to run.
   */
  readonly executablePath: string
  /**
   * Optional path for log output (both stdout and stderr).
   * If not provided, defaults to ~/Library/Logs/tx-daemon.log
   */
  readonly logPath?: string
}

/**
 * Generate a macOS launchd plist file content.
 * Creates a valid XML plist that can be used with launchctl to run the daemon.
 *
 * The generated plist configures the daemon to:
 * - Run at load (start when user logs in)
 * - Keep alive (restart if it crashes)
 * - Log stdout and stderr to the specified log path
 *
 * @param options - Configuration options for the plist
 * @returns The XML content for the launchd plist file
 *
 * @example
 * ```typescript
 * const plist = generateLaunchdPlist({
 *   label: "com.tx.daemon",
 *   executablePath: "/usr/local/bin/tx",
 *   logPath: "~/Library/Logs/tx-daemon.log"
 * })
 * ```
 */
export const generateLaunchdPlist = (options: LaunchdPlistOptions): string => {
  const { label, executablePath, logPath } = options

  // Expand ~ to home directory for the log path
  const resolvedLogPath = logPath
    ? logPath.replace(/^~/, homedir())
    : join(homedir(), "Library", "Logs", "tx-daemon.log")

  // Generate valid XML plist
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(executablePath)}</string>
        <string>daemon</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(resolvedLogPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(resolvedLogPath)}</string>
</dict>
</plist>
`
}

/**
 * Escape special characters for XML content.
 */
const escapeXml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

/**
 * Options for generating a systemd service file.
 */
export interface SystemdServiceOptions {
  /**
   * The absolute path to the executable to run.
   */
  readonly executablePath: string
  /**
   * Optional user to run the service as.
   * If not provided, the service runs as the current user (for user services).
   */
  readonly user?: string
}

/**
 * Generate a Linux systemd service file content.
 * Creates a valid systemd unit file for a user service.
 *
 * The generated service file configures the daemon to:
 * - Start after the network is available
 * - Run as Type=simple (foreground process)
 * - Restart always on failure with 5 second delay
 * - Be enabled for multi-user target
 *
 * @param options - Configuration options for the service file
 * @returns The content for the systemd service file
 *
 * @example
 * ```typescript
 * const service = generateSystemdService({
 *   executablePath: "/usr/local/bin/tx",
 *   user: "myuser"
 * })
 * ```
 */
export const generateSystemdService = (options: SystemdServiceOptions): string => {
  const { executablePath, user } = options

  // Build the [Service] section lines
  const serviceLines = [
    "Type=simple",
    `ExecStart=${executablePath} daemon run`,
    "Restart=always",
    "RestartSec=5"
  ]

  // Add User= directive only if user is provided
  if (user) {
    serviceLines.push(`User=${user}`)
  }

  return `[Unit]
Description=tx Daemon - Task and memory management for AI agents
After=network.target

[Service]
${serviceLines.join("\n")}

[Install]
WantedBy=default.target
`
}

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

/**
 * Path to store the daemon start timestamp for uptime calculation.
 */
const STARTED_AT_PATH = ".tx/daemon.started"

/**
 * Write the daemon start timestamp to a file.
 */
const writeStartedAt = (date: Date): Effect.Effect<void, DaemonError> =>
  Effect.try({
    try: () => {
      const dir = dirname(STARTED_AT_PATH)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(STARTED_AT_PATH, date.toISOString(), "utf-8")
    },
    catch: (error) =>
      new DaemonError({
        code: "STARTED_AT_WRITE_FAILED",
        message: `Failed to write started_at file: ${error}`,
        pid: null
      })
  })

/**
 * Read the daemon start timestamp from file.
 */
const readStartedAt = (): Effect.Effect<Date | null, DaemonError> =>
  Effect.try({
    try: () => {
      if (!existsSync(STARTED_AT_PATH)) {
        return null
      }
      const content = readFileSync(STARTED_AT_PATH, "utf-8").trim()
      const date = new Date(content)
      return isNaN(date.getTime()) ? null : date
    },
    catch: (error) =>
      new DaemonError({
        code: "STARTED_AT_READ_FAILED",
        message: `Failed to read started_at file: ${error}`,
        pid: null
      })
  })

/**
 * Remove the daemon start timestamp file.
 */
const removeStartedAt = (): Effect.Effect<void, DaemonError> =>
  Effect.try({
    try: () => {
      if (existsSync(STARTED_AT_PATH)) {
        unlinkSync(STARTED_AT_PATH)
      }
    },
    catch: (error) =>
      new DaemonError({
        code: "STARTED_AT_REMOVE_FAILED",
        message: `Failed to remove started_at file: ${error}`,
        pid: null
      })
  })

/**
 * Send a signal to a process by PID.
 * Returns true if the signal was sent successfully, false if the process doesn't exist.
 */
const sendSignal = (pid: number, signal: NodeJS.Signals): Effect.Effect<boolean, DaemonError> =>
  Effect.try({
    try: () => {
      process.kill(pid, signal)
      return true
    },
    catch: (error) => {
      // ESRCH means no such process - this is expected when process isn't running
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return false
      }
      // Any other error is unexpected
      throw error
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new DaemonError({
          code: "SIGNAL_FAILED",
          message: `Failed to send signal ${signal} to process ${pid}: ${error}`,
          pid
        })
      )
    ),
    Effect.flatMap((result) =>
      typeof result === "boolean" ? Effect.succeed(result) : Effect.succeed(result)
    )
  )

/**
 * Wait for a process to exit with a timeout.
 * Returns true if the process exited, false if timeout was reached.
 */
const waitForExit = (pid: number, timeoutMs: number): Effect.Effect<boolean, DaemonError> =>
  Effect.gen(function* () {
    const startTime = Date.now()
    const pollIntervalMs = 100

    while (Date.now() - startTime < timeoutMs) {
      const running = yield* isProcessRunning(pid)
      if (!running) {
        return true
      }
      yield* Effect.sleep(`${pollIntervalMs} millis`)
    }

    return false
  })

/**
 * Configuration for the daemon service.
 */
export interface DaemonConfig {
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
 * Internal start implementation for the daemon.
 * Extracted to allow reuse in restart without circular dependency.
 */
const startDaemonImpl = (config: DaemonConfig): Effect.Effect<void, DaemonError> =>
  Effect.gen(function* () {
    // Check if daemon is already running
    const existingPid = yield* readPid()
    if (existingPid !== null) {
      return yield* Effect.fail(
        new DaemonError({
          code: "ALREADY_RUNNING",
          message: `Daemon is already running with PID ${existingPid}`,
          pid: existingPid
        })
      )
    }

    // Spawn the daemon process
    const child: ChildProcess = yield* Effect.try({
      try: () => {
        const spawnedProcess = spawn(config.command, [...config.args], {
          detached: true,
          stdio: "ignore",
          cwd: config.cwd ?? process.cwd(),
          env: config.env ?? process.env
        })

        // Unref to allow parent to exit independently
        spawnedProcess.unref()

        return spawnedProcess
      },
      catch: (error) =>
        new DaemonError({
          code: "SPAWN_FAILED",
          message: `Failed to spawn daemon process: ${error}`,
          pid: null
        })
    })

    // Verify we got a PID
    if (child.pid === undefined) {
      return yield* Effect.fail(
        new DaemonError({
          code: "NO_PID",
          message: "Spawned process has no PID",
          pid: null
        })
      )
    }

    const pid = child.pid

    // Write PID file
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
          message: "Daemon process exited immediately after starting",
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
