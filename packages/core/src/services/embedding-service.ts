import { Context, Effect, Layer, Ref, Config, Option } from "effect"
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

// Types for OpenAI SDK (imported dynamically)
interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  usage?: {
    prompt_tokens?: number
    total_tokens?: number
  }
}

interface OpenAIClient {
  embeddings: {
    create(params: {
      model: string
      input: string | string[]
    }): Promise<OpenAIEmbeddingResponse>
  }
}

/**
 * Model dimensions for OpenAI text-embedding-3 models.
 * @see https://platform.openai.com/docs/models/embeddings
 */
const OPENAI_MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536 // Legacy model
}

// =============================================================================
// Dimension Validation
// =============================================================================

/**
 * Validates that an embedding vector has the expected number of dimensions.
 * This prevents silent data corruption when switching embedding providers
 * (e.g., 256-dim local to 1536-dim OpenAI) without re-embedding existing data.
 *
 * @internal Exported for testing purposes
 */
export const validateEmbeddingDimensions = (
  vector: Float32Array,
  expectedDimensions: number
): Effect.Effect<Float32Array, EmbeddingUnavailableError> => {
  if (vector.length !== expectedDimensions) {
    return Effect.fail(
      new EmbeddingUnavailableError({
        reason: `Embedding dimension mismatch: expected ${expectedDimensions}, got ${vector.length}. This may indicate a provider change without re-embedding.`
      })
    )
  }
  return Effect.succeed(vector)
}

// =============================================================================
// Runtime Interface Validators
// =============================================================================

/**
 * Validates that an object conforms to the Llama interface we depend on.
 * This guards against API changes in node-llama-cpp breaking at runtime.
 * @internal Exported for testing purposes
 */
export function isValidLlama(obj: unknown): obj is Llama {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "loadModel" in obj &&
    typeof (obj as Llama).loadModel === "function"
  )
}

/**
 * Validates that an object conforms to the LlamaModel interface we depend on.
 * @internal Exported for testing purposes
 */
export function isValidLlamaModel(obj: unknown): obj is LlamaModel {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "createEmbeddingContext" in obj &&
    typeof (obj as LlamaModel).createEmbeddingContext === "function"
  )
}

/**
 * Validates that an object conforms to the LlamaEmbeddingContext interface we depend on.
 * @internal Exported for testing purposes
 */
export function isValidLlamaEmbeddingContext(obj: unknown): obj is LlamaEmbeddingContext {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "getEmbeddingFor" in obj &&
    typeof (obj as LlamaEmbeddingContext).getEmbeddingFor === "function"
  )
}

/**
 * Validates that an object conforms to the OpenAIClient interface we depend on.
 * This guards against API changes in the openai package breaking at runtime.
 * @internal Exported for testing purposes
 */
export function isValidOpenAIClient(obj: unknown): obj is OpenAIClient {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "embeddings" in obj &&
    typeof (obj as OpenAIClient).embeddings === "object" &&
    (obj as OpenAIClient).embeddings !== null &&
    "create" in (obj as OpenAIClient).embeddings &&
    typeof (obj as OpenAIClient).embeddings.create === "function"
  )
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
    /** The dimension of embedding vectors (0 if unavailable) */
    readonly dimensions: number
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
    isAvailable: () => Effect.succeed(false),
    dimensions: 0
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

      // Get llama instance with runtime validation
      const llamaRaw = yield* Effect.tryPromise({
        try: () => nodeLlamaCpp.getLlama(),
        catch: (e) => new EmbeddingUnavailableError({ reason: `Failed to initialize llama: ${String(e)}` })
      })

      if (!isValidLlama(llamaRaw)) {
        return yield* Effect.fail(new EmbeddingUnavailableError({
          reason: "node-llama-cpp getLlama() returned incompatible interface - missing loadModel method"
        }))
      }
      const llama = llamaRaw

      // Load model - uses HuggingFace model spec format
      const modelRaw = yield* Effect.tryPromise({
        try: () => llama.loadModel({
          modelPath: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf"
        }),
        catch: (e) => new EmbeddingUnavailableError({ reason: `Failed to load model: ${String(e)}` })
      })

      if (!isValidLlamaModel(modelRaw)) {
        return yield* Effect.fail(new EmbeddingUnavailableError({
          reason: "node-llama-cpp loadModel() returned incompatible interface - missing createEmbeddingContext method"
        }))
      }
      const model = modelRaw

      // Create embedding context
      const contextRaw = yield* Effect.tryPromise({
        try: () => model.createEmbeddingContext({ threads: 4 }),
        catch: (e) => new EmbeddingUnavailableError({ reason: `Failed to create embedding context: ${String(e)}` })
      })

      if (!isValidLlamaEmbeddingContext(contextRaw)) {
        return yield* Effect.fail(new EmbeddingUnavailableError({
          reason: "node-llama-cpp createEmbeddingContext() returned incompatible interface - missing getEmbeddingFor method"
        }))
      }
      const context = contextRaw

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
          return yield* validateEmbeddingDimensions(new Float32Array(result.vector), 256)
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
            const validated = yield* validateEmbeddingDimensions(new Float32Array(result.vector), 256)
            results.push(validated)
          }
          return results
        }),

      isAvailable: () => Effect.succeed(true),

      dimensions: 256
    }
  })
)

/**
 * OpenAI implementation using text-embedding-3 models.
 * Uses OPENAI_API_KEY from environment and optional TX_OPENAI_EMBEDDING_MODEL config.
 *
 * Supported models:
 * - text-embedding-3-small (1536 dimensions, default)
 * - text-embedding-3-large (3072 dimensions)
 * - text-embedding-ada-002 (1536 dimensions, legacy)
 */
export const EmbeddingServiceOpenAI = Layer.effect(
  EmbeddingService,
  Effect.gen(function* () {
    // Read API key from environment
    const apiKey = yield* Config.string("OPENAI_API_KEY").pipe(
      Effect.mapError(() => new EmbeddingUnavailableError({
        reason: "OPENAI_API_KEY environment variable is not set"
      }))
    )

    // Read model from environment with default
    const model = yield* Config.string("TX_OPENAI_EMBEDDING_MODEL").pipe(
      Config.withDefault("text-embedding-3-small"),
      Effect.mapError(() => new EmbeddingUnavailableError({
        reason: "Failed to read TX_OPENAI_EMBEDDING_MODEL config"
      }))
    )

    // Determine dimensions based on model
    const dimensions = OPENAI_MODEL_DIMENSIONS[model] ?? 1536

    // Lazy-load client
    let client: OpenAIClient | null = null

    const ensureClient = Effect.gen(function* () {
      if (client) return client

      // Dynamic import of OpenAI SDK (optional peer dependency)
      const OpenAI = yield* Effect.tryPromise({
        try: async () => {
          // @ts-expect-error - openai is an optional peer dependency
          const mod = await import("openai")
          return mod.default
        },
        catch: () => new EmbeddingUnavailableError({
          reason: "openai package is not installed"
        })
      })

      const clientRaw = new OpenAI({ apiKey })
      if (!isValidOpenAIClient(clientRaw)) {
        return yield* Effect.fail(new EmbeddingUnavailableError({
          reason: "OpenAI SDK returned incompatible interface - missing embeddings.create method"
        }))
      }
      client = clientRaw
      return client
    })

    return {
      embed: (text) =>
        Effect.gen(function* () {
          const openai = yield* ensureClient

          const response = yield* Effect.tryPromise({
            try: () => openai.embeddings.create({
              model,
              input: text
            }),
            catch: (e) => new EmbeddingUnavailableError({
              reason: `OpenAI embedding failed: ${String(e)}`
            })
          })

          if (!response.data[0]?.embedding) {
            return yield* Effect.fail(new EmbeddingUnavailableError({
              reason: "OpenAI returned empty embedding"
            }))
          }

          return yield* validateEmbeddingDimensions(new Float32Array(response.data[0].embedding), dimensions)
        }),

      embedBatch: (texts) =>
        Effect.gen(function* () {
          if (texts.length === 0) {
            return []
          }

          const openai = yield* ensureClient

          // OpenAI supports batch embedding via array input
          const response = yield* Effect.tryPromise({
            try: () => openai.embeddings.create({
              model,
              input: [...texts] // Convert readonly to mutable
            }),
            catch: (e) => new EmbeddingUnavailableError({
              reason: `OpenAI batch embedding failed: ${String(e)}`
            })
          })

          // Sort by index to ensure correct order
          const sorted = [...response.data].sort((a, b) => a.index - b.index)

          const results: Float32Array[] = []
          for (const item of sorted) {
            const validated = yield* validateEmbeddingDimensions(new Float32Array(item.embedding), dimensions)
            results.push(validated)
          }
          return results
        }),

      isAvailable: () => Effect.succeed(true),

      dimensions
    }
  })
)

/**
 * Auto-detecting layer that selects the appropriate embedding backend.
 *
 * Priority:
 * 1. TX_EMBEDDER env var override ("openai", "local", "noop")
 * 2. OPENAI_API_KEY set → Use OpenAI (text-embedding-3-small)
 * 3. node-llama-cpp available → Use local embeddings
 * 4. Neither available → Use Noop (graceful degradation)
 */
export const EmbeddingServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    // Check for TX_EMBEDDER override first
    const embedderOverride = yield* Config.string("TX_EMBEDDER").pipe(Effect.option)

    if (Option.isSome(embedderOverride)) {
      const override = embedderOverride.value.toLowerCase().trim()
      switch (override) {
        case "openai":
          yield* Effect.logDebug("EmbeddingService: Using OpenAI (TX_EMBEDDER override)")
          return EmbeddingServiceOpenAI
        case "local":
          yield* Effect.logDebug("EmbeddingService: Using local node-llama-cpp (TX_EMBEDDER override)")
          return EmbeddingServiceLive
        case "noop":
          yield* Effect.logDebug("EmbeddingService: Using noop (TX_EMBEDDER override)")
          return EmbeddingServiceNoop
        default:
          // Invalid override value - continue with auto-detection
          yield* Effect.logDebug(`EmbeddingService: Invalid TX_EMBEDDER value "${override}", falling back to auto-detection`)
      }
    }

    // Check for OpenAI API key
    const openaiKey = yield* Config.string("OPENAI_API_KEY").pipe(Effect.option)

    if (Option.isSome(openaiKey) && openaiKey.value.trim().length > 0) {
      yield* Effect.logDebug("EmbeddingService: Using OpenAI (OPENAI_API_KEY detected)")
      return EmbeddingServiceOpenAI
    }

    // Fall back to node-llama-cpp if available
    const llamaAvailable = yield* Effect.tryPromise({
      try: async () => {
        await import("node-llama-cpp")
        return true
      },
      catch: () => false
    })

    if (llamaAvailable) {
      yield* Effect.logDebug("EmbeddingService: Using local node-llama-cpp (package available)")
      return EmbeddingServiceLive
    }

    yield* Effect.logDebug("EmbeddingService: Using noop (no embedder available)")
    return EmbeddingServiceNoop
  })
)

// =============================================================================
// SDK Factory for Custom Embedders
// =============================================================================

/**
 * Configuration for a custom embedder implementation.
 *
 * SDK users can provide their own embedding function to integrate
 * with any embedding API or model.
 *
 * @example
 * ```typescript
 * import { createEmbedderLayer } from "@jamesaphoenix/tx-core"
 *
 * const myEmbedder = createEmbedderLayer({
 *   embed: async (text) => {
 *     const response = await fetch("https://my-embedding-api.com/embed", {
 *       method: "POST",
 *       body: JSON.stringify({ text })
 *     })
 *     const data = await response.json()
 *     return new Float32Array(data.embedding)
 *   },
 *   dimensions: 768,
 *   name: "my-custom-embedder"
 * })
 * ```
 */
export interface EmbedderConfig {
  /**
   * Embed a single text string into a vector.
   * @param text - The text to embed
   * @returns A Float32Array containing the embedding vector
   */
  readonly embed: (text: string) => Promise<Float32Array>

  /**
   * Embed multiple texts in batch.
   * Optional - if not provided, defaults to sequential `embed` calls.
   * @param texts - Array of texts to embed
   * @returns Array of Float32Array embeddings in the same order as input
   */
  readonly embedBatch?: (texts: readonly string[]) => Promise<readonly Float32Array[]>

  /**
   * The dimension of embedding vectors produced by this embedder.
   * This must match the actual vector size returned by embed().
   */
  readonly dimensions: number

  /**
   * Human-readable name for logging and debugging.
   * @default "custom-embedder"
   */
  readonly name?: string
}

/**
 * Create an EmbeddingService layer from a custom embedder configuration.
 *
 * This factory allows SDK users to integrate any embedding provider
 * (OpenAI, Cohere, local models, etc.) by providing simple async functions.
 *
 * @param config - Configuration with embed function and dimensions
 * @returns An Effect Layer providing EmbeddingService
 *
 * @example
 * ```typescript
 * import { createEmbedderLayer, makeMinimalLayer } from "@jamesaphoenix/tx-core"
 * import { Layer, Effect } from "effect"
 *
 * // Create custom embedder layer
 * const myEmbedder = createEmbedderLayer({
 *   embed: async (text) => callMyEmbeddingAPI(text),
 *   dimensions: 768,
 *   name: "my-custom-embedder"
 * })
 *
 * // Use with tx application layer
 * const appLayer = makeMinimalLayer(":memory:").pipe(
 *   Layer.provideMerge(myEmbedder)
 * )
 *
 * // Run effects with custom embedder
 * const program = Effect.gen(function* () {
 *   const embedding = yield* EmbeddingService
 *   const vector = yield* embedding.embed("Hello world")
 *   console.log(`Vector dimensions: ${vector.length}`)
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(appLayer)))
 * ```
 */
export const createEmbedderLayer = (config: EmbedderConfig): Layer.Layer<EmbeddingService> => {
  const embedderName = config.name ?? "custom-embedder"

  return Layer.succeed(EmbeddingService, {
    embed: (text) =>
      Effect.gen(function* () {
        const vector = yield* Effect.tryPromise({
          try: () => config.embed(text),
          catch: (error) =>
            new EmbeddingUnavailableError({
              reason: `${embedderName} embed failed: ${String(error)}`
            })
        })
        return yield* validateEmbeddingDimensions(vector, config.dimensions)
      }),

    embedBatch: (texts) => {
      // Use custom batch implementation if provided
      if (config.embedBatch) {
        return Effect.gen(function* () {
          const vectors = yield* Effect.tryPromise({
            try: () => config.embedBatch!(texts),
            catch: (error) =>
              new EmbeddingUnavailableError({
                reason: `${embedderName} embedBatch failed: ${String(error)}`
              })
          })
          const results: Float32Array[] = []
          for (const vector of vectors) {
            const validated = yield* validateEmbeddingDimensions(vector, config.dimensions)
            results.push(validated)
          }
          return results
        })
      }

      // Fall back to sequential embed calls
      return Effect.gen(function* () {
        const results: Float32Array[] = []
        for (const text of texts) {
          const embedding = yield* Effect.tryPromise({
            try: () => config.embed(text),
            catch: (error) =>
              new EmbeddingUnavailableError({
                reason: `${embedderName} embed failed: ${String(error)}`
              })
          })
          const validated = yield* validateEmbeddingDimensions(embedding, config.dimensions)
          results.push(validated)
        }
        return results
      })
    },

    isAvailable: () => Effect.succeed(true),

    dimensions: config.dimensions
  })
}
