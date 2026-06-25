/**
 * Decision types for tx
 *
 * Type definitions for decisions as first-class artifacts in the
 * spec-driven development triangle.
 */
import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

export const DECISION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "edited",
  "superseded",
] as const

export const DECISION_SOURCES = [
  "manual",
  "diff",
  "transcript",
  "agent",
] as const

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Decision status. */
export const DecisionStatusSchema = Schema.Literal(...DECISION_STATUSES)
export type DecisionStatus = typeof DecisionStatusSchema.Type

/** Decision source — how the decision was captured. */
export const DecisionSourceSchema = Schema.Literal(...DECISION_SOURCES)
export type DecisionSource = typeof DecisionSourceSchema.Type

/** Decision ID — branded string matching dec-<12 hex chars>. */
export const DecisionIdSchema = Schema.String.pipe(
  Schema.pattern(/^dec-[a-f0-9]{12}$/),
  Schema.brand("DecisionId")
)
export type DecisionId = typeof DecisionIdSchema.Type

/** Decision entity — a captured architectural or implementation decision. */
export const DecisionSchema = Schema.Struct({
  id: DecisionIdSchema,
  content: Schema.String,
  question: Schema.NullOr(Schema.String),
  status: DecisionStatusSchema,
  source: DecisionSourceSchema,
  commitSha: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  docId: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  invariantId: Schema.NullOr(Schema.String),
  reviewedBy: Schema.NullOr(Schema.String),
  reviewNote: Schema.NullOr(Schema.String),
  editedContent: Schema.NullOr(Schema.String),
  reviewedAt: Schema.NullOr(Schema.DateFromSelf),
  contentHash: Schema.String,
  supersededBy: Schema.NullOr(Schema.String),
  syncedToDoc: Schema.Boolean,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
})
export type Decision = typeof DecisionSchema.Type

/** Input for creating a new decision. */
export const CreateDecisionInputSchema = Schema.Struct({
  content: Schema.String,
  question: Schema.optional(Schema.NullOr(Schema.String)),
  source: Schema.optional(DecisionSourceSchema),
  commitSha: Schema.optional(Schema.NullOr(Schema.String)),
  runId: Schema.optional(Schema.NullOr(Schema.String)),
  taskId: Schema.optional(Schema.NullOr(Schema.String)),
  docId: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
})
export type CreateDecisionInput = typeof CreateDecisionInputSchema.Type

/** Input for updating/reviewing a decision. */
export const ReviewDecisionInputSchema = Schema.Struct({
  reviewedBy: Schema.optional(Schema.String),
  reviewNote: Schema.optional(Schema.String),
  editedContent: Schema.optional(Schema.String),
})
export type ReviewDecisionInput = typeof ReviewDecisionInputSchema.Type

// =============================================================================
// RUNTIME VALIDATORS
// =============================================================================

export const isValidDecisionStatus = (s: string): s is DecisionStatus => {
  return (DECISION_STATUSES as readonly string[]).includes(s)
}

export const isValidDecisionSource = (s: string): s is DecisionSource => {
  return (DECISION_SOURCES as readonly string[]).includes(s)
}

// =============================================================================
// SERIALIZED SCHEMA (for API responses — plain strings, no brands)
// =============================================================================

/** Serialized decision for API/SDK responses. */
export const DecisionSerializedSchema = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  question: Schema.NullOr(Schema.String),
  status: Schema.String,
  source: Schema.String,
  commitSha: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  docId: Schema.NullOr(Schema.Number),
  invariantId: Schema.NullOr(Schema.String),
  reviewedBy: Schema.NullOr(Schema.String),
  reviewNote: Schema.NullOr(Schema.String),
  editedContent: Schema.NullOr(Schema.String),
  reviewedAt: Schema.NullOr(Schema.String),
  contentHash: Schema.String,
  supersededBy: Schema.NullOr(Schema.String),
  syncedToDoc: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type DecisionSerialized = typeof DecisionSerializedSchema.Type

/** Convert a Decision to its serialized API form. */
export const serializeDecision = (d: Decision): DecisionSerialized => ({
  id: d.id,
  content: d.content,
  question: d.question,
  status: d.status,
  source: d.source,
  commitSha: d.commitSha,
  runId: d.runId,
  taskId: d.taskId,
  docId: d.docId,
  invariantId: d.invariantId,
  reviewedBy: d.reviewedBy,
  reviewNote: d.reviewNote,
  editedContent: d.editedContent,
  reviewedAt: d.reviewedAt?.toISOString() ?? null,
  contentHash: d.contentHash,
  supersededBy: d.supersededBy,
  syncedToDoc: d.syncedToDoc,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
})

// =============================================================================
// DATABASE ROW TYPES (snake_case from SQLite)
// =============================================================================

export interface DecisionRow {
  id: string
  content: string
  question: string | null
  status: string
  source: string
  commit_sha: string | null
  run_id: string | null
  task_id: string | null
  doc_id: number | null
  invariant_id: string | null
  reviewed_by: string | null
  review_note: string | null
  edited_content: string | null
  reviewed_at: string | null
  content_hash: string
  superseded_by: string | null
  synced_to_doc: number
  created_at: string
  updated_at: string
}
