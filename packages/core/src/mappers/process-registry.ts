/**
 * Process registry mappers - convert database rows to domain objects
 */

import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"
import type { ProcessEntry, ProcessRole } from "../schemas/worker.js"

export interface ProcessRegistryRow {
  id: number
  pid: number
  parent_pid: number | null
  worker_id: string | null
  run_id: string | null
  role: string
  started_at: string
  ended_at: string | null
  last_heartbeat_at: string
  command_hint: string | null
}

const PROCESS_ROLES = ["orchestrator", "worker", "agent", "tool", "renewal"] as const

const isValidProcessRole = (s: string): s is ProcessRole => {
  return PROCESS_ROLES.some((r) => r === s)
}

export const rowToProcessEntry = (row: ProcessRegistryRow): ProcessEntry => {
  if (!isValidProcessRole(row.role)) {
    throw new InvalidStatusError({
      entity: "process_registry",
      status: row.role,
      validStatuses: PROCESS_ROLES,
      rowId: row.id
    })
  }
  return {
    id: row.id,
    pid: row.pid,
    parentPid: row.parent_pid,
    workerId: row.worker_id,
    runId: row.run_id,
    role: row.role,
    startedAt: parseDate(row.started_at, "started_at", row.id),
    endedAt: row.ended_at ? parseDate(row.ended_at, "ended_at", row.id) : null,
    lastHeartbeatAt: parseDate(row.last_heartbeat_at, "last_heartbeat_at", row.id),
    commandHint: row.command_hint
  }
}
