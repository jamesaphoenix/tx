import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  QueryExpansionService,
  QueryExpansionServiceNoop,
  QueryExpansionServiceAuto
} from "../../src/services/query-expansion-service.js"

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
