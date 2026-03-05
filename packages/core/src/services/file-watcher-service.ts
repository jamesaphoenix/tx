import { Context, Effect, Layer, Queue } from "effect"
import {
  FileWatcherError,
  WatcherAlreadyRunningError,
  WatcherNotRunningError
} from "../errors.js"
import {
  expandTilde,
  extractBaseDir,
  matchesPattern,
  type FileEvent,
  type FileEventType,
  type FileWatcherConfig,
  type FileWatcherState,
  type FileWatcherStatus,
} from "./file-watcher-service/shared.js"
export type {
  FileEventType,
  FileEvent,
  FileWatcherConfig,
  FileWatcherStatus,
} from "./file-watcher-service/shared.js"

/**
 * FileWatcherService watches file system paths and emits events when files are
 * added, changed, or deleted. Events are delivered via an Effect Queue for
 * decoupled, backpressure-aware processing.
 *
 * Used by the telemetry daemon to watch Claude Code transcript files
 * (~/.claude/projects/** /*.jsonl) and trigger the learning extraction pipeline.
 *
 * See DD-015 for the full architecture.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const watcher = yield* FileWatcherService
 *   const eventQueue = yield* watcher.getEventQueue()
 *
 *   // Start watching
 *   yield* watcher.start({
 *     patterns: ["~/.claude/projects/** /*.jsonl"],
 *     debounceMs: 2000
 *   })
 *
 *   // Process events
 *   while (true) {
 *     const event = yield* Queue.take(eventQueue)
 *     yield* Effect.log(`File ${event.type}: ${event.path}`)
 *   }
 * })
 * ```
 */
export class FileWatcherService extends Context.Tag("FileWatcherService")<
  FileWatcherService,
  {
    /**
     * Start watching files matching the configured patterns.
     * Emits FileEvent objects to the event queue.
     *
     * @param config - Configuration options for the watcher
     * @returns Effect that resolves when the watcher is started
     * @throws WatcherAlreadyRunningError if the watcher is already running
     * @throws FileWatcherError if the watcher fails to start
     */
    readonly start: (
      config: FileWatcherConfig
    ) => Effect.Effect<void, WatcherAlreadyRunningError | FileWatcherError>

    /**
     * Stop watching files and clean up resources.
     *
     * @returns Effect that resolves when the watcher is stopped
     * @throws WatcherNotRunningError if the watcher is not running
     * @throws FileWatcherError if the watcher fails to stop cleanly
     */
    readonly stop: () => Effect.Effect<void, WatcherNotRunningError | FileWatcherError>

    /**
     * Check if the watcher is currently running.
     *
     * @returns Effect that resolves to true if running, false otherwise
     */
    readonly isRunning: () => Effect.Effect<boolean>

    /**
     * Get the paths/patterns currently being watched.
     * Returns an empty array if the watcher is not running.
     *
     * @returns Effect that resolves to the list of watched paths
     */
    readonly getWatchedPaths: () => Effect.Effect<readonly string[]>

    /**
     * Get the event queue for receiving file events.
     * Consumers should take events from this queue to process file changes.
     * The queue is unbounded to avoid blocking the watcher.
     *
     * @returns Effect that resolves to the file event queue
     */
    readonly getEventQueue: () => Effect.Effect<Queue.Queue<FileEvent>>

    /**
     * Get the current status of the file watcher.
     *
     * @returns Effect that resolves to the watcher status
     */
    readonly status: () => Effect.Effect<FileWatcherStatus>
  }
>() {}

/**
 * No-op implementation for testing or when file watching is disabled.
 * All operations succeed but no actual watching occurs.
 */
export const FileWatcherServiceNoop = Layer.scoped(
  FileWatcherService,
  Effect.gen(function* () {
    // Create a dummy queue that will never receive events
    const eventQueue = yield* Queue.unbounded<FileEvent>()

    return {
      start: () => Effect.void,
      stop: () => Effect.void,
      isRunning: () => Effect.succeed(false),
      getWatchedPaths: () => Effect.succeed([]),
      getEventQueue: () => Effect.succeed(eventQueue),
      status: () =>
        Effect.succeed({
          running: false,
          watchedPaths: [],
          startedAt: null,
          eventsProcessed: 0
        } satisfies FileWatcherStatus)
    }
  })
)

/**
 * Live implementation of FileWatcherService using chokidar.
 *
 * Features:
 * - Uses chokidar for cross-platform file watching
 * - awaitWriteFinish with 2000ms debounce for chunked writes
 * - persistent mode to keep process running
 * - ignoreInitial: false to emit events for existing files
 * - Effect Queue for backpressure-aware event buffering
 * - Supports glob patterns (expands ~ and extracts base directories)
 */
export const FileWatcherServiceLive = Layer.scoped(
  FileWatcherService,
  Effect.gen(function* () {
    const chokidar = yield* Effect.tryPromise({
      try: () => import("chokidar"),
      catch: (error) =>
        new FileWatcherError({
          reason: "Failed to import chokidar",
          cause: error
        })
    })

    // Create the event queue for delivering file events
    const eventQueue = yield* Queue.unbounded<FileEvent>()

    // Mutable state using Effect Ref
    const stateRef = yield* Effect.sync(() => ({
      current: {
        running: false,
        watcher: null,
        watchedPaths: [],
        startedAt: null,
        eventsProcessed: 0,
        debounceTimers: new Map()
      } as FileWatcherState
    }))

    const getState = () => stateRef.current
    const setState = (updater: (s: FileWatcherState) => FileWatcherState) => {
      stateRef.current = updater(stateRef.current)
    }

    // Flag to prevent creating new debounce timers after stop/finalize.
    // Prevents race condition where chokidar fires events during shutdown.
    let stopped = false

    // Cleanup on scope finalization
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        stopped = true
        const state = getState()
        // Clear all pending debounce timers
        for (const timer of state.debounceTimers.values()) {
          clearTimeout(timer)
        }
        if (state.watcher) {
          yield* Effect.tryPromise({
            try: () => state.watcher!.close(),
            catch: () => new Error("cleanup") // Error will be ignored
          }).pipe(Effect.ignore)
        }
      })
    )

    const start = (
      config: FileWatcherConfig
    ): Effect.Effect<void, WatcherAlreadyRunningError | FileWatcherError> =>
      Effect.gen(function* () {
        const state = getState()

        if (state.running) {
          return yield* Effect.fail(
            new WatcherAlreadyRunningError({
              path: state.watchedPaths.join(", ")
            })
          )
        }

        // Reset shutdown flag for new watcher instance
        stopped = false

        // Extract base directories from glob patterns
        const expandedPaths = config.patterns.map((p) => expandTilde(p))
        const baseDirs = [...new Set(config.patterns.map(extractBaseDir))]

        // Store original patterns for filtering
        const originalPatterns = config.patterns

        // Configure chokidar options
        const debounceMs = config.debounceMs ?? 2000
        const watcherOptions: import("chokidar").ChokidarOptions = {
          persistent: true,
          ignoreInitial: config.ignoreInitial ?? false,
          awaitWriteFinish: {
            stabilityThreshold: debounceMs,
            pollInterval: Math.min(100, debounceMs / 10)
          },
          // Use polling interval if specified
          ...(config.pollInterval && {
            usePolling: true,
            interval: config.pollInterval
          })
        }

        // Create the watcher
        const watcher = yield* Effect.try({
          try: () => chokidar.watch(baseDirs, watcherOptions),
          catch: (error) =>
            new FileWatcherError({
              reason: "Failed to create chokidar watcher",
              cause: error
            })
        })

        // Per-path debounce timers to coalesce rapid events for the same file.
        // When multiple events fire for the same path within debounceMs, only
        // the last event is emitted. This prevents duplicate processing when
        // files are written incrementally (e.g., JSONL appends).
        const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

        const emitEvent = (type: FileEventType, filePath: string): void => {
          const event: FileEvent = {
            type,
            path: filePath,
            timestamp: new Date()
          }

          // Offer event to queue (non-blocking)
          Effect.runFork(
            Queue.offer(eventQueue, event).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  setState((s) => ({ ...s, eventsProcessed: s.eventsProcessed + 1 }))
                })
              )
            )
          )
        }

        // Set up event handlers with per-path debouncing
        const handleEvent = (type: FileEventType, filePath: string) => {
          // Don't create new timers if watcher is being shut down
          if (stopped) return

          // Check if the path matches any of our patterns
          const matches = originalPatterns.some((pattern) => matchesPattern(filePath, pattern))
          if (!matches) return

          // Clear existing debounce timer for this path
          const existingTimer = debounceTimers.get(filePath)
          if (existingTimer) {
            clearTimeout(existingTimer)
          }

          // Set a new debounce timer — only the last event within the
          // window will be emitted. unref() prevents the timer from
          // keeping the Node.js event loop alive after watcher.close()
          const timer = setTimeout(() => {
            debounceTimers.delete(filePath)
            emitEvent(type, filePath)
          }, debounceMs)
          if (typeof timer === "object" && "unref" in timer) {
            timer.unref()
          }

          debounceTimers.set(filePath, timer)
        }

        watcher.on("add", (path) => handleEvent("add", path))
        watcher.on("change", (path) => handleEvent("change", path))
        watcher.on("unlink", (path) => handleEvent("delete", path))

        watcher.on("error", (error) => {
          // Log errors but don't crash - fire and forget error reporting
          Effect.runFork(
            Effect.logWarning(`File watcher error: ${error}`)
          )
        })

        // Wait for the ready event
        yield* Effect.async<void, FileWatcherError>((resume) => {
          const timeout = setTimeout(() => {
            resume(
              Effect.fail(
                new FileWatcherError({
                  reason: "Watcher did not become ready within timeout"
                })
              )
            )
          }, 30000) // 30 second timeout

          watcher.once("ready", () => {
            clearTimeout(timeout)
            resume(Effect.void)
          })

          watcher.once("error", (error) => {
            clearTimeout(timeout)
            resume(
              Effect.fail(
                new FileWatcherError({
                  reason: "Watcher failed during initialization",
                  cause: error
                })
              )
            )
          })
        })

        // Update state
        setState(() => ({
          running: true,
          watcher,
          watchedPaths: expandedPaths,
          startedAt: new Date(),
          eventsProcessed: 0,
          debounceTimers
        }))
      })

    const stop = (): Effect.Effect<void, WatcherNotRunningError | FileWatcherError> =>
      Effect.gen(function* () {
        const state = getState()

        if (!state.running || !state.watcher) {
          return yield* Effect.fail(
            new WatcherNotRunningError({
              path: "no active watcher"
            })
          )
        }

        // Prevent new debounce timers from being created during shutdown
        stopped = true

        // Clear all pending debounce timers to prevent events firing after stop
        for (const timer of state.debounceTimers.values()) {
          clearTimeout(timer)
        }

        // Close the watcher
        yield* Effect.tryPromise({
          try: () => state.watcher!.close(),
          catch: (error) =>
            new FileWatcherError({
              reason: "Failed to close chokidar watcher",
              cause: error
            })
        })

        // Update state
        setState(() => ({
          running: false,
          watcher: null,
          watchedPaths: [],
          startedAt: null,
          eventsProcessed: 0,
          debounceTimers: new Map()
        }))
      })

    const isRunning = (): Effect.Effect<boolean> =>
      Effect.sync(() => getState().running)

    const getWatchedPaths = (): Effect.Effect<readonly string[]> =>
      Effect.sync(() => getState().watchedPaths)

    const getEventQueue = (): Effect.Effect<Queue.Queue<FileEvent>> =>
      Effect.succeed(eventQueue)

    const status = (): Effect.Effect<FileWatcherStatus> =>
      Effect.sync(() => {
        const state = getState()
        return {
          running: state.running,
          watchedPaths: state.watchedPaths,
          startedAt: state.startedAt,
          eventsProcessed: state.eventsProcessed
        }
      })

    return {
      start,
      stop,
      isRunning,
      getWatchedPaths,
      getEventQueue,
      status
    }
  })
)
