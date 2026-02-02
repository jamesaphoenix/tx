/**
 * SwarmVerificationService - Bulk invalidation with concurrent verification agents
 *
 * For large batches of anchors, spawns up to 4 concurrent verification agents.
 * Coordinates via job queue pattern using Effect's concurrency primitives.
 * Aggregates results with majority vote for edge cases.
 * Tracks swarm metrics for observability.
 *
 * @see docs/prd/PRD-017-invalidation-maintenance.md - IM-004: Bulk invalidation via agent swarm
 */

import { Context, Effect, Layer, Queue, Fiber, Ref } from "effect"
import { AnchorVerificationService, type VerificationResult, type VerifyOptions } from "./anchor-verification.js"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { DatabaseError } from "../errors.js"
import type { AnchorStatus } from "@tx/types"

// =============================================================================
// Configuration Constants
// =============================================================================

/** Default batch size per agent (PRD-017: batches of 10) */
const DEFAULT_BATCH_SIZE = 10

/** Maximum concurrent agents (PRD-017: up to 4) */
const MAX_CONCURRENT_AGENTS = 4

/** Minimum batch size to trigger swarm (sequential is fine for small batches) */
const SWARM_THRESHOLD = 20

// =============================================================================
// Types
// =============================================================================

/** A batch of anchor IDs to verify */
export interface VerificationBatch {
  readonly batchId: number
  readonly anchorIds: readonly number[]
}

/** Result of a single agent's verification of a batch */
export interface BatchResult {
  readonly batchId: number
  readonly results: readonly VerificationResult[]
  readonly duration: number
  readonly errors: number
}

/** Swarm verification metrics */
export interface SwarmMetrics {
  readonly totalAnchors: number
  readonly totalBatches: number
  readonly agentsUsed: number
  readonly duration: number
  /** Time spent per agent (for load balancing analysis) */
  readonly agentDurations: readonly number[]
  /** Counts by action type */
  readonly unchanged: number
  readonly selfHealed: number
  readonly drifted: number
  readonly invalid: number
  readonly errors: number
  /** Edge cases requiring human review (tie votes) */
  readonly needsReview: number
}

/** Complete swarm verification result */
export interface SwarmVerificationResult {
  readonly metrics: SwarmMetrics
  readonly results: readonly VerificationResult[]
  /** Anchor IDs that require human review due to tie votes */
  readonly reviewRequired: readonly number[]
}

/** Options for swarm verification */
export interface SwarmVerifyOptions extends VerifyOptions {
  /** Batch size per agent (default: 10) */
  readonly batchSize?: number
  /** Max concurrent agents (default: 4) */
  readonly maxConcurrent?: number
  /** Force swarm even for small batches */
  readonly forceSwarm?: boolean
}

/** Majority vote result for an anchor */
export interface VoteResult {
  readonly anchorId: number
  readonly votes: Map<AnchorStatus | "error", number>
  readonly consensus: AnchorStatus | null
  readonly needsReview: boolean
}

// =============================================================================
// Service Definition
// =============================================================================

export class SwarmVerificationService extends Context.Tag("SwarmVerificationService")<
  SwarmVerificationService,
  {
    /**
     * Verify anchors using concurrent agents.
     * Automatically partitions into batches and spawns agents.
     */
    readonly verifyAnchors: (
      anchorIds: readonly number[],
      options?: SwarmVerifyOptions
    ) => Effect.Effect<SwarmVerificationResult, DatabaseError>

    /**
     * Verify all valid anchors using swarm.
     */
    readonly verifyAll: (
      options?: SwarmVerifyOptions
    ) => Effect.Effect<SwarmVerificationResult, DatabaseError>

    /**
     * Verify anchors for files matching glob pattern using swarm.
     */
    readonly verifyGlob: (
      globPattern: string,
      options?: SwarmVerifyOptions
    ) => Effect.Effect<SwarmVerificationResult, DatabaseError>

    /**
     * Verify anchors affected by a list of changed files.
     * Typically called from git hooks after large commits.
     */
    readonly verifyChangedFiles: (
      filePaths: readonly string[],
      options?: SwarmVerifyOptions
    ) => Effect.Effect<SwarmVerificationResult, DatabaseError>
  }
>() {}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Partition anchor IDs into batches.
 */
const partitionIntoBatches = (
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
 * Used when multiple agents verify the same anchor (edge cases).
 *
 * Rules (per PRD-017):
 * - If 3/4 agents say valid, it's valid
 * - Tie = mark for human review
 *
 * Exported for use in LLM-assisted verification scenarios where multiple
 * agents may verify the same anchor for edge cases.
 */
export const calculateMajorityVote = (
  results: readonly VerificationResult[]
): VoteResult => {
  const anchorId = results[0].anchorId
  const votes = new Map<AnchorStatus | "error", number>()

  for (const result of results) {
    const status = result.newStatus
    votes.set(status, (votes.get(status) ?? 0) + 1)
  }

  // Find the status with most votes
  let maxVotes = 0
  let consensus: AnchorStatus | null = null
  let tieCount = 0

  for (const [status, count] of votes) {
    if (status === "error") continue // Don't count errors in consensus

    if (count > maxVotes) {
      maxVotes = count
      consensus = status as AnchorStatus
      tieCount = 1
    } else if (count === maxVotes) {
      tieCount++
    }
  }

  // Tie = needs human review
  const needsReview = tieCount > 1

  return {
    anchorId,
    votes,
    consensus: needsReview ? null : consensus,
    needsReview
  }
}

/**
 * Aggregate batch results into final metrics.
 */
const aggregateResults = (
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

// =============================================================================
// Service Implementation
// =============================================================================

export const SwarmVerificationServiceLive = Layer.effect(
  SwarmVerificationService,
  Effect.gen(function* () {
    const anchorVerification = yield* AnchorVerificationService
    const anchorRepo = yield* AnchorRepository

    /**
     * Process a single batch of anchors using the verification service.
     */
    const processB = (
      batch: VerificationBatch,
      options: VerifyOptions
    ): Effect.Effect<BatchResult, never> =>
      Effect.gen(function* () {
        const startTime = Date.now()
        const results: VerificationResult[] = []
        let errors = 0

        // Process each anchor in the batch
        for (const anchorId of batch.anchorIds) {
          const result = yield* anchorVerification.verify(anchorId, options).pipe(
            Effect.catchAll(() => {
              errors++
              return Effect.succeed(null)
            })
          )

          if (result) {
            results.push(result)
          }
        }

        return {
          batchId: batch.batchId,
          results,
          duration: Date.now() - startTime,
          errors
        }
      })

    /**
     * Run swarm verification with concurrent agents.
     */
    const runSwarm = (
      anchorIds: readonly number[],
      options: SwarmVerifyOptions
    ): Effect.Effect<SwarmVerificationResult, DatabaseError> =>
      Effect.gen(function* () {
        const startTime = Date.now()
        const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
        const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_AGENTS

        // Partition into batches
        const batches = partitionIntoBatches(anchorIds, batchSize)

        if (batches.length === 0) {
          return {
            metrics: {
              totalAnchors: 0,
              totalBatches: 0,
              agentsUsed: 0,
              duration: 0,
              agentDurations: [],
              unchanged: 0,
              selfHealed: 0,
              drifted: 0,
              invalid: 0,
              errors: 0,
              needsReview: 0
            },
            results: [],
            reviewRequired: []
          }
        }

        // Determine actual concurrency (don't spawn more agents than batches)
        const agentCount = Math.min(batches.length, maxConcurrent)

        // Create a queue for job distribution
        const queue = yield* Queue.bounded<VerificationBatch>(batches.length)

        // Enqueue all batches
        for (const batch of batches) {
          yield* Queue.offer(queue, batch)
        }

        // Counter to track active work
        const completedBatches = yield* Ref.make<BatchResult[]>([])

        // Worker function: continuously pull batches from queue
        const worker = (_workerId: number): Effect.Effect<void, never> =>
          Effect.gen(function* () {
            while (true) {
              // Try to take a batch (non-blocking)
              const maybeBatch = yield* Queue.poll(queue)

              if (maybeBatch._tag === "None") {
                // No more batches, worker done
                break
              }

              const batch = maybeBatch.value
              const result = yield* processB(batch, options)

              // Record result
              yield* Ref.update(completedBatches, (results) => [...results, result])
            }
          })

        // Spawn agents as fibers
        const fibers: Fiber.RuntimeFiber<void, never>[] = []
        for (let i = 0; i < agentCount; i++) {
          const fiber = yield* Effect.fork(worker(i))
          fibers.push(fiber)
        }

        // Wait for all agents to complete
        for (const fiber of fibers) {
          yield* Fiber.join(fiber)
        }

        // Shutdown queue
        yield* Queue.shutdown(queue)

        // Get all batch results
        const batchResults = yield* Ref.get(completedBatches)

        // Aggregate results
        const { metrics, results } = aggregateResults(batchResults, startTime, agentCount)

        // For now, we don't have multi-agent verification of the same anchor,
        // so no majority voting needed. reviewRequired is empty.
        // This would be used if we added LLM-assisted verification where
        // multiple agents verify the same anchor for edge cases.
        const reviewRequired: number[] = []

        return {
          metrics: {
            ...metrics,
            needsReview: reviewRequired.length
          },
          results,
          reviewRequired
        }
      })

    /**
     * Simple sequential verification for small batches.
     */
    const runSequential = (
      anchorIds: readonly number[],
      options: SwarmVerifyOptions
    ): Effect.Effect<SwarmVerificationResult, DatabaseError> =>
      Effect.gen(function* () {
        // Handle empty input
        if (anchorIds.length === 0) {
          return {
            metrics: {
              totalAnchors: 0,
              totalBatches: 0,
              agentsUsed: 0,
              duration: 0,
              agentDurations: [],
              unchanged: 0,
              selfHealed: 0,
              drifted: 0,
              invalid: 0,
              errors: 0,
              needsReview: 0
            },
            results: [],
            reviewRequired: []
          }
        }

        const startTime = Date.now()
        const results: VerificationResult[] = []
        let errors = 0
        let unchanged = 0
        let selfHealed = 0
        let drifted = 0
        let invalid = 0

        for (const anchorId of anchorIds) {
          const result = yield* anchorVerification.verify(anchorId, options).pipe(
            Effect.catchAll(() => {
              errors++
              return Effect.succeed(null)
            })
          )

          if (result) {
            results.push(result)
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
            totalAnchors: results.length + errors,
            totalBatches: 1,
            agentsUsed: 1,
            duration: Date.now() - startTime,
            agentDurations: [Date.now() - startTime],
            unchanged,
            selfHealed,
            drifted,
            invalid,
            errors,
            needsReview: 0
          },
          results,
          reviewRequired: []
        }
      })

    return {
      verifyAnchors: (anchorIds, options = {}) =>
        Effect.gen(function* () {
          // Use swarm for large batches, sequential for small ones
          const useSwarm =
            options.forceSwarm || anchorIds.length >= SWARM_THRESHOLD

          if (useSwarm) {
            return yield* runSwarm(anchorIds, options)
          } else {
            return yield* runSequential(anchorIds, options)
          }
        }),

      verifyAll: (options = {}) =>
        Effect.gen(function* () {
          const anchors = yield* anchorRepo.findAllValid()
          const anchorIds = anchors
            .filter((a) => !options.skipPinned || !a.pinned)
            .map((a) => a.id)

          const useSwarm =
            options.forceSwarm || anchorIds.length >= SWARM_THRESHOLD

          if (useSwarm) {
            return yield* runSwarm(anchorIds, {
              ...options,
              detectedBy: options.detectedBy ?? "periodic"
            })
          } else {
            return yield* runSequential(anchorIds, {
              ...options,
              detectedBy: options.detectedBy ?? "periodic"
            })
          }
        }),

      verifyGlob: (globPattern, options = {}) =>
        Effect.gen(function* () {
          // Simple glob matching - matches file path against pattern
          const matchesGlob = (filePath: string, pattern: string): boolean => {
            // Order matters: escape dots first, then convert glob patterns
            const regexPattern = pattern
              .replace(/\./g, "\\.") // Escape dots first
              .replace(/\*\*/g, "<<<GLOBSTAR>>>")
              .replace(/\*/g, "[^/]*")
              .replace(/\?/g, ".")
              .replace(/<<<GLOBSTAR>>>/g, ".*")

            const regex = new RegExp(`^${regexPattern}$`)
            return regex.test(filePath)
          }

          const allAnchors = yield* anchorRepo.findAll()
          const matchingIds = allAnchors
            .filter((a) => matchesGlob(a.filePath, globPattern))
            .filter((a) => !options.skipPinned || !a.pinned)
            .map((a) => a.id)

          const useSwarm =
            options.forceSwarm || matchingIds.length >= SWARM_THRESHOLD

          if (useSwarm) {
            return yield* runSwarm(matchingIds, {
              ...options,
              detectedBy: options.detectedBy ?? "manual"
            })
          } else {
            return yield* runSequential(matchingIds, {
              ...options,
              detectedBy: options.detectedBy ?? "manual"
            })
          }
        }),

      verifyChangedFiles: (filePaths, options = {}) =>
        Effect.gen(function* () {
          // Find anchors for all changed files
          const anchorIdSet = new Set<number>()

          for (const filePath of filePaths) {
            const anchors = yield* anchorRepo.findByFilePath(filePath)
            for (const anchor of anchors) {
              if (!options.skipPinned || !anchor.pinned) {
                anchorIdSet.add(anchor.id)
              }
            }
          }

          const anchorIds = Array.from(anchorIdSet)

          // Git hook context typically means large changes, use swarm
          const useSwarm =
            options.forceSwarm || anchorIds.length >= SWARM_THRESHOLD

          if (useSwarm) {
            return yield* runSwarm(anchorIds, {
              ...options,
              detectedBy: options.detectedBy ?? "git_hook"
            })
          } else {
            return yield* runSequential(anchorIds, {
              ...options,
              detectedBy: options.detectedBy ?? "git_hook"
            })
          }
        })
    }
  })
)
