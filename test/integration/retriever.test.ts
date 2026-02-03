import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDb, seedFixtures } from "../fixtures.js"
import {
  SqliteClient,
  LearningRepositoryLive,
  LearningRepository,
  EmbeddingServiceNoop,
  QueryExpansionServiceNoop,
  RerankerServiceNoop,
  RetrieverService,
  RetrieverServiceLive,
  RetrieverServiceNoop
} from "@tx/core"
import type Database from "better-sqlite3"

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as any)
  const repos = LearningRepositoryLive.pipe(Layer.provide(infra))

  // RetrieverServiceLive needs repos, embedding, query expansion, and reranker
  const retrieverLayer = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop))
  )

  return retrieverLayer
}

function makeNoopTestLayer() {
  return RetrieverServiceNoop
}

describe("RetrieverService", () => {
  describe("Service Resolution", () => {
    let db: InstanceType<typeof Database>
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = createTestDb()
      seedFixtures(db)
      layer = makeTestLayer(db)
    })

    it("service resolves in test layer", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return typeof svc.search === "function"
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe(true)
    })

    it("isAvailable returns true for Live implementation", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(layer))
      )

      expect(available).toBe(true)
    })
  })

  describe("Noop Implementation", () => {
    it("isAvailable returns false for Noop implementation", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(makeNoopTestLayer()))
      )

      expect(available).toBe(false)
    })

    it("search returns empty array for Noop implementation", async () => {
      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("test query", { limit: 10 })
        }).pipe(Effect.provide(makeNoopTestLayer()))
      )

      expect(results).toEqual([])
    })
  })

  describe("BM25 Search", () => {
    let db: InstanceType<typeof Database>
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = createTestDb()
      seedFixtures(db)
      layer = makeTestLayer(db)
    })

    it("exact match query returns matching learning", async () => {
      // First create a learning via repo
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database transactions are essential for consistency" })
        yield* repo.insert({ content: "Rate limiting protects your API" })

        const svc = yield* RetrieverService
        return yield* svc.search("database transactions", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0]?.content).toContain("Database")
    })

    it("partial match ranks relevant content", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database optimization techniques" })
        yield* repo.insert({ content: "Database indexing best practices" })
        yield* repo.insert({ content: "Unrelated content about cooking" })

        const svc = yield* RetrieverService
        return yield* svc.search("database", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      // Should return database-related learnings, not cooking
      expect(results.length).toBeGreaterThanOrEqual(1)
      for (const r of results) {
        expect(r.content.toLowerCase()).toContain("database")
      }
    })

    it("empty query returns empty results", async () => {
      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results).toHaveLength(0)
    })

    it("non-matching query returns empty results", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database transactions" })

        const svc = yield* RetrieverService
        return yield* svc.search("xyz123nonexistent", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results).toHaveLength(0)
    })
  })

  describe("RRF Fusion", () => {
    let db: InstanceType<typeof Database>
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = createTestDb()
      seedFixtures(db)
      layer = makeTestLayer(db)
    })

    it("results include RRF score fields", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database query optimization techniques" })
        yield* repo.insert({ content: "SQL indexing best practices for databases" })

        const svc = yield* RetrieverService
        return yield* svc.search("database optimization", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // Check that RRF fields are present on all results
      for (const result of results) {
        expect(result).toHaveProperty("rrfScore")
        expect(result).toHaveProperty("bm25Rank")
        expect(result).toHaveProperty("vectorRank")
        expect(typeof result.rrfScore).toBe("number")
        expect(typeof result.bm25Rank).toBe("number")
        expect(typeof result.vectorRank).toBe("number")
      }
    })

    it("BM25 ranks are 1-indexed", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database optimization guide" })
        yield* repo.insert({ content: "Database performance tuning" })

        const svc = yield* RetrieverService
        return yield* svc.search("database", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // All results from BM25 should have positive bm25Rank
      const withBM25 = results.filter(r => r.bm25Rank > 0)
      expect(withBM25.length).toBeGreaterThan(0)

      // Ranks should be 1-indexed
      for (const result of withBM25) {
        expect(result.bm25Rank).toBeGreaterThanOrEqual(1)
      }
    })
  })

  describe("Scoring Components", () => {
    let db: InstanceType<typeof Database>
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = createTestDb()
      seedFixtures(db)
      layer = makeTestLayer(db)
    })

    it("recency boost applied to results", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database tip from today" })

        const svc = yield* RetrieverService
        return yield* svc.search("database", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // Recency score should be present and positive for recent learnings
      for (const result of results) {
        expect(result).toHaveProperty("recencyScore")
        expect(result.recencyScore).toBeGreaterThanOrEqual(0)
        expect(result.recencyScore).toBeLessThanOrEqual(1)
      }
    })

    it("outcome boost applied when outcome score set", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        const learning1 = yield* repo.insert({ content: "Database indexing tip one" })
        yield* repo.insert({ content: "Database indexing tip two" })

        // Mark first one as helpful
        yield* repo.updateOutcomeScore(learning1.id, 1.0)

        const svc = yield* RetrieverService
        return yield* svc.search("database indexing", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeGreaterThanOrEqual(2)

      // The learning with outcome score should have higher relevance
      const withOutcome = results.find(r => r.outcomeScore === 1.0)
      const withoutOutcome = results.find(r => r.outcomeScore === null)

      if (withOutcome && withoutOutcome) {
        expect(withOutcome.relevanceScore).toBeGreaterThan(withoutOutcome.relevanceScore)
      }
    })

    it("frequency boost applied when usage count increases", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        const learning1 = yield* repo.insert({ content: "Database tip frequently used" })
        yield* repo.insert({ content: "Database tip rarely used" })

        // Increment usage for first one multiple times
        yield* repo.incrementUsage(learning1.id)
        yield* repo.incrementUsage(learning1.id)
        yield* repo.incrementUsage(learning1.id)

        const svc = yield* RetrieverService
        return yield* svc.search("database tip", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeGreaterThanOrEqual(2)

      // The frequently used learning should have higher relevance
      const frequentlyUsed = results.find(r => r.usageCount >= 3)
      const rarelyUsed = results.find(r => r.usageCount === 0)

      if (frequentlyUsed && rarelyUsed) {
        expect(frequentlyUsed.relevanceScore).toBeGreaterThan(rarelyUsed.relevanceScore)
      }
    })
  })

  describe("Graceful Degradation", () => {
    let db: InstanceType<typeof Database>
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = createTestDb()
      seedFixtures(db)
      layer = makeTestLayer(db)
    })

    it("works with Noop EmbeddingService (BM25-only fallback)", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Effect-TS service layer patterns" })
        yield* repo.insert({ content: "TypeScript best practices" })

        const svc = yield* RetrieverService
        return yield* svc.search("Effect-TS patterns", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      // Should still return results based on BM25
      expect(results.length).toBeGreaterThanOrEqual(1)

      // With EmbeddingServiceNoop, all vectorRank should be 0
      for (const result of results) {
        expect(result.vectorRank).toBe(0)
        expect(result.vectorScore).toBe(0)
      }
    })

    it("vector rank is 0 when embeddings unavailable", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Machine learning algorithms" })

        const svc = yield* RetrieverService
        return yield* svc.search("machine learning", { limit: 10, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // With EmbeddingServiceNoop, all vectorRank should be 0
      for (const result of results) {
        expect(result.vectorRank).toBe(0)
        expect(result.vectorScore).toBe(0)
      }
    })
  })

  describe("Options", () => {
    let db: InstanceType<typeof Database>
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = createTestDb()
      seedFixtures(db)
      layer = makeTestLayer(db)
    })

    it("respects limit parameter", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database tip 1" })
        yield* repo.insert({ content: "Database tip 2" })
        yield* repo.insert({ content: "Database tip 3" })
        yield* repo.insert({ content: "Database tip 4" })

        const svc = yield* RetrieverService
        return yield* svc.search("database", { limit: 2, minScore: 0 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      expect(results.length).toBeLessThanOrEqual(2)
    })

    it("respects minScore parameter", async () => {
      const createAndSearch = Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Database transactions" })

        const svc = yield* RetrieverService
        return yield* svc.search("database", { limit: 10, minScore: 0.9 })
      })

      const results = await Effect.runPromise(
        createAndSearch.pipe(
          Effect.provide(Layer.mergeAll(
            layer,
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, db as any)))
          ))
        )
      )

      // With high minScore, may filter out results
      for (const result of results) {
        expect(result.relevanceScore).toBeGreaterThanOrEqual(0.9)
      }
    })
  })

  describe("Feedback Scoring Integration", () => {
    it("search results include feedbackScore field", async () => {
      const { makeAppLayer, RetrieverService, LearningService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const retrieverSvc = yield* RetrieverService

          // Create learning
          yield* learningSvc.create({
            content: "Database optimization techniques",
            sourceType: "manual",
          })

          // Search should include feedbackScore
          return yield* retrieverSvc.search("database", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(result.length).toBeGreaterThanOrEqual(1)

      // All results should have feedbackScore field
      for (const r of result) {
        expect(r).toHaveProperty("feedbackScore")
        expect(typeof r.feedbackScore).toBe("number")
      }
    })

    it("feedbackScore defaults to 0.5 for learnings with no feedback", async () => {
      const { makeAppLayer, RetrieverService, LearningService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const retrieverSvc = yield* RetrieverService

          // Create learning (no feedback)
          yield* learningSvc.create({
            content: "Database indexing best practices",
            sourceType: "manual",
          })

          return yield* retrieverSvc.search("database", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(result.length).toBeGreaterThanOrEqual(1)

      // Without feedback, score should be neutral (0.5)
      expect(result[0].feedbackScore).toBe(0.5)
    })

    it("feedbackScore reflects recorded usage feedback via batch method", async () => {
      const { makeAppLayer, RetrieverService, LearningService, FeedbackTrackerService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const feedbackSvc = yield* FeedbackTrackerService
          const retrieverSvc = yield* RetrieverService

          // Create learnings with identical content so only feedback differs
          const helpfulLearning = yield* learningSvc.create({
            content: "Database transaction patterns for testing feedback scores",
            sourceType: "manual",
          })
          const unhelpfulLearning = yield* learningSvc.create({
            content: "Database transaction patterns for testing feedback scores",
            sourceType: "manual",
          })

          // Record feedback - helpful learning gets positive feedback
          yield* feedbackSvc.recordUsage("run-1", [
            { id: helpfulLearning.id, helpful: true },
          ])
          yield* feedbackSvc.recordUsage("run-2", [
            { id: helpfulLearning.id, helpful: true },
          ])
          yield* feedbackSvc.recordUsage("run-3", [
            { id: helpfulLearning.id, helpful: true },
          ])

          // Record feedback - unhelpful learning gets negative feedback
          yield* feedbackSvc.recordUsage("run-1", [
            { id: unhelpfulLearning.id, helpful: false },
          ])
          yield* feedbackSvc.recordUsage("run-2", [
            { id: unhelpfulLearning.id, helpful: false },
          ])
          yield* feedbackSvc.recordUsage("run-3", [
            { id: unhelpfulLearning.id, helpful: false },
          ])

          // Search and get both results
          const searchResults = yield* retrieverSvc.search("database", { limit: 10, minScore: 0 })

          return {
            searchResults,
            helpfulId: helpfulLearning.id,
            unhelpfulId: unhelpfulLearning.id
          }
        }).pipe(Effect.provide(layer))
      )

      expect(result.searchResults.length).toBeGreaterThanOrEqual(2)

      // Find the helpful and unhelpful learnings in results
      const helpfulResult = result.searchResults.find(r => r.id === result.helpfulId)
      const unhelpfulResult = result.searchResults.find(r => r.id === result.unhelpfulId)

      expect(helpfulResult).toBeDefined()
      expect(unhelpfulResult).toBeDefined()

      // Helpful learning: Bayesian (3 + 0.5*2) / (3 + 2) = 4/5 = 0.8
      expect(helpfulResult!.feedbackScore).toBe(0.8)

      // Unhelpful learning: Bayesian (0 + 0.5*2) / (3 + 2) = 1/5 = 0.2
      expect(unhelpfulResult!.feedbackScore).toBe(0.2)

      // Helpful learning should have higher relevance due to feedback boost
      expect(helpfulResult!.relevanceScore).toBeGreaterThan(unhelpfulResult!.relevanceScore)
    })

    it("batch feedback method is used for multiple learnings (single query)", async () => {
      const { makeAppLayer, RetrieverService, LearningService, FeedbackTrackerService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const feedbackSvc = yield* FeedbackTrackerService
          const retrieverSvc = yield* RetrieverService

          // Create multiple learnings
          const learning1 = yield* learningSvc.create({
            content: "Database query optimization strategy one",
            sourceType: "manual",
          })
          const learning2 = yield* learningSvc.create({
            content: "Database query tuning strategy two",
            sourceType: "manual",
          })
          const learning3 = yield* learningSvc.create({
            content: "Database indexing strategy three",
            sourceType: "manual",
          })

          // Record different feedback for each
          yield* feedbackSvc.recordUsage("run-1", [
            { id: learning1.id, helpful: true },
            { id: learning2.id, helpful: false },
          ])
          yield* feedbackSvc.recordUsage("run-2", [
            { id: learning1.id, helpful: true },
            { id: learning3.id, helpful: true },
          ])

          // Search returns all three
          const searchResults = yield* retrieverSvc.search("database", { limit: 10, minScore: 0 })

          return {
            searchResults,
            id1: learning1.id,
            id2: learning2.id,
            id3: learning3.id
          }
        }).pipe(Effect.provide(layer))
      )

      expect(result.searchResults.length).toBeGreaterThanOrEqual(3)

      // All learnings should have feedbackScore computed from batch method
      const r1 = result.searchResults.find(r => r.id === result.id1)
      const r2 = result.searchResults.find(r => r.id === result.id2)
      const r3 = result.searchResults.find(r => r.id === result.id3)

      expect(r1).toBeDefined()
      expect(r2).toBeDefined()
      expect(r3).toBeDefined()

      // Learning 1: 2 helpful = (2 + 1) / (2 + 2) = 0.75
      expect(r1!.feedbackScore).toBe(0.75)

      // Learning 2: 1 unhelpful = (0 + 1) / (1 + 2) = 0.333...
      expect(r2!.feedbackScore).toBeCloseTo(0.333, 2)

      // Learning 3: 1 helpful = (1 + 1) / (1 + 2) = 0.666...
      expect(r3!.feedbackScore).toBeCloseTo(0.667, 2)
    })
  })
})
