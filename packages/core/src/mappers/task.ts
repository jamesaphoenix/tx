/**
 * Task mappers - convert database rows to domain objects
 */

import { Schema } from "effect"
import type {
  Task,
  TaskAssigneeType,
  TaskStatus,
  TaskRow,
  TaskDependency,
  DependencyRow
} from "@jamesaphoenix/tx-types"
import { assertTaskId, TASK_STATUSES } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

/**
 * Schema for task metadata - a record of string keys to unknown values.
 * Used to validate JSON.parse output before casting to object.
 */
const MetadataSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

/**
 * Safely parse and validate metadata JSON string.
 * On corruption: logs a warning, preserves the raw value under `_corruptedRaw`
 * with the error message under `_corruptionError` for downstream recovery.
 * Only catches expected errors (SyntaxError, Schema ParseError); re-throws unexpected ones.
 */
const parseMetadata = (metadataJson: string | null): Record<string, unknown> => {
  if (!metadataJson) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(metadataJson)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    console.warn(
      `[tx] Corrupted metadata JSON (SyntaxError): ${error.message}. Raw value preserved for recovery.`
    )
    return { _corruptedRaw: metadataJson, _corruptionError: `SyntaxError: ${error.message}` }
  }

  try {
    return Schema.decodeUnknownSync(MetadataSchema)(parsed)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[tx] Metadata schema validation failed: ${message}. Raw value preserved for recovery.`
    )
    return { _corruptedRaw: metadataJson, _corruptionError: `SchemaError: ${message}` }
  }
}

const parseAssigneeType = (
  assigneeType: string | null | undefined,
  rowId: string
): TaskAssigneeType | null => {
  if (assigneeType == null) return null
  if (assigneeType === "human" || assigneeType === "agent") return assigneeType
  console.warn(
    `[tx] Invalid assignee_type "${assigneeType}" for task ${rowId}. Falling back to null.`
  )
  return null
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
      validStatuses: TASK_STATUSES,
      rowId: row.id
    })
  }
  return {
    id: assertTaskId(row.id),
    title: row.title,
    description: row.description,
    status: row.status,
    parentId: row.parent_id ? assertTaskId(row.parent_id) : null,
    score: row.score,
    createdAt: parseDate(row.created_at, "created_at", row.id),
    updatedAt: parseDate(row.updated_at, "updated_at", row.id),
    completedAt: row.completed_at ? parseDate(row.completed_at, "completed_at", row.id) : null,
    assigneeType: parseAssigneeType(row.assignee_type, row.id),
    assigneeId: row.assignee_id ?? null,
    assignedAt: row.assigned_at ? parseDate(row.assigned_at, "assigned_at", row.id) : null,
    assignedBy: row.assigned_by ?? null,
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
  createdAt: parseDate(row.created_at, "created_at")
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
