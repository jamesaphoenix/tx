import { Context, Effect, Layer, Ref } from "effect"
import { EmbeddingUnavailableError } from "../errors.js"

// Types for node-llama-cpp (imported dynamically)
// We use permissive types here since we're dealing with dynamic imports
// and the actual types from node-llama-cpp have readonly arrays
interface LlamaEmbeddingResult {
  readonly vector: readonly number[]
}

interface LlamaEmbeddingContext {
  getEmbeddingFor(text: string): Promise<LlamaEmbeddingResult>
}

interface LlamaModel {
  createEmbeddingContext(options?: { threads?: number }): Promise<LlamaEmbeddingContext>
}

interface Llama {
  loadModel(options: { modelPath: string }): Promise<LlamaModel>
}

/**
 * EmbeddingService provides vector embeddings for text using local models.
 *
 * Design: DD-010 specifies lazy-loading with node-llama-cpp and embeddinggemma-300M GGUF model.
 * The service gracefully degrades when the model is unavailable.
 */
export class EmbeddingService extends Context.Tag("EmbeddingService")<
  EmbeddingService,
  {
    /** Embed a single text string */
    readonly embed: (text: string) => Effect.Effect<Float32Array, EmbeddingUnavailableError>
    /** Embed multiple texts in batch */
    readonly embedBatch: (texts: readonly string[]) => Effect.Effect<readonly Float32Array[], EmbeddingUnavailableError>
    /** Check if embedding functionality is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Noop fallback - always returns failure.
 * Used when node-llama-cpp is not available or embeddings are disabled.
 */
export const EmbeddingServiceNoop = Layer.succeed(
  EmbeddingService,
  {
    embed: () => Effect.fail(new EmbeddingUnavailableError({ reason: "No embedding model configured" })),
    embedBatch: () => Effect.fail(new EmbeddingUnavailableError({ reason: "No embedding model configured" })),
    isAvailable: () => Effect.succeed(false)
  }
)

/**
 * Live implementation with node-llama-cpp.
 * Lazy-loads the model on first use and caches the context.
 */
export const EmbeddingServiceLive = Layer.scoped(
  EmbeddingService,
  Effect.gen(function* () {
    // State for lazy-loaded context
    const stateRef = yield* Ref.make<{
      context: LlamaEmbeddingContext | null
      lastActivity: number
    }>({
      context: null,
      lastActivity: Date.now()
    })

    /**
     * Ensure the embedding context is loaded.
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
        catch: () => new EmbeddingUnavailableError({ reason: "node-llama-cpp not installed" })
      })

      // Get llama instance
      const llama = yield* Effect.tryPromise({
        try: () => nodeLlamaCpp.getLlama() as unknown as Promise<Llama>,
        catch: (e) => new EmbeddingUnavailableError({ reason: `Failed to initialize llama: ${String(e)}` })
      })

      // Load model - uses HuggingFace model spec format
      const model = yield* Effect.tryPromise({
        try: () => llama.loadModel({
          modelPath: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf"
        }),
        catch: (e) => new EmbeddingUnavailableError({ reason: `Failed to load model: ${String(e)}` })
      })

      // Create embedding context
      const context = yield* Effect.tryPromise({
        try: () => model.createEmbeddingContext({ threads: 4 }),
        catch: (e) => new EmbeddingUnavailableError({ reason: `Failed to create embedding context: ${String(e)}` })
      })

      yield* Ref.set(stateRef, { context, lastActivity: Date.now() })
      return context
    })

    /**
     * Format text for query embeddings (search queries).
     * Uses Nomic-style task prefixes for better semantic matching.
     */
    const formatQuery = (text: string): string => `task: search result | query: ${text}`

    /**
     * Format text for document embeddings (stored documents).
     */
    const formatDoc = (text: string): string => `text: ${text}`

    return {
      embed: (text) =>
        Effect.gen(function* () {
          const ctx = yield* ensureContext
          const result = yield* Effect.tryPromise({
            try: () => ctx.getEmbeddingFor(formatQuery(text)),
            catch: (e) => new EmbeddingUnavailableError({ reason: `Embedding failed: ${String(e)}` })
          })
          return new Float32Array(result.vector)
        }),

      embedBatch: (texts) =>
        Effect.gen(function* () {
          const ctx = yield* ensureContext
          const results: Float32Array[] = []
          for (const text of texts) {
            const result = yield* Effect.tryPromise({
              try: () => ctx.getEmbeddingFor(formatDoc(text)),
              catch: (e) => new EmbeddingUnavailableError({ reason: `Batch embedding failed: ${String(e)}` })
            })
            yield* Ref.update(stateRef, s => ({ ...s, lastActivity: Date.now() }))
            results.push(new Float32Array(result.vector))
          }
          return results
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)

/**
 * Auto-detecting layer that uses Live if node-llama-cpp is available, Noop otherwise.
 * This allows graceful degradation when the embedding library is not installed.
 */
export const EmbeddingServiceAuto = Layer.unwrapEffect(
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
      return EmbeddingServiceLive
    }
    return EmbeddingServiceNoop
  })
)
