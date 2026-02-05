/**
 * Task mappers - convert database rows to domain objects
 */

import { Schema } from "effect"
import type {
  Task,
  TaskStatus,
  TaskRow,
  TaskDependency,
  DependencyRow
} from "@jamesaphoenix/tx-types"
import { assertTaskId, TASK_STATUSES } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"

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
export { TASK_STATUSES }
export { VALID_TRANSITIONS } from "@jamesaphoenix/tx-types"

/**
 * Convert a database row to a Task domain object.
 * Validates status and ID fields at runtime before constructing domain object.
 */
export const rowToTask = (row: TaskRow): Task => {
  if (!isValidStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "task",
      status: row.status,
      validStatuses: TASK_STATUSES
    })
  }
  return {
    id: assertTaskId(row.id),
    title: row.title,
    description: row.description,
    status: row.status,
    parentId: row.parent_id ? assertTaskId(row.parent_id) : null,
    score: row.score,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    metadata: parseMetadata(row.metadata)
  }
}

/**
 * Convert a dependency database row to a TaskDependency domain object.
 * Validates TaskId fields at runtime.
 */
export const rowToDependency = (row: DependencyRow): TaskDependency => ({
  blockerId: assertTaskId(row.blocker_id),
  blockedId: assertTaskId(row.blocked_id),
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
