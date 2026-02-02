import { Context, Effect } from "effect"
import { CandidateNotFoundError, DatabaseError, ValidationError } from "../errors.js"
import type {
  LearningCandidate,
  CandidateFilter,
  CandidateId,
  Learning
} from "@tx/types"

/**
 * Result of promoting a candidate to the learnings table.
 */
export interface PromotionResult {
  /** The updated candidate with promoted status */
  readonly candidate: LearningCandidate
  /** The newly created learning */
  readonly learning: Learning
}

/**
 * Result of auto-promotion batch operation.
 */
export interface AutoPromoteResult {
  /** Number of candidates auto-promoted */
  readonly promoted: number
  /** Number of candidates skipped (already processed or low confidence) */
  readonly skipped: number
  /** Number of candidates that failed to promote */
  readonly failed: number
  /** IDs of promoted learnings */
  readonly learningIds: readonly number[]
}

/**
 * PromotionService manages the lifecycle of learning candidates,
 * including listing, promoting to learnings, rejecting, and auto-promotion.
 *
 * @see PRD-015 for the knowledge promotion pipeline
 */
export class PromotionService extends Context.Tag("PromotionService")<
  PromotionService,
  {
    /**
     * List candidates matching the given filter.
     * Supports filtering by status, confidence, category, and pagination.
     */
    readonly list: (filter: CandidateFilter) => Effect.Effect<readonly LearningCandidate[], DatabaseError>

    /**
     * Promote a candidate to the learnings table.
     * Creates a new learning and updates the candidate status to 'promoted'.
     */
    readonly promote: (id: CandidateId) => Effect.Effect<PromotionResult, CandidateNotFoundError | DatabaseError>

    /**
     * Reject a candidate with a reason.
     * Updates the candidate status to 'rejected' and stores the rejection reason.
     */
    readonly reject: (id: CandidateId, reason: string) => Effect.Effect<LearningCandidate, CandidateNotFoundError | ValidationError | DatabaseError>

    /**
     * Auto-promote high-confidence candidates.
     * Promotes all pending candidates with 'high' confidence level.
     * Uses 'auto' as the reviewer identifier.
     */
    readonly autoPromote: () => Effect.Effect<AutoPromoteResult, DatabaseError>

    /**
     * Get all pending candidates awaiting review.
     * Convenience method equivalent to list({ status: 'pending' }).
     */
    readonly getPending: () => Effect.Effect<readonly LearningCandidate[], DatabaseError>
  }
>() {}
