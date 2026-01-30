import { Context, Effect, Layer, Config, Option } from "effect"
import { Data } from "effect"

/**
 * Error indicating query expansion is unavailable.
 */
export class QueryExpansionUnavailableError extends Data.TaggedError("QueryExpansionUnavailableError")<{
  readonly reason: string
}> {
  get message() {
    return `Query expansion unavailable: ${this.reason}`
  }
}

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

// Types for Anthropic SDK (imported dynamically)
interface AnthropicMessage {
  content: Array<{ type: string; text?: string }>
}

interface AnthropicClient {
  messages: {
    create(params: {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: string }>
    }): Promise<AnthropicMessage>
  }
}

/**
 * QueryExpansionService uses an LLM to generate alternative phrasings of search queries.
 * This improves recall by searching for semantically equivalent but differently worded queries.
 *
 * Design: Following DD-006 patterns for LLM integration.
 * The service gracefully degrades when ANTHROPIC_API_KEY is not set.
 */
export class QueryExpansionService extends Context.Tag("QueryExpansionService")<
  QueryExpansionService,
  {
    /** Expand a search query into multiple alternative phrasings */
    readonly expand: (query: string) => Effect.Effect<QueryExpansionResult, QueryExpansionUnavailableError>
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
5. Output ONLY a JSON array of strings, nothing else

Example:
Input: "fix authentication bug"
Output: ["resolve auth issue", "debug login problem", "authentication error fix"]

Input: "add user profile page"
Output: ["create profile view", "implement user account page", "build profile screen"]

Now expand this query:
`

/**
 * Parse LLM JSON response, handling common formatting issues.
 * Robust parser from DD-006.
 */
const parseLlmJson = <T>(raw: string): T | null => {
  // Step 1: Try direct parse
  try { return JSON.parse(raw) } catch { /* continue */ }

  // Step 2: Strip markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch && fenceMatch[1]) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch { /* continue */ }
  }

  // Step 3: Find first [ or { and parse from there
  const jsonStart = raw.search(/[[{]/)
  if (jsonStart >= 0) {
    const candidate = raw.slice(jsonStart)
    try { return JSON.parse(candidate) } catch { /* continue */ }

    // Step 4: Find matching bracket and extract
    const openChar = candidate[0]
    const closeChar = openChar === "[" ? "]" : "}"
    const lastClose = candidate.lastIndexOf(closeChar)
    if (lastClose > 0) {
      try { return JSON.parse(candidate.slice(0, lastClose + 1)) } catch { /* continue */ }
    }
  }

  return null
}

/**
 * Noop implementation - returns original query only.
 * Used when ANTHROPIC_API_KEY is not set or LLM features are disabled.
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
 * Live implementation using Anthropic Claude API.
 * Lazy-loads the SDK and caches the client.
 */
export const QueryExpansionServiceLive = Layer.effect(
  QueryExpansionService,
  Effect.gen(function* () {
    // Read API key from environment
    const apiKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(
      Effect.mapError(() => new QueryExpansionUnavailableError({
        reason: "ANTHROPIC_API_KEY environment variable is not set"
      }))
    )

    // Lazy-load client
    let client: AnthropicClient | null = null

    const ensureClient = Effect.gen(function* () {
      if (client) return client

      // Dynamic import of Anthropic SDK (optional peer dependency)
      const Anthropic = yield* Effect.tryPromise({
        try: async () => {
          // @ts-expect-error - @anthropic-ai/sdk is an optional peer dependency
          const mod = await import("@anthropic-ai/sdk")
          return mod.default
        },
        catch: () => new QueryExpansionUnavailableError({
          reason: "@anthropic-ai/sdk is not installed"
        })
      })

      client = new Anthropic({ apiKey }) as unknown as AnthropicClient
      return client
    })

    return {
      expand: (query) =>
        Effect.gen(function* () {
          const anthropic = yield* ensureClient

          const response = yield* Effect.tryPromise({
            try: () => anthropic.messages.create({
              model: "claude-haiku-4-20250514",
              max_tokens: 256,
              messages: [{
                role: "user",
                content: EXPANSION_PROMPT + JSON.stringify(query)
              }]
            }),
            catch: (e) => new QueryExpansionUnavailableError({
              reason: `API call failed: ${String(e)}`
            })
          })

          // Extract text from response
          const textContent = response.content.find(c => c.type === "text")
          if (!textContent || !textContent.text) {
            return { original: query, expanded: [query], wasExpanded: false }
          }

          // Parse the JSON array of expanded queries
          const alternatives = parseLlmJson<string[]>(textContent.text)
          if (!alternatives || !Array.isArray(alternatives)) {
            return { original: query, expanded: [query], wasExpanded: false }
          }

          // Filter out empty strings and duplicates
          const uniqueAlternatives = [...new Set(
            alternatives
              .filter((alt): alt is string => typeof alt === "string" && alt.trim().length > 0)
              .map(alt => alt.trim())
          )]

          // Always include original query first
          const expanded = [query, ...uniqueAlternatives.filter(alt => alt.toLowerCase() !== query.toLowerCase())]

          return {
            original: query,
            expanded,
            wasExpanded: true
          }
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)

/**
 * Auto-detecting layer that uses Live if ANTHROPIC_API_KEY is set, Noop otherwise.
 * This allows graceful degradation when the API key is not configured.
 */
export const QueryExpansionServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    // Check if API key is available
    const apiKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(Effect.option)

    if (Option.isSome(apiKey) && apiKey.value.trim().length > 0) {
      return QueryExpansionServiceLive
    }
    return QueryExpansionServiceNoop
  })
)
