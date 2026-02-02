/**
 * @tx/types/tracked-project - Daemon tracked project types
 *
 * Tracked projects are directories that the daemon monitors for JSONL
 * transcripts to process for learning extraction.
 *
 * @see PRD-015 for the JSONL daemon and knowledge promotion pipeline
 */

/**
 * Source type of the AI tool generating transcripts.
 *
 * - claude: Claude Code
 * - cursor: Cursor IDE
 * - windsurf: Windsurf IDE
 * - other: Other AI coding tools
 */
export type SourceType = "claude" | "cursor" | "windsurf" | "other"

/**
 * All valid source types.
 */
export const SOURCE_TYPES = ["claude", "cursor", "windsurf", "other"] as const

/**
 * Unique identifier for a tracked project.
 */
export type TrackedProjectId = number

/**
 * A project directory tracked by the daemon for transcript processing.
 */
export interface TrackedProject {
  /** Unique database ID */
  readonly id: TrackedProjectId
  /** Absolute path to the project directory */
  readonly projectPath: string
  /** Optional project identifier (for linking to tx database) */
  readonly projectId: string | null
  /** Type of AI tool generating transcripts */
  readonly sourceType: SourceType
  /** When the project was added for tracking */
  readonly addedAt: Date
  /** Whether tracking is currently enabled */
  readonly enabled: boolean
}

/**
 * Input for tracking a new project.
 */
export interface CreateTrackedProjectInput {
  /** Absolute path to the project directory */
  readonly projectPath: string
  /** Optional project identifier */
  readonly projectId?: string | null
  /** Type of AI tool (defaults to 'claude') */
  readonly sourceType?: SourceType
}

/**
 * Database row representation for daemon_tracked_projects table.
 */
export interface TrackedProjectRow {
  readonly id: number
  readonly project_path: string
  readonly project_id: string | null
  readonly source_type: string
  readonly added_at: string
  readonly enabled: number
}
