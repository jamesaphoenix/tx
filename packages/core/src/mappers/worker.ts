/**
 * Worker mappers - convert database rows to domain objects
 */

import type { Worker, WorkerStatus } from "../schemas/worker.js"

/**
 * Database row type for workers table.
 */
export interface WorkerRow {
  id: string
  name: string
  hostname: string
  pid: number
  status: string
  registered_at: string
  last_heartbeat_at: string
  current_task_id: string | null
  capabilities: string // JSON array
  metadata: string // JSON object
}

/**
 * Valid worker statuses.
 */
export const WORKER_STATUSES = ["starting", "idle", "busy", "stopping", "dead"] as const

/**
 * Check if a string is a valid WorkerStatus.
 */
export const isValidWorkerStatus = (s: string): s is WorkerStatus => {
  return (WORKER_STATUSES as readonly string[]).includes(s)
}

/**
 * Convert a database row to a Worker domain object.
 * Throws if status is invalid.
 */
export const rowToWorker = (row: WorkerRow): Worker => {
  if (!isValidWorkerStatus(row.status)) {
    throw new Error(`Invalid worker status: ${row.status}`)
  }
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    pid: row.pid,
    status: row.status,
    registeredAt: new Date(row.registered_at),
    lastHeartbeatAt: new Date(row.last_heartbeat_at),
    currentTaskId: row.current_task_id,
    capabilities: JSON.parse(row.capabilities || "[]"),
    metadata: JSON.parse(row.metadata || "{}")
  }
}
