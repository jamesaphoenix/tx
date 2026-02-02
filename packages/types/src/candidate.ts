/**
 * @tx/types/candidate - Learning candidate types for transcript extraction
 *
 * Learning candidates are potential learnings extracted from Claude Code
 * transcripts that await promotion to the learnings table.
 *
 * @see PRD-015 for the JSONL daemon and knowledge promotion pipeline
 */

/**
 * Confidence level for extracted learning candidates.
 *
 * - high: Tested in session with clear outcome - auto-promotable
 * - medium: Reasonable but unverified - needs review
 * - low: Speculative or edge case - needs review
 */
export type CandidateConfidence = "high" | "medium" | "low"

/**
 * All valid confidence levels.
 */
export const CANDIDATE_CONFIDENCES = ["high", "medium", "low"] as const

/**
 * Category of the extracted learning.
 * Helps organize and filter learnings by domain.
 */
export type CandidateCategory =
  | "architecture"
  | "testing"
  | "performance"
  | "security"
  | "debugging"
  | "tooling"
  | "patterns"
  | "other"

/**
 * All valid candidate categories.
 */
export const CANDIDATE_CATEGORIES = [
  "architecture",
  "testing",
  "performance",
  "security",
  "debugging",
  "tooling",
  "patterns",
  "other"
] as const

/**
 * Status of a learning candidate in the promotion pipeline.
 *
 * - pending: Awaiting review or auto-promotion
 * - promoted: Successfully promoted to learnings table
 * - rejected: Manually rejected by reviewer
 * - merged: Merged with existing similar learning
 */
export type CandidateStatus = "pending" | "promoted" | "rejected" | "merged"

/**
 * All valid candidate statuses.
 */
export const CANDIDATE_STATUSES = ["pending", "promoted", "rejected", "merged"] as const

/**
 * A chunk of transcript content to be analyzed for learning extraction.
 * Used as input to the CandidateExtractor.
 */
export interface TranscriptChunk {
  /** The transcript text content to analyze */
  readonly content: string
  /** Source file path (e.g., ~/.claude/projects/foo/session.jsonl) */
  readonly sourceFile: string
  /** Optional run ID for provenance tracking */
  readonly sourceRunId?: string | null
  /** Optional task ID for provenance tracking */
  readonly sourceTaskId?: string | null
  /** Byte offset in source file (for incremental processing) */
  readonly byteOffset?: number
  /** Line number range in source file */
  readonly lineRange?: { start: number; end: number }
}

/**
 * A learning candidate extracted from a transcript by the LLM.
 * This is the raw extraction output before database storage.
 */
export interface ExtractedCandidate {
  /** The learning text (1-3 sentences, actionable) */
  readonly content: string
  /** Confidence level assigned by the LLM */
  readonly confidence: CandidateConfidence
  /** Category of the learning */
  readonly category: CandidateCategory
}

/**
 * Unique identifier for a stored learning candidate.
 */
export type CandidateId = number

/**
 * A learning candidate stored in the database.
 * Extends ExtractedCandidate with storage metadata.
 */
export interface LearningCandidate {
  /** Unique database ID */
  readonly id: CandidateId
  /** The learning text (1-3 sentences, actionable) */
  readonly content: string
  /** Confidence level assigned by the LLM */
  readonly confidence: CandidateConfidence
  /** Category of the learning */
  readonly category: CandidateCategory | null
  /** Source JSONL file path */
  readonly sourceFile: string
  /** Source run ID for provenance */
  readonly sourceRunId: string | null
  /** Source task ID for provenance */
  readonly sourceTaskId: string | null
  /** When the candidate was extracted */
  readonly extractedAt: Date
  /** Current status in promotion pipeline */
  readonly status: CandidateStatus
  /** When the candidate was reviewed */
  readonly reviewedAt: Date | null
  /** Who reviewed ('auto' or user identifier) */
  readonly reviewedBy: string | null
  /** ID of promoted learning (if promoted or merged) */
  readonly promotedLearningId: number | null
  /** Reason for rejection (if rejected) */
  readonly rejectionReason: string | null
}

/**
 * Input for creating a new learning candidate.
 */
export interface CreateCandidateInput {
  /** The learning text */
  readonly content: string
  /** Confidence level */
  readonly confidence: CandidateConfidence
  /** Category of the learning */
  readonly category?: CandidateCategory | null
  /** Source file path */
  readonly sourceFile: string
  /** Source run ID */
  readonly sourceRunId?: string | null
  /** Source task ID */
  readonly sourceTaskId?: string | null
}

/**
 * Input for updating a learning candidate.
 */
export interface UpdateCandidateInput {
  /** New status */
  readonly status?: CandidateStatus
  /** Review timestamp */
  readonly reviewedAt?: Date
  /** Reviewer identifier */
  readonly reviewedBy?: string
  /** Promoted learning ID */
  readonly promotedLearningId?: number
  /** Rejection reason */
  readonly rejectionReason?: string
}

/**
 * Filter options for querying learning candidates.
 */
export interface CandidateFilter {
  /** Filter by status */
  readonly status?: CandidateStatus | CandidateStatus[]
  /** Filter by confidence */
  readonly confidence?: CandidateConfidence | CandidateConfidence[]
  /** Filter by category */
  readonly category?: CandidateCategory | CandidateCategory[]
  /** Filter by source file */
  readonly sourceFile?: string
  /** Filter by source run ID */
  readonly sourceRunId?: string
  /** Filter by source task ID */
  readonly sourceTaskId?: string
  /** Maximum results */
  readonly limit?: number
  /** Offset for pagination */
  readonly offset?: number
}

/**
 * Result of candidate extraction from a transcript chunk.
 */
export interface ExtractionResult {
  /** Extracted candidates */
  readonly candidates: readonly ExtractedCandidate[]
  /** Source chunk that was processed */
  readonly sourceChunk: TranscriptChunk
  /** Whether extraction was performed (false if using noop) */
  readonly wasExtracted: boolean
  /** Processing metadata */
  readonly metadata?: {
    /** Model used for extraction */
    readonly model?: string
    /** Tokens used (input + output) */
    readonly tokensUsed?: number
    /** Processing duration in milliseconds */
    readonly durationMs?: number
  }
}

/**
 * Database row representation for learning_candidates table.
 */
export interface CandidateRow {
  readonly id: number
  readonly content: string
  readonly confidence: string
  readonly category: string | null
  readonly source_file: string
  readonly source_run_id: string | null
  readonly source_task_id: string | null
  readonly extracted_at: string
  readonly status: string
  readonly reviewed_at: string | null
  readonly reviewed_by: string | null
  readonly promoted_learning_id: number | null
  readonly rejection_reason: string | null
}
