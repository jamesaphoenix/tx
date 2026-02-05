/**
 * Attempt mappers - convert database rows to domain objects
 */

import type {
  Attempt,
  AttemptOutcome,
  AttemptRow,
} from "@jamesaphoenix/tx-types"
import { assertTaskId, ATTEMPT_OUTCOMES } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"

// Re-export types and constants from @tx/types for convenience
export type { AttemptRow } from "@jamesaphoenix/tx-types"
export { ATTEMPT_OUTCOMES }

/**
 * Check if a string is a valid AttemptOutcome.
 */
export const isValidOutcome = (s: string): s is AttemptOutcome => {
  const outcomes: readonly string[] = ["failed", "succeeded"]
  return outcomes.includes(s)
}

/**
 * Convert a database row to an Attempt domain object.
 * Validates outcome and TaskId fields at runtime.
 */
export const rowToAttempt = (row: AttemptRow): Attempt => {
  if (!isValidOutcome(row.outcome)) {
    throw new InvalidStatusError({
      entity: "attempt",
      status: row.outcome,
      validStatuses: ATTEMPT_OUTCOMES
    })
  }
  return {
    id: row.id as Attempt["id"],
    taskId: assertTaskId(row.task_id),
    approach: row.approach,
    outcome: row.outcome,
    reason: row.reason,
    createdAt: new Date(row.created_at)
  }
}
