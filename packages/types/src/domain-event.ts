/**
 * Domain event types for tx
 *
 * Type definitions for the canonical domain event ledger used by
 * supervision, design-doc review, and worker lifecycle tracking.
 * See DD-039 for specification.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/** All worker-related event types. */
export const WORKER_EVENT_TYPES = [
  "worker.session_created",
  "worker.session_ended",
  "worker.session_attached",
  "worker.session_detached",
  "worker.pause_requested",
  "worker.paused",
  "worker.resumed",
  "worker.task_claimed",
  "worker.task_released",
  "worker.scope_drained",
  "worker.shutdown_requested",
  "worker.shutdown_completed",
] as const

/** All design-doc review event types. */
export const DESIGN_DOC_EVENT_TYPES = [
  "design_doc.review_eligible",
  "design_doc.review_triggered",
  "design_doc.review_started",
  "design_doc.review_passed",
  "design_doc.review_failed",
  "design_doc.review_superseded",
  "design_doc.review_followup_created",
] as const

/** All supervision domain event types. */
export const SUPERVISION_EVENT_TYPES = [
  ...WORKER_EVENT_TYPES,
  ...DESIGN_DOC_EVENT_TYPES,
] as const

// =============================================================================
// SCHEMAS & TYPES — Event Envelope
// =============================================================================

/** Worker event type literal union. */
export const WorkerEventTypeSchema = Schema.Literal(...WORKER_EVENT_TYPES)
export type WorkerEventType = typeof WorkerEventTypeSchema.Type

/** Design-doc event type literal union. */
export const DesignDocEventTypeSchema = Schema.Literal(...DESIGN_DOC_EVENT_TYPES)
export type DesignDocEventType = typeof DesignDocEventTypeSchema.Type

/** All supervision event types. */
export const SupervisionEventTypeSchema = Schema.Literal(...SUPERVISION_EVENT_TYPES)
export type SupervisionEventType = typeof SupervisionEventTypeSchema.Type

/** Domain event envelope — the canonical event record. */
export const DomainEventEnvelopeSchema = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.String,
  eventType: Schema.String,
  streamType: Schema.String,
  streamId: Schema.String,
  aggregateType: Schema.String,
  aggregateId: Schema.String,
  correlationId: Schema.NullOr(Schema.String),
  causationId: Schema.NullOr(Schema.String),
  actorType: Schema.NullOr(Schema.String),
  actorId: Schema.NullOr(Schema.String),
  schemaVersion: Schema.Number.pipe(Schema.int()),
  payload: Schema.Unknown,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type DomainEventEnvelope = typeof DomainEventEnvelopeSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Worker Event Payloads
// =============================================================================

/** Payload for worker.session_created. */
export const WorkerSessionCreatedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  workerName: Schema.String,
  scopeMode: Schema.String,
  scopeRef: Schema.NullOr(Schema.String),
  runtime: Schema.String,
  tmuxSessionName: Schema.NullOr(Schema.String),
})
export type WorkerSessionCreatedPayload = typeof WorkerSessionCreatedPayloadSchema.Type

/** Payload for worker.session_ended. */
export const WorkerSessionEndedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  reason: Schema.String,
})
export type WorkerSessionEndedPayload = typeof WorkerSessionEndedPayloadSchema.Type

/** Payload for worker.session_attached. */
export const WorkerSessionAttachedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  viewerId: Schema.String,
  mode: Schema.Literal("control", "observe"),
})
export type WorkerSessionAttachedPayload = typeof WorkerSessionAttachedPayloadSchema.Type

/** Payload for worker.session_detached. */
export const WorkerSessionDetachedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  viewerId: Schema.String,
})
export type WorkerSessionDetachedPayload = typeof WorkerSessionDetachedPayloadSchema.Type

/** Payload for worker.pause_requested. */
export const WorkerPauseRequestedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  requestedBy: Schema.String,
})
export type WorkerPauseRequestedPayload = typeof WorkerPauseRequestedPayloadSchema.Type

/** Payload for worker.paused. */
export const WorkerPausedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  currentTaskId: Schema.NullOr(Schema.String),
  currentRunId: Schema.NullOr(Schema.String),
})
export type WorkerPausedPayload = typeof WorkerPausedPayloadSchema.Type

/** Payload for worker.resumed. */
export const WorkerResumedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  resumedBy: Schema.String,
})
export type WorkerResumedPayload = typeof WorkerResumedPayloadSchema.Type

/** Payload for worker.task_claimed. */
export const WorkerTaskClaimedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  taskId: Schema.String,
  taskTitle: Schema.String,
})
export type WorkerTaskClaimedPayload = typeof WorkerTaskClaimedPayloadSchema.Type

/** Payload for worker.task_released. */
export const WorkerTaskReleasedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  taskId: Schema.String,
  reason: Schema.String,
})
export type WorkerTaskReleasedPayload = typeof WorkerTaskReleasedPayloadSchema.Type

/** Payload for worker.scope_drained. */
export const WorkerScopeDrainedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  scopeMode: Schema.String,
  scopeRef: Schema.NullOr(Schema.String),
  tasksCompleted: Schema.Number.pipe(Schema.int()),
})
export type WorkerScopeDrainedPayload = typeof WorkerScopeDrainedPayloadSchema.Type

/** Payload for worker.shutdown_requested. */
export const WorkerShutdownRequestedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  reason: Schema.String,
})
export type WorkerShutdownRequestedPayload = typeof WorkerShutdownRequestedPayloadSchema.Type

/** Payload for worker.shutdown_completed. */
export const WorkerShutdownCompletedPayloadSchema = Schema.Struct({
  sessionId: Schema.String,
  workerId: Schema.String,
  tasksCompleted: Schema.Number.pipe(Schema.int()),
  durationMs: Schema.Number.pipe(Schema.int()),
})
export type WorkerShutdownCompletedPayload = typeof WorkerShutdownCompletedPayloadSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Design-Doc Event Payloads
// =============================================================================

/** Payload for design_doc.review_eligible. */
export const DesignDocReviewEligiblePayloadSchema = Schema.Struct({
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  taskSnapshotHash: Schema.String,
  totalLinkedTasks: Schema.Number.pipe(Schema.int()),
  doneLinkedTasks: Schema.Number.pipe(Schema.int()),
})
export type DesignDocReviewEligiblePayload = typeof DesignDocReviewEligiblePayloadSchema.Type

/** Payload for design_doc.review_triggered. */
export const DesignDocReviewTriggeredPayloadSchema = Schema.Struct({
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  reviewRunId: Schema.String,
  taskSnapshotHash: Schema.String,
  runtime: Schema.String,
  transport: Schema.String,
  templateName: Schema.String,
  cause: Schema.String,
})
export type DesignDocReviewTriggeredPayload = typeof DesignDocReviewTriggeredPayloadSchema.Type

/** Payload for design_doc.review_started. */
export const DesignDocReviewStartedPayloadSchema = Schema.Struct({
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  reviewRunId: Schema.String,
  workerId: Schema.String,
})
export type DesignDocReviewStartedPayload = typeof DesignDocReviewStartedPayloadSchema.Type

/** Payload for design_doc.review_passed. */
export const DesignDocReviewPassedPayloadSchema = Schema.Struct({
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  reviewRunId: Schema.String,
  findingsCount: Schema.Number.pipe(Schema.int()),
  summary: Schema.String,
})
export type DesignDocReviewPassedPayload = typeof DesignDocReviewPassedPayloadSchema.Type

/** Payload for design_doc.review_failed. */
export const DesignDocReviewFailedPayloadSchema = Schema.Struct({
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  reviewRunId: Schema.String,
  findingsCount: Schema.Number.pipe(Schema.int()),
  summary: Schema.String,
  followupTaskIds: Schema.Array(Schema.String),
})
export type DesignDocReviewFailedPayload = typeof DesignDocReviewFailedPayloadSchema.Type

/** Payload for design_doc.review_superseded. */
export const DesignDocReviewSupersededPayloadSchema = Schema.Struct({
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  reviewRunId: Schema.String,
  reason: Schema.String,
  supersededByTaskId: Schema.NullOr(Schema.String),
})
export type DesignDocReviewSupersededPayload = typeof DesignDocReviewSupersededPayloadSchema.Type

/** Payload for design_doc.review_followup_created. */
export const DesignDocReviewFollowupCreatedPayloadSchema = Schema.Struct({
  docId: Schema.String,
  docVersion: Schema.Number.pipe(Schema.int()),
  reviewRunId: Schema.String,
  followupTaskId: Schema.String,
  followupTitle: Schema.String,
})
export type DesignDocReviewFollowupCreatedPayload = typeof DesignDocReviewFollowupCreatedPayloadSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Typed Domain Event (envelope + typed payload)
// =============================================================================

/**
 * A supervision domain event combines the envelope with a strongly typed
 * event type. The payload is typed per event family but remains Schema.Unknown
 * at the envelope level for storage flexibility. Consumers use the eventType
 * discriminant to narrow the payload type.
 */
export const SupervisionDomainEventSchema = Schema.Struct({
  ...DomainEventEnvelopeSchema.fields,
  eventType: SupervisionEventTypeSchema,
})
export type SupervisionDomainEvent = typeof SupervisionDomainEventSchema.Type

// =============================================================================
// ERROR TYPES
// =============================================================================

/** Error from domain event operations. */
export class DomainEventError extends Error {
  readonly _tag: string
  constructor(
    tag: "AppendFailed" | "QueryFailed",
    message: string,
  ) {
    super(message)
    this.name = "DomainEventError"
    this._tag = tag
  }
}

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for domain_events (snake_case from SQLite). */
export interface DomainEventRow {
  id: number
  event_id: string
  occurred_at: string
  event_type: string
  stream_type: string
  stream_id: string
  aggregate_type: string
  aggregate_id: string
  correlation_id: string | null
  causation_id: string | null
  actor_type: string | null
  actor_id: string | null
  schema_version: number
  payload: string
  metadata: string
}
