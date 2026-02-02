import { Context, Effect, Layer } from "effect"
import { DatabaseError } from "../errors.js"
import { EdgeService } from "./edge-service.js"

/**
 * Input for recording which learnings were used in a run.
 */
export interface LearningUsageFeedback {
  readonly id: number
  readonly helpful: boolean
}

/**
 * FeedbackTrackerService tracks which learnings were helpful in agent runs
 * via USED_IN_RUN edges. Uses Bayesian scoring to weight future retrievals.
 *
 * Design: DD-016 specifies feedback tracking as part of the graph-expanded
 * retrieval pipeline. Learnings that are marked helpful receive score boosts.
 */
export class FeedbackTrackerService extends Context.Tag("FeedbackTrackerService")<
  FeedbackTrackerService,
  {
    /**
     * Record which learnings were shown to an agent and whether they were helpful.
     * Creates USED_IN_RUN edges in the graph for each learning.
     *
     * @param runId - Unique identifier for the agent run
     * @param learnings - Array of learnings with their helpfulness feedback
     */
    readonly recordUsage: (
      runId: string,
      learnings: readonly LearningUsageFeedback[]
    ) => Effect.Effect<void, DatabaseError>

    /**
     * Get the feedback score for a learning based on historical usage.
     * Uses Bayesian averaging: (successes + prior) / (total + 2*prior)
     *
     * @param learningId - The learning ID to get feedback score for
     * @returns Score between 0 and 1, with 0.5 being neutral (no feedback)
     */
    readonly getFeedbackScore: (
      learningId: number
    ) => Effect.Effect<number, DatabaseError>
  }
>() {}

/**
 * Bayesian scoring constants.
 * Prior of 0.5 means neutral (neither helpful nor unhelpful).
 * Prior weight of 2 provides moderate regularization toward the prior.
 */
const BAYESIAN_PRIOR = 0.5
const BAYESIAN_PRIOR_WEIGHT = 2

/**
 * Noop implementation - returns neutral scores and does nothing on record.
 * Used when feedback tracking is disabled or for testing.
 */
export const FeedbackTrackerServiceNoop = Layer.succeed(
  FeedbackTrackerService,
  {
    recordUsage: (_runId, _learnings) => Effect.void,
    getFeedbackScore: (_learningId) => Effect.succeed(0.5)
  }
)

/**
 * Live implementation that stores feedback as USED_IN_RUN edges.
 *
 * recordUsage: Creates USED_IN_RUN edges from learning to run.
 * - Weight: 1.0 if helpful, 0.0 if not helpful
 * - Metadata: { position, recordedAt }
 *
 * getFeedbackScore: Calculates Bayesian average from historical edges.
 * - Formula: (helpfulCount + prior * priorWeight) / (totalCount + priorWeight)
 * - Returns 0.5 (neutral) for learnings with no feedback.
 */
export const FeedbackTrackerServiceLive = Layer.effect(
  FeedbackTrackerService,
  Effect.gen(function* () {
    const edgeService = yield* EdgeService

    return {
      recordUsage: (runId, learnings) =>
        Effect.gen(function* () {
          const recordedAt = new Date().toISOString()

          for (let i = 0; i < learnings.length; i++) {
            const learning = learnings[i]
            yield* edgeService.createEdge({
              edgeType: "USED_IN_RUN",
              sourceType: "learning",
              sourceId: learning.id.toString(),
              targetType: "run",
              targetId: runId,
              weight: learning.helpful ? 1.0 : 0.0,
              metadata: {
                position: i,
                recordedAt
              }
            }).pipe(
              // Map ValidationError to DatabaseError - validation errors here would be internal issues
              Effect.mapError(e => e._tag === "ValidationError"
                ? new DatabaseError({ cause: e.reason })
                : e)
            )
          }
        }),

      getFeedbackScore: (learningId) =>
        Effect.gen(function* () {
          // Find all USED_IN_RUN edges from this learning
          const edges = yield* edgeService.findFromSource("learning", learningId.toString())
          const usedInRunEdges = edges.filter(e => e.edgeType === "USED_IN_RUN")

          // No feedback = neutral score
          if (usedInRunEdges.length === 0) {
            return BAYESIAN_PRIOR
          }

          // Count helpful (weight > 0) edges
          const totalCount = usedInRunEdges.length
          const helpfulCount = usedInRunEdges.filter(e => e.weight > 0).length

          // Bayesian average: (successes + prior * priorWeight) / (total + priorWeight)
          // = (helpfulCount + 0.5 * 2) / (totalCount + 2)
          // = (helpfulCount + 1) / (totalCount + 2)
          return (helpfulCount + BAYESIAN_PRIOR * BAYESIAN_PRIOR_WEIGHT) / (totalCount + BAYESIAN_PRIOR_WEIGHT)
        })
    }
  })
)
