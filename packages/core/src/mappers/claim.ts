/**
 * Claim mappers - convert database rows to domain objects
 */

import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"
import type { TaskClaim, ClaimStatus } from "../schemas/worker.js"

/**
 * Database row type for task_claims table.
 */
export interface ClaimRow {
  id: number
  task_id: string
  worker_id: string
  claimed_at: string
  lease_expires_at: string
  renewed_count: number
  status: string
}

/**
 * Valid claim statuses.
 */
export const CLAIM_STATUSES = ["active", "released", "expired", "completed"] as const

/**
 * Check if a string is a valid ClaimStatus.
 */
export const isValidClaimStatus = (s: string): s is ClaimStatus => {
  return (CLAIM_STATUSES as readonly string[]).includes(s)
}

/**
 * Convert a database row to a TaskClaim domain object.
 * Throws InvalidStatusError if status is invalid.
 */
export const rowToClaim = (row: ClaimRow): TaskClaim => {
  if (!isValidClaimStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "claim",
      status: row.status,
      validStatuses: CLAIM_STATUSES,
      rowId: row.id
    })
  }
  return {
    id: row.id,
    taskId: row.task_id,
    workerId: row.worker_id,
    claimedAt: parseDate(row.claimed_at, "claimed_at", row.id),
    leaseExpiresAt: parseDate(row.lease_expires_at, "lease_expires_at", row.id),
    renewedCount: row.renewed_count,
    status: row.status
  }
}
