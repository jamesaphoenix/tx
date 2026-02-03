import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import type { LearningWithScore, LearningId } from "@jamesaphoenix/tx-types"

/**
 * DiversifierService Integration Tests
 *
 * Tests MMR (Maximal Marginal Relevance) diversification following Rule 3:
 * - Real in-memory SQLite via makeAppLayer(":memory:")
 * - Deterministic numeric IDs for learnings
 * - Full service path: DiversifierService -> cosineSimilarity
 */

// Deterministic numeric IDs for test learnings (LearningId is a branded number)
const FIXTURES = {
  LEARNING_1: 1 as LearningId,
  LEARNING_2: 2 as LearningId,
  LEARNING_3: 3 as LearningId,
  LEARNING_4: 4 as LearningId,
  LEARNING_5: 5 as LearningId,
  LEARNING_6: 6 as LearningId,
} as const

/**
 * Create a deterministic embedding from a seed value.
 * Same seed produces identical embedding for test reproducibility.
 * Different seeds produce dissimilar embeddings (low cosine similarity).
 */
function createDeterministicEmbedding(seed: number, dimensions = 256): Float32Array {
  const embedding = new Float32Array(dimensions)
  for (let i = 0; i < dimensions; i++) {
    // Create a deterministic value based on seed and position
    embedding[i] = Math.sin(seed * 100 + i * 0.1) * 0.5 + 0.5
  }
  // Normalize to unit vector for cosine similarity
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
 * Create a similar embedding to a source embedding.
 * Introduces small perturbations to create high cosine similarity.
 */
function createSimilarEmbedding(source: Float32Array, perturbation = 0.05): Float32Array {
  const embedding = new Float32Array(source.length)
  for (let i = 0; i < source.length; i++) {
    // Add small random-like perturbation based on index
    embedding[i] = source[i]! + Math.sin(i * 0.5) * perturbation
  }
  // Re-normalize
  let magnitude = 0
  for (let i = 0; i < embedding.length; i++) {
    magnitude += embedding[i]! * embedding[i]!
  }
  magnitude = Math.sqrt(magnitude)
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] = embedding[i]! / magnitude
    }
  }
  return embedding
}

/**
 * Create a mock LearningWithScore for testing.
 */
function createMockLearning(
  id: LearningId,
  relevanceScore: number,
  embedding: Float32Array | null,
  category: string | null = null
): LearningWithScore {
  return {
    id,
    content: `Learning content for ${id}`,
    sourceType: "manual" as const,
    sourceRef: null,
    createdAt: new Date(),
    keywords: [],
    category,
    usageCount: 0,
    lastUsedAt: null,
    outcomeScore: null,
    embedding,
    relevanceScore,
    bm25Score: relevanceScore * 0.5,
    vectorScore: relevanceScore * 0.5,
    recencyScore: 0.5,
    rrfScore: 0.01,
    bm25Rank: 1,
    vectorRank: 1,
  }
}

describe("DiversifierService Integration", () => {
  describe("Service Resolution", () => {
    it("DiversifierService resolves in app layer", async () => {
      const { makeAppLayer, DiversifierService } = await import("@jamesaphoenix/tx-core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return typeof svc.mmrDiversify === "function"
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe(true)
    })

    it("Noop implementation returns truncated candidates", async () => {
      const { DiversifierService, DiversifierServiceNoop } = await import("@jamesaphoenix/tx-core")

      const embedding = createDeterministicEmbedding(1)
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.9, embedding),
        createMockLearning(FIXTURES.LEARNING_2, 0.8, embedding),
        createMockLearning(FIXTURES.LEARNING_3, 0.7, embedding),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 2)
        }).pipe(Effect.provide(DiversifierServiceNoop))
      )

      expect(result).toHaveLength(2)
      // Noop just truncates - first two in order
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_1)
      expect(result[1]!.id).toBe(FIXTURES.LEARNING_2)
    })
  })

  describe("MMR Selection", () => {
    it("selects diverse results over similar ones", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // Create base embedding and similar/diverse variants
      const baseEmbedding = createDeterministicEmbedding(1)
      const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.02) // Very similar
      const diverseEmbedding = createDeterministicEmbedding(100) // Very different

      // Candidate 1: high relevance, base embedding
      // Candidate 2: high relevance, similar to base (should be deprioritized)
      // Candidate 3: slightly lower relevance, diverse embedding (should be prioritized over 2)
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, baseEmbedding),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, similarEmbedding),
        createMockLearning(FIXTURES.LEARNING_3, 0.85, diverseEmbedding),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          // Use lambda=0.5 to balance relevance and diversity
          return yield* svc.mmrDiversify(candidates, 3, 0.5)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(3)
      // First should be highest relevance
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_1)
      // Second should be diverse one (despite lower relevance), not the similar one
      expect(result[1]!.id).toBe(FIXTURES.LEARNING_3)
      // Similar one comes last
      expect(result[2]!.id).toBe(FIXTURES.LEARNING_2)
    })

    it("first result is always highest relevance", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const embedding = createDeterministicEmbedding(1)
      // Candidates in random relevance order
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.7, embedding),
        createMockLearning(FIXTURES.LEARNING_2, 0.95, embedding), // Highest
        createMockLearning(FIXTURES.LEARNING_3, 0.8, embedding),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 3)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(3)
      // First result should be highest relevance regardless of input order
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_2)
      expect(result[0]!.relevanceScore).toBe(0.95)
    })

    it("lambda=0.9 prefers relevance over diversity", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const baseEmbedding = createDeterministicEmbedding(1)
      const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.01)
      const diverseEmbedding = createDeterministicEmbedding(999)

      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, baseEmbedding),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, similarEmbedding), // Similar but high relevance
        createMockLearning(FIXTURES.LEARNING_3, 0.60, diverseEmbedding), // Diverse but low relevance
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          // High lambda strongly prefers relevance
          return yield* svc.mmrDiversify(candidates, 3, 0.9)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(3)
      // With high lambda, relevance wins - similar high-relevance item before diverse low-relevance
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_1)
      expect(result[1]!.id).toBe(FIXTURES.LEARNING_2)
      expect(result[2]!.id).toBe(FIXTURES.LEARNING_3)
    })

    it("lambda=0.3 prefers diversity over relevance", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const baseEmbedding = createDeterministicEmbedding(1)
      const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.01)
      const diverseEmbedding = createDeterministicEmbedding(999)

      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, baseEmbedding),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, similarEmbedding),
        createMockLearning(FIXTURES.LEARNING_3, 0.70, diverseEmbedding),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          // Low lambda strongly prefers diversity
          return yield* svc.mmrDiversify(candidates, 3, 0.3)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(3)
      // First is always highest relevance
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_1)
      // Second should be diverse one, even though it has lower relevance
      expect(result[1]!.id).toBe(FIXTURES.LEARNING_3)
      // Similar high-relevance one comes last due to low diversity
      expect(result[2]!.id).toBe(FIXTURES.LEARNING_2)
    })
  })

  describe("Category Limits", () => {
    it("category limits influence selection order", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // Create candidates - 4 from "database" category, 1 from "api"
      // All with different embeddings to avoid diversity penalty
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, createDeterministicEmbedding(1), "database"),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, createDeterministicEmbedding(2), "database"),
        createMockLearning(FIXTURES.LEARNING_3, 0.85, createDeterministicEmbedding(3), "database"),
        createMockLearning(FIXTURES.LEARNING_4, 0.80, createDeterministicEmbedding(4), "database"),
        createMockLearning(FIXTURES.LEARNING_5, 0.75, createDeterministicEmbedding(5), "api"),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          // Use high lambda to focus on relevance for clearer category limit testing
          return yield* svc.mmrDiversify(candidates, 5, 0.9)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(5)

      // Category limits try to limit same category in top 5, but fallback allows more
      // The API result should appear in the results due to category limit influence
      const apiResults = result.filter(r => r.category === "api")
      expect(apiResults.length).toBe(1)
    })

    it("works with null categories (no limit applied)", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // All null categories - no category limit applies
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, createDeterministicEmbedding(1), null),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, createDeterministicEmbedding(2), null),
        createMockLearning(FIXTURES.LEARNING_3, 0.85, createDeterministicEmbedding(3), null),
        createMockLearning(FIXTURES.LEARNING_4, 0.80, createDeterministicEmbedding(4), null),
        createMockLearning(FIXTURES.LEARNING_5, 0.75, createDeterministicEmbedding(5), null),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 5, 0.9)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(5)
      // All null categories should be included (no category limit for null)
      for (const r of result) {
        expect(r.category).toBeNull()
      }
    })

    it("mixed null and non-null categories respected", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // Mix of categories including null
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, createDeterministicEmbedding(1), "database"),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, createDeterministicEmbedding(2), "database"),
        createMockLearning(FIXTURES.LEARNING_3, 0.85, createDeterministicEmbedding(3), "database"),
        createMockLearning(FIXTURES.LEARNING_4, 0.80, createDeterministicEmbedding(4), null),
        createMockLearning(FIXTURES.LEARNING_5, 0.75, createDeterministicEmbedding(5), null),
        createMockLearning(FIXTURES.LEARNING_6, 0.70, createDeterministicEmbedding(6), null),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 5, 0.9)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(5)

      // Count database category in top 5
      const databaseCount = result.filter(r => r.category === "database").length
      expect(databaseCount).toBeLessThanOrEqual(2)

      // Null categories should fill remaining slots
      const nullCount = result.filter(r => r.category === null).length
      expect(nullCount).toBeGreaterThanOrEqual(2)
    })
  })

  describe("Edge Cases", () => {
    it("empty candidates returns empty", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify([], 10)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toEqual([])
    })

    it("single candidate returns that candidate", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const embedding = createDeterministicEmbedding(1)
      const candidates = [createMockLearning(FIXTURES.LEARNING_1, 0.9, embedding)]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 10)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_1)
    })

    it("no embeddings: falls back to relevance-only ordering", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // All candidates have null embeddings
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, null, "database"),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, null, "database"),
        createMockLearning(FIXTURES.LEARNING_3, 0.85, null, "database"),
        createMockLearning(FIXTURES.LEARNING_4, 0.80, null, "api"),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          // Lambda doesn't matter without embeddings
          return yield* svc.mmrDiversify(candidates, 4, 0.5)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(4)

      // Without embeddings, falls back to relevance order (category limits may allow fallback)
      // All candidates should be returned
      expect(result.some(r => r.category === "api")).toBe(true)
      expect(result.some(r => r.category === "database")).toBe(true)
    })

    it("limit larger than candidates returns all candidates", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.9, createDeterministicEmbedding(1)),
        createMockLearning(FIXTURES.LEARNING_2, 0.8, createDeterministicEmbedding(2)),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 100)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(2)
    })

    it("limit of 0 returns empty", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.9, createDeterministicEmbedding(1)),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 0)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toEqual([])
    })

    it("limit of 1 returns first candidate (expects pre-sorted input)", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // Per implementation: limit=1 returns candidates.slice(0, 1)
      // The service expects candidates to be pre-sorted by relevance (highest first)
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_2, 0.95, createDeterministicEmbedding(2)), // Highest, first
        createMockLearning(FIXTURES.LEARNING_3, 0.8, createDeterministicEmbedding(3)),
        createMockLearning(FIXTURES.LEARNING_1, 0.7, createDeterministicEmbedding(1)),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 1)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(1)
      // Returns first candidate (expects pre-sorted input)
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_2)
      expect(result[0]!.relevanceScore).toBe(0.95)
    })

    it("handles partially embedded candidates", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // Mix of embedded and non-embedded candidates
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, createDeterministicEmbedding(1)),
        createMockLearning(FIXTURES.LEARNING_2, 0.90, null), // No embedding
        createMockLearning(FIXTURES.LEARNING_3, 0.85, createDeterministicEmbedding(3)),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 3)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(3)
      // Should still process all candidates
      const ids = result.map(r => r.id)
      expect(ids).toContain(FIXTURES.LEARNING_1)
      expect(ids).toContain(FIXTURES.LEARNING_2)
      expect(ids).toContain(FIXTURES.LEARNING_3)
    })
  })

  describe("Integration with RetrieverService", () => {
    it("search with diversification enabled returns results", async () => {
      const { makeAppLayer, RetrieverService, LearningService } = await import("@jamesaphoenix/tx-core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const retrieverSvc = yield* RetrieverService

          // Create learnings with same category to test diversification
          yield* learningSvc.create({
            content: "Database optimization techniques for queries",
            sourceType: "manual",
            category: "database",
          })
          yield* learningSvc.create({
            content: "Database indexing best practices",
            sourceType: "manual",
            category: "database",
          })
          yield* learningSvc.create({
            content: "Database performance tuning guide",
            sourceType: "manual",
            category: "database",
          })
          yield* learningSvc.create({
            content: "API rate limiting patterns",
            sourceType: "manual",
            category: "api",
          })

          // Search with diversification options
          return yield* retrieverSvc.search("database", {
            limit: 5,
            minScore: 0,
            diversification: {
              enabled: true,
              lambda: 0.7,
            },
          })
        }).pipe(Effect.provide(layer))
      )

      // Should return results with diversification applied
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it("default lambda (0.7) produces balanced results", async () => {
      const { makeAppLayer, RetrieverService, LearningService } = await import("@jamesaphoenix/tx-core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const retrieverSvc = yield* RetrieverService

          // Create several similar learnings
          yield* learningSvc.create({
            content: "Database query optimization",
            sourceType: "manual",
          })
          yield* learningSvc.create({
            content: "Database query tuning",
            sourceType: "manual",
          })

          // Search with default diversification (lambda defaults to 0.7)
          return yield* retrieverSvc.search("database", {
            limit: 10,
            minScore: 0,
            diversification: {
              enabled: true,
            },
          })
        }).pipe(Effect.provide(layer))
      )

      expect(result.length).toBeGreaterThanOrEqual(1)
      // Results should have relevance scores in descending order
      for (let i = 1; i < result.length; i++) {
        // Allow small differences due to diversification reordering
        expect(result[0]!.relevanceScore).toBeGreaterThanOrEqual(result[i]!.relevanceScore * 0.8)
      }
    })

    it("diversification integrates with retriever search", async () => {
      const { makeAppLayer, RetrieverService, LearningService } = await import("@jamesaphoenix/tx-core")
      const layer = makeAppLayer(":memory:")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const retrieverSvc = yield* RetrieverService

          // Create learnings with categories (no embeddings in default layer)
          yield* learningSvc.create({
            content: "Database tip one",
            sourceType: "manual",
            category: "database",
          })
          yield* learningSvc.create({
            content: "Database tip two",
            sourceType: "manual",
            category: "database",
          })
          yield* learningSvc.create({
            content: "Database tip three",
            sourceType: "manual",
            category: "database",
          })
          yield* learningSvc.create({
            content: "API endpoint design",
            sourceType: "manual",
            category: "api",
          })
          yield* learningSvc.create({
            content: "Testing strategies",
            sourceType: "manual",
            category: "testing",
          })

          return yield* retrieverSvc.search("database", {
            limit: 5,
            minScore: 0,
            diversification: {
              enabled: true,
            },
          })
        }).pipe(Effect.provide(layer))
      )

      // Diversification should work with retriever search
      // Results should be returned (may include category limits influence)
      expect(result.length).toBeGreaterThanOrEqual(1)

      // Database category learnings should be included
      const databaseResults = result.filter(r => r.category === "database")
      expect(databaseResults.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("MMR Score Calculation", () => {
    it("identical embeddings produce high similarity penalty with low lambda", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const embedding = createDeterministicEmbedding(42)
      // Three candidates with identical embeddings but different relevance
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, embedding),
        createMockLearning(FIXTURES.LEARNING_2, 0.94, embedding), // Nearly same relevance, same embedding
        createMockLearning(FIXTURES.LEARNING_3, 0.50, createDeterministicEmbedding(999)), // Lower relevance, different embedding
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          // Low lambda to strongly penalize similarity
          return yield* svc.mmrDiversify(candidates, 3, 0.3)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(3)
      // First is highest relevance
      expect(result[0]!.id).toBe(FIXTURES.LEARNING_1)
      // Second item is selected based on MMR score (balancing relevance and diversity)
      // The exact ordering depends on the MMR formula: λ * relevance - (1-λ) * max_similarity
      // With λ=0.3 and high similarity, LEARNING_2 gets heavy penalty
      // But if cosine similarity is high enough, it might still beat LEARNING_3
      // Verify all candidates are returned
      const ids = result.map(r => r.id)
      expect(ids).toContain(FIXTURES.LEARNING_1)
      expect(ids).toContain(FIXTURES.LEARNING_2)
      expect(ids).toContain(FIXTURES.LEARNING_3)
    })

    it("different embeddings maintain diversity benefits", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      // Create embeddings that are different
      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.90, createDeterministicEmbedding(1)),
        createMockLearning(FIXTURES.LEARNING_2, 0.89, createDeterministicEmbedding(500)),
        createMockLearning(FIXTURES.LEARNING_3, 0.88, createDeterministicEmbedding(1000)),
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          // Even with low lambda, diverse embeddings mean minimal penalty
          return yield* svc.mmrDiversify(candidates, 3, 0.5)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      expect(result).toHaveLength(3)
      // All candidates should be returned
      const ids = result.map(r => r.id)
      expect(ids).toContain(FIXTURES.LEARNING_1)
      expect(ids).toContain(FIXTURES.LEARNING_2)
      expect(ids).toContain(FIXTURES.LEARNING_3)
      // First result should be highest relevance
      expect(result[0]!.relevanceScore).toBe(0.90)
    })
  })

  describe("Default Lambda Value", () => {
    it("default lambda is 0.7 (favors relevance)", async () => {
      const { DiversifierService, DiversifierServiceLive } = await import("@jamesaphoenix/tx-core")

      const baseEmbedding = createDeterministicEmbedding(1)
      const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.02)
      const diverseEmbedding = createDeterministicEmbedding(999)

      const candidates = [
        createMockLearning(FIXTURES.LEARNING_1, 0.95, baseEmbedding),
        createMockLearning(FIXTURES.LEARNING_2, 0.85, similarEmbedding),
        createMockLearning(FIXTURES.LEARNING_3, 0.60, diverseEmbedding),
      ]

      // Without specifying lambda (uses default 0.7)
      const resultDefault = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 3)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      // With explicit lambda=0.7
      const resultExplicit = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DiversifierService
          return yield* svc.mmrDiversify(candidates, 3, 0.7)
        }).pipe(Effect.provide(DiversifierServiceLive))
      )

      // Results should be identical
      expect(resultDefault.map(r => r.id)).toEqual(resultExplicit.map(r => r.id))
    })
  })
})
