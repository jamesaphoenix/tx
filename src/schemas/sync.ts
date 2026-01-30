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

// Union of task sync operations
export const TaskSyncOperation = Schema.Union(
  TaskUpsertOp,
  TaskDeleteOp,
  DepAddOp,
  DepRemoveOp
)
export type TaskSyncOperation = Schema.Schema.Type<typeof TaskSyncOperation>

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
export const LearningUpsertOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("learning_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  data: LearningDataSchema
})
export type LearningUpsertOp = Schema.Schema.Type<typeof LearningUpsertOp>

// Learning delete operation (tombstone)
export const LearningDeleteOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("learning_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int())
})
export type LearningDeleteOp = Schema.Schema.Type<typeof LearningDeleteOp>

// Union of learning sync operations
export const LearningSyncOperation = Schema.Union(
  LearningUpsertOp,
  LearningDeleteOp
)
export type LearningSyncOperation = Schema.Schema.Type<typeof LearningSyncOperation>

// ----- File Learning Sync Operations -----

// File learning data embedded in upsert operations
export const FileLearningDataSchema = Schema.Struct({
  filePattern: Schema.String,
  note: Schema.String,
  taskId: Schema.NullOr(Schema.String)
})

// File learning upsert operation
export const FileLearningUpsertOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("file_learning_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  data: FileLearningDataSchema
})
export type FileLearningUpsertOp = Schema.Schema.Type<typeof FileLearningUpsertOp>

// File learning delete operation (tombstone)
export const FileLearningDeleteOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("file_learning_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int())
})
export type FileLearningDeleteOp = Schema.Schema.Type<typeof FileLearningDeleteOp>

// Union of file learning sync operations
export const FileLearnningSyncOperation = Schema.Union(
  FileLearningUpsertOp,
  FileLearningDeleteOp
)
export type FileLearnningSyncOperation = Schema.Schema.Type<typeof FileLearnningSyncOperation>

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
export const AttemptUpsertOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("attempt_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  data: AttemptDataSchema
})
export type AttemptUpsertOp = Schema.Schema.Type<typeof AttemptUpsertOp>

// Union of attempt sync operations
export const AttemptSyncOperation = Schema.Union(
  AttemptUpsertOp
)
export type AttemptSyncOperation = Schema.Schema.Type<typeof AttemptSyncOperation>

// ----- Combined Sync Operations -----

// Legacy alias for backward compatibility
export const SyncOperation = TaskSyncOperation
export type SyncOperation = TaskSyncOperation

// All sync operations combined (for parsing any JSONL file)
export const AnySyncOperation = Schema.Union(
  TaskUpsertOp,
  TaskDeleteOp,
  DepAddOp,
  DepRemoveOp,
  LearningUpsertOp,
  LearningDeleteOp,
  FileLearningUpsertOp,
  FileLearningDeleteOp,
  AttemptUpsertOp
)
export type AnySyncOperation = Schema.Schema.Type<typeof AnySyncOperation>
