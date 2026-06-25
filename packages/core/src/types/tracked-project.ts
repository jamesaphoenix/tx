/**
 * @tx/types/tracked-project - Daemon tracked project types
 *
 * Tracked projects are directories that the daemon monitors for JSONL
 * transcripts to process for learning extraction.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 *
 * @see PRD-015 for the JSONL daemon and knowledge promotion pipeline
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * All valid source types.
 */
export const SOURCE_TYPES = ["claude", "cursor", "windsurf", "other"] as const

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Source type of the AI tool generating transcripts. */
export const SourceTypeSchema = Schema.Literal(...SOURCE_TYPES)
export type SourceType = typeof SourceTypeSchema.Type

/** Unique identifier for a tracked project. */
export type TrackedProjectId = number

/** A project directory tracked by the daemon for transcript processing. */
export const TrackedProjectSchema = Schema.Struct({
  /** Unique database ID */
  id: Schema.Number.pipe(Schema.int()),
  /** Absolute path to the project directory */
  projectPath: Schema.String,
  /** Optional project identifier (for linking to tx database) */
  projectId: Schema.NullOr(Schema.String),
  /** Type of AI tool generating transcripts */
  sourceType: SourceTypeSchema,
  /** When the project was added for tracking */
  addedAt: Schema.DateFromSelf,
  /** Whether tracking is currently enabled */
  enabled: Schema.Boolean,
})
export type TrackedProject = typeof TrackedProjectSchema.Type

/** Input for tracking a new project. */
export const CreateTrackedProjectInputSchema = Schema.Struct({
  /** Absolute path to the project directory */
  projectPath: Schema.String,
  /** Optional project identifier */
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Type of AI tool (defaults to 'claude') */
  sourceType: Schema.optional(SourceTypeSchema),
})
export type CreateTrackedProjectInput = typeof CreateTrackedProjectInputSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row representation for daemon_tracked_projects table. */
export interface TrackedProjectRow {
  readonly id: number
  readonly project_path: string
  readonly project_id: string | null
  readonly source_type: string
  readonly added_at: string
  readonly enabled: number
}
