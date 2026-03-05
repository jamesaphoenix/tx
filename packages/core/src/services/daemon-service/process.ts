import { Effect } from "effect"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs"
import { dirname } from "node:path"
import { DaemonError } from "../../errors.js"

/**
 * Default path for the daemon PID file.
 */
export const PID_FILE_PATH = ".tx/daemon.pid"

/**
 * Path to store the daemon start timestamp for uptime calculation.
 */
const STARTED_AT_PATH = ".tx/daemon.started"

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
    catch: (error) => error as NodeJS.ErrnoException
  }).pipe(
    Effect.catchAll((error) => {
      // ESRCH means no such process - return false (not running) as success value
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return Effect.succeed(false)
      }
      // EPERM means process exists but we don't have permission to signal it
      // The process is still running, just owned by another user - return true as success value
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        return Effect.succeed(true)
      }
      // Any other error is unexpected - convert to DaemonError
      return Effect.fail(
        new DaemonError({
          code: "PROCESS_CHECK_FAILED",
          reason: `Failed to check if process ${pid} is running: ${error}`,
          pid
        })
      )
    })
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
        reason: `Failed to write PID file: ${error}`,
        pid
      })
  })

/**
 * Remove the PID file only if its current content matches the expected value.
 *
 * This is a compare-and-swap guard that prevents the TOCTOU race where
 * readPid()'s stale cleanup could delete a freshly-written PID file created
 * by a concurrent daemon start. Between isProcessRunning() returning false
 * and removePid() executing, a new daemon may have written a fresh PID.
 *
 * If the file no longer exists or its content has changed, this is a no-op.
 *
 * @param expectedContent - The PID file content we originally read
 * @returns Effect that resolves to void on success
 */
export const removePidIfContentMatches = (expectedContent: string): Effect.Effect<void, DaemonError> =>
  Effect.try({
    try: () => {
      if (!existsSync(PID_FILE_PATH)) {
        return
      }
      const currentContent = readFileSync(PID_FILE_PATH, "utf-8").trim()
      if (currentContent === expectedContent) {
        unlinkSync(PID_FILE_PATH)
      }
      // Content changed — a concurrent start wrote a fresh PID. Do not delete.
    },
    catch: (error) =>
      new DaemonError({
        code: "PID_REMOVE_FAILED",
        reason: `Failed to remove PID file: ${error}`,
        pid: null
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
          reason: `Failed to read PID file: ${error}`,
          pid: null
        })
    })

    // Parse the PID
    const pid = parseInt(content, 10)
    if (isNaN(pid) || pid <= 0) {
      // Invalid PID content — use CAS removal so we don't delete a fresh PID
      // written by a concurrent daemon start between our read and this removal.
      yield* removePidIfContentMatches(content)
      return null
    }

    // Check if the process is still running
    const running = yield* isProcessRunning(pid)
    if (!running) {
      // Stale PID — use CAS removal so we don't delete a fresh PID written
      // by a concurrent daemon start between isProcessRunning() and here.
      yield* removePidIfContentMatches(content)
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
        reason: `Failed to remove PID file: ${error}`,
        pid: null
      })
  })

/**
 * Write the daemon start timestamp to a file.
 */
export const writeStartedAt = (date: Date): Effect.Effect<void, DaemonError> =>
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
        reason: `Failed to write started_at file: ${error}`,
        pid: null
      })
  })

/**
 * Read the daemon start timestamp from file.
 */
export const readStartedAt = (): Effect.Effect<Date | null, DaemonError> =>
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
        reason: `Failed to read started_at file: ${error}`,
        pid: null
      })
  })

/**
 * Remove the daemon start timestamp file.
 */
export const removeStartedAt = (): Effect.Effect<void, DaemonError> =>
  Effect.try({
    try: () => {
      if (existsSync(STARTED_AT_PATH)) {
        unlinkSync(STARTED_AT_PATH)
      }
    },
    catch: (error) =>
      new DaemonError({
        code: "STARTED_AT_REMOVE_FAILED",
        reason: `Failed to remove started_at file: ${error}`,
        pid: null
      })
  })

/**
 * Send a signal to a process by PID.
 * Returns true if the signal was sent successfully, false if the process doesn't exist.
 */
export const sendSignal = (pid: number, signal: NodeJS.Signals): Effect.Effect<boolean, DaemonError> =>
  Effect.try({
    try: () => {
      process.kill(pid, signal)
      return true
    },
    catch: (error) => error as NodeJS.ErrnoException
  }).pipe(
    Effect.catchAll((error) => {
      // ESRCH means no such process - return false (not running) as success value
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return Effect.succeed(false)
      }
      // Any other error is unexpected - convert to DaemonError
      return Effect.fail(
        new DaemonError({
          code: "SIGNAL_FAILED",
          reason: `Failed to send signal ${signal} to process ${pid}: ${error}`,
          pid
        })
      )
    })
  )

/**
 * Wait for a process to exit with a timeout.
 * Returns true if the process exited, false if timeout was reached.
 */
export const waitForExit = (pid: number, timeoutMs: number): Effect.Effect<boolean, DaemonError> =>
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
 * Try to atomically create the PID file using O_EXCL.
 * Returns true if created successfully, false if the file already exists.
 * This is the atomic primitive that prevents the TOCTOU race condition.
 */
export const tryAtomicPidCreate = (): Effect.Effect<boolean, DaemonError> =>
  Effect.try({
    try: () => {
      // O_CREAT | O_EXCL | O_WRONLY — fails with EEXIST if file already exists
      const fd = openSync(PID_FILE_PATH, "wx")
      // Write the lock holder's PID so stale detection works.
      // This is the `tx daemon start` process PID, not the daemon PID.
      // After spawning, writePid() overwrites with the actual daemon PID.
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return true
    },
    catch: (error) => error as NodeJS.ErrnoException
  }).pipe(
    Effect.catchAll((error) => {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        return Effect.succeed(false)
      }
      return Effect.fail(
        new DaemonError({
          code: "PID_WRITE_FAILED",
          reason: `Failed to create PID lock file: ${error}`,
          pid: null
        })
      )
    })
  )

/**
 * Atomically acquire the daemon PID file lock.
 *
 * Uses O_EXCL flag to prevent the TOCTOU race condition where two concurrent
 * `tx daemon start` commands both pass the existence check before either writes
 * the PID file. With O_EXCL, the filesystem guarantees only one process can
 * create the file — the loser gets EEXIST immediately.
 *
 * If the file already exists, checks whether the PID is stale (process dead).
 * Stale files are removed and creation is retried once.
 */
export const acquirePidLock = (): Effect.Effect<void, DaemonError> =>
  Effect.gen(function* () {
    const dir = dirname(PID_FILE_PATH)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // First attempt: atomic file creation
    const created = yield* tryAtomicPidCreate()
    if (created) return

    // File already exists — check if the PID inside is stale
    const existingContent = yield* Effect.try({
      try: () =>
        existsSync(PID_FILE_PATH) ? readFileSync(PID_FILE_PATH, "utf-8").trim() : null,
      catch: (error) =>
        new DaemonError({
          code: "PID_READ_FAILED",
          reason: `Failed to read existing PID file: ${error}`,
          pid: null
        })
    })

    if (existingContent !== null && existingContent !== "") {
      const pid = parseInt(existingContent, 10)
      if (!isNaN(pid) && pid > 0) {
        const running = yield* isProcessRunning(pid)
        if (running) {
          return yield* Effect.fail(
            new DaemonError({
              code: "ALREADY_RUNNING",
              reason: `Daemon is already running with PID ${pid}`,
              pid
            })
          )
        }
      }
    }

    // PID file is stale — CAS removal to avoid deleting a fresh PID written
    // by a concurrent start that raced us between isProcessRunning() and here.
    if (existingContent !== null) {
      yield* removePidIfContentMatches(existingContent)
    }

    const retryCreated = yield* tryAtomicPidCreate()
    if (!retryCreated) {
      // Another process won the race after our stale cleanup
      return yield* Effect.fail(
        new DaemonError({
          code: "ALREADY_RUNNING",
          reason: "Another daemon start is in progress",
          pid: null
        })
      )
    }
  })
