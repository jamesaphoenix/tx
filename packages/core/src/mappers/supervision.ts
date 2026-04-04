/**
 * Supervision mappers - convert database rows to domain objects
 */

import {
  WORKER_SESSION_CONTROL_MODES,
  WORKER_SESSION_SCOPE_MODES,
  WORKER_SESSION_ORCHESTRATORS,
  WORKER_SESSION_RUNTIMES,
  WORKER_SESSION_TERMINAL_BACKENDS,
  type WorkerSession,
  type WorkerSessionControlMode,
  type WorkerSessionScopeMode,
  type WorkerSessionOrchestrator,
  type WorkerSessionRuntime,
  type WorkerSessionTerminalBackend,
  type WorkerSessionRow,
} from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"

// Local string arrays for .includes() checks
const controlModeStrings: readonly string[] = WORKER_SESSION_CONTROL_MODES
const scopeModeStrings: readonly string[] = WORKER_SESSION_SCOPE_MODES
const orchestratorStrings: readonly string[] = WORKER_SESSION_ORCHESTRATORS
const runtimeStrings: readonly string[] = WORKER_SESSION_RUNTIMES
const terminalBackendStrings: readonly string[] = WORKER_SESSION_TERMINAL_BACKENDS

// =============================================================================
// TYPE GUARDS
// =============================================================================

export const isValidControlMode = (s: string): s is WorkerSessionControlMode =>
  controlModeStrings.includes(s)
export const isValidScopeMode = (s: string): s is WorkerSessionScopeMode =>
  scopeModeStrings.includes(s)
export const isValidOrchestrator = (s: string): s is WorkerSessionOrchestrator =>
  orchestratorStrings.includes(s)
export const isValidRuntime = (s: string): s is WorkerSessionRuntime =>
  runtimeStrings.includes(s)
export const isValidTerminalBackend = (s: string): s is WorkerSessionTerminalBackend =>
  terminalBackendStrings.includes(s)

// =============================================================================
// METADATA PARSING
// =============================================================================

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

// =============================================================================
// ROW MAPPERS
// =============================================================================

/**
 * Convert a database row to a WorkerSession domain object.
 * Validates enum fields at runtime.
 *
 * Note: workerName and workerStatus are NOT stored in worker_sessions —
 * they come from the workers table join. When mapping a bare worker_sessions
 * row (no join), pass defaults or use rowToWorkerSessionFromJoin instead.
 */
export const rowToWorkerSession = (
  row: WorkerSessionRow,
  workerName: string,
  workerStatus: string,
): WorkerSession => {
  if (!isValidControlMode(row.control_mode)) {
    throw new InvalidStatusError({
      entity: "worker_session",
      status: row.control_mode,
      validStatuses: [...WORKER_SESSION_CONTROL_MODES],
      rowId: row.id,
    })
  }
  if (!isValidScopeMode(row.scope_mode)) {
    throw new InvalidStatusError({
      entity: "worker_session",
      status: row.scope_mode,
      validStatuses: [...WORKER_SESSION_SCOPE_MODES],
      rowId: row.id,
    })
  }
  if (!isValidOrchestrator(row.orchestrator)) {
    throw new InvalidStatusError({
      entity: "worker_session",
      status: row.orchestrator,
      validStatuses: [...WORKER_SESSION_ORCHESTRATORS],
      rowId: row.id,
    })
  }
  if (!isValidRuntime(row.runtime)) {
    throw new InvalidStatusError({
      entity: "worker_session",
      status: row.runtime,
      validStatuses: [...WORKER_SESSION_RUNTIMES],
      rowId: row.id,
    })
  }
  if (!isValidTerminalBackend(row.terminal_backend)) {
    throw new InvalidStatusError({
      entity: "worker_session",
      status: row.terminal_backend,
      validStatuses: [...WORKER_SESSION_TERMINAL_BACKENDS],
      rowId: row.id,
    })
  }

  return {
    id: row.id,
    workerId: row.worker_id,
    workerName,
    workerStatus,
    scopeMode: row.scope_mode,
    scopeRef: row.scope_ref,
    orchestrator: row.orchestrator,
    runtime: row.runtime,
    terminalBackend: row.terminal_backend,
    tmuxSessionName: row.tmux_session_name,
    tmuxWindowName: row.tmux_window_name,
    tmuxPaneId: row.tmux_pane_id,
    controlMode: row.control_mode,
    currentTaskId: row.current_task_id,
    currentRunId: row.current_run_id,
    activeTerminalController: row.active_terminal_controller,
    startedAt: row.started_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    endedAt: row.ended_at,
    metadata: safeParseMetadata(row.metadata),
  }
}
