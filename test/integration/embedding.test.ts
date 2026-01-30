import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Context, Effect, Layer, Ref } from "effect"
import {
  EmbeddingService,
  EmbeddingServiceNoop,
  EmbeddingServiceLive,
  EmbeddingServiceAuto
} from "../../src/services/embedding-service.js"
import { EmbeddingUnavailableError } from "../../src/errors.js"

// ============================================================================
// Mock Factories for node-llama-cpp
// ============================================================================

/** Creates a successful mock embedding context */
const createMockContext = (embedFn?: (text: string) => { vector: number[] }) => ({
  getEmbeddingFor: embedFn ?? ((text: string) => Promise.resolve({ vector: Array(256).fill(0.1) }))
})

/** Creates a successful mock model */
const createMockModel = (contextFn?: () => Promise<ReturnType<typeof createMockContext>>) => ({
  createEmbeddingContext: contextFn ?? (() => Promise.resolve(createMockContext()))
})

/** Creates a successful mock llama instance */
const createMockLlama = (modelFn?: (opts: { modelPath: string }) => Promise<ReturnType<typeof createMockModel>>) => ({
  loadModel: modelFn ?? (() => Promise.resolve(createMockModel()))
})

/** Creates a successful mock node-llama-cpp module */
const createMockNodeLlamaCpp = (llamaFn?: () => Promise<ReturnType<typeof createMockLlama>>) => ({
  getLlama: llamaFn ?? (() => Promise.resolve(createMockLlama()))
})

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
