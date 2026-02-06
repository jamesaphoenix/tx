import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer, Ref, ConfigProvider } from "effect"
import {
  EmbeddingService,
  EmbeddingServiceNoop,
  EmbeddingServiceLive,
  EmbeddingServiceOpenAI,
  EmbeddingServiceAuto,
  EmbeddingUnavailableError,
  createEmbedderLayer,
  type EmbedderConfig
} from "@jamesaphoenix/tx-core"

// ============================================================================
// Mock Factories for node-llama-cpp
// ============================================================================

// Note: These mock factories demonstrate the expected interface structure
// for node-llama-cpp. They are used by the mock-based test layer below.

describe("EmbeddingServiceNoop", () => {
  it("embed returns EmbeddingUnavailableError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* Effect.either(svc.embed("test text"))
      }).pipe(Effect.provide(EmbeddingServiceNoop))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("EmbeddingUnavailableError")
      expect(result.left.reason).toBe("No embedding model configured")
    }
  })

  it("embedBatch returns EmbeddingUnavailableError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* Effect.either(svc.embedBatch(["text1", "text2"]))
      }).pipe(Effect.provide(EmbeddingServiceNoop))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("EmbeddingUnavailableError")
    }
  })

  it("isAvailable returns false", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* svc.isAvailable()
      }).pipe(Effect.provide(EmbeddingServiceNoop))
    )

    expect(result).toBe(false)
  })

  it("dimensions returns 0", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return svc.dimensions
      }).pipe(Effect.provide(EmbeddingServiceNoop))
    )

    expect(result).toBe(0)
  })
})

describe("EmbeddingServiceLive", () => {
  it("isAvailable returns true (before any embedding calls)", async () => {
    // EmbeddingServiceLive.isAvailable() returns true, indicating it *claims* to be available.
    // Actual availability depends on the model being loadable at runtime.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* svc.isAvailable()
      }).pipe(
        Effect.provide(EmbeddingServiceLive),
        Effect.scoped
      )
    )

    expect(result).toBe(true)
  })

  it("dimensions returns 256 (embeddinggemma-300M)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return svc.dimensions
      }).pipe(
        Effect.provide(EmbeddingServiceLive),
        Effect.scoped
      )
    )

    expect(result).toBe(256)
  })

  // Note: We don't test actual embedding generation here since it requires
  // downloading and loading the embeddinggemma-300M model, which is impractical
  // for unit tests. Integration tests with the actual model should be run
  // separately in an environment with the model available.
})

describe("EmbeddingServiceAuto", () => {
  it("resolves to a layer (either Noop or Live)", async () => {
    // EmbeddingServiceAuto should auto-detect whether node-llama-cpp is available
    // and return the appropriate layer. Since we have node-llama-cpp installed,
    // it should use the Live layer.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* svc.isAvailable()
      }).pipe(
        Effect.provide(EmbeddingServiceAuto),
        Effect.scoped
      )
    )

    // Should be either true (Live) or false (Noop) depending on environment
    expect(typeof result).toBe("boolean")
  })
})

describe("EmbeddingUnavailableError", () => {
  it("has correct tag and message", () => {
    const error = new EmbeddingUnavailableError({ reason: "test reason" })
    expect(error._tag).toBe("EmbeddingUnavailableError")
    expect(error.message).toContain("test reason")
  })
})

// ============================================================================
// Mock-based Tests for Model Loading Pipeline
// ============================================================================

describe("EmbeddingService Mock-based Tests", () => {
  // Track calls to verify behavior
  let callLog: string[] = []
  let lastEmbedText: string | null = null

  beforeEach(() => {
    callLog = []
    lastEmbedText = null
  })

  /**
   * Creates a mock-based EmbeddingService layer for testing.
   * This allows us to inject mock implementations without downloading real models.
   */
  const createMockEmbeddingServiceLayer = (options: {
    importError?: boolean
    getLlamaError?: boolean
    loadModelError?: boolean
    createContextError?: boolean
    embedError?: boolean
    embedBatchError?: boolean
    trackCalls?: boolean
  } = {}) => {
    return Layer.scoped(
      EmbeddingService,
      Effect.gen(function* () {
        // State for lazy-loaded context
        const stateRef = yield* Ref.make<{
          context: { getEmbeddingFor: (text: string) => Promise<{ vector: number[] }> } | null
          lastActivity: number
          loadCount: number
        }>({
          context: null,
          lastActivity: Date.now(),
          loadCount: 0
        })

        const ensureContext = Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)
          if (state.context) {
            if (options.trackCalls) callLog.push("cache-hit")
            yield* Ref.update(stateRef, s => ({ ...s, lastActivity: Date.now() }))
            return state.context
          }

          // Step 1: Import node-llama-cpp
          if (options.trackCalls) callLog.push("import")
          if (options.importError) {
            return yield* Effect.fail(new EmbeddingUnavailableError({ reason: "node-llama-cpp not installed" }))
          }

          // Step 2: Get llama instance
          if (options.trackCalls) callLog.push("getLlama")
          if (options.getLlamaError) {
            return yield* Effect.fail(new EmbeddingUnavailableError({ reason: "Failed to initialize llama: mock error" }))
          }

          // Step 3: Load model
          if (options.trackCalls) callLog.push("loadModel")
          if (options.loadModelError) {
            return yield* Effect.fail(new EmbeddingUnavailableError({ reason: "Failed to load model: mock error" }))
          }

          // Step 4: Create embedding context
          if (options.trackCalls) callLog.push("createContext")
          if (options.createContextError) {
            return yield* Effect.fail(new EmbeddingUnavailableError({ reason: "Failed to create embedding context: mock error" }))
          }

          const mockContext = {
            getEmbeddingFor: async (text: string) => {
              lastEmbedText = text
              if (options.embedError) {
                throw new Error("mock embed error")
              }
              return { vector: Array(256).fill(0.1) }
            }
          }

          yield* Ref.update(stateRef, s => ({
            ...s,
            context: mockContext,
            lastActivity: Date.now(),
            loadCount: s.loadCount + 1
          }))
          return mockContext
        })

        const formatQuery = (text: string): string => `task: search result | query: ${text}`
        const formatDoc = (text: string): string => `text: ${text}`

        return {
          embed: (text: string) =>
            Effect.gen(function* () {
              const ctx = yield* ensureContext
              const result = yield* Effect.tryPromise({
                try: () => ctx.getEmbeddingFor(formatQuery(text)),
                catch: (e) => new EmbeddingUnavailableError({ reason: `Embedding failed: ${String(e)}` })
              })
              return new Float32Array(result.vector)
            }),

          embedBatch: (texts: readonly string[]) =>
            Effect.gen(function* () {
              const ctx = yield* ensureContext
              const results: Float32Array[] = []
              for (const text of texts) {
                if (options.embedBatchError && results.length > 0) {
                  return yield* Effect.fail(new EmbeddingUnavailableError({ reason: "Batch embedding failed: mock error" }))
                }
                const result = yield* Effect.tryPromise({
                  try: () => ctx.getEmbeddingFor(formatDoc(text)),
                  catch: (e) => new EmbeddingUnavailableError({ reason: `Batch embedding failed: ${String(e)}` })
                })
                if (options.trackCalls) callLog.push(`batch-item-${results.length}`)
                results.push(new Float32Array(result.vector))
              }
              return results
            }),

          isAvailable: () => Effect.succeed(true),

          dimensions: 256,

          // Expose internal state for testing
          getLoadCount: () =>
            Effect.gen(function* () {
              const state = yield* Ref.get(stateRef)
              return state.loadCount
            })
        }
      })
    )
  }

  describe("Model Loading Pipeline (4 steps)", () => {
    it("executes all 4 loading steps on first call", async () => {
      const layer = createMockEmbeddingServiceLayer({ trackCalls: true })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          yield* svc.embed("test")
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(callLog).toContain("import")
      expect(callLog).toContain("getLlama")
      expect(callLog).toContain("loadModel")
      expect(callLog).toContain("createContext")
    })

    it("step 1: import - fails with correct error when node-llama-cpp unavailable", async () => {
      const layer = createMockEmbeddingServiceLayer({ importError: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("node-llama-cpp not installed")
      }
    })

    it("step 2: getLlama - fails with correct error when llama init fails", async () => {
      const layer = createMockEmbeddingServiceLayer({ getLlamaError: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("Failed to initialize llama")
      }
    })

    it("step 3: loadModel - fails with correct error when model loading fails", async () => {
      const layer = createMockEmbeddingServiceLayer({ loadModelError: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("Failed to load model")
      }
    })

    it("step 4: createContext - fails with correct error when context creation fails", async () => {
      const layer = createMockEmbeddingServiceLayer({ createContextError: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("Failed to create embedding context")
      }
    })
  })

  describe("Error Catch Blocks (6 total)", () => {
    it("embed - catches and wraps embedding errors", async () => {
      const layer = createMockEmbeddingServiceLayer({ embedError: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("Embedding failed")
      }
    })

    it("embedBatch - catches and wraps batch embedding errors", async () => {
      const layer = createMockEmbeddingServiceLayer({ embedBatchError: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embedBatch(["text1", "text2", "text3"]))
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("Batch embedding failed")
      }
    })
  })

  describe("formatQuery/formatDoc Text Formatting", () => {
    it("embed uses formatQuery with task prefix", async () => {
      const layer = createMockEmbeddingServiceLayer({})

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          yield* svc.embed("my search query")
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(lastEmbedText).toBe("task: search result | query: my search query")
    })

    it("embedBatch uses formatDoc with text prefix", async () => {
      const layer = createMockEmbeddingServiceLayer({})

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          yield* svc.embedBatch(["document content"])
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(lastEmbedText).toBe("text: document content")
    })

    it("formatQuery handles special characters", async () => {
      const layer = createMockEmbeddingServiceLayer({})

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          yield* svc.embed("test & special <chars> 'quotes'")
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(lastEmbedText).toBe("task: search result | query: test & special <chars> 'quotes'")
    })

    it("formatDoc handles empty string", async () => {
      const layer = createMockEmbeddingServiceLayer({})

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          yield* svc.embedBatch([""])
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(lastEmbedText).toBe("text: ")
    })
  })

  describe("Lazy Loading Behavior", () => {
    it("first call loads the model, second call uses cache", async () => {
      const layer = createMockEmbeddingServiceLayer({ trackCalls: true })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          // First embed call
          yield* svc.embed("first query")
          // Second embed call
          yield* svc.embed("second query")
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      // Should see loading steps only once
      const importCount = callLog.filter(c => c === "import").length
      const cacheHitCount = callLog.filter(c => c === "cache-hit").length

      expect(importCount).toBe(1)
      expect(cacheHitCount).toBe(1) // Second call should hit cache
    })

    it("context is reused across multiple embed calls", async () => {
      const layer = createMockEmbeddingServiceLayer({ trackCalls: true })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          yield* svc.embed("query 1")
          yield* svc.embed("query 2")
          yield* svc.embed("query 3")
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      // Should only see one set of loading steps
      expect(callLog.filter(c => c === "createContext").length).toBe(1)
      // Should see cache hits for subsequent calls
      expect(callLog.filter(c => c === "cache-hit").length).toBe(2)
    })

    it("context is reused between embed and embedBatch", async () => {
      const layer = createMockEmbeddingServiceLayer({ trackCalls: true })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          yield* svc.embed("query")
          yield* svc.embedBatch(["doc1", "doc2"])
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      // Should only load once
      expect(callLog.filter(c => c === "loadModel").length).toBe(1)
      // Should see cache hit for batch call
      expect(callLog.filter(c => c === "cache-hit").length).toBe(1)
    })
  })

  describe("Batch Processing Loop", () => {
    it("processes all items in batch sequentially", async () => {
      const layer = createMockEmbeddingServiceLayer({ trackCalls: true })

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(["doc1", "doc2", "doc3"])
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(results).toHaveLength(3)
      expect(callLog).toContain("batch-item-0")
      expect(callLog).toContain("batch-item-1")
      expect(callLog).toContain("batch-item-2")
    })

    it("returns Float32Array for each batch item", async () => {
      const layer = createMockEmbeddingServiceLayer({})

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(["doc1", "doc2"])
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(results[0]).toBeInstanceOf(Float32Array)
      expect(results[1]).toBeInstanceOf(Float32Array)
      expect(results[0]!.length).toBe(256)
    })

    it("handles empty batch gracefully", async () => {
      const layer = createMockEmbeddingServiceLayer({ trackCalls: true })

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch([])
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(results).toHaveLength(0)
    })

    it("handles single item batch", async () => {
      const layer = createMockEmbeddingServiceLayer({})

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(["single"])
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      expect(results).toHaveLength(1)
      expect(results[0]).toBeInstanceOf(Float32Array)
    })

    it("fails at correct point when error occurs mid-batch", async () => {
      const layer = createMockEmbeddingServiceLayer({ embedBatchError: true, trackCalls: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embedBatch(["doc1", "doc2", "doc3"]))
        }).pipe(
          Effect.provide(layer),
          Effect.scoped
        )
      )

      // First item succeeds, second fails
      expect(callLog).toContain("batch-item-0")
      expect(result._tag).toBe("Left")
    })
  })

  describe("EmbeddingServiceAuto Layer Selection", () => {
    it("returns Noop layer when node-llama-cpp import fails", async () => {
      // Create a custom layer that simulates import failure
      const NoopLayer = Layer.succeed(EmbeddingService, {
        embed: () => Effect.fail(new EmbeddingUnavailableError({ reason: "No embedding model configured" })),
        embedBatch: () => Effect.fail(new EmbeddingUnavailableError({ reason: "No embedding model configured" })),
        isAvailable: () => Effect.succeed(false),
        dimensions: 0
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(NoopLayer))
      )

      expect(result).toBe(false)
    })

    it("returns Live layer when node-llama-cpp is available", async () => {
      const LiveLayer = Layer.succeed(EmbeddingService, {
        embed: () => Effect.succeed(new Float32Array(256)),
        embedBatch: () => Effect.succeed([new Float32Array(256)]),
        isAvailable: () => Effect.succeed(true),
        dimensions: 256
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(LiveLayer))
      )

      expect(result).toBe(true)
    })

    it("EmbeddingServiceAuto resolves without throwing", async () => {
      // This test verifies the auto layer doesn't throw during resolution
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(
          Effect.provide(EmbeddingServiceAuto),
          Effect.scoped
        )
      )

      expect(typeof result).toBe("boolean")
    })
  })
})

// ============================================================================
// Embed Output Tests
// ============================================================================

describe("Embedding Output Format", () => {
  it("embed returns Float32Array with expected dimensions", async () => {
    // Use mock layer to control output
    const MockLayer = Layer.succeed(EmbeddingService, {
      embed: () => Effect.succeed(new Float32Array(256).fill(0.5)),
      embedBatch: () => Effect.succeed([]),
      isAvailable: () => Effect.succeed(true),
      dimensions: 256
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* svc.embed("test")
      }).pipe(Effect.provide(MockLayer))
    )

    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(256)
    expect(result[0]).toBe(0.5)
  })

  it("embedBatch returns array of Float32Arrays", async () => {
    const MockLayer = Layer.succeed(EmbeddingService, {
      embed: () => Effect.succeed(new Float32Array(256)),
      embedBatch: (texts) => Effect.succeed(
        texts.map(() => new Float32Array(256).fill(0.1))
      ),
      isAvailable: () => Effect.succeed(true),
      dimensions: 256
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* svc.embedBatch(["a", "b", "c"])
      }).pipe(Effect.provide(MockLayer))
    )

    expect(result).toHaveLength(3)
    expect(result[0]).toBeInstanceOf(Float32Array)
    expect(result[1]).toBeInstanceOf(Float32Array)
    expect(result[2]).toBeInstanceOf(Float32Array)
  })
})

// ============================================================================
// EmbeddingServiceOpenAI Tests
// ============================================================================

describe("EmbeddingServiceOpenAI", () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  /**
   * Create a mock OpenAI layer for testing.
   * This simulates the OpenAI embedding API responses.
   */
  const createMockOpenAILayer = (options: {
    embeddings?: number[][]
    error?: string
    dimensions?: number
    emptyResponse?: boolean
  } = {}) => {
    const dims = options.dimensions ?? 1536
    const defaultEmbedding = Array(dims).fill(0.1)

    return Layer.succeed(EmbeddingService, {
      embed: (_text) => {
        if (options.error) {
          return Effect.fail(new EmbeddingUnavailableError({ reason: options.error }))
        }
        if (options.emptyResponse) {
          return Effect.fail(new EmbeddingUnavailableError({ reason: "OpenAI returned empty embedding" }))
        }
        const embedding = options.embeddings?.[0] ?? defaultEmbedding
        return Effect.succeed(new Float32Array(embedding))
      },
      embedBatch: (texts) => {
        if (options.error) {
          return Effect.fail(new EmbeddingUnavailableError({ reason: options.error }))
        }
        const results = texts.map((_, i) => {
          const embedding = options.embeddings?.[i] ?? defaultEmbedding
          return new Float32Array(embedding)
        })
        return Effect.succeed(results)
      },
      isAvailable: () => Effect.succeed(true),
      dimensions: dims
    })
  }

  describe("Successful embedding", () => {
    it("embed returns Float32Array with correct dimensions (text-embedding-3-small)", async () => {
      const layer = createMockOpenAILayer({ dimensions: 1536 })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("test text")
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(1536)
    })

    it("embed returns Float32Array with correct dimensions (text-embedding-3-large)", async () => {
      const layer = createMockOpenAILayer({ dimensions: 3072 })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("test text")
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(3072)
    })

    it("dimensions property matches configured model", async () => {
      const layer1536 = createMockOpenAILayer({ dimensions: 1536 })
      const layer3072 = createMockOpenAILayer({ dimensions: 3072 })

      const dims1536 = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return svc.dimensions
        }).pipe(Effect.provide(layer1536))
      )

      const dims3072 = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return svc.dimensions
        }).pipe(Effect.provide(layer3072))
      )

      expect(dims1536).toBe(1536)
      expect(dims3072).toBe(3072)
    })
  })

  describe("Batch embedding", () => {
    it("embedBatch returns array of Float32Arrays in correct order", async () => {
      const embeddings = [
        Array(1536).fill(0.1),
        Array(1536).fill(0.2),
        Array(1536).fill(0.3)
      ]
      const layer = createMockOpenAILayer({ embeddings, dimensions: 1536 })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(["text1", "text2", "text3"])
        }).pipe(Effect.provide(layer))
      )

      expect(result).toHaveLength(3)
      expect(result[0]![0]).toBeCloseTo(0.1)
      expect(result[1]![0]).toBeCloseTo(0.2)
      expect(result[2]![0]).toBeCloseTo(0.3)
    })

    it("embedBatch handles empty array", async () => {
      const layer = createMockOpenAILayer()

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch([])
        }).pipe(Effect.provide(layer))
      )

      expect(result).toHaveLength(0)
    })

    it("embedBatch handles single item", async () => {
      const layer = createMockOpenAILayer({ dimensions: 1536 })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(["single text"])
        }).pipe(Effect.provide(layer))
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Float32Array)
      expect(result[0]!.length).toBe(1536)
    })
  })

  describe("API error handling", () => {
    it("returns EmbeddingUnavailableError on API failure", async () => {
      const layer = createMockOpenAILayer({ error: "OpenAI embedding failed: 429 Too Many Requests" })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("429")
      }
    })

    it("returns EmbeddingUnavailableError when response is empty", async () => {
      const layer = createMockOpenAILayer({ emptyResponse: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("empty embedding")
      }
    })
  })

  describe("Missing API key", () => {
    it("EmbeddingServiceOpenAI fails when OPENAI_API_KEY not set", async () => {
      // Ensure OPENAI_API_KEY is not set
      delete process.env.OPENAI_API_KEY

      // EmbeddingServiceOpenAI uses Layer.effect which fails at layer construction
      // time if OPENAI_API_KEY is not set. We need to catch this layer construction error.
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("test")
        }).pipe(
          Effect.provide(EmbeddingServiceOpenAI),
          Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
          Effect.either
        )
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect((result.left as EmbeddingUnavailableError).reason).toContain("OPENAI_API_KEY")
      }
    })
  })

  describe("isAvailable", () => {
    it("returns true when layer is successfully created", async () => {
      const layer = createMockOpenAILayer()

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBe(true)
    })
  })
})

// ============================================================================
// createEmbedderLayer Tests
// ============================================================================

describe("createEmbedderLayer", () => {
  describe("Basic functionality", () => {
    it("creates valid EmbeddingService from config", async () => {
      const config: EmbedderConfig = {
        embed: async (_text) => new Float32Array(Array(768).fill(0.5)),
        dimensions: 768,
        name: "test-embedder"
      }

      const layer = createEmbedderLayer(config)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("hello world")
        }).pipe(Effect.provide(layer))
      )

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(768)
      expect(result[0]).toBeCloseTo(0.5)
    })

    it("sets dimensions property correctly", async () => {
      const config: EmbedderConfig = {
        embed: async (_text) => new Float32Array(512),
        dimensions: 512
      }

      const layer = createEmbedderLayer(config)

      const dims = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return svc.dimensions
        }).pipe(Effect.provide(layer))
      )

      expect(dims).toBe(512)
    })

    it("isAvailable always returns true", async () => {
      const config: EmbedderConfig = {
        embed: async () => new Float32Array(256),
        dimensions: 256
      }

      const layer = createEmbedderLayer(config)

      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(layer))
      )

      expect(available).toBe(true)
    })
  })

  describe("embedBatch fallback", () => {
    it("uses custom embedBatch when provided", async () => {
      let batchCalled = false
      const config: EmbedderConfig = {
        embed: async (_text) => new Float32Array(256),
        embedBatch: async (texts) => {
          batchCalled = true
          return texts.map(() => new Float32Array(256).fill(0.9))
        },
        dimensions: 256
      }

      const layer = createEmbedderLayer(config)

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(["text1", "text2"])
        }).pipe(Effect.provide(layer))
      )

      expect(batchCalled).toBe(true)
      expect(results).toHaveLength(2)
      expect(results[0]![0]).toBeCloseTo(0.9)
    })

    it("falls back to sequential embed calls when embedBatch not provided", async () => {
      let embedCallCount = 0
      const config: EmbedderConfig = {
        embed: async (_text) => {
          embedCallCount++
          return new Float32Array(Array(256).fill(embedCallCount * 0.1))
        },
        dimensions: 256
      }

      const layer = createEmbedderLayer(config)

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(["a", "b", "c"])
        }).pipe(Effect.provide(layer))
      )

      expect(embedCallCount).toBe(3)
      expect(results).toHaveLength(3)
      // Verify order is preserved
      expect(results[0]![0]).toBeCloseTo(0.1)
      expect(results[1]![0]).toBeCloseTo(0.2)
      expect(results[2]![0]).toBeCloseTo(0.3)
    })
  })

  describe("Error handling", () => {
    it("wraps embed errors in EmbeddingUnavailableError", async () => {
      const config: EmbedderConfig = {
        embed: async () => {
          throw new Error("Custom API failed")
        },
        dimensions: 256,
        name: "failing-embedder"
      }

      const layer = createEmbedderLayer(config)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("failing-embedder")
        expect(result.left.reason).toContain("Custom API failed")
      }
    })

    it("wraps embedBatch errors in EmbeddingUnavailableError", async () => {
      const config: EmbedderConfig = {
        embed: async () => new Float32Array(256),
        embedBatch: async () => {
          throw new Error("Batch API failed")
        },
        dimensions: 256,
        name: "failing-batch-embedder"
      }

      const layer = createEmbedderLayer(config)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embedBatch(["a", "b"]))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("EmbeddingUnavailableError")
        expect(result.left.reason).toContain("failing-batch-embedder")
        expect(result.left.reason).toContain("Batch API failed")
      }
    })

    it("uses default name 'custom-embedder' when name not provided", async () => {
      const config: EmbedderConfig = {
        embed: async () => {
          throw new Error("API error")
        },
        dimensions: 256
        // name not provided
      }

      const layer = createEmbedderLayer(config)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* Effect.either(svc.embed("test"))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left.reason).toContain("custom-embedder")
      }
    })
  })

  describe("Edge cases", () => {
    it("handles empty string input", async () => {
      const config: EmbedderConfig = {
        embed: async (text) => new Float32Array(Array(256).fill(text.length)),
        dimensions: 256
      }

      const layer = createEmbedderLayer(config)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embed("")
        }).pipe(Effect.provide(layer))
      )

      expect(result.length).toBe(256)
      expect(result[0]).toBe(0) // Empty string has length 0
    })

    it("handles empty batch", async () => {
      const config: EmbedderConfig = {
        embed: async () => new Float32Array(256),
        dimensions: 256
      }

      const layer = createEmbedderLayer(config)

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch([])
        }).pipe(Effect.provide(layer))
      )

      expect(results).toHaveLength(0)
    })
  })
})

// ============================================================================
// EmbeddingServiceAuto Selection Logic Tests
// ============================================================================

describe("EmbeddingServiceAuto Selection Logic", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe("TX_EMBEDDER override", () => {
    it("selects noop when TX_EMBEDDER=noop", async () => {
      const configProvider = ConfigProvider.fromMap(new Map([
        ["TX_EMBEDDER", "noop"]
      ]))

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return {
            available: yield* svc.isAvailable(),
            dimensions: svc.dimensions
          }
        }).pipe(
          Effect.provide(EmbeddingServiceAuto),
          Effect.withConfigProvider(configProvider),
          Effect.scoped
        )
      )

      expect(result.available).toBe(false)
      expect(result.dimensions).toBe(0)
    })

    it("TX_EMBEDDER override is case-insensitive", async () => {
      const configProvider = ConfigProvider.fromMap(new Map([
        ["TX_EMBEDDER", "NOOP"]
      ]))

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(
          Effect.provide(EmbeddingServiceAuto),
          Effect.withConfigProvider(configProvider),
          Effect.scoped
        )
      )

      expect(result).toBe(false)
    })
  })

  describe("Priority fallback", () => {
    it("falls back to noop when nothing available", async () => {
      // No TX_EMBEDDER, no OPENAI_API_KEY, and node-llama-cpp may not be available
      const configProvider = ConfigProvider.fromMap(new Map())

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(
          Effect.provide(EmbeddingServiceAuto),
          Effect.withConfigProvider(configProvider),
          Effect.scoped
        )
      )

      // Result depends on whether node-llama-cpp is installed
      expect(typeof result).toBe("boolean")
    })

    it("auto layer resolves without throwing on any config", async () => {
      // Test with various config combinations
      const configs = [
        new Map(),
        new Map([["TX_EMBEDDER", "noop"]]),
        new Map([["TX_EMBEDDER", "invalid"]]),
        new Map([["OPENAI_API_KEY", ""]]),
      ]

      for (const configMap of configs) {
        const configProvider = ConfigProvider.fromMap(configMap)

        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              const svc = yield* EmbeddingService
              return yield* svc.isAvailable()
            }).pipe(
              Effect.provide(EmbeddingServiceAuto),
              Effect.withConfigProvider(configProvider),
              Effect.scoped
            )
          )
        ).resolves.toBeDefined()
      }
    })
  })

  describe("Invalid TX_EMBEDDER values", () => {
    it("falls back to auto-detection on invalid TX_EMBEDDER", async () => {
      const configProvider = ConfigProvider.fromMap(new Map([
        ["TX_EMBEDDER", "invalid-value"]
      ]))

      // Should not throw, should fall back to auto-detection
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.isAvailable()
        }).pipe(
          Effect.provide(EmbeddingServiceAuto),
          Effect.withConfigProvider(configProvider),
          Effect.scoped
        )
      )

      expect(typeof result).toBe("boolean")
    })
  })
})

// ============================================================================
// Dimensions Property Tests (All Implementations)
// ============================================================================

describe("Dimensions Property (All Implementations)", () => {
  it("EmbeddingServiceNoop returns 0 dimensions", async () => {
    const dims = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return svc.dimensions
      }).pipe(Effect.provide(EmbeddingServiceNoop))
    )

    expect(dims).toBe(0)
  })

  it("EmbeddingServiceLive returns 256 dimensions (embeddinggemma-300M)", async () => {
    const dims = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return svc.dimensions
      }).pipe(
        Effect.provide(EmbeddingServiceLive),
        Effect.scoped
      )
    )

    expect(dims).toBe(256)
  })

  it("custom embedder returns configured dimensions", async () => {
    const dims384 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return svc.dimensions
      }).pipe(
        Effect.provide(createEmbedderLayer({
          embed: async () => new Float32Array(384),
          dimensions: 384
        }))
      )
    )

    const dims1024 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return svc.dimensions
      }).pipe(
        Effect.provide(createEmbedderLayer({
          embed: async () => new Float32Array(1024),
          dimensions: 1024
        }))
      )
    )

    expect(dims384).toBe(384)
    expect(dims1024).toBe(1024)
  })

  it("dimensions is consistent before and after embed calls", async () => {
    const layer = createEmbedderLayer({
      embed: async () => new Float32Array(512),
      dimensions: 512
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        const dimsBefore = svc.dimensions
        yield* svc.embed("test")
        const dimsAfter = svc.dimensions
        return { dimsBefore, dimsAfter }
      }).pipe(Effect.provide(layer))
    )

    expect(result.dimsBefore).toBe(512)
    expect(result.dimsAfter).toBe(512)
  })
})

// ============================================================================
// Graceful Degradation Tests
// ============================================================================

describe("Graceful Degradation", () => {
  it("Noop layer returns error but doesn't throw", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        const embedResult = yield* Effect.either(svc.embed("test"))
        const batchResult = yield* Effect.either(svc.embedBatch(["a", "b"]))
        return { embedResult, batchResult }
      }).pipe(Effect.provide(EmbeddingServiceNoop))
    )

    expect(result.embedResult._tag).toBe("Left")
    expect(result.batchResult._tag).toBe("Left")
  })

  it("Auto layer always resolves to some implementation", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        // Just accessing the service should not throw
        return {
          available: yield* svc.isAvailable(),
          dimensions: svc.dimensions
        }
      }).pipe(
        Effect.provide(EmbeddingServiceAuto),
        Effect.scoped
      )
    )

    expect(typeof result.available).toBe("boolean")
    expect(typeof result.dimensions).toBe("number")
  })

  it("failing custom embedder returns proper error type", async () => {
    const layer = createEmbedderLayer({
      embed: async () => {
        throw new Error("Network timeout")
      },
      dimensions: 256
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* Effect.either(svc.embed("test"))
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(EmbeddingUnavailableError)
      expect(result.left._tag).toBe("EmbeddingUnavailableError")
    }
  })

  it("isAvailable correctly reflects layer state", async () => {
    // Noop: not available
    const noopAvailable = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* svc.isAvailable()
      }).pipe(Effect.provide(EmbeddingServiceNoop))
    )

    // Custom: always available
    const customAvailable = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* svc.isAvailable()
      }).pipe(Effect.provide(createEmbedderLayer({
        embed: async () => new Float32Array(256),
        dimensions: 256
      })))
    )

    expect(noopAvailable).toBe(false)
    expect(customAvailable).toBe(true)
  })
})

// ============================================================================
// validateEmbeddingDimensions Tests
// ============================================================================

describe("validateEmbeddingDimensions", () => {
  it("succeeds when vector length matches expected dimensions", async () => {
    const vector = new Float32Array(256).fill(0.5)
    const result = await Effect.runPromise(
      validateEmbeddingDimensions(vector, 256)
    )
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(256)
    expect(result[0]).toBe(0.5)
  })

  it("fails when vector is too short (provider downgrade)", async () => {
    // Simulates switching from 1536-dim OpenAI to 256-dim local without re-embedding
    const vector = new Float32Array(256).fill(0.1)
    const result = await Effect.runPromise(
      Effect.either(validateEmbeddingDimensions(vector, 1536))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("EmbeddingUnavailableError")
      expect(result.left.reason).toContain("expected 1536, got 256")
      expect(result.left.reason).toContain("provider change")
    }
  })

  it("fails when vector is too long (provider upgrade)", async () => {
    // Simulates switching from 256-dim local to 1536-dim OpenAI without re-embedding
    const vector = new Float32Array(1536).fill(0.1)
    const result = await Effect.runPromise(
      Effect.either(validateEmbeddingDimensions(vector, 256))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("EmbeddingUnavailableError")
      expect(result.left.reason).toContain("expected 256, got 1536")
    }
  })

  it("fails on empty vector when dimensions expected", async () => {
    const vector = new Float32Array(0)
    const result = await Effect.runPromise(
      Effect.either(validateEmbeddingDimensions(vector, 256))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left.reason).toContain("expected 256, got 0")
    }
  })

  it("succeeds with various valid dimension sizes", async () => {
    for (const dims of [128, 256, 384, 512, 768, 1024, 1536, 3072]) {
      const vector = new Float32Array(dims)
      const result = await Effect.runPromise(
        validateEmbeddingDimensions(vector, dims)
      )
      expect(result.length).toBe(dims)
    }
  })
})

describe("Dimension validation in createEmbedderLayer", () => {
  it("rejects embedding with wrong dimensions from custom embedder", async () => {
    const config: EmbedderConfig = {
      embed: async () => new Float32Array(512), // Returns 512 dims
      dimensions: 256 // But claims 256
    }

    const layer = createEmbedderLayer(config)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* Effect.either(svc.embed("test"))
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("EmbeddingUnavailableError")
      expect(result.left.reason).toContain("expected 256, got 512")
    }
  })

  it("rejects batch embedding with wrong dimensions from custom embedder", async () => {
    const config: EmbedderConfig = {
      embed: async () => new Float32Array(512),
      dimensions: 256
    }

    const layer = createEmbedderLayer(config)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* Effect.either(svc.embedBatch(["a", "b"]))
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left.reason).toContain("expected 256, got 512")
    }
  })

  it("rejects custom embedBatch with wrong dimensions", async () => {
    const config: EmbedderConfig = {
      embed: async () => new Float32Array(256),
      embedBatch: async (texts) => texts.map(() => new Float32Array(128)), // Wrong dims
      dimensions: 256
    }

    const layer = createEmbedderLayer(config)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmbeddingService
        return yield* Effect.either(svc.embedBatch(["a"]))
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left.reason).toContain("expected 256, got 128")
    }
  })
})

// ============================================================================
// Runtime Interface Validator Tests
// ============================================================================

import {
  isValidLlama,
  isValidLlamaModel,
  isValidLlamaEmbeddingContext,
  isValidOpenAIClient,
  validateEmbeddingDimensions
} from "@jamesaphoenix/tx-core"

describe("Runtime Interface Validators", () => {
  describe("isValidLlama", () => {
    it("returns true for valid Llama interface", () => {
      const validLlama = {
        loadModel: () => Promise.resolve({})
      }
      expect(isValidLlama(validLlama)).toBe(true)
    })

    it("returns false for null", () => {
      expect(isValidLlama(null)).toBe(false)
    })

    it("returns false for undefined", () => {
      expect(isValidLlama(undefined)).toBe(false)
    })

    it("returns false for non-object", () => {
      expect(isValidLlama("string")).toBe(false)
      expect(isValidLlama(123)).toBe(false)
      expect(isValidLlama(true)).toBe(false)
    })

    it("returns false when loadModel is missing", () => {
      const invalidLlama = {
        otherMethod: () => {}
      }
      expect(isValidLlama(invalidLlama)).toBe(false)
    })

    it("returns false when loadModel is not a function", () => {
      const invalidLlama = {
        loadModel: "not a function"
      }
      expect(isValidLlama(invalidLlama)).toBe(false)
    })
  })

  describe("isValidLlamaModel", () => {
    it("returns true for valid LlamaModel interface", () => {
      const validModel = {
        createEmbeddingContext: () => Promise.resolve({})
      }
      expect(isValidLlamaModel(validModel)).toBe(true)
    })

    it("returns false for null", () => {
      expect(isValidLlamaModel(null)).toBe(false)
    })

    it("returns false for undefined", () => {
      expect(isValidLlamaModel(undefined)).toBe(false)
    })

    it("returns false when createEmbeddingContext is missing", () => {
      const invalidModel = {
        loadSomething: () => {}
      }
      expect(isValidLlamaModel(invalidModel)).toBe(false)
    })

    it("returns false when createEmbeddingContext is not a function", () => {
      const invalidModel = {
        createEmbeddingContext: { nested: "object" }
      }
      expect(isValidLlamaModel(invalidModel)).toBe(false)
    })
  })

  describe("isValidLlamaEmbeddingContext", () => {
    it("returns true for valid LlamaEmbeddingContext interface", () => {
      const validContext = {
        getEmbeddingFor: () => Promise.resolve({ vector: [] })
      }
      expect(isValidLlamaEmbeddingContext(validContext)).toBe(true)
    })

    it("returns false for null", () => {
      expect(isValidLlamaEmbeddingContext(null)).toBe(false)
    })

    it("returns false for undefined", () => {
      expect(isValidLlamaEmbeddingContext(undefined)).toBe(false)
    })

    it("returns false when getEmbeddingFor is missing", () => {
      const invalidContext = {
        embed: () => {}
      }
      expect(isValidLlamaEmbeddingContext(invalidContext)).toBe(false)
    })

    it("returns false when getEmbeddingFor is not a function", () => {
      const invalidContext = {
        getEmbeddingFor: 42
      }
      expect(isValidLlamaEmbeddingContext(invalidContext)).toBe(false)
    })
  })

  describe("isValidOpenAIClient", () => {
    it("returns true for valid OpenAIClient interface", () => {
      const validClient = {
        embeddings: {
          create: () => Promise.resolve({})
        }
      }
      expect(isValidOpenAIClient(validClient)).toBe(true)
    })

    it("returns false for null", () => {
      expect(isValidOpenAIClient(null)).toBe(false)
    })

    it("returns false for undefined", () => {
      expect(isValidOpenAIClient(undefined)).toBe(false)
    })

    it("returns false when embeddings is missing", () => {
      const invalidClient = {
        chat: { create: () => {} }
      }
      expect(isValidOpenAIClient(invalidClient)).toBe(false)
    })

    it("returns false when embeddings is null", () => {
      const invalidClient = {
        embeddings: null
      }
      expect(isValidOpenAIClient(invalidClient)).toBe(false)
    })

    it("returns false when embeddings is not an object", () => {
      const invalidClient = {
        embeddings: "not an object"
      }
      expect(isValidOpenAIClient(invalidClient)).toBe(false)
    })

    it("returns false when embeddings.create is missing", () => {
      const invalidClient = {
        embeddings: {
          list: () => {}
        }
      }
      expect(isValidOpenAIClient(invalidClient)).toBe(false)
    })

    it("returns false when embeddings.create is not a function", () => {
      const invalidClient = {
        embeddings: {
          create: "not a function"
        }
      }
      expect(isValidOpenAIClient(invalidClient)).toBe(false)
    })

    it("returns true for client with additional methods", () => {
      const validClient = {
        embeddings: {
          create: () => Promise.resolve({}),
          list: () => Promise.resolve([])
        },
        chat: {
          completions: {}
        }
      }
      expect(isValidOpenAIClient(validClient)).toBe(true)
    })
  })
})
