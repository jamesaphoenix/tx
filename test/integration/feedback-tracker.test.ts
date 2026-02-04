/**
 * FeedbackTrackerService Integration Tests
 *
 * Tests the FeedbackTrackerService at the service layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 * Previously created ~17 databases, now creates 1 per describe block (~4 total).
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services once at module level
import {
  FeedbackTrackerService,
  FeedbackTrackerServiceNoop,
  LearningService,
  EdgeService,
  RetrieverService
} from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`feedback-tracker-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  RUN_1: fixtureId("run-1"),
  RUN_2: fixtureId("run-2"),
  RUN_3: fixtureId("run-3"),
} as const

// =============================================================================
// FeedbackTrackerServiceLive Tests
// =============================================================================

describe("FeedbackTrackerServiceLive Integration", () => {
  describe("recordUsage", () => {
    let shared: SharedTestLayerResult

    beforeAll(async () => {
      shared = await createSharedTestLayer()
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
    })

    it("creates USED_IN_RUN edges for each learning", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService
          const edgeSvc = yield* EdgeService

          // Create learnings
          const learning1 = yield* learningSvc.create({
            content: "Learning 1",
            sourceType: "manual",
          })
          const learning2 = yield* learningSvc.create({
            content: "Learning 2",
            sourceType: "manual",
          })

          // Record usage
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [
            { id: learning1.id, helpful: true },
            { id: learning2.id, helpful: false },
          ])

          // Query edges
          const edges1 = yield* edgeSvc.findFromSource("learning", String(learning1.id))
          const edges2 = yield* edgeSvc.findFromSource("learning", String(learning2.id))

          return { edges1, edges2 }
        }).pipe(Effect.provide(shared.layer))
      )

      // Check edges were created
      expect(result.edges1).toHaveLength(1)
      expect(result.edges2).toHaveLength(1)

      // Check edge types
      expect(result.edges1[0].edgeType).toBe("USED_IN_RUN")
      expect(result.edges2[0].edgeType).toBe("USED_IN_RUN")

      // Check weights (helpful = 1.0, not helpful = 0.0)
      expect(result.edges1[0].weight).toBe(1.0)
      expect(result.edges2[0].weight).toBe(0.0)

      // Check target
      expect(result.edges1[0].targetType).toBe("run")
      expect(result.edges1[0].targetId).toBe(FIXTURES.RUN_1)
    })

    it("stores position in metadata", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService
          const edgeSvc = yield* EdgeService

          // Create learnings
          const learning1 = yield* learningSvc.create({
            content: "Learning 1",
            sourceType: "manual",
          })
          const learning2 = yield* learningSvc.create({
            content: "Learning 2",
            sourceType: "manual",
          })
          const learning3 = yield* learningSvc.create({
            content: "Learning 3",
            sourceType: "manual",
          })

          // Record usage
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [
            { id: learning1.id, helpful: true },
            { id: learning2.id, helpful: false },
            { id: learning3.id, helpful: true },
          ])

          // Query edges
          const edges1 = yield* edgeSvc.findFromSource("learning", String(learning1.id))
          const edges2 = yield* edgeSvc.findFromSource("learning", String(learning2.id))
          const edges3 = yield* edgeSvc.findFromSource("learning", String(learning3.id))

          return { edges1, edges2, edges3 }
        }).pipe(Effect.provide(shared.layer))
      )

      // Check positions in metadata
      expect((result.edges1[0].metadata as any).position).toBe(0)
      expect((result.edges2[0].metadata as any).position).toBe(1)
      expect((result.edges3[0].metadata as any).position).toBe(2)
    })

    it("stores recordedAt in metadata", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService
          const edgeSvc = yield* EdgeService

          // Create learning
          const learning = yield* learningSvc.create({
            content: "Learning",
            sourceType: "manual",
          })

          // Record usage
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [
            { id: learning.id, helpful: true },
          ])

          // Query edge
          const edges = yield* edgeSvc.findFromSource("learning", String(learning.id))

          return edges[0]
        }).pipe(Effect.provide(shared.layer))
      )

      // Check recordedAt is ISO string
      const recordedAt = (result.metadata as any).recordedAt
      expect(typeof recordedAt).toBe("string")
      expect(new Date(recordedAt).toISOString()).toBe(recordedAt)
    })

    it("handles empty learnings array", async () => {
      // Should not throw
      await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [])
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })

  describe("getFeedbackScore", () => {
    let shared: SharedTestLayerResult

    beforeAll(async () => {
      shared = await createSharedTestLayer()
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
    })

    it("returns 0.5 for learning with no feedback", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          // Create learning with no feedback
          const learning = yield* learningSvc.create({
            content: "Learning",
            sourceType: "manual",
          })

          return yield* feedbackSvc.getFeedbackScore(learning.id)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBe(0.5)
    })

    it("returns higher score for all helpful feedback", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning = yield* learningSvc.create({
            content: "Learning",
            sourceType: "manual",
          })

          // Record 3 helpful usages
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_3, [{ id: learning.id, helpful: true }])

          return yield* feedbackSvc.getFeedbackScore(learning.id)
        }).pipe(Effect.provide(shared.layer))
      )

      // Bayesian: (3 + 0.5 * 2) / (3 + 2) = 4 / 5 = 0.8
      expect(result).toBe(0.8)
    })

    it("returns lower score for all unhelpful feedback", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning = yield* learningSvc.create({
            content: "Learning",
            sourceType: "manual",
          })

          // Record 3 unhelpful usages
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning.id, helpful: false }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning.id, helpful: false }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_3, [{ id: learning.id, helpful: false }])

          return yield* feedbackSvc.getFeedbackScore(learning.id)
        }).pipe(Effect.provide(shared.layer))
      )

      // Bayesian: (0 + 0.5 * 2) / (3 + 2) = 1 / 5 = 0.2
      expect(result).toBe(0.2)
    })

    it("returns balanced score for mixed feedback", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning = yield* learningSvc.create({
            content: "Learning",
            sourceType: "manual",
          })

          // Record 2 helpful, 2 unhelpful
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_3, [{ id: learning.id, helpful: false }])
          yield* feedbackSvc.recordUsage(fixtureId("run-4"), [{ id: learning.id, helpful: false }])

          return yield* feedbackSvc.getFeedbackScore(learning.id)
        }).pipe(Effect.provide(shared.layer))
      )

      // Bayesian: (2 + 0.5 * 2) / (4 + 2) = 3 / 6 = 0.5
      expect(result).toBe(0.5)
    })

    it("score regresses to prior with less data", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning = yield* learningSvc.create({
            content: "Learning",
            sourceType: "manual",
          })

          // Record 1 helpful usage
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning.id, helpful: true }])

          return yield* feedbackSvc.getFeedbackScore(learning.id)
        }).pipe(Effect.provide(shared.layer))
      )

      // Bayesian: (1 + 0.5 * 2) / (1 + 2) = 2 / 3 ≈ 0.667
      // With only 1 data point, the prior pulls toward 0.5
      expect(result).toBeCloseTo(0.667, 2)
    })

    it("calculates Bayesian average correctly with 3/4 helpful (~0.667)", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning = yield* learningSvc.create({
            content: "Learning for 3/4 helpful test",
            sourceType: "manual",
          })

          // Record 3 helpful and 1 unhelpful usage (3/4 helpful ratio)
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_3, [{ id: learning.id, helpful: true }])
          yield* feedbackSvc.recordUsage(fixtureId("run-4"), [{ id: learning.id, helpful: false }])

          return yield* feedbackSvc.getFeedbackScore(learning.id)
        }).pipe(Effect.provide(shared.layer))
      )

      // Bayesian: (3 + 0.5 * 2) / (4 + 2) = 4 / 6 ≈ 0.667
      // With 3/4 (75%) helpful, the Bayesian average is ~0.667
      expect(result).toBeCloseTo(0.667, 2)
    })

    it("scores are independent per learning", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning1 = yield* learningSvc.create({
            content: "Learning 1",
            sourceType: "manual",
          })
          const learning2 = yield* learningSvc.create({
            content: "Learning 2",
            sourceType: "manual",
          })

          // Learning 1: all helpful
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning1.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning1.id, helpful: true }])

          // Learning 2: all unhelpful
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning2.id, helpful: false }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning2.id, helpful: false }])

          const score1 = yield* feedbackSvc.getFeedbackScore(learning1.id)
          const score2 = yield* feedbackSvc.getFeedbackScore(learning2.id)

          return { score1, score2 }
        }).pipe(Effect.provide(shared.layer))
      )

      // Learning 1: (2 + 1) / (2 + 2) = 0.75
      expect(result.score1).toBe(0.75)
      // Learning 2: (0 + 1) / (2 + 2) = 0.25
      expect(result.score2).toBe(0.25)
    })
  })

  describe("getFeedbackScores (batch)", () => {
    let shared: SharedTestLayerResult

    beforeAll(async () => {
      shared = await createSharedTestLayer()
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
    })

    it("returns map with all 0.5 for learnings with no feedback", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          // Create learnings with no feedback
          const learning1 = yield* learningSvc.create({
            content: "Learning 1",
            sourceType: "manual",
          })
          const learning2 = yield* learningSvc.create({
            content: "Learning 2",
            sourceType: "manual",
          })
          const learning3 = yield* learningSvc.create({
            content: "Learning 3",
            sourceType: "manual",
          })

          return yield* feedbackSvc.getFeedbackScores([learning1.id, learning2.id, learning3.id])
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.size).toBe(3)
      for (const [_id, score] of result) {
        expect(score).toBe(0.5)
      }
    })

    it("returns correct scores for multiple learnings with mixed feedback", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning1 = yield* learningSvc.create({
            content: "Learning 1",
            sourceType: "manual",
          })
          const learning2 = yield* learningSvc.create({
            content: "Learning 2",
            sourceType: "manual",
          })
          const learning3 = yield* learningSvc.create({
            content: "Learning 3",
            sourceType: "manual",
          })

          // Learning 1: 3 helpful
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning1.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning1.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_3, [{ id: learning1.id, helpful: true }])

          // Learning 2: 3 unhelpful
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning2.id, helpful: false }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning2.id, helpful: false }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_3, [{ id: learning2.id, helpful: false }])

          // Learning 3: no feedback (neutral)

          return {
            scores: yield* feedbackSvc.getFeedbackScores([learning1.id, learning2.id, learning3.id]),
            ids: { id1: learning1.id, id2: learning2.id, id3: learning3.id }
          }
        }).pipe(Effect.provide(shared.layer))
      )

      // Learning 1: (3 + 0.5 * 2) / (3 + 2) = 4 / 5 = 0.8
      expect(result.scores.get(result.ids.id1)).toBe(0.8)
      // Learning 2: (0 + 0.5 * 2) / (3 + 2) = 1 / 5 = 0.2
      expect(result.scores.get(result.ids.id2)).toBe(0.2)
      // Learning 3: no feedback = 0.5
      expect(result.scores.get(result.ids.id3)).toBe(0.5)
    })

    it("returns empty map for empty input array", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          return yield* feedbackSvc.getFeedbackScores([])
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.size).toBe(0)
    })

    it("returns same scores as single getFeedbackScore calls", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const feedbackSvc = yield* FeedbackTrackerService
          const learningSvc = yield* LearningService

          const learning1 = yield* learningSvc.create({
            content: "Learning 1",
            sourceType: "manual",
          })
          const learning2 = yield* learningSvc.create({
            content: "Learning 2",
            sourceType: "manual",
          })

          // Add mixed feedback
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning1.id, helpful: true }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: learning1.id, helpful: false }])
          yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: learning2.id, helpful: true }])

          // Get individual scores
          const single1 = yield* feedbackSvc.getFeedbackScore(learning1.id)
          const single2 = yield* feedbackSvc.getFeedbackScore(learning2.id)

          // Get batch scores
          const batch = yield* feedbackSvc.getFeedbackScores([learning1.id, learning2.id])

          return { single1, single2, batch1: batch.get(learning1.id), batch2: batch.get(learning2.id) }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.batch1).toBe(result.single1)
      expect(result.batch2).toBe(result.single2)
    })
  })
})

// =============================================================================
// FeedbackTrackerServiceNoop Tests
// =============================================================================

describe("FeedbackTrackerServiceNoop", () => {
  it("recordUsage does nothing", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const feedbackSvc = yield* FeedbackTrackerService
        // Should not throw even with non-existent IDs
        yield* feedbackSvc.recordUsage("run-1", [
          { id: 99999, helpful: true },
        ])
      }).pipe(Effect.provide(FeedbackTrackerServiceNoop))
    )
  })

  it("getFeedbackScore always returns 0.5", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const feedbackSvc = yield* FeedbackTrackerService
        return yield* feedbackSvc.getFeedbackScore(12345)
      }).pipe(Effect.provide(FeedbackTrackerServiceNoop))
    )

    expect(result).toBe(0.5)
  })

  it("getFeedbackScores returns all 0.5 scores", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const feedbackSvc = yield* FeedbackTrackerService
        return yield* feedbackSvc.getFeedbackScores([1, 2, 3, 100])
      }).pipe(Effect.provide(FeedbackTrackerServiceNoop))
    )

    expect(result.size).toBe(4)
    expect(result.get(1)).toBe(0.5)
    expect(result.get(2)).toBe(0.5)
    expect(result.get(3)).toBe(0.5)
    expect(result.get(100)).toBe(0.5)
  })
})

// =============================================================================
// Retriever Integration Tests (feedbackScore in search results)
// =============================================================================

describe("FeedbackTracker Retriever Integration", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("search results include feedbackScore field", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const retrieverSvc = yield* RetrieverService

        // Create learning
        yield* learningSvc.create({
          content: "Database optimization for feedback test",
          sourceType: "manual",
        })

        // Search should include feedbackScore
        return yield* retrieverSvc.search("database", { limit: 10, minScore: 0 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.length).toBeGreaterThanOrEqual(1)

    // All results should have feedbackScore field
    for (const r of result) {
      expect(r).toHaveProperty("feedbackScore")
      expect(typeof r.feedbackScore).toBe("number")
      expect(r.feedbackScore).toBeGreaterThanOrEqual(0)
      expect(r.feedbackScore).toBeLessThanOrEqual(1)
    }
  })

  it("feedbackScore defaults to 0.5 for learnings with no feedback", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const retrieverSvc = yield* RetrieverService

        // Create learning (no feedback)
        yield* learningSvc.create({
          content: "Database indexing for neutral feedback test",
          sourceType: "manual",
        })

        return yield* retrieverSvc.search("database", { limit: 10, minScore: 0 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.length).toBeGreaterThanOrEqual(1)

    // Without feedback, score should be neutral (0.5)
    expect(result[0].feedbackScore).toBe(0.5)
  })

  it("learnings with good feedback rank higher than new learnings (same BM25 score)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const feedbackSvc = yield* FeedbackTrackerService
        const retrieverSvc = yield* RetrieverService

        // Create two learnings with identical content (same BM25 score)
        const helpfulLearning = yield* learningSvc.create({
          content: "Database transaction patterns for ranking test",
          sourceType: "manual",
        })
        const newLearning = yield* learningSvc.create({
          content: "Database transaction patterns for ranking test",
          sourceType: "manual",
        })

        // Record positive feedback for first learning only
        yield* feedbackSvc.recordUsage(FIXTURES.RUN_1, [{ id: helpfulLearning.id, helpful: true }])
        yield* feedbackSvc.recordUsage(FIXTURES.RUN_2, [{ id: helpfulLearning.id, helpful: true }])
        yield* feedbackSvc.recordUsage(FIXTURES.RUN_3, [{ id: helpfulLearning.id, helpful: true }])

        // Search returns both results
        const searchResults = yield* retrieverSvc.search("database transaction", { limit: 10, minScore: 0 })

        return {
          searchResults,
          helpfulId: helpfulLearning.id,
          newId: newLearning.id
        }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.searchResults.length).toBeGreaterThanOrEqual(2)

    // Find the helpful and new learnings in results
    const helpfulResult = result.searchResults.find(r => r.id === result.helpfulId)
    const newResult = result.searchResults.find(r => r.id === result.newId)

    expect(helpfulResult).toBeDefined()
    expect(newResult).toBeDefined()

    // Helpful learning should have higher feedbackScore (0.8 vs 0.5)
    // Bayesian: (3 + 0.5*2) / (3 + 2) = 4/5 = 0.8
    expect(helpfulResult!.feedbackScore).toBe(0.8)
    expect(newResult!.feedbackScore).toBe(0.5) // No feedback = neutral

    // Helpful learning should rank higher due to feedback boost
    expect(helpfulResult!.relevanceScore).toBeGreaterThan(newResult!.relevanceScore)
  })
})
