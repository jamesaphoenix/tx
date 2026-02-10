import { Context, Effect, Layer } from "effect"
import { LlmUnavailableError } from "../errors.js"
import { LlmService } from "./llm-service.js"

/**
 * Error indicating query expansion is unavailable.
 */
export { LlmUnavailableError as QueryExpansionUnavailableError }

/**
 * Result of query expansion.
 */
export interface QueryExpansionResult {
  /** Original query */
  readonly original: string
  /** Expanded queries (includes original plus alternatives) */
  readonly expanded: readonly string[]
  /** Whether expansion was performed (false if using noop) */
  readonly wasExpanded: boolean
}

/** Maximum number of expanded queries (excluding original) to prevent unbounded generation */
export const MAX_EXPANSION_QUERIES = 5

/** Maximum character length for any single expanded query */
export const MAX_QUERY_LENGTH = 200

/**
 * QueryExpansionService uses an LLM to generate alternative phrasings of search queries.
 * This improves recall by searching for semantically equivalent but differently worded queries.
 *
 * Design: Following DD-006 patterns for LLM integration.
 * The service gracefully degrades when no LLM backend is available.
 */
export class QueryExpansionService extends Context.Tag("QueryExpansionService")<
  QueryExpansionService,
  {
    /** Expand a search query into multiple alternative phrasings */
    readonly expand: (query: string) => Effect.Effect<QueryExpansionResult, LlmUnavailableError>
    /** Check if query expansion is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * The prompt template for query expansion.
 * Designed to generate concise, search-optimized alternative queries.
 */
const EXPANSION_PROMPT = `You are a search query expansion assistant. Given a search query, generate 2-3 alternative phrasings that capture the same intent but use different words or perspectives.

Rules:
1. Keep alternatives concise (similar length to original)
2. Use synonyms and related terminology
3. Consider different ways to express the same concept
4. Do NOT add information not implied by the original query

Example:
Input: "fix authentication bug"
Output: {"alternatives": ["resolve auth issue", "debug login problem", "authentication error fix"]}

Input: "add user profile page"
Output: {"alternatives": ["create profile view", "implement user account page", "build profile screen"]}

Now expand this query:
`

/** JSON Schema for structured output from the query expansion LLM call */
const EXPANSION_SCHEMA = {
  type: "object",
  properties: {
    alternatives: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["alternatives"],
  additionalProperties: false,
} as const

/**
 * Validate and limit expanded query alternatives.
 * Filters out empty, overly long, duplicate, and non-string entries,
 * then caps the total number of expansions.
 *
 * @returns Array with original query first, followed by up to MAX_EXPANSION_QUERIES alternatives
 */
export const validateExpansions = (
  query: string,
  alternatives: unknown[]
): string[] => {
  const uniqueAlternatives = [...new Set(
    alternatives
      .filter((alt): alt is string => typeof alt === "string" && alt.trim().length > 0)
      .map(alt => alt.trim())
      .filter(alt => alt.length <= MAX_QUERY_LENGTH)
  )]

  return [query, ...uniqueAlternatives
    .filter(alt => alt.toLowerCase() !== query.toLowerCase())
    .slice(0, MAX_EXPANSION_QUERIES)
  ]
}

/**
 * Noop implementation - returns original query only.
 * Used when no LLM backend is available or LLM features are disabled.
 */
export const QueryExpansionServiceNoop = Layer.succeed(
  QueryExpansionService,
  {
    expand: (query) => Effect.succeed({
      original: query,
      expanded: [query],
      wasExpanded: false
    }),
    isAvailable: () => Effect.succeed(false)
  }
)

/**
 * Live implementation using centralized LlmService.
 * Depends on LlmService being provided in the layer context.
 */
export const QueryExpansionServiceLive = Layer.effect(
  QueryExpansionService,
  Effect.gen(function* () {
    const llmService = yield* LlmService

    return {
      expand: (query) =>
        Effect.gen(function* () {
          const either = yield* Effect.either(llmService.complete({
            prompt: EXPANSION_PROMPT + JSON.stringify(query),
            model: "claude-haiku-4-20250514",
            maxTokens: 256,
            jsonSchema: EXPANSION_SCHEMA,
          }))

          // Graceful degradation: if LLM call fails, return original query
          if (either._tag === "Left") {
            return { original: query, expanded: [query], wasExpanded: false }
          }

          const result = either.right
          if (!result.text) {
            return { original: query, expanded: [query], wasExpanded: false }
          }

          // Structured outputs guarantee valid JSON matching the schema
          const parsed = JSON.parse(result.text) as { alternatives: string[] }

          // Validate and limit expansion results
          const expanded = validateExpansions(query, parsed.alternatives)

          return {
            original: query,
            expanded,
            wasExpanded: expanded.length > 1
          }
        }),

      isAvailable: () => llmService.isAvailable()
    }
  })
)

/**
 * Auto-detecting layer — uses Live if LlmService is available, Noop otherwise.
 * This allows graceful degradation when no LLM backend is configured.
 */
export const QueryExpansionServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    const opt = yield* Effect.serviceOption(LlmService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const }))
    )

    if (opt._tag === "Some") {
      const available = yield* opt.value.isAvailable()
      if (available) return QueryExpansionServiceLive
    }
    return QueryExpansionServiceNoop
  })
)
