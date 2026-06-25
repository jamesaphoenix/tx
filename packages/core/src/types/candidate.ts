/**
 * @tx/types/candidate - Learning candidate types for transcript extraction
 *
 * Learning candidates are potential learnings extracted from Claude Code
 * transcripts that await promotion to the learnings table.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 *
 * @see PRD-015 for the JSONL daemon and knowledge promotion pipeline
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * All valid confidence levels.
 */
export const CANDIDATE_CONFIDENCES = ["high", "medium", "low"] as const

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
 * All valid candidate statuses.
 */
export const CANDIDATE_STATUSES = ["pending", "promoted", "rejected", "merged"] as const

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Confidence level for extracted learning candidates. */
export const CandidateConfidenceSchema = Schema.Literal(...CANDIDATE_CONFIDENCES)
export type CandidateConfidence = typeof CandidateConfidenceSchema.Type

/** Category of the extracted learning. */
export const CandidateCategorySchema = Schema.Literal(...CANDIDATE_CATEGORIES)
export type CandidateCategory = typeof CandidateCategorySchema.Type

/** Status of a learning candidate in the promotion pipeline. */
export const CandidateStatusSchema = Schema.Literal(...CANDIDATE_STATUSES)
export type CandidateStatus = typeof CandidateStatusSchema.Type

/** Unique identifier for a stored learning candidate. */
export type CandidateId = number

/** A chunk of transcript content to be analyzed for learning extraction. */
export const TranscriptChunkSchema = Schema.Struct({
  /** The transcript text content to analyze */
  content: Schema.String,
  /** Source file path (e.g., ~/.claude/projects/foo/session.jsonl) */
  sourceFile: Schema.String,
  /** Optional run ID for provenance tracking */
  sourceRunId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Optional task ID for provenance tracking */
  sourceTaskId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Byte offset in source file (for incremental processing) */
  byteOffset: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Line number range in source file */
  lineRange: Schema.optional(Schema.Struct({
    start: Schema.Number.pipe(Schema.int()),
    end: Schema.Number.pipe(Schema.int()),
  })),
})
export type TranscriptChunk = typeof TranscriptChunkSchema.Type

/** A learning candidate extracted from a transcript by the LLM. */
export const ExtractedCandidateSchema = Schema.Struct({
  /** The learning text (1-3 sentences, actionable) */
  content: Schema.String,
  /** Confidence level assigned by the LLM */
  confidence: CandidateConfidenceSchema,
  /** Category of the learning */
  category: CandidateCategorySchema,
})
export type ExtractedCandidate = typeof ExtractedCandidateSchema.Type

/** A learning candidate stored in the database. */
export const LearningCandidateSchema = Schema.Struct({
  /** Unique database ID */
  id: Schema.Number.pipe(Schema.int()),
  /** The learning text (1-3 sentences, actionable) */
  content: Schema.String,
  /** Confidence level assigned by the LLM */
  confidence: CandidateConfidenceSchema,
  /** Category of the learning */
  category: Schema.NullOr(CandidateCategorySchema),
  /** Source JSONL file path */
  sourceFile: Schema.String,
  /** Source run ID for provenance */
  sourceRunId: Schema.NullOr(Schema.String),
  /** Source task ID for provenance */
  sourceTaskId: Schema.NullOr(Schema.String),
  /** When the candidate was extracted */
  extractedAt: Schema.DateFromSelf,
  /** Current status in promotion pipeline */
  status: CandidateStatusSchema,
  /** When the candidate was reviewed */
  reviewedAt: Schema.NullOr(Schema.DateFromSelf),
  /** Who reviewed ('auto' or user identifier) */
  reviewedBy: Schema.NullOr(Schema.String),
  /** ID of promoted learning (if promoted or merged) */
  promotedLearningId: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  /** Reason for rejection (if rejected) */
  rejectionReason: Schema.NullOr(Schema.String),
})
export type LearningCandidate = typeof LearningCandidateSchema.Type

/** Input for creating a new learning candidate. */
export const CreateCandidateInputSchema = Schema.Struct({
  content: Schema.String,
  confidence: CandidateConfidenceSchema,
  category: Schema.optional(Schema.NullOr(CandidateCategorySchema)),
  sourceFile: Schema.String,
  sourceRunId: Schema.optional(Schema.NullOr(Schema.String)),
  sourceTaskId: Schema.optional(Schema.NullOr(Schema.String)),
})
export type CreateCandidateInput = typeof CreateCandidateInputSchema.Type

/** Input for updating a learning candidate. */
export const UpdateCandidateInputSchema = Schema.Struct({
  status: Schema.optional(CandidateStatusSchema),
  reviewedAt: Schema.optional(Schema.DateFromSelf),
  reviewedBy: Schema.optional(Schema.String),
  promotedLearningId: Schema.optional(Schema.Number.pipe(Schema.int())),
  rejectionReason: Schema.optional(Schema.String),
})
export type UpdateCandidateInput = typeof UpdateCandidateInputSchema.Type

/** Filter options for querying learning candidates. */
export const CandidateFilterSchema = Schema.Struct({
  status: Schema.optional(Schema.Union(CandidateStatusSchema, Schema.Array(CandidateStatusSchema))),
  confidence: Schema.optional(Schema.Union(CandidateConfidenceSchema, Schema.Array(CandidateConfidenceSchema))),
  category: Schema.optional(Schema.Union(CandidateCategorySchema, Schema.Array(CandidateCategorySchema))),
  sourceFile: Schema.optional(Schema.String),
  sourceRunId: Schema.optional(Schema.String),
  sourceTaskId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number.pipe(Schema.int())),
  offset: Schema.optional(Schema.Number.pipe(Schema.int())),
})
export type CandidateFilter = typeof CandidateFilterSchema.Type

/** Result of candidate extraction from a transcript chunk. */
export const ExtractionResultSchema = Schema.Struct({
  candidates: Schema.Array(ExtractedCandidateSchema),
  sourceChunk: TranscriptChunkSchema,
  wasExtracted: Schema.Boolean,
  metadata: Schema.optional(Schema.Struct({
    model: Schema.optional(Schema.String),
    tokensUsed: Schema.optional(Schema.Number.pipe(Schema.int())),
    durationMs: Schema.optional(Schema.Number),
  })),
})
export type ExtractionResult = typeof ExtractionResultSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row representation for learning_candidates table. */
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
