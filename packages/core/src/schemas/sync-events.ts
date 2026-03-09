import { Schema } from "effect"

export const SyncEventVersionSchema = Schema.Literal(2)

export const UlidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9A-HJKMNP-TV-Z]{26}$/)
)

export const StreamIdSchema = UlidSchema
export const EventIdSchema = UlidSchema

export const SyncEventTypeSchema = Schema.Literal(
  "task.upsert",
  "task.delete",
  "dep.add",
  "dep.remove",
  "learning.upsert",
  "learning.delete",
  "file_learning.upsert",
  "file_learning.delete",
  "attempt.upsert",
  "pin.upsert",
  "pin.delete",
  "anchor.upsert",
  "anchor.delete",
  "edge.upsert",
  "edge.delete",
  "doc.upsert",
  "doc.delete",
  "doc_link.upsert",
  "task_doc_link.upsert",
  "invariant.upsert",
  "label.upsert",
  "label_assignment.upsert",
  "decision.upsert",
  "decision.delete"
)
export type SyncEventType = typeof SyncEventTypeSchema.Type

const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
)

export const SyncEventEnvelopeSchema = Schema.Struct({
  event_id: EventIdSchema,
  stream_id: StreamIdSchema,
  seq: Schema.Number.pipe(Schema.int(), Schema.positive()),
  ts: IsoTimestamp,
  type: SyncEventTypeSchema,
  entity_id: Schema.String,
  v: SyncEventVersionSchema,
  payload: Schema.Unknown,
})

export type SyncEventEnvelope = typeof SyncEventEnvelopeSchema.Type

export const StreamConfigSchema = Schema.Struct({
  stream_id: StreamIdSchema,
  created_at: IsoTimestamp,
  name: Schema.optional(Schema.String),
})

export type StreamConfig = typeof StreamConfigSchema.Type
