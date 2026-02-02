import { Context, Effect, Layer } from "effect"
import type { DatabaseError } from "../errors.js"

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
