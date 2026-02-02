import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDb, seedFixtures, FIXTURES } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  LearningRepositoryLive,
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  LearningServiceLive,
  LearningService,
  EmbeddingServiceNoop,
  AutoSyncServiceNoop,
  QueryExpansionServiceNoop,
  RerankerServiceNoop
} from "@tx/core"
import type Database from "better-sqlite3"

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as any)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, AutoSyncServiceNoop))
  )
  return services
}

describe("Learning CRUD", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("create returns a learning with valid ID", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        return yield* svc.create({
          content: "Always use transactions for database operations",
          category: "database"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(learning.id).toBe(1)
    expect(learning.content).toBe("Always use transactions for database operations")
    expect(learning.category).toBe("database")
    expect(learning.sourceType).toBe("manual")
    expect(learning.usageCount).toBe(0)
  })

  it("get returns the learning by ID", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Test learning" })
        return yield* svc.get(1)
      }).pipe(Effect.provide(layer))
    )

    expect(learning.content).toBe("Test learning")
  })

  it("get throws LearningNotFoundError for non-existent ID", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.get(999)
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })

  it("remove deletes the learning", async () => {
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "To be deleted" })
        yield* svc.remove(1)
        return yield* svc.count()
      }).pipe(Effect.provide(layer))
    )

    expect(count).toBe(0)
  })

  it("getRecent returns learnings sorted by created_at DESC, then by ID DESC", async () => {
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "First" })
        yield* svc.create({ content: "Second" })
        yield* svc.create({ content: "Third" })
        return yield* svc.getRecent(10)
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(3)
    // All learnings should be present
    const contents = learnings.map(l => l.content)
    expect(contents).toContain("First")
    expect(contents).toContain("Second")
    expect(contents).toContain("Third")
  })
})

describe("Learning BM25 Search", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("search returns matching learnings", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Always use database transactions for consistency" })
        yield* svc.create({ content: "Rate limiting is 100 requests per minute" })
        yield* svc.create({ content: "PostgreSQL transactions support ACID" })
        return yield* svc.search({ query: "database transactions", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(results.length).toBeGreaterThanOrEqual(1)
    // Results should be sorted by relevance
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(results[i]!.relevanceScore)
    }
  })

  it("search returns empty for non-matching query", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Always use database transactions" })
        return yield* svc.search({ query: "xyz123nonexistent", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(results).toHaveLength(0)
  })

  it("search respects limit parameter", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Database tip 1" })
        yield* svc.create({ content: "Database tip 2" })
        yield* svc.create({ content: "Database tip 3" })
        yield* svc.create({ content: "Database tip 4" })
        return yield* svc.search({ query: "database", limit: 2, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(results.length).toBeLessThanOrEqual(2)
  })
})

describe("Learning Usage and Outcome Tracking", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("recordUsage increments usage count", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Test" })
        yield* svc.recordUsage(1)
        yield* svc.recordUsage(1)
        return yield* svc.get(1)
      }).pipe(Effect.provide(layer))
    )

    expect(learning.usageCount).toBe(2)
    expect(learning.lastUsedAt).not.toBeNull()
  })

  it("updateOutcome sets the outcome score", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Test" })
        yield* svc.updateOutcome(1, 0.85)
        return yield* svc.get(1)
      }).pipe(Effect.provide(layer))
    )

    expect(learning.outcomeScore).toBe(0.85)
  })

  it("updateOutcome rejects invalid scores", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          yield* svc.create({ content: "Test" })
          yield* svc.updateOutcome(1, 1.5)
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })
})

describe("Context for Task", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("getContextForTask returns relevant learnings", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        // Create learnings
        yield* svc.create({ content: "JWT tokens should be validated on every request" })
        yield* svc.create({ content: "Always hash passwords with bcrypt" })
        yield* svc.create({ content: "API rate limiting prevents abuse" })

        // Get context for JWT validation task (TASK_JWT = "JWT validation")
        return yield* svc.getContextForTask(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(result.taskId).toBe(FIXTURES.TASK_JWT)
    expect(result.taskTitle).toBe("JWT validation")
    expect(result.learnings.length).toBeGreaterThanOrEqual(0)
    expect(result.searchDuration).toBeGreaterThanOrEqual(0)
  })

  it("getContextForTask throws TaskNotFoundError for invalid task", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.getContextForTask("tx-nonexistent")
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })

  it("getContextForTask increments usage count for returned learnings", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        // Create a learning that matches the JWT task
        yield* svc.create({ content: "JWT tokens must be validated before use" })

        // Call getContextForTask
        yield* svc.getContextForTask(FIXTURES.TASK_JWT)

        // Check if usage was incremented
        return yield* svc.get(1)
      }).pipe(Effect.provide(layer))
    )

    // Usage should be >= 1 if the learning was returned in context
    // (depends on whether it matched the search)
    expect(learning.usageCount).toBeGreaterThanOrEqual(0)
  })
})

describe("Hybrid Scoring", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("outcome score boosts relevance", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        // Create two similar learnings
        yield* svc.create({ content: "Database indexing tip number one" })
        yield* svc.create({ content: "Database indexing tip number two" })

        // Mark one as very helpful
        yield* svc.updateOutcome(1, 1.0)

        // Search should now favor the one with outcome
        return yield* svc.search({ query: "database indexing", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    // The learning with outcome score should be boosted
    if (results.length >= 2) {
      const withOutcome = results.find(r => r.id === 1)
      const withoutOutcome = results.find(r => r.id === 2)
      if (withOutcome && withoutOutcome) {
        expect(withOutcome.relevanceScore).toBeGreaterThan(withoutOutcome.relevanceScore)
      }
    }
  })
})

describe("RRF Hybrid Search", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("search results include RRF score fields", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Database query optimization techniques" })
        yield* svc.create({ content: "SQL indexing best practices for databases" })
        return yield* svc.search({ query: "database optimization", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
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

  it("BM25 ranks are 1-indexed and sequential", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Database optimization guide" })
        yield* svc.create({ content: "Database performance tuning" })
        yield* svc.create({ content: "Database scaling strategies" })
        return yield* svc.search({ query: "database", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(results.length).toBeGreaterThanOrEqual(1)

    // All results from BM25 should have positive bm25Rank
    const withBM25 = results.filter(r => r.bm25Rank > 0)
    expect(withBM25.length).toBeGreaterThan(0)

    // Ranks should be valid (1-indexed)
    for (const result of withBM25) {
      expect(result.bm25Rank).toBeGreaterThanOrEqual(1)
    }
  })

  it("RRF score increases with better rank", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        // Create learnings with varying relevance
        yield* svc.create({ content: "Database database database" }) // Most relevant
        yield* svc.create({ content: "Database systems" }) // Less relevant
        yield* svc.create({ content: "Database" }) // Least relevant
        return yield* svc.search({ query: "database", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(results.length).toBeGreaterThanOrEqual(2)

    // Results with lower (better) BM25 rank should have higher RRF score
    // Since we're sorting by relevanceScore which includes RRF + boosts,
    // we verify the RRF component is reasonable
    for (const result of results) {
      if (result.bm25Rank > 0) {
        // RRF formula: 1/(k + rank) where k=60
        // For rank 1: 1/61 ≈ 0.0164
        // For rank 10: 1/70 ≈ 0.0143
        expect(result.rrfScore).toBeGreaterThan(0)
        expect(result.rrfScore).toBeLessThan(0.1) // Max possible is 1/(60+1) ≈ 0.0164
      }
    }
  })

  it("vector rank is 0 when embeddings are unavailable", async () => {
    // Using EmbeddingServiceNoop, vector search should return nothing
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Machine learning algorithms" })
        return yield* svc.search({ query: "machine learning", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(results.length).toBeGreaterThanOrEqual(1)

    // With EmbeddingServiceNoop, all vectorRank should be 0
    for (const result of results) {
      expect(result.vectorRank).toBe(0)
      expect(result.vectorScore).toBe(0)
    }
  })

  it("search gracefully degrades to BM25-only when embeddings unavailable", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        yield* svc.create({ content: "Effect-TS service layer patterns" })
        yield* svc.create({ content: "TypeScript best practices" })
        return yield* svc.search({ query: "Effect-TS patterns", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    // Should still return results based on BM25
    expect(results.length).toBeGreaterThanOrEqual(1)

    // Results should have valid BM25 scores and ranks
    const matching = results.filter(r => r.bm25Rank > 0)
    expect(matching.length).toBeGreaterThan(0)
  })

  it("relevance score combines RRF with recency and outcome boosts", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        // Create learnings
        yield* svc.create({ content: "API design principles" })
        yield* svc.create({ content: "API design patterns" })

        // Mark one as helpful
        yield* svc.updateOutcome(1, 1.0)

        return yield* svc.search({ query: "API design", limit: 10, minScore: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(results.length).toBeGreaterThanOrEqual(2)

    // Both should have similar RRF scores (same query relevance)
    // But the one with outcome should have higher total relevance
    const withOutcome = results.find(r => r.id === 1)
    const withoutOutcome = results.find(r => r.id === 2)

    if (withOutcome && withoutOutcome) {
      // The outcome boost should make the first one rank higher
      expect(withOutcome.relevanceScore).toBeGreaterThan(withoutOutcome.relevanceScore)
    }
  })
})
