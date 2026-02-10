import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import {
  CandidateExtractorService,
  CandidateExtractorServiceNoop,
  CandidateExtractorServiceLive,
  CandidateExtractorServiceAuto,
  LlmServiceNoop,
  LlmServiceAuto,
} from "@jamesaphoenix/tx-core"
import type { TranscriptChunk } from "@jamesaphoenix/tx-types"

describe("CandidateExtractorService", () => {
  describe("CandidateExtractorServiceNoop", () => {
    const sampleChunk = {
      content: "User asked about database optimization. We decided to add indexes.",
      sourceFile: "~/.claude/projects/test/session.jsonl"
    }

    it("returns empty candidates array", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(CandidateExtractorServiceNoop))
      )

      expect(result.candidates).toEqual([])
      expect(result.sourceChunk).toEqual(sampleChunk)
      expect(result.wasExtracted).toBe(false)
    })

    it("isAvailable returns false", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(CandidateExtractorServiceNoop))
      )

      expect(available).toBe(false)
    })

    it("preserves source chunk in result", async () => {
      const chunkWithMetadata = {
        content: "Some transcript content here",
        sourceFile: "~/.claude/projects/myapp/session-123.jsonl",
        sourceRunId: "run-abc123",
        sourceTaskId: "tx-def456",
        byteOffset: 1024,
        lineRange: { start: 10, end: 50 }
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(chunkWithMetadata)
        }).pipe(Effect.provide(CandidateExtractorServiceNoop))
      )

      expect(result.sourceChunk).toEqual(chunkWithMetadata)
      expect(result.sourceChunk.sourceRunId).toBe("run-abc123")
      expect(result.sourceChunk.sourceTaskId).toBe("tx-def456")
      expect(result.sourceChunk.byteOffset).toBe(1024)
      expect(result.sourceChunk.lineRange).toEqual({ start: 10, end: 50 })
    })

    it("handles empty content", async () => {
      const emptyChunk = {
        content: "",
        sourceFile: "~/.claude/projects/test/empty.jsonl"
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(emptyChunk)
        }).pipe(Effect.provide(CandidateExtractorServiceNoop))
      )

      expect(result.candidates).toEqual([])
      expect(result.wasExtracted).toBe(false)
    })

    it("handles content with special characters", async () => {
      const specialChunk = {
        content: "Fix bug: @#$%^&*() in <tag> with \"quotes\"",
        sourceFile: "~/.claude/projects/test/special.jsonl"
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(specialChunk)
        }).pipe(Effect.provide(CandidateExtractorServiceNoop))
      )

      expect(result.sourceChunk.content).toBe("Fix bug: @#$%^&*() in <tag> with \"quotes\"")
      expect(result.wasExtracted).toBe(false)
    })

    it("handles very large content", async () => {
      const largeContent = "x".repeat(100000)
      const largeChunk = {
        content: largeContent,
        sourceFile: "~/.claude/projects/test/large.jsonl"
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(largeChunk)
        }).pipe(Effect.provide(CandidateExtractorServiceNoop))
      )

      expect(result.candidates).toEqual([])
      expect(result.sourceChunk.content.length).toBe(100000)
    })
  })

  describe("CandidateExtractorServiceAuto", () => {
    it("uses Noop when LlmService is not available", async () => {
      // Auto should fall back to Noop when LlmService reports unavailable
      const layer = CandidateExtractorServiceAuto.pipe(Layer.provide(LlmServiceNoop))
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract({
            content: "Test transcript content",
            sourceFile: "~/.claude/projects/test/auto.jsonl"
          })
        }).pipe(Effect.provide(layer))
      )

      // With noop LlmService, should behave like Noop
      expect(result.candidates).toEqual([])
      expect(result.wasExtracted).toBe(false)
    })

    it("isAvailable returns false when LlmService is noop", async () => {
      const layer = CandidateExtractorServiceAuto.pipe(Layer.provide(LlmServiceNoop))
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(layer))
      )

      expect(available).toBe(false)
    })
  })
})

describe("ExtractionResult interface", () => {
  it("has correct structure from Noop service", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract({
          content: "Sample transcript",
          sourceFile: "~/.claude/test.jsonl"
        })
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    // Verify all required fields are present
    expect(result).toHaveProperty("candidates")
    expect(result).toHaveProperty("sourceChunk")
    expect(result).toHaveProperty("wasExtracted")

    // Verify types
    expect(Array.isArray(result.candidates)).toBe(true)
    expect(typeof result.sourceChunk).toBe("object")
    expect(typeof result.wasExtracted).toBe("boolean")

    // Source chunk should have required fields
    expect(result.sourceChunk).toHaveProperty("content")
    expect(result.sourceChunk).toHaveProperty("sourceFile")
  })

  it("metadata is optional", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract({
          content: "Sample transcript",
          sourceFile: "~/.claude/test.jsonl"
        })
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    // Noop doesn't include metadata
    expect(result.metadata).toBeUndefined()
  })
})

describe("Candidate extraction graceful degradation", () => {
  it("extraction results can be used in downstream pipeline", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        const extraction = yield* svc.extract({
          content: "User discussion about patterns",
          sourceFile: "~/.claude/session.jsonl"
        })

        // Verify the result can be used in a promotion pipeline
        // Even with noop, candidates array exists and can be iterated
        expect(extraction.candidates).toBeDefined()
        expect(Array.isArray(extraction.candidates)).toBe(true)

        // Can check wasExtracted to decide promotion logic
        if (!extraction.wasExtracted) {
          // Queue for later processing when LLM becomes available
          return { queued: true, extraction }
        }

        return { queued: false, extraction }
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(result.queued).toBe(true)
    expect(result.extraction.sourceChunk.sourceFile).toBe("~/.claude/session.jsonl")
  })

  it("handles null/undefined optional fields gracefully", async () => {
    const minimalChunk = {
      content: "Minimal content",
      sourceFile: "~/.claude/minimal.jsonl",
      sourceRunId: null,
      sourceTaskId: undefined
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract(minimalChunk)
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(result.sourceChunk.sourceRunId).toBeNull()
    expect(result.sourceChunk.sourceTaskId).toBeUndefined()
  })
})

describe("Multiple extractions", () => {
  it("can extract from multiple chunks sequentially", async () => {
    const chunks = [
      { content: "Chunk 1", sourceFile: "~/.claude/1.jsonl" },
      { content: "Chunk 2", sourceFile: "~/.claude/2.jsonl" },
      { content: "Chunk 3", sourceFile: "~/.claude/3.jsonl" }
    ]

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        const result1 = yield* svc.extract(chunks[0])
        const result2 = yield* svc.extract(chunks[1])
        const result3 = yield* svc.extract(chunks[2])
        return [result1, result2, result3]
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(results).toHaveLength(3)
    expect(results[0].sourceChunk.sourceFile).toBe("~/.claude/1.jsonl")
    expect(results[1].sourceChunk.sourceFile).toBe("~/.claude/2.jsonl")
    expect(results[2].sourceChunk.sourceFile).toBe("~/.claude/3.jsonl")
  })

  it("can extract from multiple chunks in parallel", async () => {
    const chunks = [
      { content: "Parallel 1", sourceFile: "~/.claude/p1.jsonl" },
      { content: "Parallel 2", sourceFile: "~/.claude/p2.jsonl" },
      { content: "Parallel 3", sourceFile: "~/.claude/p3.jsonl" }
    ]

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* Effect.all(
          chunks.map(chunk => svc.extract(chunk)),
          { concurrency: "unbounded" }
        )
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(results).toHaveLength(3)
    // All should complete without interference
    results.forEach((result) => {
      expect(result.candidates).toEqual([])
      expect(result.wasExtracted).toBe(false)
    })
  })
})

// ============================================================================
// CandidateExtractorServiceLive — Real LlmService integration tests
// ============================================================================

// Check if a real LLM backend is available
const llmAvailable = await (async () => {
  try {
    await import("@anthropic-ai/claude-agent-sdk")
    return true
  } catch {
    return !!process.env.ANTHROPIC_API_KEY
  }
})()

describe.skipIf(!llmAvailable)("CandidateExtractorServiceLive (real LlmService)", () => {
  const sampleChunk: TranscriptChunk = {
    content: `User asked Claude to fix a database connection timeout issue.
Claude investigated and found the connection pool was exhausted because connections weren't being released after transactions.
The fix was to add proper try/finally blocks around all transaction code to ensure connections are always returned to the pool.
Claude also added a connection pool health check endpoint.`,
    sourceFile: "~/.claude/projects/test/session-real.jsonl"
  }

  // CandidateExtractorServiceLive depends on LlmService
  const layer = CandidateExtractorServiceLive.pipe(Layer.provide(LlmServiceAuto))

  it("extracts candidates from a real transcript", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract(sampleChunk)
      }).pipe(Effect.provide(layer))
    )

    expect(result.wasExtracted).toBe(true)
    expect(result.sourceChunk).toEqual(sampleChunk)
    // Real LLM should extract at least one learning from this transcript
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.length).toBeLessThanOrEqual(5)

    // Validate candidate structure
    for (const candidate of result.candidates) {
      expect(typeof candidate.content).toBe("string")
      expect(candidate.content.length).toBeGreaterThan(10)
      expect(["high", "medium", "low"]).toContain(candidate.confidence)
      expect(["architecture", "testing", "performance", "security", "debugging", "tooling", "patterns", "other"]).toContain(candidate.category)
    }
  }, 60_000)

  it("handles short transcript with few learnings", async () => {
    const shortChunk: TranscriptChunk = {
      content: "User: Hello. Claude: Hi, how can I help?",
      sourceFile: "~/.claude/projects/test/short.jsonl"
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract(shortChunk)
      }).pipe(Effect.provide(layer))
    )

    expect(result.wasExtracted).toBe(true)
    // Short, generic conversation should yield few or no learnings
    expect(result.candidates.length).toBeLessThanOrEqual(5)
  }, 30_000)

  it("isAvailable returns true with real LlmService", async () => {
    const available = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.isAvailable()
      }).pipe(Effect.provide(layer))
    )

    expect(available).toBe(true)
  })

  it("includes metadata in extraction result", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract(sampleChunk)
      }).pipe(Effect.provide(layer))
    )

    expect(result.metadata).toBeDefined()
    expect(typeof result.metadata?.model).toBe("string")
    expect(typeof result.metadata?.durationMs).toBe("number")
    if (result.metadata?.durationMs !== undefined) {
      expect(result.metadata.durationMs).toBeGreaterThan(0)
    }
  }, 60_000)
})
