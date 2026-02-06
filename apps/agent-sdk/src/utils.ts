/**
 * @tx/agent-sdk Utility Functions
 *
 * Helper functions for SDK consumers.
 */

import type { TaskStatus, SerializedTaskWithDeps } from "./types.js"
import { TASK_STATUSES } from "./types.js"

// Re-export task ID validation from types package for backwards compatibility
export { isValidTaskId, assertTaskId, InvalidTaskIdError, TASK_ID_PATTERN } from "@jamesaphoenix/tx-types"

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a string is a valid TaskStatus.
 */
export const isValidTaskStatus = (status: string): status is TaskStatus => {
  return (TASK_STATUSES as readonly string[]).includes(status)
}

// =============================================================================
// Task Helpers
// =============================================================================

/**
 * Filter tasks by status.
 */
export const filterByStatus = (
  tasks: SerializedTaskWithDeps[],
  status: TaskStatus | TaskStatus[]
): SerializedTaskWithDeps[] => {
  const statuses = Array.isArray(status) ? status : [status]
  return tasks.filter(task => statuses.includes(task.status))
}

/**
 * Filter to only ready tasks.
 */
export const filterReady = (
  tasks: SerializedTaskWithDeps[]
): SerializedTaskWithDeps[] => {
  return tasks.filter(task => task.isReady)
}

/**
 * Sort tasks by score (descending).
 */
export const sortByScore = (
  tasks: SerializedTaskWithDeps[]
): SerializedTaskWithDeps[] => {
  return [...tasks].sort((a, b) => b.score - a.score)
}

/**
 * Get the highest priority ready task.
 */
export const getNextTask = (
  tasks: SerializedTaskWithDeps[]
): SerializedTaskWithDeps | null => {
  const ready = filterReady(tasks)
  if (ready.length === 0) return null
  return sortByScore(ready)[0]
}

// =============================================================================
// Date Helpers
// =============================================================================

/**
 * Parse ISO date string to Date object.
 */
export const parseDate = (dateStr: string): Date => {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) {
    throw new TxError(`Invalid date string: '${dateStr}'`, "VALIDATION_ERROR")
  }
  return date
}

/**
 * Check if a task was completed within the last N hours.
 */
export const wasCompletedRecently = (
  task: SerializedTaskWithDeps,
  hours: number
): boolean => {
  if (!task.completedAt) return false
  const completedAt = parseDate(task.completedAt)
  const now = new Date()
  const diffMs = now.getTime() - completedAt.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)
  return diffHours <= hours
}

// =============================================================================
// URL Helpers
// =============================================================================

/**
 * Build a URL with query parameters.
 */
export const buildUrl = (
  base: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string => {
  const url = new URL(path, base)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return url.toString()
}

/**
 * Normalize API URL (ensure no trailing slash).
 */
export const normalizeApiUrl = (url: string): string => {
  return url.replace(/\/+$/, "")
}

// =============================================================================
// Error Helpers
// =============================================================================

/**
 * SDK error class with additional context.
 */
export class TxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = "TxError"
  }

  /**
   * Check if this is a "not found" error.
   */
  isNotFound(): boolean {
    return this.statusCode === 404 || this.code === "NOT_FOUND"
  }

  /**
   * Check if this is a validation error.
   */
  isValidation(): boolean {
    return this.statusCode === 400 || this.code === "VALIDATION_ERROR"
  }

  /**
   * Check if this is a circular dependency error.
   */
  isCircularDependency(): boolean {
    return this.code === "CIRCULAR_DEPENDENCY"
  }
}

/**
 * Parse error response from API.
 */
export const parseApiError = async (response: Response): Promise<TxError> => {
  let details: unknown
  try {
    details = await response.json()
  } catch {
    details = await response.text()
  }

  const errorObj = details as { error?: { code?: string; message?: string } }
  const code = errorObj?.error?.code ?? "API_ERROR"
  const message = errorObj?.error?.message ?? `HTTP ${response.status}`

  return new TxError(message, code, response.status, details)
}

// =============================================================================
// Retry Helpers
// =============================================================================

/**
 * Options for retry logic.
 */
export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  shouldRetry?: (error: unknown) => boolean
}

/**
 * Default retry predicate - retry on network errors and 5xx responses.
 */
export const defaultShouldRetry = (error: unknown): boolean => {
  if (error instanceof TxError) {
    // Retry on server errors (5xx)
    return error.statusCode !== undefined && error.statusCode >= 500
  }
  // Retry on network errors
  return error instanceof TypeError && error.message.includes("fetch")
}

/**
 * Sleep for a given number of milliseconds.
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Execute a function with retry logic.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry
  } = options

  let lastError: unknown
  let delay = initialDelayMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error
      }

      await sleep(delay)
      delay = Math.min(delay * backoffMultiplier, maxDelayMs)
    }
  }

  throw lastError
}
