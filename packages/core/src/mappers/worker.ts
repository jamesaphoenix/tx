/**
 * Worker mappers - convert database rows to domain objects
 */

import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"
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
 * Safely parse a JSON array of strings, returning empty array on failure.
 */
const safeParseCapabilities = (json: string | null | undefined): string[] => {
  try {
    const parsed: unknown = JSON.parse(json || "[]")
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
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
 * Convert a database row to a Worker domain object.
 * Throws InvalidStatusError if status is invalid.
 */
export const rowToWorker = (row: WorkerRow): Worker => {
  if (!isValidWorkerStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "worker",
      status: row.status,
      validStatuses: WORKER_STATUSES,
      rowId: row.id
    })
  }
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    pid: row.pid,
    status: row.status,
    registeredAt: parseDate(row.registered_at, "registered_at", row.id),
    lastHeartbeatAt: parseDate(row.last_heartbeat_at, "last_heartbeat_at", row.id),
    currentTaskId: row.current_task_id,
    capabilities: safeParseCapabilities(row.capabilities),
    metadata: safeParseMetadata(row.metadata)
  }
}
