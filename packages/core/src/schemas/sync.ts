// Effect Schema definitions for JSONL sync operations.
// See DD-009 for specification details.

import { Schema } from "effect"
import {
  TASK_STATUSES, TaskAssigneeTypeSchema,
  ANCHOR_TYPES, EDGE_TYPES, NODE_TYPES,
  DOC_KINDS, DOC_STATUSES, DOC_LINK_TYPES, TASK_DOC_LINK_TYPES,
  INVARIANT_ENFORCEMENT_TYPES, INVARIANT_STATUSES,
  DECISION_STATUSES, DECISION_SOURCES,
} from "@jamesaphoenix/tx-types"

// Schema version - v=1 for all sync operations
export const SyncVersion = Schema.Literal(1)

// TaskId schema - matches tx-[a-z0-9]{6,12} pattern
export const TaskIdSchema = Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,12}$/)
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
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
  assigneeType: Schema.optional(Schema.NullOr(TaskAssigneeTypeSchema)),
  assigneeId: Schema.optional(Schema.NullOr(Schema.String)),
  assignedAt: Schema.optional(Schema.NullOr(Schema.String)),
  assignedBy: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

// Task upsert operation
const TaskUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("upsert"),
  ts: IsoTimestamp,
  eventId: Schema.optional(Schema.String),
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
  eventId: Schema.optional(Schema.String),
  id: TaskIdSchema
})
export { TaskDeleteOpSchema as TaskDeleteOp }
export type TaskDeleteOp = typeof TaskDeleteOpSchema.Type

// Dependency add operation
const DepAddOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("dep_add"),
  ts: IsoTimestamp,
  eventId: Schema.optional(Schema.String),
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
  eventId: Schema.optional(Schema.String),
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
// contentHash: SHA256(content + sourceType) for cross-machine dedup (integer IDs collide)
const LearningUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("learning_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: LearningDataSchema
})
export { LearningUpsertOpSchema as LearningUpsertOp }
export type LearningUpsertOp = typeof LearningUpsertOpSchema.Type

// Learning delete operation (tombstone)
// contentHash used for cross-machine identity (integer IDs are machine-local)
const LearningDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("learning_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String
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
// contentHash: SHA256(filePattern + note) for cross-machine dedup
const FileLearningUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("file_learning_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: FileLearningDataSchema
})
export { FileLearningUpsertOpSchema as FileLearningUpsertOp }
export type FileLearningUpsertOp = typeof FileLearningUpsertOpSchema.Type

// File learning delete operation (tombstone)
// contentHash used for cross-machine identity
const FileLearningDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("file_learning_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String
})
export { FileLearningDeleteOpSchema as FileLearningDeleteOp }
export type FileLearningDeleteOp = typeof FileLearningDeleteOpSchema.Type

// Union of file learning sync operations
const FileLearningSyncOperationSchema = Schema.Union(
  FileLearningUpsertOpSchema,
  FileLearningDeleteOpSchema
)
export { FileLearningSyncOperationSchema as FileLearningSyncOperation }
export type FileLearningSyncOperation = typeof FileLearningSyncOperationSchema.Type

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
// contentHash: SHA256(taskId + approach) for cross-machine dedup
const AttemptUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("attempt_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
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

// ----- Pin Sync Operations -----

// Pin data embedded in upsert operations
export const PinDataSchema = Schema.Struct({
  content: Schema.String,
})

// Pin upsert operation
// contentHash: SHA256(id) for cross-machine dedup (pin IDs are user-chosen text keys)
const PinUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("pin_upsert"),
  ts: IsoTimestamp,
  id: Schema.String,
  contentHash: Schema.String,
  data: PinDataSchema
})
export { PinUpsertOpSchema as PinUpsertOp }
export type PinUpsertOp = typeof PinUpsertOpSchema.Type

// Pin delete operation (tombstone)
const PinDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("pin_delete"),
  ts: IsoTimestamp,
  id: Schema.String,
  contentHash: Schema.String
})
export { PinDeleteOpSchema as PinDeleteOp }
export type PinDeleteOp = typeof PinDeleteOpSchema.Type

// Union of pin sync operations
const PinSyncOperationSchema = Schema.Union(
  PinUpsertOpSchema,
  PinDeleteOpSchema
)
export { PinSyncOperationSchema as PinSyncOperation }
export type PinSyncOperation = typeof PinSyncOperationSchema.Type

// ----- Anchor Sync Operations -----

// Anchor type schema
export const AnchorTypeSchema = Schema.Literal(...ANCHOR_TYPES)

// Anchor status schema
export const AnchorStatusSchema = Schema.Literal("valid", "drifted", "invalid")

// Anchor data embedded in upsert operations
export const AnchorDataSchema = Schema.Struct({
  learningContentHash: Schema.String,
  anchorType: AnchorTypeSchema,
  anchorValue: Schema.String,
  filePath: Schema.String,
  symbolFqname: Schema.NullOr(Schema.String),
  lineStart: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  lineEnd: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  contentHash: Schema.NullOr(Schema.String),
  contentPreview: Schema.NullOr(Schema.String),
  status: AnchorStatusSchema,
  pinned: Schema.Boolean
})

// Anchor upsert operation
// contentHash (top-level): SHA256(learningContentHash + filePath + anchorType + anchorValue) for cross-machine dedup
const AnchorUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("anchor_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: AnchorDataSchema
})
export { AnchorUpsertOpSchema as AnchorUpsertOp }
export type AnchorUpsertOp = typeof AnchorUpsertOpSchema.Type

// Anchor delete operation (tombstone)
const AnchorDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("anchor_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String
})
export { AnchorDeleteOpSchema as AnchorDeleteOp }
export type AnchorDeleteOp = typeof AnchorDeleteOpSchema.Type

// Union of anchor sync operations
const AnchorSyncOperationSchema = Schema.Union(
  AnchorUpsertOpSchema,
  AnchorDeleteOpSchema
)
export { AnchorSyncOperationSchema as AnchorSyncOperation }
export type AnchorSyncOperation = typeof AnchorSyncOperationSchema.Type

// ----- Edge Sync Operations -----

// Edge type schema
export const SyncEdgeTypeSchema = Schema.Literal(...EDGE_TYPES)

// Node type schema (for source/target)
export const SyncNodeTypeSchema = Schema.Literal(...NODE_TYPES)

// Edge data embedded in upsert operations
export const EdgeDataSchema = Schema.Struct({
  edgeType: SyncEdgeTypeSchema,
  sourceType: SyncNodeTypeSchema,
  sourceId: Schema.String,
  targetType: SyncNodeTypeSchema,
  targetId: Schema.String,
  weight: Schema.Number,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

// Edge upsert operation
// contentHash: SHA256(edgeType + sourceType + sourceId + targetType + targetId) for cross-machine dedup
const EdgeUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("edge_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: EdgeDataSchema
})
export { EdgeUpsertOpSchema as EdgeUpsertOp }
export type EdgeUpsertOp = typeof EdgeUpsertOpSchema.Type

// Edge delete operation (tombstone / invalidation)
const EdgeDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("edge_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String
})
export { EdgeDeleteOpSchema as EdgeDeleteOp }
export type EdgeDeleteOp = typeof EdgeDeleteOpSchema.Type

// Union of edge sync operations
const EdgeSyncOperationSchema = Schema.Union(
  EdgeUpsertOpSchema,
  EdgeDeleteOpSchema
)
export { EdgeSyncOperationSchema as EdgeSyncOperation }
export type EdgeSyncOperation = typeof EdgeSyncOperationSchema.Type

// ----- Doc Sync Operations -----

// Doc kind schema
export const SyncDocKindSchema = Schema.Literal(...DOC_KINDS)
// Doc status schema
export const SyncDocStatusSchema = Schema.Literal(...DOC_STATUSES)
// Doc names must be simple identifiers (no path separators/traversal).
const SyncDocNameSchema = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
)
// Doc file paths must be relative and must not include traversal segments.
const SyncDocFilePathSchema = Schema.String.pipe(
  Schema.pattern(/^(?![\\/])(?![A-Za-z]:[\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*(?:^|[\\/])\.(?:[\\/]|$)).+$/)
)

// Doc data embedded in upsert operations
export const DocDataSchema = Schema.Struct({
  kind: SyncDocKindSchema,
  name: SyncDocNameSchema,
  title: Schema.String,
  version: Schema.Number.pipe(Schema.int()),
  status: SyncDocStatusSchema,
  filePath: SyncDocFilePathSchema,
  hash: Schema.String,
  parentDocKey: Schema.NullOr(Schema.String),
  lockedAt: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

// Doc upsert operation
// contentHash: SHA256(kind + name + version) for cross-machine dedup
const DocUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("doc_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: DocDataSchema
})
export { DocUpsertOpSchema as DocUpsertOp }
export type DocUpsertOp = typeof DocUpsertOpSchema.Type

// Doc delete operation (tombstone)
const DocDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("doc_delete"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String
})
export { DocDeleteOpSchema as DocDeleteOp }
export type DocDeleteOp = typeof DocDeleteOpSchema.Type

// Union of doc sync operations
const DocSyncOperationSchema = Schema.Union(
  DocUpsertOpSchema,
  DocDeleteOpSchema
)
export { DocSyncOperationSchema as DocSyncOperation }
export type DocSyncOperation = typeof DocSyncOperationSchema.Type

// ----- Doc Link Sync Operations -----

// Doc link type schema
export const SyncDocLinkTypeSchema = Schema.Literal(...DOC_LINK_TYPES)

// Doc link data
export const DocLinkDataSchema = Schema.Struct({
  fromDocKey: Schema.String,
  toDocKey: Schema.String,
  linkType: SyncDocLinkTypeSchema
})

// Doc link upsert operation
// contentHash: SHA256(fromDocKey + toDocKey) for cross-machine dedup
const DocLinkUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("doc_link_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: DocLinkDataSchema
})
export { DocLinkUpsertOpSchema as DocLinkUpsertOp }
export type DocLinkUpsertOp = typeof DocLinkUpsertOpSchema.Type

// Union of doc link sync operations
const DocLinkSyncOperationSchema = Schema.Union(
  DocLinkUpsertOpSchema
)
export { DocLinkSyncOperationSchema as DocLinkSyncOperation }
export type DocLinkSyncOperation = typeof DocLinkSyncOperationSchema.Type

// ----- Task Doc Link Sync Operations -----

// Task doc link type schema
export const SyncTaskDocLinkTypeSchema = Schema.Literal(...TASK_DOC_LINK_TYPES)

// Task doc link data
export const TaskDocLinkDataSchema = Schema.Struct({
  taskId: Schema.String,
  docKey: Schema.String,
  linkType: SyncTaskDocLinkTypeSchema
})

// Task doc link upsert operation
// contentHash: SHA256(taskId + docKey) for cross-machine dedup
const TaskDocLinkUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("task_doc_link_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: TaskDocLinkDataSchema
})
export { TaskDocLinkUpsertOpSchema as TaskDocLinkUpsertOp }
export type TaskDocLinkUpsertOp = typeof TaskDocLinkUpsertOpSchema.Type

// Union of task doc link sync operations
const TaskDocLinkSyncOperationSchema = Schema.Union(
  TaskDocLinkUpsertOpSchema
)
export { TaskDocLinkSyncOperationSchema as TaskDocLinkSyncOperation }
export type TaskDocLinkSyncOperation = typeof TaskDocLinkSyncOperationSchema.Type

// ----- Invariant Sync Operations -----

// Invariant enforcement schema
export const SyncInvariantEnforcementSchema = Schema.Literal(...INVARIANT_ENFORCEMENT_TYPES)
// Invariant status schema
export const SyncInvariantStatusSchema = Schema.Literal(...INVARIANT_STATUSES)

// Invariant data embedded in upsert operations
export const InvariantDataSchema = Schema.Struct({
  id: Schema.String,
  rule: Schema.String,
  enforcement: SyncInvariantEnforcementSchema,
  docKey: Schema.String,
  subsystem: Schema.NullOr(Schema.String),
  testRef: Schema.NullOr(Schema.String),
  lintRule: Schema.NullOr(Schema.String),
  promptRef: Schema.NullOr(Schema.String),
  status: SyncInvariantStatusSchema,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

// Invariant upsert operation
// contentHash: SHA256(id) for cross-machine dedup (invariant IDs are globally unique INV-*)
const InvariantUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("invariant_upsert"),
  ts: IsoTimestamp,
  id: Schema.String,
  contentHash: Schema.String,
  data: InvariantDataSchema
})
export { InvariantUpsertOpSchema as InvariantUpsertOp }
export type InvariantUpsertOp = typeof InvariantUpsertOpSchema.Type

// Union of invariant sync operations
const InvariantSyncOperationSchema = Schema.Union(
  InvariantUpsertOpSchema
)
export { InvariantSyncOperationSchema as InvariantSyncOperation }
export type InvariantSyncOperation = typeof InvariantSyncOperationSchema.Type

// ----- Label Sync Operations -----

// Label data embedded in upsert operations
export const LabelDataSchema = Schema.Struct({
  name: Schema.String,
  color: Schema.String
})

// Label upsert operation
// contentHash: SHA256(lower(name)) for cross-machine dedup (case-insensitive unique)
const LabelUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("label_upsert"),
  ts: IsoTimestamp,
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  data: LabelDataSchema
})
export { LabelUpsertOpSchema as LabelUpsertOp }
export type LabelUpsertOp = typeof LabelUpsertOpSchema.Type

// Label assignment data
export const LabelAssignmentDataSchema = Schema.Struct({
  taskId: Schema.String,
  labelName: Schema.String
})

// Label assignment upsert operation
// contentHash: SHA256(taskId + lower(labelName)) for cross-machine dedup
const LabelAssignmentUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("label_assignment_upsert"),
  ts: IsoTimestamp,
  contentHash: Schema.String,
  data: LabelAssignmentDataSchema
})
export { LabelAssignmentUpsertOpSchema as LabelAssignmentUpsertOp }
export type LabelAssignmentUpsertOp = typeof LabelAssignmentUpsertOpSchema.Type

// Union of label sync operations
const LabelSyncOperationSchema = Schema.Union(
  LabelUpsertOpSchema,
  LabelAssignmentUpsertOpSchema
)
export { LabelSyncOperationSchema as LabelSyncOperation }
export type LabelSyncOperation = typeof LabelSyncOperationSchema.Type

// ----- Decision Sync Operations -----

// Decision status schema
export const SyncDecisionStatusSchema = Schema.Literal(...DECISION_STATUSES)
// Decision source schema
export const SyncDecisionSourceSchema = Schema.Literal(...DECISION_SOURCES)

// Decision data embedded in upsert operations
export const DecisionDataSchema = Schema.Struct({
  content: Schema.String,
  question: Schema.NullOr(Schema.String),
  status: SyncDecisionStatusSchema,
  source: SyncDecisionSourceSchema,
  commitSha: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  docKey: Schema.NullOr(Schema.String),
  invariantId: Schema.NullOr(Schema.String),
  reviewedBy: Schema.NullOr(Schema.String),
  reviewNote: Schema.NullOr(Schema.String),
  editedContent: Schema.NullOr(Schema.String),
  reviewedAt: Schema.NullOr(Schema.String),
  supersededBy: Schema.NullOr(Schema.String),
  syncedToDoc: Schema.Boolean,
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
})

// Decision upsert operation
// id is dec-<12 hex chars>, contentHash is SHA256(content)
const DecisionUpsertOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("decision_upsert"),
  ts: IsoTimestamp,
  id: Schema.String,
  contentHash: Schema.String,
  data: DecisionDataSchema,
})
export { DecisionUpsertOpSchema as DecisionUpsertOp }
export type DecisionUpsertOp = typeof DecisionUpsertOpSchema.Type

// Decision delete operation (tombstone)
const DecisionDeleteOpSchema = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("decision_delete"),
  ts: IsoTimestamp,
  id: Schema.String,
  contentHash: Schema.String,
})
export { DecisionDeleteOpSchema as DecisionDeleteOp }
export type DecisionDeleteOp = typeof DecisionDeleteOpSchema.Type

// Union of decision sync operations
const DecisionSyncOperationSchema = Schema.Union(
  DecisionUpsertOpSchema,
  DecisionDeleteOpSchema,
)
export { DecisionSyncOperationSchema as DecisionSyncOperation }
export type DecisionSyncOperation = typeof DecisionSyncOperationSchema.Type

// ----- Combined Sync Operations -----

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
  AttemptUpsertOpSchema,
  PinUpsertOpSchema,
  PinDeleteOpSchema,
  AnchorUpsertOpSchema,
  AnchorDeleteOpSchema,
  EdgeUpsertOpSchema,
  EdgeDeleteOpSchema,
  DocUpsertOpSchema,
  DocDeleteOpSchema,
  DocLinkUpsertOpSchema,
  TaskDocLinkUpsertOpSchema,
  InvariantUpsertOpSchema,
  LabelUpsertOpSchema,
  LabelAssignmentUpsertOpSchema,
  DecisionUpsertOpSchema,
  DecisionDeleteOpSchema
)
export { AnySyncOperationSchema as AnySyncOperation }
export type AnySyncOperation = typeof AnySyncOperationSchema.Type
