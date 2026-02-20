/**
 * Task types for tx
 *
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * All valid task statuses in lifecycle order.
 * backlog → ready → planning → active → blocked → review → human_needs_to_review → done
 */
export const TASK_STATUSES = [
  "backlog",
  "ready",
  "planning",
  "active",
  "blocked",
  "review",
  "human_needs_to_review",
  "done",
] as const;

/**
 * Valid task assignment intent values.
 * Assignment is routing metadata, not lease ownership.
 */
export const TASK_ASSIGNEE_TYPES = ["human", "agent"] as const;

/**
 * Regex pattern for valid task IDs.
 */
export const TASK_ID_PATTERN = /^tx-[a-z0-9]{6,12}$/;

/**
 * Valid status transitions map.
 * Used to validate status changes follow the lifecycle.
 */
export const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ["ready", "planning", "active", "blocked", "done"],
  ready: ["planning", "active", "blocked", "done"],
  planning: ["ready", "active", "blocked", "done"],
  active: ["blocked", "review", "done"],
  blocked: ["backlog", "ready", "planning", "active"],
  review: ["active", "human_needs_to_review", "done"],
  human_needs_to_review: ["active", "review", "done"],
  done: ["backlog"],
} as const;

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Task status - one of the valid lifecycle states. */
export const TaskStatusSchema = Schema.Literal(...TASK_STATUSES)
export type TaskStatus = typeof TaskStatusSchema.Type

/** Task assignment intent type. */
export const TaskAssigneeTypeSchema = Schema.Literal(...TASK_ASSIGNEE_TYPES)
export type TaskAssigneeType = typeof TaskAssigneeTypeSchema.Type

/** Task ID - branded string matching tx-[a-z0-9]{6,12}. */
export const TaskIdSchema = Schema.String.pipe(
  Schema.pattern(TASK_ID_PATTERN),
  Schema.brand("TaskId")
)
export type TaskId = typeof TaskIdSchema.Type

/**
 * Core task entity without dependency information.
 * IMPORTANT: Per doctrine Rule 1, never return bare Task to external consumers.
 * Always use TaskWithDeps for API responses.
 */
export const TaskSchema = Schema.Struct({
  id: TaskIdSchema,
  title: Schema.String,
  description: Schema.String,
  status: TaskStatusSchema,
  parentId: Schema.NullOr(TaskIdSchema),
  score: Schema.Number.pipe(Schema.int()),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  completedAt: Schema.NullOr(Schema.DateFromSelf),
  assigneeType: Schema.NullOr(TaskAssigneeTypeSchema),
  assigneeId: Schema.NullOr(Schema.String),
  assignedAt: Schema.NullOr(Schema.DateFromSelf),
  assignedBy: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type Task = typeof TaskSchema.Type

/**
 * Task with full dependency information.
 * This is the REQUIRED return type for all external APIs (Rule 1).
 */
export const TaskWithDepsSchema = Schema.Struct({
  ...TaskSchema.fields,
  /** Task IDs that block this task */
  blockedBy: Schema.Array(TaskIdSchema),
  /** Task IDs this task blocks */
  blocks: Schema.Array(TaskIdSchema),
  /** Direct child task IDs */
  children: Schema.Array(TaskIdSchema),
  /** Whether this task can be worked on (status is workable AND all blockers are done) */
  isReady: Schema.Boolean,
})
export type TaskWithDeps = typeof TaskWithDepsSchema.Type

/** Recursive tree structure for task hierarchy. */
export const TaskTreeSchema: Schema.Schema<TaskTree, any> = Schema.Struct({
  task: TaskSchema,
  children: Schema.Array(Schema.suspend((): Schema.Schema<TaskTree, any> => TaskTreeSchema)),
})
export type TaskTree = {
  readonly task: Task
  readonly children: readonly TaskTree[]
}

/** Task dependency relationship. */
export const TaskDependencySchema = Schema.Struct({
  blockerId: TaskIdSchema,
  blockedId: TaskIdSchema,
  createdAt: Schema.DateFromSelf,
})
export type TaskDependency = typeof TaskDependencySchema.Type

/** Input for creating a new task. */
export const CreateTaskInputSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  score: Schema.optional(Schema.Number.pipe(Schema.int())),
  assigneeType: Schema.optional(Schema.NullOr(TaskAssigneeTypeSchema)),
  assigneeId: Schema.optional(Schema.NullOr(Schema.String)),
  assignedAt: Schema.optional(Schema.NullOr(Schema.DateFromSelf)),
  assignedBy: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type CreateTaskInput = typeof CreateTaskInputSchema.Type

/** Input for updating an existing task. */
export const UpdateTaskInputSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  status: Schema.optional(TaskStatusSchema),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  score: Schema.optional(Schema.Number.pipe(Schema.int())),
  assigneeType: Schema.optional(Schema.NullOr(TaskAssigneeTypeSchema)),
  assigneeId: Schema.optional(Schema.NullOr(Schema.String)),
  assignedAt: Schema.optional(Schema.NullOr(Schema.DateFromSelf)),
  assignedBy: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type UpdateTaskInput = typeof UpdateTaskInputSchema.Type

/** Cursor for pagination (score + id based). */
export const TaskCursorSchema = Schema.Struct({
  score: Schema.Number,
  id: Schema.String,
})
export type TaskCursor = typeof TaskCursorSchema.Type

/** Filter options for task queries. */
export const TaskFilterSchema = Schema.Struct({
  status: Schema.optional(Schema.Union(TaskStatusSchema, Schema.Array(TaskStatusSchema))),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  limit: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Search in title and description (case-insensitive) */
  search: Schema.optional(Schema.String),
  /** Cursor for keyset pagination (returns tasks after this cursor) */
  cursor: Schema.optional(TaskCursorSchema),
  /** Exclude tasks that have an active claim in task_claims (prevents thundering herd) */
  excludeClaimed: Schema.optional(Schema.Boolean),
})
export type TaskFilter = typeof TaskFilterSchema.Type

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Check if a string is a valid task status.
 */
export const isValidTaskStatus = (status: string): status is TaskStatus => {
  return TASK_STATUSES.includes(status as TaskStatus);
};

/**
 * Error thrown when a task status is invalid.
 */
export class InvalidTaskStatusError extends Error {
  constructor(public readonly status: string) {
    super(`Invalid task status: "${status}". Valid statuses: ${TASK_STATUSES.join(", ")}`);
    this.name = "InvalidTaskStatusError";
  }
}

/**
 * Validate and return a TaskStatus, or throw if invalid.
 */
export const assertTaskStatus = (status: string): TaskStatus => {
  if (!isValidTaskStatus(status)) {
    throw new InvalidTaskStatusError(status);
  }
  return status;
};

/**
 * Check if a string is a valid task ID format.
 */
export const isValidTaskId = (id: string): id is TaskId => {
  return TASK_ID_PATTERN.test(id);
};

/**
 * Error thrown when a task ID is invalid.
 */
export class InvalidTaskIdError extends Error {
  constructor(public readonly id: string) {
    super(`Invalid task ID: "${id}". Expected format: tx-[a-z0-9]{6,12}`);
    this.name = "InvalidTaskIdError";
  }
}

/**
 * Validate and return a branded TaskId, or throw if invalid.
 */
export const assertTaskId = (id: string): TaskId => {
  if (!isValidTaskId(id)) {
    throw new InvalidTaskIdError(id);
  }
  return id;
};

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for tasks (snake_case from SQLite). */
export interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  parent_id: string | null;
  score: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  assignee_type?: string | null;
  assignee_id?: string | null;
  assigned_at?: string | null;
  assigned_by?: string | null;
  metadata: string;
}

/** Database row type for dependencies (snake_case from SQLite). */
export interface DependencyRow {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}
