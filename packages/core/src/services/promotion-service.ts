import { Context, Effect, Layer } from "effect"
import { CandidateNotFoundError, DatabaseError, ValidationError } from "../errors.js"
import { CandidateRepository } from "../repo/candidate-repo.js"
import { LearningService } from "./learning-service.js"
import { EdgeService } from "./edge-service.js"
import type {
  LearningCandidate,
  CandidateFilter,
  CandidateId,
  Learning
} from "@jamesaphoenix/tx-types"

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

/** Duplicate detection threshold for auto-promotion (0.85 = high similarity) */
const DUPLICATE_MIN_SCORE = 0.85

export const PromotionServiceLive = Layer.effect(
  PromotionService,
  Effect.gen(function* () {
    const candidateRepo = yield* CandidateRepository
    const learningService = yield* LearningService
    const edgeService = yield* EdgeService

    /**
     * Promote a single candidate with optional reviewer identifier.
     * Internal helper shared by promote() and autoPromote().
     */
    const promoteCandidate = (
      candidate: LearningCandidate,
      reviewedBy: string
    ): Effect.Effect<PromotionResult, CandidateNotFoundError | DatabaseError> =>
      Effect.gen(function* () {
        // Create learning from candidate content
        // Map ValidationError to DatabaseError (validation should not fail for existing candidates)
        const learning = yield* Effect.mapError(
          learningService.create({
            content: candidate.content,
            sourceType: "run",
            sourceRef: candidate.sourceRunId ?? candidate.sourceFile,
            category: candidate.category
          }),
          (error) =>
            error._tag === "ValidationError"
              ? new DatabaseError({ cause: error.reason })
              : error
        )

        // Create DERIVED_FROM edge for provenance tracking
        // Link the learning back to its source (run or task)
        if (candidate.sourceRunId) {
          yield* Effect.catchAll(
            edgeService.createEdge({
              edgeType: "DERIVED_FROM",
              sourceType: "learning",
              sourceId: String(learning.id),
              targetType: "run",
              targetId: candidate.sourceRunId,
              weight: 1.0
            }),
            () => Effect.void // Ignore edge creation failures
          )
        } else if (candidate.sourceTaskId) {
          yield* Effect.catchAll(
            edgeService.createEdge({
              edgeType: "DERIVED_FROM",
              sourceType: "learning",
              sourceId: String(learning.id),
              targetType: "task",
              targetId: candidate.sourceTaskId,
              weight: 1.0
            }),
            () => Effect.void // Ignore edge creation failures
          )
        }

        // Update candidate status to promoted
        const now = new Date()
        const updatedCandidate = yield* candidateRepo.update(candidate.id, {
          status: "promoted",
          reviewedAt: now,
          reviewedBy,
          promotedLearningId: learning.id
        })

        if (!updatedCandidate) {
          return yield* Effect.fail(new CandidateNotFoundError({ id: candidate.id }))
        }

        return { candidate: updatedCandidate, learning }
      })

    return {
      list: (filter) => candidateRepo.findByFilter(filter),

      promote: (id) =>
        Effect.gen(function* () {
          const candidate = yield* candidateRepo.findById(id)
          if (!candidate) {
            return yield* Effect.fail(new CandidateNotFoundError({ id }))
          }

          return yield* promoteCandidate(candidate, "manual")
        }),

      reject: (id, reason) =>
        Effect.gen(function* () {
          // Validate reason is provided
          if (!reason || reason.trim().length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "Rejection reason is required" }))
          }

          const candidate = yield* candidateRepo.findById(id)
          if (!candidate) {
            return yield* Effect.fail(new CandidateNotFoundError({ id }))
          }

          const now = new Date()
          const updatedCandidate = yield* candidateRepo.update(id, {
            status: "rejected",
            reviewedAt: now,
            reviewedBy: "manual",
            rejectionReason: reason.trim()
          })

          if (!updatedCandidate) {
            return yield* Effect.fail(new CandidateNotFoundError({ id }))
          }

          return updatedCandidate
        }),

      autoPromote: () =>
        Effect.gen(function* () {
          // Get all pending high-confidence candidates
          const candidates = yield* candidateRepo.findByFilter({
            status: "pending",
            confidence: "high"
          })

          let promoted = 0
          let skipped = 0
          let failed = 0
          const learningIds: number[] = []

          for (const candidate of candidates) {
            // Check for duplicates using semantic search
            const searchResult = yield* Effect.catchAll(
              learningService.search({
                query: candidate.content,
                limit: 1,
                minScore: DUPLICATE_MIN_SCORE
              }),
              () => Effect.succeed([] as const)
            )

            // If a highly similar learning exists, skip this candidate
            if (searchResult.length > 0) {
              skipped++
              // Mark as merged with the existing learning
              yield* Effect.catchAll(
                candidateRepo.update(candidate.id, {
                  status: "merged",
                  reviewedAt: new Date(),
                  reviewedBy: "auto",
                  promotedLearningId: searchResult[0].id
                }),
                () => Effect.void
              )
              continue
            }

            // Promote the candidate
            const result = yield* Effect.either(promoteCandidate(candidate, "auto"))

            if (result._tag === "Right") {
              promoted++
              learningIds.push(result.right.learning.id)
            } else {
              failed++
            }
          }

          return {
            promoted,
            skipped,
            failed,
            learningIds
          }
        }),

      getPending: () => candidateRepo.findByFilter({ status: "pending" })
    }
  })
)
