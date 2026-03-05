import { homedir } from "node:os"

/**
 * Type of file event detected by the watcher.
 */
export type FileEventType = "add" | "change" | "delete"

/**
 * Represents a file system event detected by the watcher.
 */
export type FileEvent = {
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
export type FileWatcherConfig = {
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
export type FileWatcherStatus = {
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
 * Internal state for the FileWatcherServiceLive implementation.
 */
export type FileWatcherState = {
  /** Whether the watcher is running */
  running: boolean
  /** Chokidar watcher instance */
  watcher: import("chokidar").FSWatcher | null
  /** Currently watched paths/patterns */
  watchedPaths: readonly string[]
  /** Timestamp when the watcher started */
  startedAt: Date | null
  /** Number of events processed */
  eventsProcessed: number
  /** Per-path debounce timers for coalescing rapid events */
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>
}

/**
 * Expand tilde (~) to the user's home directory.
 */
export const expandTilde = (path: string): string => {
  return path.startsWith("~") ? path.replace(/^~/, homedir()) : path
}

/**
 * Extract the base directory from a glob pattern.
 * For "~/.claude/projects/** /*.jsonl", returns the expanded "~/.claude/projects".
 * For paths without globs, returns the path as-is.
 */
export const extractBaseDir = (pattern: string): string => {
  const expanded = expandTilde(pattern)
  const firstGlobIndex = expanded.search(/[*?[\]{}]/)
  if (firstGlobIndex === -1) {
    return expanded
  }
  const beforeGlob = expanded.slice(0, firstGlobIndex)
  const lastSep = Math.max(beforeGlob.lastIndexOf("/"), beforeGlob.lastIndexOf("\\"))
  return lastSep > 0 ? expanded.slice(0, lastSep) : expanded
}

/**
 * Check if a file path matches a glob-like pattern.
 * Simple implementation supporting:
 * - ** for any directory depth
 * - * for any characters in a filename
 */
export const matchesPattern = (filePath: string, pattern: string): boolean => {
  const expanded = expandTilde(pattern)

  if (!/[*?[\]{}]/.test(expanded)) {
    return filePath.startsWith(expanded)
  }

  const regexStr = expanded
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*")
    .replace(/\?/g, ".")

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(filePath)
}
