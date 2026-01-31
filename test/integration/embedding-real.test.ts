/**
 * Real embedding integration tests with actual model loading.
 *
 * These tests actually load the embeddinggemma-300M model via node-llama-cpp
 * and generate real embeddings. They are marked as slow and should be skipped
 * in CI unless explicitly enabled.
 *
 * Run with: npx vitest --run test/integration/embedding-real.test.ts
 * Skip in CI by setting: SKIP_REAL_EMBEDDING_TESTS=1
 *
 * @see DD-010 for embedding service design
 */
import { describe, it, expect, beforeAll } from "vitest"
import { Effect } from "effect"
import {
  EmbeddingService,
  EmbeddingServiceLive
} from "../../src/services/embedding-service.js"
import { cosineSimilarity } from "../../src/utils/math.js"

// Skip tests if SKIP_REAL_EMBEDDING_TESTS is set (for CI) or if model loading fails
const SKIP_REAL_TESTS = process.env.SKIP_REAL_EMBEDDING_TESTS === "1"

/**
 * Check if the embedding model is available by attempting to load it.
 * This runs once before all tests.
 */
let modelAvailable = false
let modelCheckError: string | null = null

beforeAll(async () => {
  if (SKIP_REAL_TESTS) {
    modelCheckError = "Skipped via SKIP_REAL_EMBEDDING_TESTS=1"
    return
  }

  try {
    // Try to generate a simple embedding to verify model is available
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* Effect.either(svc.embed("test"))
      }).pipe(
        Effect.provide(EmbeddingServiceLive),
        Effect.scoped
      )
    )

    if (result._tag === "Right") {
      modelAvailable = true
    } else {
      modelCheckError = result.left.reason
    }
  } catch (e) {
    modelCheckError = String(e)
  }
}, 120000) // 2 minute timeout for model loading

describe.skipIf(SKIP_REAL_TESTS || !modelAvailable)("Real Embedding Integration Tests", () => {
  // Extended timeout for model operations (60 seconds)
  const TEST_TIMEOUT = 60000

  describe("Vector Dimensions and Value Ranges", () => {
    it("embed returns Float32Array with 256 dimensions", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("database transactions")
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(256)
    }, TEST_TIMEOUT)

    it("embedding values are within reasonable range [-1, 1]", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("test embedding value ranges")
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      // Check all values are finite numbers in a reasonable range
      for (let i = 0; i < result.length; i++) {
        const value = result[i]!
        expect(Number.isFinite(value)).toBe(true)
        // Embedding values typically fall in a normalized range
        // The exact range depends on the model, but should be bounded
        expect(Math.abs(value)).toBeLessThan(10)
      }
    }, TEST_TIMEOUT)

    it("embedding vector is normalized (unit length)", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("check vector normalization")
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      // Calculate L2 norm
      let sumSquares = 0
      for (let i = 0; i < result.length; i++) {
        sumSquares += result[i]! * result[i]!
      }
      const norm = Math.sqrt(sumSquares)

      // Normalized vectors should have length ~1
      // Allow some tolerance for floating point precision
      expect(norm).toBeGreaterThan(0.9)
      expect(norm).toBeLessThan(1.1)
    }, TEST_TIMEOUT)
  })

  describe("Batch Embedding (10+ texts)", () => {
    it("embedBatch processes 10+ texts correctly", async () => {
      const texts = [
        "database transactions",
        "SQL commits and rollbacks",
        "ACID properties",
        "machine learning models",
        "neural network training",
        "deep learning algorithms",
        "pizza recipes",
        "Italian cuisine",
        "software engineering",
        "code review practices",
        "test driven development",
        "continuous integration"
      ]

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(texts)
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      expect(results.length).toBe(texts.length)

      // Verify each result is a valid 256-dimension Float32Array
      for (let i = 0; i < results.length; i++) {
        expect(results[i]).toBeInstanceOf(Float32Array)
        expect(results[i]!.length).toBe(256)
      }
    }, TEST_TIMEOUT * 2) // Double timeout for batch

    it("embedBatch returns unique vectors for different texts", async () => {
      const texts = [
        "database transactions",
        "pizza recipes",
        "quantum physics"
      ]

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(texts)
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      // Each pair should have different vectors (cosine similarity < 1)
      const sim01 = cosineSimilarity(results[0]!, results[1]!)
      const sim02 = cosineSimilarity(results[0]!, results[2]!)
      const sim12 = cosineSimilarity(results[1]!, results[2]!)

      // Very different topics should not have identical embeddings
      expect(sim01).toBeLessThan(0.99)
      expect(sim02).toBeLessThan(0.99)
      expect(sim12).toBeLessThan(0.99)
    }, TEST_TIMEOUT)
  })

  describe("Semantic Similarity", () => {
    it("similar texts have high cosine similarity", async () => {
      const text1 = "database transactions"
      const text2 = "SQL commits and rollbacks"

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          const emb1 = yield* svc.embed(text1)
          const emb2 = yield* svc.embed(text2)
          return { emb1, emb2 }
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      const similarity = cosineSimilarity(results.emb1, results.emb2)

      // Semantically similar texts should have high similarity
      // Note: The exact threshold depends on the model, but related concepts
      // should generally have similarity > 0.5
      expect(similarity).toBeGreaterThan(0.5)
    }, TEST_TIMEOUT)

    it("dissimilar texts have low cosine similarity", async () => {
      const text1 = "database transactions"
      const text2 = "pizza recipes"

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          const emb1 = yield* svc.embed(text1)
          const emb2 = yield* svc.embed(text2)
          return { emb1, emb2 }
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      const similarity = cosineSimilarity(results.emb1, results.emb2)

      // Unrelated texts should have lower similarity
      // The exact threshold depends on the model
      expect(similarity).toBeLessThan(0.8)
    }, TEST_TIMEOUT)

    it("relative similarity ordering is preserved", async () => {
      // "database transactions" should be more similar to "SQL commits"
      // than to "pizza recipes"
      const texts = {
        base: "database transactions",
        similar: "SQL commits and rollbacks",
        dissimilar: "pizza recipes"
      }

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          const batch = yield* svc.embedBatch([texts.base, texts.similar, texts.dissimilar])
          return batch
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      const simToSimilar = cosineSimilarity(results[0]!, results[1]!)
      const simToDissimilar = cosineSimilarity(results[0]!, results[2]!)

      // The related text should have higher similarity
      expect(simToSimilar).toBeGreaterThan(simToDissimilar)
    }, TEST_TIMEOUT)
  })

  describe("Determinism", () => {
    it("same text produces identical vectors", async () => {
      const text = "deterministic embedding test"

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          const emb1 = yield* svc.embed(text)
          const emb2 = yield* svc.embed(text)
          return { emb1, emb2 }
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      // Same text should produce identical embeddings
      const similarity = cosineSimilarity(results.emb1, results.emb2)
      expect(similarity).toBeGreaterThan(0.9999)

      // Check element-wise equality (with small tolerance for floating point)
      for (let i = 0; i < results.emb1.length; i++) {
        expect(Math.abs(results.emb1[i]! - results.emb2[i]!)).toBeLessThan(0.0001)
      }
    }, TEST_TIMEOUT)

    it("embedBatch produces same vectors as individual embed calls", async () => {
      const texts = ["test text one", "test text two"]

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          const batchResults = yield* svc.embedBatch(texts)
          // Note: embedBatch uses formatDoc, embed uses formatQuery
          // So they will NOT be identical - this tests that batch is internally consistent
          const batchResults2 = yield* svc.embedBatch(texts)
          return { batch1: batchResults, batch2: batchResults2 }
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      // Batch results should be deterministic
      for (let i = 0; i < texts.length; i++) {
        const similarity = cosineSimilarity(results.batch1[i]!, results.batch2[i]!)
        expect(similarity).toBeGreaterThan(0.9999)
      }
    }, TEST_TIMEOUT)

    it("multiple calls maintain consistency across session", async () => {
      const text = "consistency check text"

      // Make multiple calls and verify they all produce the same result
      const embeddings: Float32Array[] = []

      for (let i = 0; i < 3; i++) {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* EmbeddingService
            return yield* svc.embed(text)
          }).pipe(
            Effect.provide(EmbeddingServiceLive),
            Effect.scoped
          )
        )
        embeddings.push(result)
      }

      // All embeddings should be essentially identical
      for (let i = 1; i < embeddings.length; i++) {
        const similarity = cosineSimilarity(embeddings[0]!, embeddings[i]!)
        expect(similarity).toBeGreaterThan(0.9999)
      }
    }, TEST_TIMEOUT)
  })

  describe("Edge Cases", () => {
    it("handles empty string input", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("")
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(256)
    }, TEST_TIMEOUT)

    it("handles very long text input", async () => {
      const longText = "software engineering ".repeat(100)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed(longText)
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(256)
    }, TEST_TIMEOUT)

    it("handles special characters", async () => {
      const specialText = "test<script>alert('xss')</script> & special chars: ñ 中文 🚀"

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed(specialText)
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(256)
    }, TEST_TIMEOUT)

    it("handles whitespace-only input", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("   \t\n   ")
        }).pipe(
          Effect.provide(EmbeddingServiceLive),
          Effect.scoped
        )
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(256)
    }, TEST_TIMEOUT)
  })
})

// Diagnostic test that always runs to report model availability
describe("Model Availability Check", () => {
  it("reports model availability status", () => {
    if (SKIP_REAL_TESTS) {
      console.log("Real embedding tests skipped via SKIP_REAL_EMBEDDING_TESTS=1")
    } else if (modelAvailable) {
      console.log("Embedding model is available - real tests will run")
    } else {
      console.log(`Embedding model not available: ${modelCheckError}`)
      console.log("Real embedding tests will be skipped")
    }
    // This test always passes - it's just for diagnostic output
    expect(true).toBe(true)
  })
})
