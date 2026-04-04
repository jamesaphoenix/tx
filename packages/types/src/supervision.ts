/**
 * Supervision types for tx
 *
 * Type definitions for Ralph supervision sessions, worker session management,
 * design-doc completion state, review runs, and terminal tokens.
 * See DD-039 for specification.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/** Valid control modes for a worker session. */
export const WORKER_SESSION_CONTROL_MODES = [
  "agent",
  "human_paused",
  "human_attached",
  "detached",
  "ended",
] as const

/** Valid scope modes for a worker session. */
export const WORKER_SESSION_SCOPE_MODES = ["all", "design-doc"] as const

/** Valid orchestrator types. */
export const WORKER_SESSION_ORCHESTRATORS = ["ralph"] as const

/** Valid runtime types for worker sessions. */
export const WORKER_SESSION_RUNTIMES = ["claude", "codex", "custom", "pi"] as const

/** Valid terminal backends. */
export const WORKER_SESSION_TERMINAL_BACKENDS = ["tmux"] as const

/** Valid terminal token modes. */
export const TERMINAL_TOKEN_MODES = ["control", "observe"] as const

/** Valid design-doc completion states. */
export const DESIGN_DOC_COMPLETION_STATES = [
  "no_tasks",
  "implementing",
  "ready_for_review",
  "reviewing",
  "review_failed",
  "verified",
  "superseded",
] as const

/** Valid doc review run statuses. */
export const DOC_REVIEW_RUN_STATUSES = [
  "pending",
  "running",
  "passed",
  "failed",
  "cancelled",
  "superseded",
] as const

/** Valid review runtimes. */
export const REVIEW_RUNTIMES = ["pi", "custom"] as const

/** Valid review transports. */
export const REVIEW_TRANSPORTS = ["rpc", "sdk"] as const

/** Valid review trigger causes. */
export const REVIEW_TRIGGER_CAUSES = ["scope_drained", "manual", "task_completed"] as const

/** Valid maybe-trigger result outcomes. */
export const MAYBE_TRIGGER_OUTCOMES = [
  "triggered",
  "already_active",
  "not_all_done",
  "config_disabled",
  "no_linked_tasks",
] as const

// =============================================================================
// SCHEMAS & TYPES — Worker Session
// =============================================================================

/** Worker session control mode — governs terminal and claim behavior. */
export const WorkerSessionControlModeSchema = Schema.Literal(...WORKER_SESSION_CONTROL_MODES)
export type WorkerSessionControlMode = typeof WorkerSessionControlModeSchema.Type

/** Worker session scope mode. */
export const WorkerSessionScopeModeSchema = Schema.Literal(...WORKER_SESSION_SCOPE_MODES)
export type WorkerSessionScopeMode = typeof WorkerSessionScopeModeSchema.Type

/** Worker session orchestrator type. */
export const WorkerSessionOrchestratorSchema = Schema.Literal(...WORKER_SESSION_ORCHESTRATORS)
export type WorkerSessionOrchestrator = typeof WorkerSessionOrchestratorSchema.Type

/** Worker session runtime type. */
export const WorkerSessionRuntimeSchema = Schema.Literal(...WORKER_SESSION_RUNTIMES)
export type WorkerSessionRuntime = typeof WorkerSessionRuntimeSchema.Type

/** Worker session terminal backend. */
export const WorkerSessionTerminalBackendSchema = Schema.Literal(...WORKER_SESSION_TERMINAL_BACKENDS)
export type WorkerSessionTerminalBackend = typeof WorkerSessionTerminalBackendSchema.Type

/** Terminal token mode — control (read-write) or observe (read-only). */
export const TerminalTokenModeSchema = Schema.Literal(...TERMINAL_TOKEN_MODES)
export type TerminalTokenMode = typeof TerminalTokenModeSchema.Type

/** A worker supervision session snapshot. */
export const WorkerSessionSchema = Schema.Struct({
  id: Schema.String,
  workerId: Schema.String,
  workerName: Schema.String,
  workerStatus: Schema.String,
  scopeMode: WorkerSessionScopeModeSchema,
  scopeRef: Schema.NullOr(Schema.String),
  orchestrator: WorkerSessionOrchestratorSchema,
  runtime: WorkerSessionRuntimeSchema,
  terminalBackend: WorkerSessionTerminalBackendSchema,
  tmuxSessionName: Schema.NullOr(Schema.String),
  tmuxWindowName: Schema.NullOr(Schema.String),
  tmuxPaneId: Schema.NullOr(Schema.String),
  controlMode: WorkerSessionControlModeSchema,
  currentTaskId: Schema.NullOr(Schema.String),
  currentRunId: Schema.NullOr(Schema.String),
  activeTerminalController: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  lastHeartbeatAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type WorkerSession = typeof WorkerSessionSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Design-Doc Progress & Completion
// =============================================================================

/** Design-doc completion state — derived from linked tasks and review runs. */
export const DesignDocCompletionStateSchema = Schema.Literal(...DESIGN_DOC_COMPLETION_STATES)
export type DesignDocCompletionState = typeof DesignDocCompletionStateSchema.Type

/** Design-doc progress — derived projection of linked task counts. */
export const DesignDocProgressSchema = Schema.Struct({
  total: Schema.Number.pipe(Schema.int()),
  done: Schema.Number.pipe(Schema.int()),
  inProgress: Schema.Number.pipe(Schema.int()),
  blocked: Schema.Number.pipe(Schema.int()),
  completionPercent: Schema.Number,
})
export type DesignDocProgress = typeof DesignDocProgressSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Worker Session Detail (rich read model)
// =============================================================================

/** Rich read model joining worker session with related entities. */
export const WorkerSessionDetailSchema = Schema.Struct({
  ...WorkerSessionSchema.fields,
  /** Current task title (if a task is claimed). */
  currentTaskTitle: Schema.NullOr(Schema.String),
  /** Current task status (if a task is claimed). */
  currentTaskStatus: Schema.NullOr(Schema.String),
  /** Current run status (if a run is active). */
  currentRunStatus: Schema.NullOr(Schema.String),
  /** Claim owner for the current task (if claimed). */
  claimOwner: Schema.NullOr(Schema.String),
  /** Claim lease expiry (if claimed). */
  claimExpiresAt: Schema.NullOr(Schema.String),
  /** Design-doc progress when scoped to a design doc. */
  designDocProgress: Schema.NullOr(DesignDocProgressSchema),
  /** Design-doc completion state when scoped to a design doc. */
  designDocCompletionState: Schema.NullOr(DesignDocCompletionStateSchema),
  /** Whether a tmux terminal is available for this session. */
  terminalAvailable: Schema.Boolean,
})
export type WorkerSessionDetail = typeof WorkerSessionDetailSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Supervision Terminal Token
// =============================================================================

/** Token authorizing a websocket terminal connection. */
export const SupervisionTerminalTokenSchema = Schema.Struct({
  token: Schema.String,
  sessionId: Schema.String,
  viewerId: Schema.String,
  mode: TerminalTokenModeSchema,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
})
export type SupervisionTerminalToken = typeof SupervisionTerminalTokenSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Doc Review Run
// =============================================================================

/** Doc review run status. */
export const DocReviewRunStatusSchema = Schema.Literal(...DOC_REVIEW_RUN_STATUSES)
export type DocReviewRunStatus = typeof DocReviewRunStatusSchema.Type

/** Review runtime type. */
export const ReviewRuntimeSchema = Schema.Literal(...REVIEW_RUNTIMES)
export type ReviewRuntimeType = typeof ReviewRuntimeSchema.Type

/** Review transport type. */
export const ReviewTransportSchema = Schema.Literal(...REVIEW_TRANSPORTS)
export type ReviewTransport = typeof ReviewTransportSchema.Type

/** A single design-doc review run. */
export const DocReviewRunSchema = Schema.Struct({
  id: Schema.String,
  docRowId: Schema.Number.pipe(Schema.int()),
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  taskSnapshotHash: Schema.String,
  status: DocReviewRunStatusSchema,
  runtime: ReviewRuntimeSchema,
  transport: ReviewTransportSchema,
  templateName: Schema.String,
  triggeredByEventId: Schema.NullOr(Schema.String),
  workerId: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String),
  resultSummary: Schema.NullOr(Schema.String),
  findingsCount: Schema.Number.pipe(Schema.int()),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type DocReviewRun = typeof DocReviewRunSchema.Type

/** Result of a successful review run. */
export const ReviewRunResultSchema = Schema.Struct({
  passed: Schema.Boolean,
  summary: Schema.String,
  findingsCount: Schema.Number.pipe(Schema.int()),
  findings: Schema.Array(Schema.Struct({
    severity: Schema.Literal("info", "warning", "error"),
    message: Schema.String,
    location: Schema.NullOr(Schema.String),
  })),
})
export type ReviewRunResult = typeof ReviewRunResultSchema.Type

/** Result of a failed review run. */
export const ReviewFailureResultSchema = Schema.Struct({
  errorMessage: Schema.String,
  retryable: Schema.Boolean,
})
export type ReviewFailureResult = typeof ReviewFailureResultSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Review Trigger
// =============================================================================

/** Cause that triggered a review. */
export const ReviewTriggerCauseSchema = Schema.Literal(...REVIEW_TRIGGER_CAUSES)
export type ReviewTriggerCause = typeof ReviewTriggerCauseSchema.Type

/** Outcome of a maybe-trigger call. */
export const MaybeTriggerOutcomeSchema = Schema.Literal(...MAYBE_TRIGGER_OUTCOMES)
export type MaybeTriggerOutcome = typeof MaybeTriggerOutcomeSchema.Type

/** Result returned by DocReviewService.maybeTrigger. */
export const MaybeTriggerResultSchema = Schema.Struct({
  outcome: MaybeTriggerOutcomeSchema,
  reviewRunId: Schema.NullOr(Schema.String),
  message: Schema.String,
})
export type MaybeTriggerResult = typeof MaybeTriggerResultSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Actor Reference
// =============================================================================

/** Reference to an actor performing a supervision action. */
export const ActorRefSchema = Schema.Struct({
  type: Schema.Literal("human", "agent", "system"),
  id: Schema.String,
})
export type ActorRef = typeof ActorRefSchema.Type

// =============================================================================
// ERROR TYPES
// =============================================================================

/** Error from supervision operations. */
export class SupervisionError extends Error {
  readonly _tag: string
  constructor(
    tag: "NotFound" | "InvalidTransition" | "TerminalUnavailable" | "ControllerConflict",
    message: string,
  ) {
    super(message)
    this.name = "SupervisionError"
    this._tag = tag
  }
}

/** Error from doc review operations. */
export class DocReviewError extends Error {
  readonly _tag: string
  constructor(
    tag: "NotFound" | "AlreadyActive" | "ConfigDisabled" | "RuntimeFailure",
    message: string,
  ) {
    super(message)
    this.name = "DocReviewError"
    this._tag = tag
  }
}

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for worker_sessions (snake_case from SQLite). */
export interface WorkerSessionRow {
  id: string
  worker_id: string
  scope_mode: string
  scope_ref: string | null
  orchestrator: string
  runtime: string
  terminal_backend: string
  tmux_session_name: string | null
  tmux_window_name: string | null
  tmux_pane_id: string | null
  control_mode: string
  current_task_id: string | null
  current_run_id: string | null
  active_terminal_controller: string | null
  started_at: string
  last_heartbeat_at: string
  ended_at: string | null
  metadata: string
}

/** Database row type for doc_review_runs (snake_case from SQLite). */
export interface DocReviewRunRow {
  id: string
  doc_row_id: number
  doc_id: string
  doc_version: number
  task_snapshot_hash: string
  status: string
  runtime: string
  transport: string
  template_name: string
  triggered_by_event_id: string | null
  worker_id: string | null
  started_at: string | null
  ended_at: string | null
  result_summary: string | null
  findings_count: number
  metadata: string
}
