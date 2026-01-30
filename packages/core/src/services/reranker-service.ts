import { Context, Effect, Layer, Ref } from "effect"
import { RerankerUnavailableError } from "../errors.js"

// Types for node-llama-cpp (imported dynamically)
interface LlamaRankingResult {
  readonly document: string
  readonly score: number
}

interface LlamaRankingContext {
  rankAndSort(query: string, documents: string[]): Promise<LlamaRankingResult[]>
  dispose(): Promise<void>
}

interface LlamaModel {
  createRankingContext(): Promise<LlamaRankingContext>
}

interface Llama {
  loadModel(options: { modelPath: string }): Promise<LlamaModel>
}

/**
 * Result of re-ranking documents against a query.
 */
export interface RerankerResult {
  /** Original document content */
  readonly document: string
  /** Relevance score (0-1, higher is more relevant) */
  readonly score: number
  /** Original index before re-ranking */
  readonly originalIndex: number
}

/**
 * RerankerService uses LLM-based re-ranking to improve search result quality.
 *
 * Re-ranking takes initial search results and uses a specialized model to
 * re-score them based on query relevance. This typically improves precision
 * at the cost of some latency.
 *
 * Design: Following DD-010 patterns for local model integration.
 * The service gracefully degrades when node-llama-cpp is not available.
 */
export class RerankerService extends Context.Tag("RerankerService")<
  RerankerService,
  {
    /**
     * Re-rank documents against a query.
     * Returns documents sorted by relevance score (highest first).
     */
    readonly rerank: (
      query: string,
      documents: readonly string[]
    ) => Effect.Effect<readonly RerankerResult[], RerankerUnavailableError>
    /** Check if re-ranking functionality is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Noop fallback - returns documents unchanged with default scores.
 * Used when node-llama-cpp is not available or re-ranking is disabled.
 */
export const RerankerServiceNoop = Layer.succeed(
  RerankerService,
  {
    rerank: (_query, documents) =>
      Effect.succeed(
        documents.map((document, index) => ({
          document,
          score: 1 - index * 0.01, // Preserve original order with decreasing scores
          originalIndex: index
        }))
      ),
    isAvailable: () => Effect.succeed(false)
  }
)

/**
 * Live implementation with node-llama-cpp and Qwen3-Reranker model.
 * Lazy-loads the model on first use and caches the context.
 */
export const RerankerServiceLive = Layer.scoped(
  RerankerService,
  Effect.gen(function* () {
    // State for lazy-loaded context
    const stateRef = yield* Ref.make<{
      context: LlamaRankingContext | null
      lastActivity: number
    }>({
      context: null,
      lastActivity: Date.now()
    })

    /**
     * Ensure the ranking context is loaded.
     * Lazy-loads node-llama-cpp and the model on first call.
     */
    const ensureContext = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (state.context) {
        yield* Ref.update(stateRef, s => ({ ...s, lastActivity: Date.now() }))
        return state.context
      }

      // Lazy load node-llama-cpp
      const nodeLlamaCpp = yield* Effect.tryPromise({
        try: async () => {
          const mod = await import("node-llama-cpp")
          return mod
        },
        catch: () => new RerankerUnavailableError({ reason: "node-llama-cpp not installed" })
      })

      // Get llama instance
      const llama = yield* Effect.tryPromise({
        try: () => nodeLlamaCpp.getLlama() as unknown as Promise<Llama>,
        catch: (e) => new RerankerUnavailableError({ reason: `Failed to initialize llama: ${String(e)}` })
      })

      // Load Qwen3-Reranker model - uses HuggingFace model spec format
      // Using the 0.6B model for a good balance of quality and speed
      const model = yield* Effect.tryPromise({
        try: () => llama.loadModel({
          modelPath: "hf:Mungert/Qwen3-Reranker-0.6B-GGUF/Qwen3-Reranker-0.6B-Q8_0.gguf"
        }),
        catch: (e) => new RerankerUnavailableError({ reason: `Failed to load model: ${String(e)}` })
      })

      // Create ranking context
      const context = yield* Effect.tryPromise({
        try: () => model.createRankingContext(),
        catch: (e) => new RerankerUnavailableError({ reason: `Failed to create ranking context: ${String(e)}` })
      })

      yield* Ref.set(stateRef, { context, lastActivity: Date.now() })
      return context
    })

    return {
      rerank: (query, documents) =>
        Effect.gen(function* () {
          if (documents.length === 0) {
            return []
          }

          // For very small result sets, re-ranking may not be worth the cost
          if (documents.length <= 2) {
            return documents.map((document, index) => ({
              document,
              score: 1 - index * 0.1,
              originalIndex: index
            }))
          }

          const ctx = yield* ensureContext

          // Create index map to track original positions
          const docArray = [...documents]
          const indexMap = new Map<string, number>()
          docArray.forEach((doc, idx) => {
            indexMap.set(doc, idx)
          })

          const ranked = yield* Effect.tryPromise({
            try: () => ctx.rankAndSort(query, docArray),
            catch: (e) => new RerankerUnavailableError({ reason: `Re-ranking failed: ${String(e)}` })
          })

          yield* Ref.update(stateRef, s => ({ ...s, lastActivity: Date.now() }))

          return ranked.map(result => ({
            document: result.document,
            score: result.score,
            originalIndex: indexMap.get(result.document) ?? -1
          }))
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)

/**
 * Auto-detecting layer that uses Live if node-llama-cpp is available, Noop otherwise.
 * This allows graceful degradation when the re-ranking library is not installed.
 */
export const RerankerServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    // Try to import node-llama-cpp to check availability
    const available = yield* Effect.tryPromise({
      try: async () => {
        await import("node-llama-cpp")
        return true
      },
      catch: () => false
    })

    if (available) {
      return RerankerServiceLive
    }
    return RerankerServiceNoop
  })
)
