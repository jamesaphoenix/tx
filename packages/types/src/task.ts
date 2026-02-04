/**
 * Task types for tx
 *
 * Core type definitions for the task management system.
 * Zero runtime dependencies - pure TypeScript types only.
 */

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
 * Task status - one of the valid lifecycle states.
 */
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Check if a string is a valid task status.
 * @param status - String to validate
 * @returns true if the string is a valid TaskStatus
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
 * @param status - String to validate
 * @returns The validated TaskStatus
 * @throws InvalidTaskStatusError if the status is invalid
 */
export const assertTaskStatus = (status: string): TaskStatus => {
  if (!isValidTaskStatus(status)) {
    throw new InvalidTaskStatusError(status);
  }
  return status;
};

/**
 * Branded type for task IDs.
 * Format: tx-[a-z0-9]{6,8} (e.g., "tx-abc123")
 */
export type TaskId = string & { readonly _brand: unique symbol };

/**
 * Regex pattern for valid task IDs.
 */
export const TASK_ID_PATTERN = /^tx-[a-z0-9]{6,8}$/;

/**
 * Check if a string is a valid task ID format.
 * @param id - String to validate
 * @returns true if the string matches the TaskId format
 */
export const isValidTaskId = (id: string): id is TaskId => {
  return TASK_ID_PATTERN.test(id);
};

/**
 * Error thrown when a task ID is invalid.
 */
export class InvalidTaskIdError extends Error {
  constructor(public readonly id: string) {
    super(`Invalid task ID: "${id}". Expected format: tx-[a-z0-9]{6,8}`);
    this.name = "InvalidTaskIdError";
  }
}

/**
 * Validate and return a branded TaskId, or throw if invalid.
 * Use this instead of bare `as TaskId` casts.
 * @param id - String to validate and cast
 * @returns The validated TaskId
 * @throws InvalidTaskIdError if the ID format is invalid
 */
export const assertTaskId = (id: string): TaskId => {
  if (!isValidTaskId(id)) {
    throw new InvalidTaskIdError(id);
  }
  return id;
};

/**
 * Core task entity without dependency information.
 * IMPORTANT: Per doctrine Rule 1, never return bare Task to external consumers.
 * Always use TaskWithDeps for API responses.
 */
export interface Task {
  readonly id: TaskId;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly parentId: TaskId | null;
  readonly score: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly metadata: Record<string, unknown>;
}

/**
 * Task with full dependency information.
 * This is the REQUIRED return type for all external APIs (Rule 1).
 */
export interface TaskWithDeps extends Task {
  /** Task IDs that block this task */
  readonly blockedBy: TaskId[];
  /** Task IDs this task blocks */
  readonly blocks: TaskId[];
  /** Direct child task IDs */
  readonly children: TaskId[];
  /** Whether this task can be worked on (status is workable AND all blockers are done) */
  readonly isReady: boolean;
}

/**
 * Recursive tree structure for task hierarchy.
 */
export interface TaskTree {
  readonly task: Task;
  readonly children: readonly TaskTree[];
}

/**
 * Task dependency relationship.
 */
export interface TaskDependency {
  readonly blockerId: TaskId;
  readonly blockedId: TaskId;
  readonly createdAt: Date;
}

/**
 * Input for creating a new task.
 */
export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly parentId?: string | null;
  readonly score?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Input for updating an existing task.
 */
export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string;
  readonly status?: TaskStatus;
  readonly parentId?: string | null;
  readonly score?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Cursor for pagination (score + id based).
 */
export interface TaskCursor {
  readonly score: number;
  readonly id: string;
}

/**
 * Filter options for task queries.
 */
export interface TaskFilter {
  readonly status?: TaskStatus | TaskStatus[];
  readonly parentId?: string | null;
  readonly limit?: number;
  /** Search in title and description (case-insensitive) */
  readonly search?: string;
  /** Cursor for keyset pagination (returns tasks after this cursor) */
  readonly cursor?: TaskCursor;
}

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

/**
 * Database row type for tasks (snake_case from SQLite).
 * Used by repositories for mapping DB rows to Task objects.
 */
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
  metadata: string;
}

/**
 * Database row type for dependencies (snake_case from SQLite).
 */
export interface DependencyRow {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}
