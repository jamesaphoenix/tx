// Effect Schema definitions for JSONL sync operations.
// See DD-009 for specification details.

import { Schema } from "effect"
import { TASK_STATUSES } from "@jamesaphoenix/tx-types"

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
const TaskUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("upsert"),
  ts: IsoTimestamp,
  id: TaskIdSchema,
  data: TaskDataSchema
})
export { TaskUpsertOpSchema as TaskUpsertOp }
export type TaskUpsertOp = typeof TaskUpsertOpSchema.Type

// Task delete operation (tombstone)
const TaskDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("delete"),
  ts: IsoTimestamp,
  id: TaskIdSchema
})
export { TaskDeleteOpSchema as TaskDeleteOp }
export type TaskDeleteOp = typeof TaskDeleteOpSchema.Type

// Dependency add operation
const DepAddOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("dep_add"),
  ts: IsoTimestamp,
  blockerId: TaskIdSchema,
  blockedId: TaskIdSchema
})
export { DepAddOpSchema as DepAddOp }
export type DepAddOp = typeof DepAddOpSchema.Type

// Dependency remove operation
const DepRemoveOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("dep_remove"),
  ts: IsoTimestamp,
  blockerId: TaskIdSchema,
  blockedId: TaskIdSchema
})
export { DepRemoveOpSchema as DepRemoveOp }
export type DepRemoveOp = typeof DepRemoveOpSchema.Type

// Union of task sync operations
const TaskSyncOperationSchema = Schema.Union(
  TaskUpsertOpSchema,
  TaskDeleteOpSchema,
  DepAddOpSchema,
  DepRemoveOpSchema
)
export { TaskSyncOperationSchema as TaskSyncOperation }
export type TaskSyncOperation = typeof TaskSyncOperationSchema.Type

// ----- Learning Sync Operations -----

// Learning source type schema
export const LearningSourceTypeSchema = Schema.Literal(
  "compaction", "run", "manual", "claude_md"
)

// Learning data embedded in upsert operations
export const LearningDataSchema = Schema.Struct({
  content: Schema.String,
  sourceType: LearningSourceTypeSchema,
  sourceRef: Schema.NullOr(Schema.String),
  keywords: Schema.Array(Schema.String),
  category: Schema.NullOr(Schema.String)
})

// Learning upsert operation
const LearningUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("learning_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  data: LearningDataSchema
})
export { LearningUpsertOpSchema as LearningUpsertOp }
export type LearningUpsertOp = typeof LearningUpsertOpSchema.Type

// Learning delete operation (tombstone)
const LearningDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("learning_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int())
})
export { LearningDeleteOpSchema as LearningDeleteOp }
export type LearningDeleteOp = typeof LearningDeleteOpSchema.Type

// Union of learning sync operations
const LearningSyncOperationSchema = Schema.Union(
  LearningUpsertOpSchema,
  LearningDeleteOpSchema
)
export { LearningSyncOperationSchema as LearningSyncOperation }
export type LearningSyncOperation = typeof LearningSyncOperationSchema.Type

// ----- File Learning Sync Operations -----

// File learning data embedded in upsert operations
export const FileLearningDataSchema = Schema.Struct({
  filePattern: Schema.String,
  note: Schema.String,
  taskId: Schema.NullOr(Schema.String)
})

// File learning upsert operation
const FileLearningUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("file_learning_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  data: FileLearningDataSchema
})
export { FileLearningUpsertOpSchema as FileLearningUpsertOp }
export type FileLearningUpsertOp = typeof FileLearningUpsertOpSchema.Type

// File learning delete operation (tombstone)
const FileLearningDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("file_learning_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int())
})
export { FileLearningDeleteOpSchema as FileLearningDeleteOp }
export type FileLearningDeleteOp = typeof FileLearningDeleteOpSchema.Type

// Union of file learning sync operations
const FileLearnningSyncOperationSchema = Schema.Union(
  FileLearningUpsertOpSchema,
  FileLearningDeleteOpSchema
)
export { FileLearnningSyncOperationSchema as FileLearnningSyncOperation }
export type FileLearnningSyncOperation = typeof FileLearnningSyncOperationSchema.Type

// ----- Attempt Sync Operations -----

// Attempt outcome schema
export const AttemptOutcomeSchema = Schema.Literal("failed", "succeeded")

// Attempt data embedded in upsert operations
export const AttemptDataSchema = Schema.Struct({
  taskId: Schema.String,
  approach: Schema.String,
  outcome: AttemptOutcomeSchema,
  reason: Schema.NullOr(Schema.String)
})

// Attempt upsert operation (attempts are immutable, no delete operation)
const AttemptUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("attempt_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  data: AttemptDataSchema
})
export { AttemptUpsertOpSchema as AttemptUpsertOp }
export type AttemptUpsertOp = typeof AttemptUpsertOpSchema.Type

// Union of attempt sync operations
const AttemptSyncOperationSchema = Schema.Union(
  AttemptUpsertOpSchema
)
export { AttemptSyncOperationSchema as AttemptSyncOperation }
export type AttemptSyncOperation = typeof AttemptSyncOperationSchema.Type

// ----- Combined Sync Operations -----

// Legacy alias for backward compatibility
export { TaskSyncOperationSchema as SyncOperation }
export type SyncOperation = typeof TaskSyncOperationSchema.Type

// All sync operations combined (for parsing any JSONL file)
const AnySyncOperationSchema = Schema.Union(
  TaskUpsertOpSchema,
  TaskDeleteOpSchema,
  DepAddOpSchema,
  DepRemoveOpSchema,
  LearningUpsertOpSchema,
  LearningDeleteOpSchema,
  FileLearningUpsertOpSchema,
  FileLearningDeleteOpSchema,
  AttemptUpsertOpSchema
)
export { AnySyncOperationSchema as AnySyncOperation }
export type AnySyncOperation = typeof AnySyncOperationSchema.Type
