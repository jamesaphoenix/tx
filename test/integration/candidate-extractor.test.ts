import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import {
  CandidateExtractorService,
  CandidateExtractorServiceNoop,
  CandidateExtractorServiceAuto,
  ExtractionUnavailableError
} from "@tx/core"
import type { TranscriptChunk, ExtractedCandidate } from "@tx/types"
import {
  createMockAnthropic,
  createMockAnthropicForExtraction,
  createMockOpenAI,
  createMockOpenAIForExtraction,
  createMockOpenAIForExtractionRaw,
  type MockAnthropicResult,
  type MockOpenAIResult
} from "@tx/test-utils"

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
    it("uses Noop when no API keys are set", async () => {
      // Auto should fall back to Noop when no API keys are configured
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract({
            content: "Test transcript content",
            sourceFile: "~/.claude/projects/test/auto.jsonl"
          })
        }).pipe(Effect.provide(CandidateExtractorServiceAuto))
      )

      // Without API keys, should behave like Noop
      expect(result.candidates).toEqual([])
      expect(result.wasExtracted).toBe(false)
    })

    it("isAvailable returns false when no API keys set", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(CandidateExtractorServiceAuto))
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
// Mock-based Tests for CandidateExtractorService Anthropic Implementation
// ============================================================================

describe("CandidateExtractorServiceAnthropic (Mock-based)", () => {
  /**
   * Creates a mock-based CandidateExtractorService layer that mimics
   * the Anthropic implementation for testing.
   */
  const createMockAnthropicLayer = (options: {
    mock?: MockAnthropicResult
    candidates?: Array<{ content: string; confidence: string; category: string }>
    error?: string
    apiError?: boolean
    emptyResponse?: boolean
    noTextContent?: boolean
    invalidJson?: boolean
  } = {}) => {
    // Create the mock client
    const mockResult = options.mock ||
      (options.candidates
        ? createMockAnthropicForExtraction(options.candidates)
        : createMockAnthropic({
            shouldFail: options.apiError,
            failureMessage: options.error || "Mock API error",
            defaultResponse: options.emptyResponse
              ? {
                  id: "mock-empty",
                  type: "message",
                  role: "assistant",
                  content: [],
                  model: "claude-haiku-4-20250514",
                  usage: { input_tokens: 10, output_tokens: 5 }
                }
              : options.noTextContent
                ? {
                    id: "mock-no-text",
                    type: "message",
                    role: "assistant",
                    content: [{ type: "image", text: undefined }],
                    model: "claude-haiku-4-20250514",
                    usage: { input_tokens: 10, output_tokens: 5 }
                  }
                : options.invalidJson
                  ? {
                      id: "mock-invalid",
                      type: "message",
                      role: "assistant",
                      content: [{ type: "text", text: "not valid json at all" }],
                      model: "claude-haiku-4-20250514",
                      usage: { input_tokens: 10, output_tokens: 5 }
                    }
                  : undefined
          }))

    return {
      layer: Layer.succeed(CandidateExtractorService, {
        extract: (chunk: TranscriptChunk) =>
          Effect.gen(function* () {
            const startTime = Date.now()

            // Call the mock client
            const response = yield* Effect.tryPromise({
              try: () => mockResult.client.messages.create({
                model: "claude-haiku-4-20250514",
                max_tokens: 1024,
                messages: [{
                  role: "user",
                  content: `Extract learnings from: ${chunk.content}`
                }]
              }),
              catch: (e) => new ExtractionUnavailableError({
                reason: `Anthropic API call failed: ${String(e)}`
              })
            })

            // Extract text from response
            const textContent = response.content.find((c: { type: string; text?: string }) => c.type === "text")
            if (!textContent || !textContent.text) {
              return {
                candidates: [],
                sourceChunk: chunk,
                wasExtracted: true,
                metadata: {
                  model: "claude-haiku-4-20250514",
                  tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
                  durationMs: Date.now() - startTime
                }
              }
            }

            // Parse JSON
            const parsed = parseLlmJson(textContent.text)
            const rawCandidates = Array.isArray(parsed) ? parsed : []

            // Validate candidates
            const candidates: ExtractedCandidate[] = rawCandidates
              .map(validateCandidate)
              .filter((c): c is ExtractedCandidate => c !== null)
              .slice(0, 5)

            return {
              candidates,
              sourceChunk: chunk,
              wasExtracted: true,
              metadata: {
                model: "claude-haiku-4-20250514",
                tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
                durationMs: Date.now() - startTime
              }
            }
          }),
        isAvailable: () => Effect.succeed(true)
      }),
      mock: mockResult
    }
  }

  // Helper to parse LLM JSON (simplified version)
  const parseLlmJson = <T>(raw: string): T | null => {
    try { return JSON.parse(raw) } catch { /* continue */ }

    // Strip markdown fences
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
    if (fenceMatch && fenceMatch[1]) {
      try { return JSON.parse(fenceMatch[1].trim()) } catch { /* continue */ }
    }

    // Find first [ or {
    const jsonStart = raw.search(/[[{]/)
    if (jsonStart >= 0) {
      try { return JSON.parse(raw.slice(jsonStart)) } catch { /* continue */ }
    }

    return null
  }

  // Helper to validate candidate
  const validateCandidate = (raw: unknown): ExtractedCandidate | null => {
    if (!raw || typeof raw !== "object") return null
    const obj = raw as Record<string, unknown>
    if (typeof obj.content !== "string" || obj.content.trim().length < 10) return null

    const validConfidences = ["high", "medium", "low"]
    const validCategories = ["architecture", "testing", "performance", "security", "debugging", "tooling", "patterns", "other"]

    const confidence = validConfidences.includes(String(obj.confidence).toLowerCase())
      ? String(obj.confidence).toLowerCase() as "high" | "medium" | "low"
      : "medium"
    const category = validCategories.includes(String(obj.category).toLowerCase())
      ? String(obj.category).toLowerCase() as "architecture" | "testing" | "performance" | "security" | "debugging" | "tooling" | "patterns" | "other"
      : "other"

    return { content: obj.content.trim(), confidence, category }
  }

  const sampleChunk: TranscriptChunk = {
    content: "User asked about database optimization. We decided to add indexes.",
    sourceFile: "~/.claude/projects/test/session.jsonl"
  }

  describe("Successful extraction", () => {
    it("extracts candidates from valid JSON array response", async () => {
      const testCandidates = [
        { content: "Always add indexes for frequently queried columns", confidence: "high", category: "performance" },
        { content: "Test database migrations in staging first", confidence: "medium", category: "testing" }
      ]

      const { layer, mock } = createMockAnthropicLayer({ candidates: testCandidates })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates[0]!.content).toBe("Always add indexes for frequently queried columns")
      expect(result.candidates[0]!.confidence).toBe("high")
      expect(result.candidates[0]!.category).toBe("performance")
      expect(result.candidates[1]!.content).toBe("Test database migrations in staging first")
      expect(mock.getCallCount()).toBe(1)
    })

    it("includes metadata with model, tokens, and duration", async () => {
      const { layer } = createMockAnthropicLayer({
        candidates: [{ content: "Always validate user input", confidence: "high", category: "security" }]
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.metadata).toBeDefined()
      expect(result.metadata!.model).toBe("claude-haiku-4-20250514")
      expect(result.metadata!.tokensUsed).toBeGreaterThan(0)
      expect(result.metadata!.durationMs).toBeGreaterThanOrEqual(0)
    })

    it("preserves source chunk in result", async () => {
      const chunkWithMetadata: TranscriptChunk = {
        content: "Some content",
        sourceFile: "~/.claude/test.jsonl",
        sourceRunId: "run-123",
        sourceTaskId: "tx-abc456",
        byteOffset: 1024,
        lineRange: { start: 10, end: 50 }
      }

      const { layer } = createMockAnthropicLayer({ candidates: [] })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(chunkWithMetadata)
        }).pipe(Effect.provide(layer))
      )

      expect(result.sourceChunk).toEqual(chunkWithMetadata)
    })

    it("limits candidates to maximum of 5", async () => {
      const manyCandidates = Array.from({ length: 10 }, (_, i) => ({
        content: `Learning number ${i + 1} with sufficient length`,
        confidence: "medium",
        category: "patterns"
      }))

      const { layer } = createMockAnthropicLayer({ candidates: manyCandidates })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(5)
    })

    it("isAvailable returns true", async () => {
      const { layer } = createMockAnthropicLayer({})

      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(layer))
      )

      expect(available).toBe(true)
    })
  })

  describe("Response parsing", () => {
    it("handles empty content array", async () => {
      const { layer } = createMockAnthropicLayer({ emptyResponse: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toEqual([])
    })

    it("handles response with no text content type", async () => {
      const { layer } = createMockAnthropicLayer({ noTextContent: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toEqual([])
    })

    it("handles invalid JSON response", async () => {
      const { layer } = createMockAnthropicLayer({ invalidJson: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toEqual([])
    })

    it("handles markdown-wrapped JSON", async () => {
      const mock = createMockAnthropic({
        defaultResponse: {
          id: "mock-md",
          type: "message",
          role: "assistant",
          content: [{
            type: "text",
            text: "```json\n[{\"content\": \"Use markdown code blocks\", \"confidence\": \"high\", \"category\": \"patterns\"}]\n```"
          }],
          model: "claude-haiku-4-20250514",
          usage: { input_tokens: 10, output_tokens: 20 }
        }
      })

      const { layer } = createMockAnthropicLayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.content).toBe("Use markdown code blocks")
    })
  })

  describe("Candidate validation", () => {
    it("filters out candidates with short content", async () => {
      const { layer } = createMockAnthropicLayer({
        candidates: [
          { content: "Short", confidence: "high", category: "patterns" },
          { content: "This is a valid learning with sufficient length", confidence: "high", category: "patterns" }
        ]
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.content).toContain("valid learning")
    })

    it("defaults invalid confidence to medium", async () => {
      const mock = createMockAnthropic({
        defaultResponse: {
          id: "mock-invalid-conf",
          type: "message",
          role: "assistant",
          content: [{
            type: "text",
            text: JSON.stringify([{ content: "Learning with invalid confidence level", confidence: "invalid", category: "patterns" }])
          }],
          model: "claude-haiku-4-20250514",
          usage: { input_tokens: 10, output_tokens: 20 }
        }
      })

      const { layer } = createMockAnthropicLayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.confidence).toBe("medium")
    })

    it("defaults invalid category to other", async () => {
      const mock = createMockAnthropic({
        defaultResponse: {
          id: "mock-invalid-cat",
          type: "message",
          role: "assistant",
          content: [{
            type: "text",
            text: JSON.stringify([{ content: "Learning with invalid category type", confidence: "high", category: "invalid" }])
          }],
          model: "claude-haiku-4-20250514",
          usage: { input_tokens: 10, output_tokens: 20 }
        }
      })

      const { layer } = createMockAnthropicLayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.category).toBe("other")
    })
  })

  describe("Error handling", () => {
    it("returns ExtractionUnavailableError on API failure", async () => {
      const { layer } = createMockAnthropicLayer({
        apiError: true,
        error: "Rate limit exceeded"
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* Effect.either(svc.extract(sampleChunk))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ExtractionUnavailableError")
        expect(result.left.reason).toContain("Rate limit exceeded")
      }
    })

    it("wraps network errors in ExtractionUnavailableError", async () => {
      const mock = createMockAnthropic({
        shouldFail: true,
        failureError: new Error("Network connection failed")
      })

      const { layer } = createMockAnthropicLayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* Effect.either(svc.extract(sampleChunk))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ExtractionUnavailableError")
        expect(result.left.reason).toContain("Network connection failed")
      }
    })
  })

  describe("Call tracking", () => {
    it("tracks API calls for debugging", async () => {
      const { layer, mock } = createMockAnthropicLayer({ candidates: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          yield* svc.extract(sampleChunk)
          yield* svc.extract({ content: "Second chunk", sourceFile: "~/.claude/test2.jsonl" })
        }).pipe(Effect.provide(layer))
      )

      expect(mock.getCallCount()).toBe(2)
      expect(mock.getLastCall()?.messages[0]?.content).toContain("Second chunk")
    })

    it("can reset call tracking", async () => {
      const { layer, mock } = createMockAnthropicLayer({ candidates: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(mock.getCallCount()).toBe(1)
      mock.reset()
      expect(mock.getCallCount()).toBe(0)
    })
  })
})

// ============================================================================
// Mock-based Tests for CandidateExtractorService OpenAI Implementation
// ============================================================================

describe("CandidateExtractorServiceOpenAI (Mock-based)", () => {
  /**
   * Creates a mock-based CandidateExtractorService layer that mimics
   * the OpenAI implementation for testing.
   */
  const createMockOpenAILayer = (options: {
    mock?: MockOpenAIResult
    candidates?: Array<{ content: string; confidence: string; category: string }>
    error?: string
    apiError?: boolean
    emptyResponse?: boolean
    nullContent?: boolean
    invalidJson?: boolean
    wrappedResponse?: boolean
  } = {}) => {
    // Create the mock client
    const mockResult = options.mock ||
      (options.candidates
        ? (options.wrappedResponse
            ? createMockOpenAIForExtraction(options.candidates)
            : createMockOpenAIForExtractionRaw(options.candidates))
        : createMockOpenAI({
            shouldFail: options.apiError,
            failureMessage: options.error || "Mock API error",
            defaultResponse: options.emptyResponse
              ? {
                  id: "mock-empty",
                  object: "chat.completion",
                  created: Math.floor(Date.now() / 1000),
                  model: "gpt-4o-mini",
                  choices: [],
                  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                }
              : options.nullContent
                ? {
                    id: "mock-null",
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model: "gpt-4o-mini",
                    choices: [{
                      index: 0,
                      message: { role: "assistant", content: null },
                      finish_reason: "stop"
                    }],
                    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                  }
                : options.invalidJson
                  ? {
                      id: "mock-invalid",
                      object: "chat.completion",
                      created: Math.floor(Date.now() / 1000),
                      model: "gpt-4o-mini",
                      choices: [{
                        index: 0,
                        message: { role: "assistant", content: "not valid json" },
                        finish_reason: "stop"
                      }],
                      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                    }
                  : undefined
          }))

    return {
      layer: Layer.succeed(CandidateExtractorService, {
        extract: (chunk: TranscriptChunk) =>
          Effect.gen(function* () {
            const startTime = Date.now()

            // Call the mock client
            const response = yield* Effect.tryPromise({
              try: () => mockResult.client.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 1024,
                messages: [{
                  role: "user",
                  content: `Extract learnings from: ${chunk.content}`
                }],
                response_format: { type: "json_object" }
              }),
              catch: (e) => new ExtractionUnavailableError({
                reason: `OpenAI API call failed: ${String(e)}`
              })
            })

            // Extract text from response
            const textContent = response.choices[0]?.message?.content
            if (!textContent) {
              return {
                candidates: [],
                sourceChunk: chunk,
                wasExtracted: true,
                metadata: {
                  model: "gpt-4o-mini",
                  tokensUsed: (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
                  durationMs: Date.now() - startTime
                }
              }
            }

            // Parse JSON - handle wrapped response
            const parsed = parseLlmJson(textContent)
            let rawCandidates: unknown[] = []

            if (Array.isArray(parsed)) {
              rawCandidates = parsed
            } else if (parsed && typeof parsed === "object") {
              const obj = parsed as Record<string, unknown>
              const arrayField = Object.values(obj).find(Array.isArray)
              if (arrayField) {
                rawCandidates = arrayField as unknown[]
              }
            }

            // Validate candidates
            const candidates: ExtractedCandidate[] = rawCandidates
              .map(validateCandidate)
              .filter((c): c is ExtractedCandidate => c !== null)
              .slice(0, 5)

            return {
              candidates,
              sourceChunk: chunk,
              wasExtracted: true,
              metadata: {
                model: "gpt-4o-mini",
                tokensUsed: (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
                durationMs: Date.now() - startTime
              }
            }
          }),
        isAvailable: () => Effect.succeed(true)
      }),
      mock: mockResult
    }
  }

  // Helper to parse LLM JSON
  const parseLlmJson = <T>(raw: string): T | null => {
    try { return JSON.parse(raw) } catch { /* continue */ }

    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
    if (fenceMatch && fenceMatch[1]) {
      try { return JSON.parse(fenceMatch[1].trim()) } catch { /* continue */ }
    }

    const jsonStart = raw.search(/[[{]/)
    if (jsonStart >= 0) {
      try { return JSON.parse(raw.slice(jsonStart)) } catch { /* continue */ }
    }

    return null
  }

  // Helper to validate candidate
  const validateCandidate = (raw: unknown): ExtractedCandidate | null => {
    if (!raw || typeof raw !== "object") return null
    const obj = raw as Record<string, unknown>
    if (typeof obj.content !== "string" || obj.content.trim().length < 10) return null

    const validConfidences = ["high", "medium", "low"]
    const validCategories = ["architecture", "testing", "performance", "security", "debugging", "tooling", "patterns", "other"]

    const confidence = validConfidences.includes(String(obj.confidence).toLowerCase())
      ? String(obj.confidence).toLowerCase() as "high" | "medium" | "low"
      : "medium"
    const category = validCategories.includes(String(obj.category).toLowerCase())
      ? String(obj.category).toLowerCase() as "architecture" | "testing" | "performance" | "security" | "debugging" | "tooling" | "patterns" | "other"
      : "other"

    return { content: obj.content.trim(), confidence, category }
  }

  const sampleChunk: TranscriptChunk = {
    content: "User asked about database optimization. We decided to add indexes.",
    sourceFile: "~/.claude/projects/test/session.jsonl"
  }

  describe("Successful extraction", () => {
    it("extracts candidates from raw JSON array response", async () => {
      const testCandidates = [
        { content: "Always add indexes for frequently queried columns", confidence: "high", category: "performance" },
        { content: "Test database migrations in staging first", confidence: "medium", category: "testing" }
      ]

      const { layer, mock } = createMockOpenAILayer({ candidates: testCandidates })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates[0]!.content).toBe("Always add indexes for frequently queried columns")
      expect(result.candidates[0]!.confidence).toBe("high")
      expect(result.candidates[0]!.category).toBe("performance")
      expect(mock.getCallCount()).toBe(1)
    })

    it("extracts candidates from wrapped JSON object response", async () => {
      const testCandidates = [
        { content: "Always validate user input before processing", confidence: "high", category: "security" }
      ]

      const { layer } = createMockOpenAILayer({ candidates: testCandidates, wrappedResponse: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.content).toBe("Always validate user input before processing")
    })

    it("includes metadata with model, tokens, and duration", async () => {
      const { layer } = createMockOpenAILayer({
        candidates: [{ content: "Always validate user input", confidence: "high", category: "security" }]
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.metadata).toBeDefined()
      expect(result.metadata!.model).toBe("gpt-4o-mini")
      expect(result.metadata!.tokensUsed).toBeGreaterThan(0)
      expect(result.metadata!.durationMs).toBeGreaterThanOrEqual(0)
    })

    it("preserves source chunk in result", async () => {
      const chunkWithMetadata: TranscriptChunk = {
        content: "Some content",
        sourceFile: "~/.claude/test.jsonl",
        sourceRunId: "run-456",
        sourceTaskId: "tx-def789"
      }

      const { layer } = createMockOpenAILayer({ candidates: [] })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(chunkWithMetadata)
        }).pipe(Effect.provide(layer))
      )

      expect(result.sourceChunk).toEqual(chunkWithMetadata)
    })

    it("limits candidates to maximum of 5", async () => {
      const manyCandidates = Array.from({ length: 10 }, (_, i) => ({
        content: `Learning number ${i + 1} with sufficient length`,
        confidence: "medium",
        category: "patterns"
      }))

      const { layer } = createMockOpenAILayer({ candidates: manyCandidates })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(5)
    })

    it("isAvailable returns true", async () => {
      const { layer } = createMockOpenAILayer({})

      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(layer))
      )

      expect(available).toBe(true)
    })
  })

  describe("Response parsing", () => {
    it("handles empty choices array", async () => {
      const { layer } = createMockOpenAILayer({ emptyResponse: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toEqual([])
    })

    it("handles null content in response", async () => {
      const { layer } = createMockOpenAILayer({ nullContent: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toEqual([])
    })

    it("handles invalid JSON response", async () => {
      const { layer } = createMockOpenAILayer({ invalidJson: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.wasExtracted).toBe(true)
      expect(result.candidates).toEqual([])
    })

    it("handles object with learnings field", async () => {
      const mock = createMockOpenAI({
        defaultResponse: {
          id: "mock-learnings",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "gpt-4o-mini",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                learnings: [
                  { content: "Use learnings field for candidates", confidence: "high", category: "patterns" }
                ]
              })
            },
            finish_reason: "stop"
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        }
      })

      const { layer } = createMockOpenAILayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.content).toBe("Use learnings field for candidates")
    })
  })

  describe("Candidate validation", () => {
    it("filters out candidates with short content", async () => {
      const { layer } = createMockOpenAILayer({
        candidates: [
          { content: "Short", confidence: "high", category: "patterns" },
          { content: "This is a valid learning with sufficient length", confidence: "high", category: "patterns" }
        ]
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.content).toContain("valid learning")
    })

    it("defaults invalid confidence to medium", async () => {
      const mock = createMockOpenAI({
        defaultResponse: {
          id: "mock-invalid-conf",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "gpt-4o-mini",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify([{ content: "Learning with invalid confidence level", confidence: "invalid", category: "patterns" }])
            },
            finish_reason: "stop"
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        }
      })

      const { layer } = createMockOpenAILayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.confidence).toBe("medium")
    })

    it("defaults invalid category to other", async () => {
      const mock = createMockOpenAI({
        defaultResponse: {
          id: "mock-invalid-cat",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "gpt-4o-mini",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify([{ content: "Learning with invalid category type", confidence: "high", category: "invalid" }])
            },
            finish_reason: "stop"
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        }
      })

      const { layer } = createMockOpenAILayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.category).toBe("other")
    })
  })

  describe("Error handling", () => {
    it("returns ExtractionUnavailableError on API failure", async () => {
      const { layer } = createMockOpenAILayer({
        apiError: true,
        error: "429 Too Many Requests"
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* Effect.either(svc.extract(sampleChunk))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ExtractionUnavailableError")
        expect(result.left.reason).toContain("429")
      }
    })

    it("wraps network errors in ExtractionUnavailableError", async () => {
      const mock = createMockOpenAI({
        shouldFail: true,
        failureError: new Error("Network timeout")
      })

      const { layer } = createMockOpenAILayer({ mock })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          return yield* Effect.either(svc.extract(sampleChunk))
        }).pipe(Effect.provide(layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ExtractionUnavailableError")
        expect(result.left.reason).toContain("Network timeout")
      }
    })
  })

  describe("Call tracking", () => {
    it("tracks API calls for debugging", async () => {
      const { layer, mock } = createMockOpenAILayer({ candidates: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          yield* svc.extract(sampleChunk)
          yield* svc.extract({ content: "Second chunk", sourceFile: "~/.claude/test2.jsonl" })
        }).pipe(Effect.provide(layer))
      )

      expect(mock.getCallCount()).toBe(2)
      expect(mock.getLastCall()?.messages[0]?.content).toContain("Second chunk")
    })

    it("can reset call tracking", async () => {
      const { layer, mock } = createMockOpenAILayer({ candidates: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(mock.getCallCount()).toBe(1)
      mock.reset()
      expect(mock.getCallCount()).toBe(0)
    })

    it("verifies response_format is set to json_object", async () => {
      const { layer, mock } = createMockOpenAILayer({ candidates: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(mock.getLastCall()?.response_format).toEqual({ type: "json_object" })
    })
  })

  describe("Model configuration", () => {
    it("uses gpt-4o-mini model by default", async () => {
      const { layer, mock } = createMockOpenAILayer({ candidates: [] })

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CandidateExtractorService
          yield* svc.extract(sampleChunk)
        }).pipe(Effect.provide(layer))
      )

      expect(mock.getLastCall()?.model).toBe("gpt-4o-mini")
    })
  })
})
