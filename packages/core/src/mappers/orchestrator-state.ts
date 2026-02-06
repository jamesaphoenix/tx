/**
 * OrchestratorState mappers - convert database rows to domain objects
 */

import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"
import type { OrchestratorState, OrchestratorStatus } from "../schemas/worker.js"

/**
 * Database row type for orchestrator_state table.
 */
export interface OrchestratorStateRow {
  id: number
  status: string
  pid: number | null
  started_at: string | null
  last_reconcile_at: string | null
  worker_pool_size: number
  reconcile_interval_seconds: number
  heartbeat_interval_seconds: number
  lease_duration_minutes: number
  metadata: string // JSON object
}

/**
 * Valid orchestrator statuses.
 */
export const ORCHESTRATOR_STATUSES = ["stopped", "starting", "running", "stopping"] as const

/**
 * Check if a string is a valid OrchestratorStatus.
 */
export const isValidOrchestratorStatus = (s: string): s is OrchestratorStatus => {
  return (ORCHESTRATOR_STATUSES as readonly string[]).includes(s)
}

/**
 * Safely parse a JSON object string, returning empty object on failure.
 */
const safeParseMetadata = (json: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(json || "{}")
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = value
      }
      return result
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Convert a database row to an OrchestratorState domain object.
 * Throws InvalidStatusError if status is invalid.
 */
export const rowToOrchestratorState = (row: OrchestratorStateRow): OrchestratorState => {
  if (!isValidOrchestratorStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "orchestrator",
      status: row.status,
      validStatuses: ORCHESTRATOR_STATUSES,
      rowId: row.id
    })
  }
  return {
    status: row.status,
    pid: row.pid,
    startedAt: row.started_at ? parseDate(row.started_at, "started_at", row.id) : null,
    lastReconcileAt: row.last_reconcile_at ? parseDate(row.last_reconcile_at, "last_reconcile_at", row.id) : null,
    workerPoolSize: row.worker_pool_size,
    reconcileIntervalSeconds: row.reconcile_interval_seconds,
    heartbeatIntervalSeconds: row.heartbeat_interval_seconds,
    leaseDurationMinutes: row.lease_duration_minutes,
    metadata: safeParseMetadata(row.metadata)
  }
}
