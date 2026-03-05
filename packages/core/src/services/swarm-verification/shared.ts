import { Effect } from "effect"
import { ValidationError } from "../../errors.js"
import type { AnchorStatus } from "@jamesaphoenix/tx-types"
import type { VerificationResult, VerifyOptions } from "../anchor-verification.js"

/** Default batch size per agent (PRD-017: batches of 10) */
export const DEFAULT_BATCH_SIZE = 10

/** Maximum concurrent agents (PRD-017: up to 4) */
export const MAX_CONCURRENT_AGENTS = 4

/** Minimum batch size to trigger swarm (sequential is fine for small batches) */
export const SWARM_THRESHOLD = 20

/** A batch of anchor IDs to verify */
export type VerificationBatch = {
  readonly batchId: number
  readonly anchorIds: readonly number[]
}

/** Result of a single agent's verification of a batch */
export type BatchResult = {
  readonly batchId: number
  readonly results: readonly VerificationResult[]
  readonly duration: number
  readonly errors: number
}

/** Swarm verification metrics */
export type SwarmMetrics = {
  readonly totalAnchors: number
  readonly totalBatches: number
  readonly agentsUsed: number
  readonly duration: number
  readonly agentDurations: readonly number[]
  readonly unchanged: number
  readonly selfHealed: number
  readonly drifted: number
  readonly invalid: number
  readonly errors: number
  readonly needsReview: number
}

/** Complete swarm verification result */
export type SwarmVerificationResult = {
  readonly metrics: SwarmMetrics
  readonly results: readonly VerificationResult[]
  readonly reviewRequired: readonly number[]
}

/** Options for swarm verification */
export type SwarmVerifyOptions = VerifyOptions & {
  readonly batchSize?: number
  readonly maxConcurrent?: number
  readonly forceSwarm?: boolean
}

/** Majority vote result for an anchor */
export type VoteResult = {
  readonly anchorId: number
  readonly votes: Map<AnchorStatus | "error", number>
  readonly consensus: AnchorStatus | null
  readonly needsReview: boolean
}

/**
 * Partition anchor IDs into batches.
 */
export const partitionIntoBatches = (
  anchorIds: readonly number[],
  batchSize: number
): VerificationBatch[] => {
  const batches: VerificationBatch[] = []
  for (let i = 0; i < anchorIds.length; i += batchSize) {
    batches.push({
      batchId: batches.length,
      anchorIds: anchorIds.slice(i, i + batchSize)
    })
  }
  return batches
}

/**
 * Calculate majority vote for conflicting results on the same anchor.
 */
export const calculateMajorityVote = (
  results: readonly VerificationResult[]
): Effect.Effect<VoteResult, ValidationError> =>
  Effect.gen(function* () {
    if (results.length === 0) {
      return yield* Effect.fail(
        new ValidationError({
          reason: "Cannot calculate majority vote with empty results"
        })
      )
    }

    const anchorId = results[0].anchorId
    const votes = new Map<AnchorStatus | "error", number>()

    for (const result of results) {
      const status = result.newStatus
      votes.set(status, (votes.get(status) ?? 0) + 1)
    }

    let maxVotes = 0
    let consensus: AnchorStatus | null = null
    let tieCount = 0

    for (const [status, count] of votes) {
      if (status === "error") continue

      if (count > maxVotes) {
        maxVotes = count
        consensus = status as AnchorStatus
        tieCount = 1
      } else if (count === maxVotes) {
        tieCount++
      }
    }

    const needsReview = tieCount > 1

    return {
      anchorId,
      votes,
      consensus: needsReview ? null : consensus,
      needsReview
    }
  })

/**
 * Aggregate batch results into final metrics.
 */
export const aggregateResults = (
  batchResults: readonly BatchResult[],
  startTime: number,
  agentCount: number
): { metrics: Omit<SwarmMetrics, "needsReview">; results: VerificationResult[] } => {
  let unchanged = 0
  let selfHealed = 0
  let drifted = 0
  let invalid = 0
  let errors = 0
  const allResults: VerificationResult[] = []
  const agentDurations: number[] = []

  for (const batch of batchResults) {
    agentDurations.push(batch.duration)
    errors += batch.errors

    for (const result of batch.results) {
      allResults.push(result)
      switch (result.action) {
        case "unchanged":
          unchanged++
          break
        case "self_healed":
          selfHealed++
          break
        case "drifted":
          drifted++
          break
        case "invalidated":
          invalid++
          break
      }
    }
  }

  return {
    metrics: {
      totalAnchors: allResults.length + errors,
      totalBatches: batchResults.length,
      agentsUsed: agentCount,
      duration: Date.now() - startTime,
      agentDurations,
      unchanged,
      selfHealed,
      drifted,
      invalid,
      errors
    },
    results: allResults
  }
}
