/**
 * SupervisionRepository — database operations for worker supervision sessions.
 *
 * Manages worker_sessions table and provides rich detail queries that join
 * across workers, task_claims, tasks, runs, and design-doc progress.
 * See DD-039 for specification.
 */
import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToWorkerSession } from "../mappers/supervision.js"
import type {
  WorkerSession,
  WorkerSessionDetail,
  WorkerSessionControlMode,
  WorkerSessionRow,
  DesignDocProgress,
  DesignDocCompletionState,
} from "@jamesaphoenix/tx-types"

// =============================================================================
// TYPES
// =============================================================================

export type WorkerSessionInsertInput = {
  readonly id: string
  readonly workerId: string
  readonly scopeMode: string
  readonly scopeRef?: string | null
  readonly orchestrator: string
  readonly runtime: string
  readonly terminalBackend: string
  readonly tmuxSessionName?: string | null
  readonly tmuxWindowName?: string | null
  readonly tmuxPaneId?: string | null
  readonly controlMode: string
  readonly currentTaskId?: string | null
  readonly currentRunId?: string | null
  readonly activeTerminalController?: string | null
  readonly startedAt: string
  readonly lastHeartbeatAt: string
  readonly metadata?: Record<string, unknown>
}

export type WorkerSessionUpdateInput = {
  readonly controlMode?: string
  readonly currentTaskId?: string | null
  readonly currentRunId?: string | null
  readonly activeTerminalController?: string | null
  readonly lastHeartbeatAt?: string
  readonly endedAt?: string | null
  readonly metadata?: Record<string, unknown>
}

/** Row type for the detail join query. */
type SessionDetailRow = WorkerSessionRow & {
  worker_name: string
  worker_status: string
  current_task_title: string | null
  current_task_status: string | null
  current_run_status: string | null
  claim_owner: string | null
  claim_expires_at: string | null
}

// =============================================================================
// SERVICE
// =============================================================================

export type SupervisionRepositoryService = {
  readonly createSession: (input: WorkerSessionInsertInput) => Effect.Effect<WorkerSession, DatabaseError>
  readonly updateSession: (id: string, input: WorkerSessionUpdateInput) => Effect.Effect<void, DatabaseError>
  readonly endSession: (id: string, endedAt: string) => Effect.Effect<void, DatabaseError>
  readonly getSessionById: (id: string) => Effect.Effect<WorkerSession | null, DatabaseError>
  readonly listLiveSessions: () => Effect.Effect<readonly WorkerSession[], DatabaseError>
  readonly getSessionDetail: (id: string) => Effect.Effect<WorkerSessionDetail | null, DatabaseError>
  readonly listSessionDetails: () => Effect.Effect<readonly WorkerSessionDetail[], DatabaseError>
  readonly resolveTerminalController: (id: string) => Effect.Effect<string | null, DatabaseError>
  readonly updateControlMode: (id: string, controlMode: WorkerSessionControlMode) => Effect.Effect<void, DatabaseError>
  readonly updateHeartbeat: (id: string, lastHeartbeatAt: string) => Effect.Effect<void, DatabaseError>
}

export class SupervisionRepository extends Context.Tag("SupervisionRepository")<
  SupervisionRepository,
  SupervisionRepositoryService
>() {}

// =============================================================================
// DETAIL QUERY SQL
// =============================================================================

const SESSION_DETAIL_SQL = `
  SELECT
    ws.*,
    w.name AS worker_name,
    w.status AS worker_status,
    t.title AS current_task_title,
    t.status AS current_task_status,
    r.status AS current_run_status,
    tc.worker_id AS claim_owner,
    tc.expires_at AS claim_expires_at
  FROM worker_sessions ws
  JOIN workers w ON w.id = ws.worker_id
  LEFT JOIN tasks t ON t.id = ws.current_task_id
  LEFT JOIN runs r ON r.id = ws.current_run_id
  LEFT JOIN task_claims tc ON tc.task_id = ws.current_task_id
    AND tc.status = 'active'
`

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Compute design-doc progress for a session scoped to a design doc.
 */
const computeDesignDocProgress = (
  db: import("../db.js").SqliteDatabase,
  scopeRef: string | null,
): { progress: DesignDocProgress | null; completionState: DesignDocCompletionState | null } => {
  if (!scopeRef) return { progress: null, completionState: null }

  type CountRow = {
    total: number
    done: number
    in_progress: number
    blocked: number
  }

  const row = db.prepare<CountRow>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN t.status IN ('active', 'planning', 'review', 'needs_review') THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked
     FROM task_doc_links tdl
     JOIN docs d ON d.id = tdl.doc_id
     JOIN tasks t ON t.id = tdl.task_id
     WHERE d.name = ?`
  ).get(scopeRef)

  if (!row || row.total === 0) {
    return {
      progress: { total: 0, done: 0, inProgress: 0, blocked: 0, completionPercent: 0 },
      completionState: "no_tasks",
    }
  }

  const progress: DesignDocProgress = {
    total: row.total,
    done: row.done,
    inProgress: row.in_progress,
    blocked: row.blocked,
    completionPercent: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0,
  }

  let completionState: DesignDocCompletionState
  if (row.done === row.total) {
    completionState = "ready_for_review"
  } else {
    completionState = "implementing"
  }

  return { progress, completionState }
}

/**
 * Map a detail join row + design-doc progress into WorkerSessionDetail.
 */
const detailRowToSessionDetail = (
  db: import("../db.js").SqliteDatabase,
  row: SessionDetailRow,
  scopeMode: string,
  scopeRef: string | null,
): WorkerSessionDetail => {
  const session = rowToWorkerSession(row, row.worker_name, row.worker_status)
  const { progress, completionState } =
    scopeMode === "design-doc"
      ? computeDesignDocProgress(db, scopeRef)
      : { progress: null, completionState: null }

  return {
    ...session,
    currentTaskTitle: row.current_task_title,
    currentTaskStatus: row.current_task_status,
    currentRunStatus: row.current_run_status,
    claimOwner: row.claim_owner,
    claimExpiresAt: row.claim_expires_at,
    designDocProgress: progress,
    designDocCompletionState: completionState,
    terminalAvailable: session.tmuxSessionName !== null,
  }
}

// =============================================================================
// LIVE IMPLEMENTATION
// =============================================================================

export const SupervisionRepositoryLive = Layer.effect(
  SupervisionRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      createSession: (input: WorkerSessionInsertInput) =>
        Effect.try({
          try: () => {
            db.prepare(
              `INSERT INTO worker_sessions
               (id, worker_id, scope_mode, scope_ref, orchestrator, runtime,
                terminal_backend, tmux_session_name, tmux_window_name, tmux_pane_id,
                control_mode, current_task_id, current_run_id,
                active_terminal_controller, started_at, last_heartbeat_at, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              input.id,
              input.workerId,
              input.scopeMode,
              input.scopeRef ?? null,
              input.orchestrator,
              input.runtime,
              input.terminalBackend,
              input.tmuxSessionName ?? null,
              input.tmuxWindowName ?? null,
              input.tmuxPaneId ?? null,
              input.controlMode,
              input.currentTaskId ?? null,
              input.currentRunId ?? null,
              input.activeTerminalController ?? null,
              input.startedAt,
              input.lastHeartbeatAt,
              JSON.stringify(input.metadata ?? {}),
            )
            // Fetch with worker join for workerName/workerStatus
            type JoinRow = WorkerSessionRow & { worker_name: string; worker_status: string }
            const row = db
              .prepare<JoinRow>(
                `SELECT ws.*, w.name AS worker_name, w.status AS worker_status
                 FROM worker_sessions ws
                 JOIN workers w ON w.id = ws.worker_id
                 WHERE ws.id = ?`
              )
              .get(input.id)
            if (!row) {
              throw new EntityFetchError({
                entity: "worker_session",
                id: input.id,
                operation: "insert",
              })
            }
            return rowToWorkerSession(row, row.worker_name, row.worker_status)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      updateSession: (id: string, input: WorkerSessionUpdateInput) =>
        Effect.try({
          try: () => {
            const sets: string[] = []
            const params: unknown[] = []
            if (input.controlMode !== undefined) {
              sets.push("control_mode = ?")
              params.push(input.controlMode)
            }
            if (input.currentTaskId !== undefined) {
              sets.push("current_task_id = ?")
              params.push(input.currentTaskId)
            }
            if (input.currentRunId !== undefined) {
              sets.push("current_run_id = ?")
              params.push(input.currentRunId)
            }
            if (input.activeTerminalController !== undefined) {
              sets.push("active_terminal_controller = ?")
              params.push(input.activeTerminalController)
            }
            if (input.lastHeartbeatAt !== undefined) {
              sets.push("last_heartbeat_at = ?")
              params.push(input.lastHeartbeatAt)
            }
            if (input.endedAt !== undefined) {
              sets.push("ended_at = ?")
              params.push(input.endedAt)
            }
            if (input.metadata !== undefined) {
              sets.push("metadata = ?")
              params.push(JSON.stringify(input.metadata))
            }
            if (sets.length === 0) return
            params.push(id)
            db.prepare(
              `UPDATE worker_sessions SET ${sets.join(", ")} WHERE id = ?`
            ).run(...params)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      endSession: (id: string, endedAt: string) =>
        Effect.try({
          try: () => {
            db.prepare(
              "UPDATE worker_sessions SET control_mode = 'ended', ended_at = ? WHERE id = ?"
            ).run(endedAt, id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getSessionById: (id: string) =>
        Effect.try({
          try: () => {
            type JoinRow = WorkerSessionRow & { worker_name: string; worker_status: string }
            const row = db
              .prepare<JoinRow>(
                `SELECT ws.*, w.name AS worker_name, w.status AS worker_status
                 FROM worker_sessions ws
                 JOIN workers w ON w.id = ws.worker_id
                 WHERE ws.id = ?`
              )
              .get(id)
            return row ? rowToWorkerSession(row, row.worker_name, row.worker_status) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      listLiveSessions: () =>
        Effect.try({
          try: () => {
            type JoinRow = WorkerSessionRow & { worker_name: string; worker_status: string }
            const rows = db
              .prepare<JoinRow>(
                `SELECT ws.*, w.name AS worker_name, w.status AS worker_status
                 FROM worker_sessions ws
                 JOIN workers w ON w.id = ws.worker_id
                 WHERE ws.ended_at IS NULL
                 ORDER BY ws.last_heartbeat_at DESC`
              )
              .all()
            return rows.map((row) => rowToWorkerSession(row, row.worker_name, row.worker_status))
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getSessionDetail: (id: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<SessionDetailRow>(
                SESSION_DETAIL_SQL + " WHERE ws.id = ?"
              )
              .get(id)
            if (!row) return null
            return detailRowToSessionDetail(db, row, row.scope_mode, row.scope_ref)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      listSessionDetails: () =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<SessionDetailRow>(
                SESSION_DETAIL_SQL + " WHERE ws.ended_at IS NULL ORDER BY ws.last_heartbeat_at DESC"
              )
              .all()
            return rows.map((row) => detailRowToSessionDetail(db, row, row.scope_mode, row.scope_ref))
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      resolveTerminalController: (id: string) =>
        Effect.try({
          try: () => {
            type ControllerRow = { active_terminal_controller: string | null }
            const row = db
              .prepare<ControllerRow>(
                "SELECT active_terminal_controller FROM worker_sessions WHERE id = ?"
              )
              .get(id)
            return row?.active_terminal_controller ?? null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      updateControlMode: (id: string, controlMode: WorkerSessionControlMode) =>
        Effect.try({
          try: () => {
            db.prepare(
              "UPDATE worker_sessions SET control_mode = ? WHERE id = ?"
            ).run(controlMode, id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      updateHeartbeat: (id: string, lastHeartbeatAt: string) =>
        Effect.try({
          try: () => {
            db.prepare(
              "UPDATE worker_sessions SET last_heartbeat_at = ? WHERE id = ?"
            ).run(lastHeartbeatAt, id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
    }
  })
)
