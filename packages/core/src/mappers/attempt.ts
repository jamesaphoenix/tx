/**
 * Attempt mappers - convert database rows to domain objects
 */

import type {
  Attempt,
  AttemptId,
  AttemptOutcome,
  AttemptRow,
  TaskId
} from "@jamesaphoenix/tx-types"

// Re-export types and constants from @tx/types for convenience
export type { AttemptRow } from "@jamesaphoenix/tx-types"
export { ATTEMPT_OUTCOMES } from "@jamesaphoenix/tx-types"

/**
 * Check if a string is a valid AttemptOutcome.
 */
export const isValidOutcome = (s: string): s is AttemptOutcome => {
  const outcomes: readonly string[] = ["failed", "succeeded"]
  return outcomes.includes(s)
}

/**
 * Convert a database row to an Attempt domain object.
 */
export const rowToAttempt = (row: AttemptRow): Attempt => ({
  id: row.id as AttemptId,
  taskId: row.task_id as TaskId,
  approach: row.approach,
  outcome: row.outcome as AttemptOutcome,
  reason: row.reason,
  createdAt: new Date(row.created_at)
})
