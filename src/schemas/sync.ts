// Effect Schema definitions for JSONL sync operations.
// See DD-009 for specification details.

import { Schema } from "effect"
import { TASK_STATUSES } from "../schema.js"

// Schema version - v=1 for all sync operations
export const SyncVersion = Schema.Literal(1)

// TaskId schema - matches tx-[a-z0-9]{6,8} pattern
export const TaskIdSchema = Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,8}$/)
)

// TaskStatus schema - matches the status lifecycle
export const TaskStatusSchema = Schema.Literal(...TASK_STATUSES)

// ISO 8601 timestamp pattern (basic validation)
const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
)

// Task data embedded in upsert operations
export const TaskDataSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  status: TaskStatusSchema,
  score: Schema.Number.pipe(Schema.int()),
  parentId: Schema.NullOr(TaskIdSchema),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

// Task upsert operation
export const TaskUpsertOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("upsert"),
  ts: IsoTimestamp,
  id: TaskIdSchema,
  data: TaskDataSchema
})
export type TaskUpsertOp = Schema.Schema.Type<typeof TaskUpsertOp>

// Task delete operation (tombstone)
export const TaskDeleteOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("delete"),
  ts: IsoTimestamp,
  id: TaskIdSchema
})
export type TaskDeleteOp = Schema.Schema.Type<typeof TaskDeleteOp>

// Dependency add operation
export const DepAddOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("dep_add"),
  ts: IsoTimestamp,
  blockerId: TaskIdSchema,
  blockedId: TaskIdSchema
})
export type DepAddOp = Schema.Schema.Type<typeof DepAddOp>

// Dependency remove operation
export const DepRemoveOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("dep_remove"),
  ts: IsoTimestamp,
  blockerId: TaskIdSchema,
  blockedId: TaskIdSchema
})
export type DepRemoveOp = Schema.Schema.Type<typeof DepRemoveOp>

// Union of all sync operations
export const SyncOperation = Schema.Union(
  TaskUpsertOp,
  TaskDeleteOp,
  DepAddOp,
  DepRemoveOp
)
export type SyncOperation = Schema.Schema.Type<typeof SyncOperation>
