/**
 * Cosine Similarity Unit Tests
 *
 * Tests the cosineSimilarity function from math.ts, including dimension validation.
 */
import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { cosineSimilarity, EmbeddingDimensionMismatchError } from "@jamesaphoenix/tx-core"

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", async () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([1, 0, 0])

    const result = await Effect.runPromise(cosineSimilarity(a, b))
    expect(result).toBeCloseTo(1, 5)
  })

  it("returns -1 for opposite vectors", async () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([-1, 0, 0])

    const result = await Effect.runPromise(cosineSimilarity(a, b))
    expect(result).toBeCloseTo(-1, 5)
  })

  it("returns 0 for orthogonal vectors", async () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])

    const result = await Effect.runPromise(cosineSimilarity(a, b))
    expect(result).toBeCloseTo(0, 5)
  })

  it("returns 0 when one vector is all zeros", async () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([0, 0, 0])

    const result = await Effect.runPromise(cosineSimilarity(a, b))
    expect(result).toBe(0)
  })

  it("returns 0 when both vectors are all zeros", async () => {
    const a = new Float32Array([0, 0, 0])
    const b = new Float32Array([0, 0, 0])

    const result = await Effect.runPromise(cosineSimilarity(a, b))
    expect(result).toBe(0)
  })

  it("correctly computes similarity for non-unit vectors", async () => {
    // Vectors with the same direction but different magnitudes should have similarity 1
    const a = new Float32Array([2, 4, 6])
    const b = new Float32Array([1, 2, 3])

    const result = await Effect.runPromise(cosineSimilarity(a, b))
    expect(result).toBeCloseTo(1, 5)
  })

  it("handles typical embedding dimensions", async () => {
    // Simulate small embedding vectors (like 256-dim)
    const dims = 256
    const a = new Float32Array(dims)
    const b = new Float32Array(dims)
    for (let i = 0; i < dims; i++) {
      a[i] = Math.random() - 0.5
      b[i] = Math.random() - 0.5
    }

    const result = await Effect.runPromise(cosineSimilarity(a, b))
    expect(result).toBeGreaterThanOrEqual(-1)
    expect(result).toBeLessThanOrEqual(1)
  })

  describe("dimension mismatch validation", () => {
    it("fails with EmbeddingDimensionMismatchError when dimensions differ", async () => {
      const a = new Float32Array([1, 2, 3]) // 3 dimensions
      const b = new Float32Array([1, 2, 3, 4]) // 4 dimensions

      const result = await Effect.runPromise(
        Effect.either(cosineSimilarity(a, b))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingDimensionMismatchError")
        const error = result.left as EmbeddingDimensionMismatchError
        expect(error.queryDimensions).toBe(3)
        expect(error.documentDimensions).toBe(4)
        expect(error.message).toContain("query has 3 dims")
        expect(error.message).toContain("document has 4 dims")
      }
    })

    it("fails when document has fewer dimensions than query", async () => {
      const a = new Float32Array([1, 2, 3, 4, 5]) // 5 dimensions (query)
      const b = new Float32Array([1, 2]) // 2 dimensions (document)

      const result = await Effect.runPromise(
        Effect.either(cosineSimilarity(a, b))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        const error = result.left as EmbeddingDimensionMismatchError
        expect(error.queryDimensions).toBe(5)
        expect(error.documentDimensions).toBe(2)
      }
    })

    it("succeeds when dimensions match (including single dimension)", async () => {
      const a = new Float32Array([5])
      const b = new Float32Array([10])

      const result = await Effect.runPromise(cosineSimilarity(a, b))
      expect(result).toBeCloseTo(1, 5) // Same direction
    })

    it("succeeds with empty vectors (0 dimensions)", async () => {
      const a = new Float32Array([])
      const b = new Float32Array([])

      // Empty vectors have 0 magnitude, should return 0
      const result = await Effect.runPromise(cosineSimilarity(a, b))
      expect(result).toBe(0)
    })

    it("fails when comparing empty with non-empty vector", async () => {
      const a = new Float32Array([])
      const b = new Float32Array([1, 2, 3])

      const result = await Effect.runPromise(
        Effect.either(cosineSimilarity(a, b))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        const error = result.left as EmbeddingDimensionMismatchError
        expect(error.queryDimensions).toBe(0)
        expect(error.documentDimensions).toBe(3)
      }
    })
  })
})
