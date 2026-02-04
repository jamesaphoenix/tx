import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  SqliteClient,
  LearningRepositoryLive,
  LearningRepository,
  LearningService,
  FeedbackTrackerService,
  EmbeddingService,
  EmbeddingServiceNoop,
  QueryExpansionServiceNoop,
  RerankerServiceNoop,
  RetrieverService,
  RetrieverServiceLive,
  RetrieverServiceNoop
} from "@jamesaphoenix/tx-core"

/**
 * Create a deterministic embedding from text content.
 * Uses a simple hash-based approach to ensure consistent results.
 * Similar content produces similar embeddings.
 */
function createDeterministicEmbedding(text: string, dimensions = 256): Float32Array {
  const embedding = new Float32Array(dimensions)
  // Use character codes to create a deterministic pattern
  for (let i = 0; i < dimensions; i++) {
    const charIndex = i % text.length
    const char = text.charCodeAt(charIndex)
    // Create a value between -1 and 1 based on character and position
    embedding[i] = Math.sin(char * (i + 1) * 0.01) * 0.5 + 0.5
  }
  // Normalize to unit vector
  let magnitude = 0
  for (let i = 0; i < dimensions; i++) {
    magnitude += embedding[i]! * embedding[i]!
  }
  magnitude = Math.sqrt(magnitude)
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      embedding[i] = embedding[i]! / magnitude
    }
  }
  return embedding
}

/**
 * Create a Mock EmbeddingService that returns deterministic embeddings.
 * This allows testing vector search without requiring actual LLM embeddings.
 */
function createMockEmbeddingService() {
  return Layer.succeed(EmbeddingService, {
    embed: (text: string) => Effect.succeed(createDeterministicEmbedding(text)),
    embedBatch: (texts: readonly string[]) => Effect.succeed(texts.map(t => createDeterministicEmbedding(t))),
    isAvailable: () => Effect.succeed(true),
    dimensions: 256
  })
}

/**
 * Convert Float32Array to Buffer for SQLite storage.
 */
function float32ArrayToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

function makeTestLayer(db: any) {
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

/**
 * Create test layer with mock embedding service for vector search testing.
 */
function makeTestLayerWithMockEmbeddings(db: any) {
  const infra = Layer.succeed(SqliteClient, db as any)
  const repos = LearningRepositoryLive.pipe(Layer.provide(infra))
  const mockEmbeddingService = createMockEmbeddingService()

  // RetrieverServiceLive with mock embeddings
  const retrieverLayer = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, mockEmbeddingService, QueryExpansionServiceNoop, RerankerServiceNoop))
  )

  return retrieverLayer
}

describe("RetrieverService", () => {
  describe("Service Resolution", () => {
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayer>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayer(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
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
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayer>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayer(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
          ))
        )
      )

      expect(results).toHaveLength(0)
    })
  })

  describe("RRF Fusion", () => {
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayer>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayer(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayer>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayer(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayer>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayer(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayer>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayer(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
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
            LearningRepositoryLive.pipe(Layer.provide(Layer.succeed(SqliteClient, shared.getDb() as any)))
          ))
        )
      )

      // With high minScore, may filter out results
      for (const result of results) {
        expect(result.relevanceScore).toBeGreaterThanOrEqual(0.9)
      }
    })
  })

  describe("Vector Search with Mock Embeddings", () => {
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayerWithMockEmbeddings>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayerWithMockEmbeddings(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
    })

    /**
     * Helper to insert learning with embedding directly in DB.
     */
    const insertLearningWithEmbedding = (
      db: any,
      content: string
    ): number => {
      const now = new Date().toISOString()
      const result = db.prepare(
        `INSERT INTO learnings (content, source_type, created_at) VALUES (?, 'manual', ?)`
      ).run(content, now)
      const id = Number(result.lastInsertRowid)

      // Add deterministic embedding
      const embedding = createDeterministicEmbedding(content)
      const buffer = float32ArrayToBuffer(embedding)
      db.prepare(`UPDATE learnings SET embedding = ? WHERE id = ?`).run(buffer, id)

      return id
    }

    it("semantic query returns content with similar embeddings", async () => {
      const db = shared.getDb()
      // Insert learnings with embeddings for vector search
      insertLearningWithEmbedding(db, "database optimization techniques")
      insertLearningWithEmbedding(db, "database performance tuning")
      insertLearningWithEmbedding(db, "cooking recipe for pasta")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("database optimization", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // Database-related learnings should rank higher than cooking
      const dbResults = results.filter(r => r.content.includes("database"))
      expect(dbResults.length).toBeGreaterThanOrEqual(1)

      // Check that vector scores are present (non-zero for matched learnings)
      const withVectorScore = results.filter(r => r.vectorScore > 0)
      expect(withVectorScore.length).toBeGreaterThanOrEqual(1)
    })

    it("mock embeddings produce consistent results across searches", async () => {
      const db = shared.getDb()
      insertLearningWithEmbedding(db, "consistent embedding test")

      // Run same search twice
      const results1 = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("consistent embedding", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      const results2 = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("consistent embedding", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results1.length).toBe(results2.length)

      // Same query should produce same scores (use toBeCloseTo for floating-point comparison)
      // Small differences can occur due to recency score using Date.now()
      if (results1.length > 0 && results2.length > 0) {
        expect(results1[0]?.vectorScore).toBe(results2[0]?.vectorScore)
        expect(results1[0]?.relevanceScore).toBeCloseTo(results2[0]!.relevanceScore, 5)
      }
    })

    it("vector rank is positive when embeddings are available", async () => {
      const db = shared.getDb()
      insertLearningWithEmbedding(db, "vector rank test content")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("vector rank test", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // With mock embeddings, vectorRank should be positive
      const withVectorRank = results.filter(r => r.vectorRank > 0)
      expect(withVectorRank.length).toBeGreaterThanOrEqual(1)
    })

    it("vector score is normalized between 0 and 1", async () => {
      const db = shared.getDb()
      insertLearningWithEmbedding(db, "normalization test alpha")
      insertLearningWithEmbedding(db, "normalization test beta")
      insertLearningWithEmbedding(db, "normalization test gamma")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("normalization test", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // Vector scores should be normalized between 0 and 1
      for (const result of results) {
        expect(result.vectorScore).toBeGreaterThanOrEqual(0)
        expect(result.vectorScore).toBeLessThanOrEqual(1)
      }
    })
  })

  describe("RRF Fusion Boost", () => {
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayerWithMockEmbeddings>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayerWithMockEmbeddings(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
    })

    /**
     * Helper to insert learning with embedding directly in DB.
     */
    const insertLearningWithEmbedding = (
      db: any,
      content: string
    ): number => {
      const now = new Date().toISOString()
      const result = db.prepare(
        `INSERT INTO learnings (content, source_type, created_at) VALUES (?, 'manual', ?)`
      ).run(content, now)
      const id = Number(result.lastInsertRowid)

      // Add deterministic embedding
      const embedding = createDeterministicEmbedding(content)
      const buffer = float32ArrayToBuffer(embedding)
      db.prepare(`UPDATE learnings SET embedding = ? WHERE id = ?`).run(buffer, id)

      return id
    }

    it("items in both BM25 and vector rankings get RRF boost", async () => {
      const db = shared.getDb()
      // Insert learnings with embeddings
      insertLearningWithEmbedding(db, "database optimization strategies")
      insertLearningWithEmbedding(db, "database optimization techniques")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("database optimization", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // Results should have both BM25 and vector rankings
      const withBothRankings = results.filter(r => r.bm25Rank > 0 && r.vectorRank > 0)
      expect(withBothRankings.length).toBeGreaterThanOrEqual(1)

      // RRF score should be positive for items in both rankings
      for (const result of withBothRankings) {
        expect(result.rrfScore).toBeGreaterThan(0)
      }
    })

    it("RRF score is higher for items ranking well in both systems", async () => {
      const db = shared.getDb()
      // Insert learnings with embeddings
      insertLearningWithEmbedding(db, "fusion test exact match")
      insertLearningWithEmbedding(db, "fusion test partial")
      insertLearningWithEmbedding(db, "unrelated cooking recipe")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("fusion test exact", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // Exact match should have highest RRF score
      const exactMatch = results.find(r => r.content.includes("exact match"))
      const partialMatch = results.find(r => r.content.includes("partial"))

      if (exactMatch && partialMatch) {
        // Item matching well in both BM25 and vector should have higher RRF
        expect(exactMatch.rrfScore).toBeGreaterThanOrEqual(partialMatch.rrfScore)
      }
    })

    it("RRF formula: 1/(k + rank) produces expected scores", async () => {
      const db = shared.getDb()
      insertLearningWithEmbedding(db, "rrf formula test")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("rrf formula", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(1)

      // RRF uses k=60 by default
      // For rank 1 in one system: 1/(60+1) ≈ 0.0164
      // For rank 1 in both systems: 2 * 1/(60+1) ≈ 0.0328
      for (const result of results) {
        if (result.bm25Rank > 0 || result.vectorRank > 0) {
          // RRF score should be positive
          expect(result.rrfScore).toBeGreaterThan(0)
          // Max possible for single system is 1/(60+1) ≈ 0.0164
          // Max possible for two systems is ~0.033
          expect(result.rrfScore).toBeLessThan(0.1)
        }
      }
    })
  })

  describe("Position-Aware Bonuses", () => {
    let shared: SharedTestLayerResult
    let layer: ReturnType<typeof makeTestLayerWithMockEmbeddings>

    beforeAll(async () => {
      shared = await createSharedTestLayer()
      layer = makeTestLayerWithMockEmbeddings(shared.getDb())
    })

    afterEach(async () => {
      await shared.reset()
    })

    afterAll(async () => {
      await shared.close()
    })

    /**
     * Helper to insert learning with embedding directly in DB.
     */
    const insertLearningWithEmbedding = (
      db: any,
      content: string
    ): number => {
      const now = new Date().toISOString()
      const result = db.prepare(
        `INSERT INTO learnings (content, source_type, created_at) VALUES (?, 'manual', ?)`
      ).run(content, now)
      const id = Number(result.lastInsertRowid)

      // Add deterministic embedding
      const embedding = createDeterministicEmbedding(content)
      const buffer = float32ArrayToBuffer(embedding)
      db.prepare(`UPDATE learnings SET embedding = ? WHERE id = ?`).run(buffer, id)

      return id
    }

    it("top ranked items get position bonus", async () => {
      const db = shared.getDb()
      // Insert multiple learnings to test ranking
      insertLearningWithEmbedding(db, "position bonus primary test")
      insertLearningWithEmbedding(db, "position bonus secondary test")
      insertLearningWithEmbedding(db, "position bonus tertiary test")
      insertLearningWithEmbedding(db, "unrelated content about cooking")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("position bonus", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(3)

      // Results should be sorted by relevanceScore (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(results[i]!.relevanceScore)
      }

      // Position bonus contributes to final score
      // Top results should have valid BM25 ranks (positive, within range)
      const matchingResults = results.filter(r => r.content.includes("position bonus"))
      expect(matchingResults.length).toBe(3)

      // All matching results should have positive BM25 ranks
      for (const result of matchingResults) {
        expect(result.bm25Rank).toBeGreaterThanOrEqual(1)
        expect(result.bm25Rank).toBeLessThanOrEqual(3)
      }
    })

    it("position bonuses are applied based on rank", async () => {
      const db = shared.getDb()
      // Position bonuses are applied:
      // - TOP_1_BONUS = 0.05 for rank 1 in any system
      // - TOP_3_BONUS = 0.02 for ranks 2-3 in any system
      insertLearningWithEmbedding(db, "position rank first item test")
      insertLearningWithEmbedding(db, "position rank second item test")
      insertLearningWithEmbedding(db, "position rank third item test")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RetrieverService
          return yield* svc.search("position rank", { limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )

      expect(results.length).toBeGreaterThanOrEqual(2)

      // Verify results have valid BM25 rankings (1-indexed)
      const bm25Ranks = results.filter(r => r.bm25Rank > 0).map(r => r.bm25Rank)
      expect(bm25Ranks.length).toBeGreaterThanOrEqual(2)

      // Rankings should be positive and sequential
      for (const rank of bm25Ranks) {
        expect(rank).toBeGreaterThanOrEqual(1)
      }

      // Results are sorted by relevance score (descending)
      // Position bonus contributes to this ordering
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(results[i]!.relevanceScore)
      }
    })
  })

  describe("Feedback Scoring Integration", () => {
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
            content: "Database optimization techniques",
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
      }
    })

    it("feedbackScore defaults to 0.5 for learnings with no feedback", async () => {
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
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.length).toBeGreaterThanOrEqual(1)

      // Without feedback, score should be neutral (0.5)
      expect(result[0].feedbackScore).toBe(0.5)
    })

    it("feedbackScore reflects recorded usage feedback via batch method", async () => {
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
        }).pipe(Effect.provide(shared.layer))
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
        }).pipe(Effect.provide(shared.layer))
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
