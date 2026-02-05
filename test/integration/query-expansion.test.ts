import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  QueryExpansionService,
  QueryExpansionServiceNoop,
  QueryExpansionServiceAuto,
  validateExpansions,
  MAX_EXPANSION_QUERIES,
  MAX_QUERY_LENGTH
} from "@jamesaphoenix/tx-core"

describe("QueryExpansionService", () => {
  describe("QueryExpansionServiceNoop", () => {
    it("returns original query only", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* QueryExpansionService
          return yield* svc.expand("database optimization")
        }).pipe(Effect.provide(QueryExpansionServiceNoop))
      )

      expect(result.original).toBe("database optimization")
      expect(result.expanded).toEqual(["database optimization"])
      expect(result.wasExpanded).toBe(false)
    })

    it("isAvailable returns false", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* QueryExpansionService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(QueryExpansionServiceNoop))
      )

      expect(available).toBe(false)
    })

    it("handles empty query", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* QueryExpansionService
          return yield* svc.expand("")
        }).pipe(Effect.provide(QueryExpansionServiceNoop))
      )

      expect(result.original).toBe("")
      expect(result.expanded).toEqual([""])
      expect(result.wasExpanded).toBe(false)
    })

    it("handles query with special characters", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* QueryExpansionService
          return yield* svc.expand("fix @#$% bug")
        }).pipe(Effect.provide(QueryExpansionServiceNoop))
      )

      expect(result.original).toBe("fix @#$% bug")
      expect(result.expanded).toEqual(["fix @#$% bug"])
      expect(result.wasExpanded).toBe(false)
    })
  })

  describe("QueryExpansionServiceAuto", () => {
    it("uses Noop when ANTHROPIC_API_KEY is not set", async () => {
      // Auto should fall back to Noop when no API key is set
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* QueryExpansionService
          return yield* svc.expand("test query")
        }).pipe(Effect.provide(QueryExpansionServiceAuto))
      )

      // Without API key, should behave like Noop
      expect(result.original).toBe("test query")
      expect(result.expanded).toEqual(["test query"])
      expect(result.wasExpanded).toBe(false)
    })

    it("isAvailable returns false when API key not set", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* QueryExpansionService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(QueryExpansionServiceAuto))
      )

      expect(available).toBe(false)
    })
  })
})

describe("QueryExpansionResult interface", () => {
  it("has correct structure from Noop service", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* QueryExpansionService
        return yield* svc.expand("find documents")
      }).pipe(Effect.provide(QueryExpansionServiceNoop))
    )

    // Verify all required fields are present
    expect(result).toHaveProperty("original")
    expect(result).toHaveProperty("expanded")
    expect(result).toHaveProperty("wasExpanded")

    // Verify types
    expect(typeof result.original).toBe("string")
    expect(Array.isArray(result.expanded)).toBe(true)
    expect(typeof result.wasExpanded).toBe("boolean")

    // Verify expanded is readonly array of strings
    result.expanded.forEach(query => {
      expect(typeof query).toBe("string")
    })
  })
})

describe("Query expansion graceful degradation", () => {
  it("search can handle unexpanded queries", async () => {
    // This test verifies the contract that the learning service expects
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* QueryExpansionService
        const expansion = yield* svc.expand("search query")

        // Verify the result can be used in a search pipeline
        // expanded should always contain at least the original query
        expect(expansion.expanded.length).toBeGreaterThanOrEqual(1)
        expect(expansion.expanded).toContain(expansion.original)

        return expansion
      }).pipe(Effect.provide(QueryExpansionServiceNoop))
    )

    expect(result.original).toBe("search query")
  })
})

describe("validateExpansions", () => {
  it("includes original query first", () => {
    const result = validateExpansions("my query", ["alt1", "alt2"])
    expect(result[0]).toBe("my query")
  })

  it("includes valid alternatives after original", () => {
    const result = validateExpansions("my query", ["alt1", "alt2"])
    expect(result).toEqual(["my query", "alt1", "alt2"])
  })

  it("caps alternatives at MAX_EXPANSION_QUERIES", () => {
    const manyAlternatives = Array.from({ length: 50 }, (_, i) => `alternative ${i}`)
    const result = validateExpansions("my query", manyAlternatives)

    // original + MAX_EXPANSION_QUERIES
    expect(result.length).toBe(1 + MAX_EXPANSION_QUERIES)
    expect(result[0]).toBe("my query")
  })

  it("filters out queries exceeding MAX_QUERY_LENGTH", () => {
    const longQuery = "a".repeat(MAX_QUERY_LENGTH + 1)
    const result = validateExpansions("my query", [longQuery, "short"])
    expect(result).toEqual(["my query", "short"])
  })

  it("allows queries at exactly MAX_QUERY_LENGTH", () => {
    const exactLength = "a".repeat(MAX_QUERY_LENGTH)
    const result = validateExpansions("my query", [exactLength])
    expect(result).toEqual(["my query", exactLength])
  })

  it("filters out empty strings", () => {
    const result = validateExpansions("my query", ["", "  ", "valid"])
    expect(result).toEqual(["my query", "valid"])
  })

  it("filters out non-string values", () => {
    const result = validateExpansions("my query", [42, null, undefined, true, "valid"] as unknown[])
    expect(result).toEqual(["my query", "valid"])
  })

  it("deduplicates alternatives", () => {
    const result = validateExpansions("my query", ["dup", "dup", "dup", "other"])
    expect(result).toEqual(["my query", "dup", "other"])
  })

  it("removes alternatives that match original (case-insensitive)", () => {
    const result = validateExpansions("My Query", ["MY QUERY", "my query", "different"])
    expect(result).toEqual(["My Query", "different"])
  })

  it("trims whitespace from alternatives", () => {
    const result = validateExpansions("my query", ["  padded  ", "  spaced  "])
    expect(result).toEqual(["my query", "padded", "spaced"])
  })

  it("returns only original when alternatives is empty", () => {
    const result = validateExpansions("my query", [])
    expect(result).toEqual(["my query"])
  })

  it("handles hundreds of alternatives without issue", () => {
    const hugeList = Array.from({ length: 500 }, (_, i) => `query variant ${i}`)
    const result = validateExpansions("original", hugeList)

    expect(result.length).toBe(1 + MAX_EXPANSION_QUERIES)
    expect(result[0]).toBe("original")
  })
})
