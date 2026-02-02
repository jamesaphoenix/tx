import { Context, Effect, Layer, Queue } from "effect"
import {
  FileWatcherError,
  WatcherAlreadyRunningError,
  WatcherNotRunningError
} from "../errors.js"

/**
 * Type of file event detected by the watcher.
 */
export type FileEventType = "add" | "change" | "delete"

/**
 * Represents a file system event detected by the watcher.
 */
export interface FileEvent {
  /** Type of the event */
  readonly type: FileEventType
  /** Absolute path to the file */
  readonly path: string
  /** Timestamp when the event was detected */
  readonly timestamp: Date
}

/**
 * Configuration options for the file watcher.
 */
export interface FileWatcherConfig {
  /** Glob patterns to watch (e.g., "~/.claude/projects/** /*.jsonl") */
  readonly patterns: readonly string[]
  /** Debounce delay in milliseconds for rapid file changes */
  readonly debounceMs?: number
  /** Whether to emit events for existing files on start (default: false) */
  readonly ignoreInitial?: boolean
  /** Polling interval in milliseconds (for network drives, etc.) */
  readonly pollInterval?: number
}

/**
 * Status information for the file watcher.
 */
export interface FileWatcherStatus {
  /** Whether the watcher is currently running */
  readonly running: boolean
  /** Paths/patterns currently being watched */
  readonly watchedPaths: readonly string[]
  /** Timestamp when the watcher was started (null if not running) */
  readonly startedAt: Date | null
  /** Number of events processed since start */
  readonly eventsProcessed: number
}

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
