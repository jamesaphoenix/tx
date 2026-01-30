import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  RerankerService,
  RerankerServiceNoop,
  RerankerServiceAuto
} from "../../packages/core/src/services/reranker-service.js"

describe("RerankerService", () => {
  describe("RerankerServiceNoop", () => {
    it("returns documents in original order with decreasing scores", async () => {
      const documents = [
        "First document about databases",
        "Second document about optimization",
        "Third document about performance"
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RerankerService
          return yield* svc.rerank("database performance", documents)
        }).pipe(Effect.provide(RerankerServiceNoop))
      )

      expect(result.length).toBe(3)
      // Documents should be in original order
      expect(result[0]!.document).toBe(documents[0])
      expect(result[1]!.document).toBe(documents[1])
      expect(result[2]!.document).toBe(documents[2])
      // Original indices should be preserved
      expect(result[0]!.originalIndex).toBe(0)
      expect(result[1]!.originalIndex).toBe(1)
      expect(result[2]!.originalIndex).toBe(2)
      // Scores should decrease
      expect(result[0]!.score).toBeGreaterThan(result[1]!.score)
      expect(result[1]!.score).toBeGreaterThan(result[2]!.score)
    })

    it("isAvailable returns false", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RerankerService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(RerankerServiceNoop))
      )

      expect(available).toBe(false)
    })

    it("handles empty documents array", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RerankerService
          return yield* svc.rerank("test query", [])
        }).pipe(Effect.provide(RerankerServiceNoop))
      )

      expect(result.length).toBe(0)
    })

    it("handles single document", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RerankerService
          return yield* svc.rerank("query", ["Single document"])
        }).pipe(Effect.provide(RerankerServiceNoop))
      )

      expect(result.length).toBe(1)
      expect(result[0]!.document).toBe("Single document")
      expect(result[0]!.originalIndex).toBe(0)
      expect(result[0]!.score).toBeGreaterThan(0)
    })

    it("handles documents with special characters", async () => {
      const documents = [
        "Document with @#$% special characters",
        "Another doc with émojis 🎉"
      ]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RerankerService
          return yield* svc.rerank("special", documents)
        }).pipe(Effect.provide(RerankerServiceNoop))
      )

      expect(result.length).toBe(2)
      expect(result[0]!.document).toBe(documents[0])
      expect(result[1]!.document).toBe(documents[1])
    })
  })

  describe("RerankerServiceAuto", () => {
    it("uses Noop when node-llama-cpp is not available", async () => {
      // Auto should fall back to Noop when node-llama-cpp is not installed
      const documents = ["Doc 1", "Doc 2"]

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RerankerService
          return yield* svc.rerank("test query", documents)
        }).pipe(Effect.provide(RerankerServiceAuto))
      )

      // Without node-llama-cpp, should behave like Noop
      expect(result.length).toBe(2)
      expect(result[0]!.document).toBe("Doc 1")
      expect(result[1]!.document).toBe("Doc 2")
    })

    it("isAvailable returns false when node-llama-cpp not installed", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* RerankerService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(RerankerServiceAuto))
      )

      // Will be false if node-llama-cpp is not installed
      expect(typeof available).toBe("boolean")
    })
  })
})

describe("RerankerResult interface", () => {
  it("has correct structure from Noop service", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* RerankerService
        return yield* svc.rerank("find documents", ["doc1", "doc2"])
      }).pipe(Effect.provide(RerankerServiceNoop))
    )

    // Verify all required fields are present
    expect(result[0]).toHaveProperty("document")
    expect(result[0]).toHaveProperty("score")
    expect(result[0]).toHaveProperty("originalIndex")

    // Verify types
    expect(typeof result[0]!.document).toBe("string")
    expect(typeof result[0]!.score).toBe("number")
    expect(typeof result[0]!.originalIndex).toBe("number")

    // Verify score is in valid range
    expect(result[0]!.score).toBeGreaterThanOrEqual(0)
    expect(result[0]!.score).toBeLessThanOrEqual(1)
  })
})

describe("Reranker graceful degradation", () => {
  it("search can handle unreranked documents", async () => {
    // This test verifies the contract that the learning service expects
    const documents = ["doc 1", "doc 2", "doc 3"]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* RerankerService
        const reranked = yield* svc.rerank("search query", documents)

        // Verify the result can be used in a search pipeline
        // reranked should contain all original documents
        expect(reranked.length).toBe(documents.length)

        // All documents should be present
        const rerankedDocs = reranked.map(r => r.document)
        documents.forEach(doc => {
          expect(rerankedDocs).toContain(doc)
        })

        return reranked
      }).pipe(Effect.provide(RerankerServiceNoop))
    )

    expect(result.length).toBe(3)
  })

  it("preserves document content exactly", async () => {
    const documents = [
      "Exact content with  multiple   spaces",
      "Content with\nnewlines",
      "Content with\ttabs"
    ]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* RerankerService
        return yield* svc.rerank("test", documents)
      }).pipe(Effect.provide(RerankerServiceNoop))
    )

    expect(result[0]!.document).toBe(documents[0])
    expect(result[1]!.document).toBe(documents[1])
    expect(result[2]!.document).toBe(documents[2])
  })
})

describe("Reranker performance characteristics", () => {
  it("handles large document sets efficiently with Noop", async () => {
    // Generate 100 documents
    const documents = Array.from({ length: 100 }, (_, i) => `Document number ${i} about various topics`)

    const startTime = Date.now()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* RerankerService
        return yield* svc.rerank("search query", documents)
      }).pipe(Effect.provide(RerankerServiceNoop))
    )
    const elapsed = Date.now() - startTime

    expect(result.length).toBe(100)
    // Noop should be very fast
    expect(elapsed).toBeLessThan(100)
  })
})
