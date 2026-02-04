/**
 * Task mappers - convert database rows to domain objects
 */

import { Schema } from "effect"
import type {
  Task,
  TaskId,
  TaskStatus,
  TaskRow,
  TaskDependency,
  DependencyRow
} from "@jamesaphoenix/tx-types"

/**
 * Schema for task metadata - a record of string keys to unknown values.
 * Used to validate JSON.parse output before casting to object.
 */
const MetadataSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

/**
 * Safely parse and validate metadata JSON string.
 * Returns empty object if parsing fails or validation fails.
 */
const parseMetadata = (metadataJson: string | null): Record<string, unknown> => {
  if (!metadataJson) return {}

  try {
    const parsed: unknown = JSON.parse(metadataJson)
    const result = Schema.decodeUnknownSync(MetadataSchema)(parsed)
    return result
  } catch {
    // Return empty object on parse error or validation failure
    return {}
  }
}

// Re-export types and constants from @tx/types for convenience
export type { TaskRow, DependencyRow } from "@jamesaphoenix/tx-types"
export { TASK_STATUSES, VALID_TRANSITIONS } from "@jamesaphoenix/tx-types"

/**
 * Convert a database row to a Task domain object.
 */
export const rowToTask = (row: TaskRow): Task => ({
  id: row.id as TaskId,
  title: row.title,
  description: row.description,
  status: row.status as TaskStatus,
  parentId: row.parent_id as TaskId | null,
  score: row.score,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  completedAt: row.completed_at ? new Date(row.completed_at) : null,
  metadata: parseMetadata(row.metadata)
})

/**
 * Convert a dependency database row to a TaskDependency domain object.
 */
export const rowToDependency = (row: DependencyRow): TaskDependency => ({
  blockerId: row.blocker_id as TaskId,
  blockedId: row.blocked_id as TaskId,
  createdAt: new Date(row.created_at)
})

/**
 * Check if a string is a valid TaskStatus.
 */
export const isValidStatus = (s: string): s is TaskStatus => {
  const statuses: readonly string[] = [
    "backlog", "ready", "planning", "active",
    "blocked", "review", "human_needs_to_review", "done"
  ]
  return statuses.includes(s)
}

/**
 * Check if a status transition is valid.
 */
export const isValidTransition = (from: TaskStatus, to: TaskStatus): boolean => {
  const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
    backlog: ["ready", "planning", "active", "blocked", "done"],
    ready: ["planning", "active", "blocked", "done"],
    planning: ["ready", "active", "blocked", "done"],
    active: ["blocked", "review", "done"],
    blocked: ["backlog", "ready", "planning", "active"],
    review: ["active", "human_needs_to_review", "done"],
    human_needs_to_review: ["active", "review", "done"],
    done: ["backlog"]
  }
  return transitions[from]?.includes(to) ?? false
}
