/**
 * Candidate mappers - convert database rows to domain objects
 */

import type {
  LearningCandidate,
  CandidateRow,
  CandidateConfidence,
  CandidateCategory,
  CandidateStatus
} from "@tx/types"

// Re-export types and constants from @tx/types for convenience
export type { CandidateRow } from "@tx/types"
export {
  CANDIDATE_CONFIDENCES,
  CANDIDATE_CATEGORIES,
  CANDIDATE_STATUSES
} from "@tx/types"

/**
 * Check if a string is a valid CandidateConfidence.
 */
export const isValidConfidence = (s: string): s is CandidateConfidence => {
  const confidences: readonly string[] = ["high", "medium", "low"]
  return confidences.includes(s)
}

/**
 * Check if a string is a valid CandidateStatus.
 */
export const isValidStatus = (s: string): s is CandidateStatus => {
  const statuses: readonly string[] = ["pending", "promoted", "rejected", "merged"]
  return statuses.includes(s)
}

/**
 * Check if a string is a valid CandidateCategory.
 */
export const isValidCategory = (s: string): s is CandidateCategory => {
  const categories: readonly string[] = [
    "architecture",
    "testing",
    "performance",
    "security",
    "debugging",
    "tooling",
    "patterns",
    "other"
  ]
  return categories.includes(s)
}

/**
 * Convert a database row to a LearningCandidate domain object.
 */
export const rowToCandidate = (row: CandidateRow): LearningCandidate => ({
  id: row.id,
  content: row.content,
  confidence: row.confidence as CandidateConfidence,
  category: row.category as CandidateCategory | null,
  sourceFile: row.source_file,
  sourceRunId: row.source_run_id,
  sourceTaskId: row.source_task_id,
  extractedAt: new Date(row.extracted_at),
  status: row.status as CandidateStatus,
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
  reviewedBy: row.reviewed_by,
  promotedLearningId: row.promoted_learning_id,
  rejectionReason: row.rejection_reason
})
