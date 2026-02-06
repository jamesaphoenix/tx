/**
 * TrackedProject mappers - convert database rows to domain objects
 */

import type {
  TrackedProject,
  TrackedProjectRow,
  SourceType
} from "@jamesaphoenix/tx-types"
import { SOURCE_TYPES } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

// Re-export types and constants from @tx/types for convenience
export type { TrackedProjectRow } from "@jamesaphoenix/tx-types"
export { SOURCE_TYPES }

/**
 * Check if a string is a valid SourceType for tracked projects.
 */
export const isValidTrackedSourceType = (s: string): s is SourceType => {
  const sourceTypes: readonly string[] = ["claude", "cursor", "windsurf", "other"]
  return sourceTypes.includes(s)
}

/**
 * Convert a database row to a TrackedProject domain object.
 * Validates source_type at runtime.
 */
export const rowToTrackedProject = (row: TrackedProjectRow): TrackedProject => {
  if (!isValidTrackedSourceType(row.source_type)) {
    throw new InvalidStatusError({
      entity: "tracked_project",
      status: row.source_type,
      validStatuses: SOURCE_TYPES,
      rowId: row.id
    })
  }
  return {
    id: row.id,
    projectPath: row.project_path,
    projectId: row.project_id,
    sourceType: row.source_type,
    addedAt: parseDate(row.added_at, "added_at", row.id),
    enabled: row.enabled === 1
  }
}
