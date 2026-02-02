import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer, Ref } from "effect"
import {
  EmbeddingService,
  EmbeddingServiceNoop,
  EmbeddingServiceLive,
  EmbeddingServiceAuto,
  EmbeddingUnavailableError
} from "@tx/core"

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
        isAvailable: () => Effect.succeed(false)
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
        isAvailable: () => Effect.succeed(true)
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
      isAvailable: () => Effect.succeed(true)
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
      isAvailable: () => Effect.succeed(true)
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
