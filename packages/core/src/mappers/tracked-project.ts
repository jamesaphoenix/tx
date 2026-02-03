/**
 * TrackedProject mappers - convert database rows to domain objects
 */

import type {
  TrackedProject,
  TrackedProjectRow,
  SourceType
} from "@jamesaphoenix/tx-types"

// Re-export types and constants from @tx/types for convenience
export type { TrackedProjectRow } from "@jamesaphoenix/tx-types"
export { SOURCE_TYPES } from "@jamesaphoenix/tx-types"

/**
 * Check if a string is a valid SourceType for tracked projects.
 */
export const isValidTrackedSourceType = (s: string): s is SourceType => {
  const sourceTypes: readonly string[] = ["claude", "cursor", "windsurf", "other"]
  return sourceTypes.includes(s)
}

/**
 * Convert a database row to a TrackedProject domain object.
 */
export const rowToTrackedProject = (row: TrackedProjectRow): TrackedProject => ({
  id: row.id,
  projectPath: row.project_path,
  projectId: row.project_id,
  sourceType: row.source_type as SourceType,
  addedAt: new Date(row.added_at),
  enabled: row.enabled === 1
})
