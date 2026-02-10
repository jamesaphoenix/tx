/**
 * Response types for tx
 *
 * Shared response schemas optimized for agent consumption.
 * All types use consistent camelCase naming and provide full context in every response.
 * Serialized types convert Date objects to ISO strings for JSON output.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 *
 * Design principles:
 * - Consistent field naming across CLI, MCP, API, and SDK
 * - Full context in every response (no bare Task, always TaskWithDeps)
 * - Serialized types ready for JSON.stringify without custom replacers
 * - Standard envelopes for lists, pagination, and actions
 */

import { Schema } from "effect"
import { TaskIdSchema, TaskStatusSchema } from "./task.js"
import type { TaskWithDeps } from "./task.js"
import { LearningSourceTypeSchema } from "./learning.js"
import type { Learning, LearningWithScore } from "./learning.js"
import { FileLearningIdSchema } from "./file-learning.js"
import type { FileLearning } from "./file-learning.js"
import { RunIdSchema, RunStatusSchema } from "./run.js"
import type { Run } from "./run.js"
import { AttemptIdSchema, AttemptOutcomeSchema } from "./attempt.js"
import type { Attempt } from "./attempt.js"
import { MessageIdSchema, MessageStatusSchema } from "./message.js"
import type { Message } from "./message.js"
import { EdgeTypeSchema } from "./edge.js"

// =============================================================================
// SERIALIZED ENTITY SCHEMAS
// =============================================================================
// These schemas mirror their domain counterparts but with Date fields as ISO strings.
// Use these for JSON responses across CLI, MCP, API, and SDK.

/**
 * TaskWithDeps serialized for JSON output.
 * All Date fields converted to ISO strings.
 * This is the REQUIRED return type for all external APIs (per Doctrine Rule 1).
 */
export const TaskWithDepsSerializedSchema = Schema.Struct({
  id: TaskIdSchema,
  title: Schema.String,
  description: Schema.String,
  status: TaskStatusSchema,
  parentId: Schema.NullOr(TaskIdSchema),
  score: Schema.Number.pipe(Schema.int()),
  createdAt: Schema.String, // ISO string
  updatedAt: Schema.String, // ISO string
  completedAt: Schema.NullOr(Schema.String), // ISO string
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  /** Task IDs that block this task */
  blockedBy: Schema.Array(TaskIdSchema),
  /** Task IDs this task blocks */
  blocks: Schema.Array(TaskIdSchema),
  /** Direct child task IDs */
  children: Schema.Array(TaskIdSchema),
  /** Whether this task can be worked on (status is workable AND all blockers are done) */
  isReady: Schema.Boolean,
})
export type TaskWithDepsSerialized = typeof TaskWithDepsSerializedSchema.Type

/**
 * Learning serialized for JSON output.
 * All Date fields converted to ISO strings.
 * Embedding as number array instead of Float32Array.
 */
export const LearningSerializedSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  content: Schema.String,
  sourceType: LearningSourceTypeSchema,
  sourceRef: Schema.NullOr(Schema.String),
  createdAt: Schema.String, // ISO string
  keywords: Schema.Array(Schema.String),
  category: Schema.NullOr(Schema.String),
  usageCount: Schema.Number.pipe(Schema.int()),
  lastUsedAt: Schema.NullOr(Schema.String), // ISO string
  outcomeScore: Schema.NullOr(Schema.Number),
  /** Embedding vector as number array (null if not computed) */
  embedding: Schema.NullOr(Schema.Array(Schema.Number)),
})
export type LearningSerialized = typeof LearningSerializedSchema.Type

/**
 * LearningWithScore serialized for JSON output.
 * Extends LearningSerialized with relevance scoring fields.
 */
export const LearningWithScoreSerializedSchema = Schema.Struct({
  ...LearningSerializedSchema.fields,
  /** Combined relevance score (0-1) */
  relevanceScore: Schema.Number,
  /** BM25 text search score */
  bm25Score: Schema.Number,
  /** Vector similarity score (0-1) */
  vectorScore: Schema.Number,
  /** Recency score (0-1, higher for newer) */
  recencyScore: Schema.Number,
  /** RRF (Reciprocal Rank Fusion) score from combining BM25 and vector rankings */
  rrfScore: Schema.Number,
  /** Rank in BM25 results (1-indexed, 0 if not in BM25 results) */
  bm25Rank: Schema.Number.pipe(Schema.int()),
  /** Rank in vector similarity results (1-indexed, 0 if not in vector results) */
  vectorRank: Schema.Number.pipe(Schema.int()),
  /** LLM reranker score (0-1, optional - only present when reranking is applied) */
  rerankerScore: Schema.optional(Schema.Number),
  /** Number of hops from seed (0 = direct match from RRF, 1+ = expanded via graph) */
  expansionHops: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Path of learning IDs from seed to this learning (only for expanded results) */
  expansionPath: Schema.optional(Schema.Array(Schema.Number.pipe(Schema.int()))),
  /** Edge type that led to this learning (null for direct matches) */
  sourceEdge: Schema.optional(Schema.NullOr(EdgeTypeSchema)),
  /** Feedback score from historical usage (0-1, 0.5 = neutral, optional) */
  feedbackScore: Schema.optional(Schema.Number),
})
export type LearningWithScoreSerialized = typeof LearningWithScoreSerializedSchema.Type

/**
 * FileLearning serialized for JSON output.
 */
export const FileLearningsSerializedSchema = Schema.Struct({
  id: FileLearningIdSchema,
  filePattern: Schema.String,
  note: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  createdAt: Schema.String, // ISO string
})
export type FileLearningsSerialized = typeof FileLearningsSerializedSchema.Type

/**
 * Run serialized for JSON output.
 */
export const RunSerializedSchema = Schema.Struct({
  id: RunIdSchema,
  taskId: Schema.NullOr(Schema.String),
  agent: Schema.String,
  startedAt: Schema.String, // ISO string
  endedAt: Schema.NullOr(Schema.String), // ISO string
  status: RunStatusSchema,
  exitCode: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  pid: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  transcriptPath: Schema.NullOr(Schema.String),
  stderrPath: Schema.NullOr(Schema.String),
  stdoutPath: Schema.NullOr(Schema.String),
  contextInjected: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type RunSerialized = typeof RunSerializedSchema.Type

/**
 * Attempt serialized for JSON output.
 */
export const AttemptSerializedSchema = Schema.Struct({
  id: AttemptIdSchema,
  taskId: TaskIdSchema,
  approach: Schema.String,
  outcome: AttemptOutcomeSchema,
  reason: Schema.NullOr(Schema.String),
  createdAt: Schema.String, // ISO string
})
export type AttemptSerialized = typeof AttemptSerializedSchema.Type

// =============================================================================
// SERIALIZATION FUNCTIONS
// =============================================================================
// Pure functions to convert domain types to serialized types.
// Use these across CLI, MCP, API, and SDK for consistent JSON output.

/**
 * Serialize a TaskWithDeps for JSON output.
 * Converts Date objects to ISO strings.
 */
export const serializeTask = (task: TaskWithDeps): TaskWithDepsSerialized => ({
  id: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  parentId: task.parentId,
  score: task.score,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  completedAt: task.completedAt?.toISOString() ?? null,
  metadata: task.metadata,
  blockedBy: task.blockedBy,
  blocks: task.blocks,
  children: task.children,
  isReady: task.isReady,
})

/**
 * Serialize a Learning for JSON output.
 * Converts Date objects to ISO strings.
 * Embeddings are omitted (null) to avoid serialization overhead —
 * Float32Array → Array.from() → JSON.stringify is expensive and
 * external consumers never need raw embedding vectors.
 */
export const serializeLearning = (learning: Learning): LearningSerialized => ({
  id: learning.id,
  content: learning.content,
  sourceType: learning.sourceType,
  sourceRef: learning.sourceRef,
  createdAt: learning.createdAt.toISOString(),
  keywords: learning.keywords,
  category: learning.category,
  usageCount: learning.usageCount,
  lastUsedAt: learning.lastUsedAt?.toISOString() ?? null,
  outcomeScore: learning.outcomeScore,
  embedding: null,
})

/**
 * Serialize a LearningWithScore for JSON output.
 * Extends serializeLearning with score fields.
 */
export const serializeLearningWithScore = (learning: LearningWithScore): LearningWithScoreSerialized => ({
  ...serializeLearning(learning),
  relevanceScore: learning.relevanceScore,
  bm25Score: learning.bm25Score,
  vectorScore: learning.vectorScore,
  recencyScore: learning.recencyScore,
  rrfScore: learning.rrfScore,
  bm25Rank: learning.bm25Rank,
  vectorRank: learning.vectorRank,
  rerankerScore: learning.rerankerScore,
  expansionHops: learning.expansionHops,
  expansionPath: learning.expansionPath,
  sourceEdge: learning.sourceEdge,
  feedbackScore: learning.feedbackScore,
})

/**
 * Serialize a FileLearning for JSON output.
 */
export const serializeFileLearning = (learning: FileLearning): FileLearningsSerialized => ({
  id: learning.id,
  filePattern: learning.filePattern,
  note: learning.note,
  taskId: learning.taskId,
  createdAt: learning.createdAt.toISOString(),
})

/**
 * Serialize a Run for JSON output.
 */
export const serializeRun = (run: Run): RunSerialized => ({
  id: run.id,
  taskId: run.taskId,
  agent: run.agent,
  startedAt: run.startedAt.toISOString(),
  endedAt: run.endedAt?.toISOString() ?? null,
  status: run.status,
  exitCode: run.exitCode,
  pid: run.pid,
  transcriptPath: run.transcriptPath,
  stderrPath: run.stderrPath,
  stdoutPath: run.stdoutPath,
  contextInjected: run.contextInjected,
  summary: run.summary,
  errorMessage: run.errorMessage,
  metadata: run.metadata,
})

/**
 * Serialize an Attempt for JSON output.
 */
export const serializeAttempt = (attempt: Attempt): AttemptSerialized => ({
  id: attempt.id,
  taskId: attempt.taskId,
  approach: attempt.approach,
  outcome: attempt.outcome,
  reason: attempt.reason,
  createdAt: attempt.createdAt.toISOString(),
})

// =============================================================================
// RESPONSE ENVELOPES
// =============================================================================
// Standard response wrappers used across all interfaces.
// These remain as interfaces since they are generic container types.

/**
 * Standard list response with count.
 * Use for simple lists without pagination.
 */
export interface ListResponse<T> {
  readonly items: readonly T[]
  readonly count: number
}

/**
 * Paginated response with cursor-based pagination.
 * Use for large lists that need pagination.
 */
export interface PaginatedResponse<T> {
  readonly items: readonly T[]
  /** Total count of items matching the filter (not just this page) */
  readonly total: number
  /** Cursor for next page, null if no more pages */
  readonly nextCursor: string | null
  /** Whether there are more items after this page */
  readonly hasMore: boolean
}

/**
 * Standard action response for mutations.
 * Use for create, update, delete operations.
 */
export interface ActionResponse<T = void> {
  readonly success: boolean
  /** The affected resource (for create/update) */
  readonly data?: T
  /** Human-readable message describing the action */
  readonly message?: string
}

/**
 * Error response with structured error info.
 * Use for all error responses.
 */
export const ErrorResponseSchema = Schema.Struct({
  error: Schema.Struct({
    /** Error code (e.g., "NOT_FOUND", "VALIDATION_ERROR") */
    code: Schema.String,
    /** Human-readable error message */
    message: Schema.String,
    /** Additional error details */
    details: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  }),
})
export type ErrorResponse = typeof ErrorResponseSchema.Type

// =============================================================================
// TASK RESPONSE SCHEMAS
// =============================================================================
// Standard task response shapes used across CLI, MCP, API, and SDK.

/** Response for listing ready tasks. */
export const TaskReadyResponseSchema = Schema.Struct({
  tasks: Schema.Array(TaskWithDepsSerializedSchema),
  count: Schema.Number.pipe(Schema.int()),
})
export type TaskReadyResponse = typeof TaskReadyResponseSchema.Type

/** Response for listing tasks with pagination. */
export const TaskListResponseSchema = Schema.Struct({
  items: Schema.Array(TaskWithDepsSerializedSchema),
  tasks: Schema.Array(TaskWithDepsSerializedSchema),
  total: Schema.Number.pipe(Schema.int()),
  nextCursor: Schema.NullOr(Schema.String),
  hasMore: Schema.Boolean,
})
export type TaskListResponse = typeof TaskListResponseSchema.Type

/** Response for getting a single task with full details. */
export const TaskDetailResponseSchema = Schema.Struct({
  task: TaskWithDepsSerializedSchema,
  /** Tasks that block this task (full details, not just IDs) */
  blockedByTasks: Schema.Array(TaskWithDepsSerializedSchema),
  /** Tasks that this task blocks (full details, not just IDs) */
  blocksTasks: Schema.Array(TaskWithDepsSerializedSchema),
  /** Child tasks (full details, not just IDs) */
  childTasks: Schema.Array(TaskWithDepsSerializedSchema),
})
export type TaskDetailResponse = typeof TaskDetailResponseSchema.Type

/** Response for completing a task. */
export const TaskCompletionResponseSchema = Schema.Struct({
  /** The completed task */
  task: TaskWithDepsSerializedSchema,
  /** Tasks that became ready after this completion */
  nowReady: Schema.Array(TaskWithDepsSerializedSchema),
})
export type TaskCompletionResponse = typeof TaskCompletionResponseSchema.Type

/** Response for task tree/hierarchy queries. */
export const TaskTreeResponseSchema = Schema.Struct({
  tasks: Schema.Array(TaskWithDepsSerializedSchema),
  /** Root task ID */
  rootId: TaskIdSchema,
})
export type TaskTreeResponse = typeof TaskTreeResponseSchema.Type

// =============================================================================
// LEARNING RESPONSE SCHEMAS
// =============================================================================
// Standard learning response shapes.

/** Response for searching learnings. */
export const LearningSearchResponseSchema = Schema.Struct({
  learnings: Schema.Array(LearningWithScoreSerializedSchema),
  query: Schema.String,
  count: Schema.Number.pipe(Schema.int()),
})
export type LearningSearchResponse = typeof LearningSearchResponseSchema.Type

/** Response for getting contextual learnings for a task. */
export const ContextResponseSchema = Schema.Struct({
  taskId: Schema.String,
  taskTitle: Schema.String,
  learnings: Schema.Array(LearningWithScoreSerializedSchema),
  searchQuery: Schema.String,
  /** Search duration in milliseconds */
  searchDuration: Schema.Number,
  /** Graph expansion statistics (only present when useGraph=true) */
  graphExpansion: Schema.optional(Schema.Struct({
    enabled: Schema.Boolean,
    seedCount: Schema.Number.pipe(Schema.int()),
    expandedCount: Schema.Number.pipe(Schema.int()),
    maxDepthReached: Schema.Number.pipe(Schema.int()),
  })),
})
export type ContextResponse = typeof ContextResponseSchema.Type

/** Response for file learnings. */
export const FileLearningListResponseSchema = Schema.Struct({
  learnings: Schema.Array(FileLearningsSerializedSchema),
  count: Schema.Number.pipe(Schema.int()),
  /** File path used for matching (if provided) */
  matchedPath: Schema.optional(Schema.String),
})
export type FileLearningListResponse = typeof FileLearningListResponseSchema.Type

// =============================================================================
// RUN RESPONSE SCHEMAS
// =============================================================================
// Standard run response shapes.

/** Response for listing runs. */
export const RunListResponseSchema = Schema.Struct({
  runs: Schema.Array(RunSerializedSchema),
  count: Schema.Number.pipe(Schema.int()),
})
export type RunListResponse = typeof RunListResponseSchema.Type

/** Response for getting a single run with details. */
export const RunDetailResponseSchema = Schema.Struct({
  run: RunSerializedSchema,
  /** Associated task (if any) */
  task: Schema.optional(TaskWithDepsSerializedSchema),
  /** Attempts made during this run */
  attempts: Schema.Array(AttemptSerializedSchema),
})
export type RunDetailResponse = typeof RunDetailResponseSchema.Type

// =============================================================================
// SYNC RESPONSE SCHEMAS
// =============================================================================
// Standard sync operation response shapes.

/** Response for sync export operation. */
export const SyncExportResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  outputPath: Schema.String,
  taskCount: Schema.Number.pipe(Schema.int()),
  learningCount: Schema.Number.pipe(Schema.int()),
})
export type SyncExportResponse = typeof SyncExportResponseSchema.Type

/** Response for sync import operation. */
export const SyncImportResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  inputPath: Schema.String,
  tasksImported: Schema.Number.pipe(Schema.int()),
  learningsImported: Schema.Number.pipe(Schema.int()),
  conflicts: Schema.Number.pipe(Schema.int()),
})
export type SyncImportResponse = typeof SyncImportResponseSchema.Type

// =============================================================================
// MESSAGE SERIALIZED SCHEMAS
// =============================================================================
// Serialized message types for JSON output.

/**
 * Message serialized for JSON output.
 * All Date fields converted to ISO strings.
 */
export const MessageSerializedSchema = Schema.Struct({
  id: MessageIdSchema,
  channel: Schema.String,
  sender: Schema.String,
  content: Schema.String,
  status: MessageStatusSchema,
  correlationId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  createdAt: Schema.String, // ISO string
  ackedAt: Schema.NullOr(Schema.String), // ISO string
  expiresAt: Schema.NullOr(Schema.String), // ISO string
})
export type MessageSerialized = typeof MessageSerializedSchema.Type

/**
 * Serialize a Message for JSON output.
 * Converts Date objects to ISO strings.
 */
export const serializeMessage = (message: Message): MessageSerialized => ({
  id: message.id,
  channel: message.channel,
  sender: message.sender,
  content: message.content,
  status: message.status,
  correlationId: message.correlationId,
  taskId: message.taskId,
  metadata: message.metadata,
  createdAt: message.createdAt.toISOString(),
  ackedAt: message.ackedAt?.toISOString() ?? null,
  expiresAt: message.expiresAt?.toISOString() ?? null,
})

// =============================================================================
// MESSAGE RESPONSE SCHEMAS
// =============================================================================

/** Response for reading inbox messages. */
export const InboxResponseSchema = Schema.Struct({
  messages: Schema.Array(MessageSerializedSchema),
  channel: Schema.String,
  count: Schema.Number.pipe(Schema.int()),
})
export type InboxResponse = typeof InboxResponseSchema.Type
