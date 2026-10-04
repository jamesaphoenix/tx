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
import { TaskIdSchema, TaskStatusSchema, TaskLinkedDocRefSchema } from "./task.js"
import type { TaskWithDeps } from "./task.js"

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
  assigneeType: Schema.NullOr(Schema.Literal("human", "agent")),
  assigneeId: Schema.NullOr(Schema.String),
  assignedAt: Schema.NullOr(Schema.String), // ISO string
  assignedBy: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  /** Task IDs that block this task */
  blockedBy: Schema.Array(TaskIdSchema),
  /** Task IDs this task blocks */
  blocks: Schema.Array(TaskIdSchema),
  /** Direct child task IDs */
  children: Schema.Array(TaskIdSchema),
  /** Whether this task can be worked on (status is workable AND all blockers are done) */
  isReady: Schema.Boolean,
  /** Docs linked to this task */
  linkedDocs: Schema.Array(TaskLinkedDocRefSchema),
})
export type TaskWithDepsSerialized = typeof TaskWithDepsSerializedSchema.Type

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
  assigneeType: task.assigneeType ?? null,
  assigneeId: task.assigneeId ?? null,
  assignedAt: task.assignedAt?.toISOString() ?? null,
  assignedBy: task.assignedBy ?? null,
  metadata: task.metadata,
  blockedBy: task.blockedBy,
  blocks: task.blocks,
  children: task.children,
  isReady: task.isReady,
  linkedDocs: task.linkedDocs,
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
