/**
 * OrchestratorState mappers - convert database rows to domain objects
 */

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
 * Convert a database row to an OrchestratorState domain object.
 */
export const rowToOrchestratorState = (row: OrchestratorStateRow): OrchestratorState => ({
  status: row.status as OrchestratorStatus,
  pid: row.pid,
  startedAt: row.started_at ? new Date(row.started_at) : null,
  lastReconcileAt: row.last_reconcile_at ? new Date(row.last_reconcile_at) : null,
  workerPoolSize: row.worker_pool_size,
  reconcileIntervalSeconds: row.reconcile_interval_seconds,
  heartbeatIntervalSeconds: row.heartbeat_interval_seconds,
  leaseDurationMinutes: row.lease_duration_minutes,
  metadata: JSON.parse(row.metadata || "{}")
})
