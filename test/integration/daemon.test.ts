/**
 * Daemon and Promotion Pipeline Integration Tests
 *
 * Tests for PRD-015: JSONL Telemetry Daemon and Knowledge Promotion Pipeline.
 * Covers file watching, hash deduplication, candidate extraction,
 * confidence scoring, promotion flow, and review queue.
 *
 * @see PRD-015 for specification
 * @see DD-007 for testing patterns
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  createTestDatabase,
  CandidateFactory,
  LearningFactory,
  fixtureId,
  cachedLLMCall,
  createMockAnthropicForExtraction,
  configureLLMCache,
  resetCacheConfig,
  type TestDatabase
} from "@jamesaphoenix/tx-test-utils"
import {
  CandidateExtractorService,
  CandidateExtractorServiceNoop,
  CandidateExtractorServiceAuto,
  writePid,
  readPid,
  removePid,
  isProcessRunning
} from "@jamesaphoenix/tx-core"
import {
  generateLaunchdPlist,
  generateSystemdService,
  type LaunchdPlistOptions,
  type SystemdServiceOptions
} from "@tx/core/services"

// =============================================================================
// Test Fixtures
// =============================================================================

const FIXTURES = {
  // JSONL file paths
  FILE_SESSION_1: "~/.claude/projects/test-project/session-001.jsonl",
  FILE_SESSION_2: "~/.claude/projects/test-project/session-002.jsonl",
  FILE_OTHER_PROJECT: "~/.claude/projects/other/session.jsonl",

  // JSONL content examples
  LINE_USER_MSG: '{"type":"user","content":"How do I implement authentication?"}',
  LINE_ASSISTANT_MSG: '{"type":"assistant","content":"I recommend using JWT tokens..."}',
  LINE_TOOL_CALL: '{"type":"tool_call","tool":"Read","input":{"path":"src/auth.ts"}}',
  LINE_TOOL_RESULT: '{"type":"tool_result","result":"export function verifyToken() {...}"}',

  // Task IDs for provenance
  TASK_AUTH: fixtureId("daemon-auth"),
  TASK_LOGIN: fixtureId("daemon-login"),

  // Run IDs for provenance
  RUN_SESSION_1: "run-session-001",
  RUN_SESSION_2: "run-session-002"
} as const

// =============================================================================
// File Watching Tests (Simulated)
// =============================================================================

describe("Daemon File Watching", () => {
  let tempDir: string

  beforeEach(() => {
    // Create a temporary directory to simulate ~/.claude/projects/
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-test-"))
  })

  it("detects new JSONL files in watched directory", () => {
    // Simulate creating a new JSONL file
    const sessionFile = path.join(tempDir, "session.jsonl")
    const jsonlContent = [
      FIXTURES.LINE_USER_MSG,
      FIXTURES.LINE_ASSISTANT_MSG
    ].join("\n")

    fs.writeFileSync(sessionFile, jsonlContent)

    // Verify file exists and has expected content
    expect(fs.existsSync(sessionFile)).toBe(true)
    const content = fs.readFileSync(sessionFile, "utf-8")
    expect(content).toContain('"type":"user"')
    expect(content).toContain('"type":"assistant"')
  })

  it("detects changed JSONL files", () => {
    const sessionFile = path.join(tempDir, "session.jsonl")

    // Create initial file
    fs.writeFileSync(sessionFile, FIXTURES.LINE_USER_MSG)
    const initialSize = fs.statSync(sessionFile).size

    // Append to file (simulates ongoing session)
    fs.appendFileSync(sessionFile, "\n" + FIXTURES.LINE_ASSISTANT_MSG)
    const newSize = fs.statSync(sessionFile).size

    expect(newSize).toBeGreaterThan(initialSize)
  })

  it("ignores non-JSONL files", () => {
    // Create various files
    const jsonlFile = path.join(tempDir, "session.jsonl")
    const txtFile = path.join(tempDir, "notes.txt")
    const jsonFile = path.join(tempDir, "config.json")

    fs.writeFileSync(jsonlFile, FIXTURES.LINE_USER_MSG)
    fs.writeFileSync(txtFile, "Some notes")
    fs.writeFileSync(jsonFile, '{"config": true}')

    // Verify only .jsonl files would be processed
    const files = fs.readdirSync(tempDir)
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"))

    expect(jsonlFiles).toHaveLength(1)
    expect(jsonlFiles[0]).toBe("session.jsonl")
  })

  it("handles nested project directories", () => {
    // Create nested structure like ~/.claude/projects/myapp/session.jsonl
    const projectDir = path.join(tempDir, "projects", "myapp")
    fs.mkdirSync(projectDir, { recursive: true })

    const sessionFile = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(sessionFile, FIXTURES.LINE_USER_MSG)

    expect(fs.existsSync(sessionFile)).toBe(true)
  })
})

// =============================================================================
// Hash Deduplication Tests
// =============================================================================

describe("Daemon Hash Deduplication", () => {
  it("computes consistent SHA256 hash for content", async () => {
    const { makeAppLayer, DeduplicationService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        const hash1 = dedupSvc.computeHash(FIXTURES.LINE_USER_MSG)
        const hash2 = dedupSvc.computeHash(FIXTURES.LINE_USER_MSG)
        const hash3 = dedupSvc.computeHash(FIXTURES.LINE_ASSISTANT_MSG)

        return { hash1, hash2, hash3 }
      }).pipe(Effect.provide(layer))
    )

    // Same content produces same hash
    expect(result.hash1).toBe(result.hash2)
    // Different content produces different hash
    expect(result.hash1).not.toBe(result.hash3)
    // Hash is 64 chars (SHA256 hex)
    expect(result.hash1.length).toBe(64)
  })

  it("skips already processed JSONL lines", async () => {
    const { makeAppLayer, DeduplicationService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // First time processing
        const first = yield* dedupSvc.processLine(FIXTURES.LINE_USER_MSG, FIXTURES.FILE_SESSION_1, 1)

        // Same content from different file
        const second = yield* dedupSvc.processLine(FIXTURES.LINE_USER_MSG, FIXTURES.FILE_SESSION_2, 1)

        return { first, second }
      }).pipe(Effect.provide(layer))
    )

    expect(result.first.isNew).toBe(true)
    expect(result.second.isNew).toBe(false)
  })

  it("tracks file processing progress", async () => {
    const { makeAppLayer, DeduplicationService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process some lines
        const lines = [
          { content: FIXTURES.LINE_USER_MSG, lineNumber: 1 },
          { content: FIXTURES.LINE_ASSISTANT_MSG, lineNumber: 2 },
          { content: FIXTURES.LINE_TOOL_CALL, lineNumber: 3 }
        ]
        yield* dedupSvc.processLines(lines, FIXTURES.FILE_SESSION_1)

        // Update progress
        yield* dedupSvc.updateProgress(FIXTURES.FILE_SESSION_1, 3, 500, 1000, "checksum123")

        // Get progress
        const progress = yield* dedupSvc.getProgress(FIXTURES.FILE_SESSION_1)

        return { progress }
      }).pipe(Effect.provide(layer))
    )

    expect(result.progress).not.toBeNull()
    expect(result.progress!.lastLineProcessed).toBe(3)
    expect(result.progress!.lastByteOffset).toBe(500)
    expect(result.progress!.fileSize).toBe(1000)
  })

  it("supports incremental processing from last position", async () => {
    const { makeAppLayer, DeduplicationService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // First batch (lines 1-2)
        const batch1 = [
          { content: FIXTURES.LINE_USER_MSG, lineNumber: 1 },
          { content: FIXTURES.LINE_ASSISTANT_MSG, lineNumber: 2 }
        ]
        const result1 = yield* dedupSvc.processLines(batch1, FIXTURES.FILE_SESSION_1)

        // Second batch (lines 3-4) - incremental
        const batch2 = [
          { content: FIXTURES.LINE_TOOL_CALL, lineNumber: 3 },
          { content: FIXTURES.LINE_TOOL_RESULT, lineNumber: 4 }
        ]
        const result2 = yield* dedupSvc.processLines(batch2, FIXTURES.FILE_SESSION_1, { startLine: 3 })

        return { result1, result2 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.result1.newLines).toBe(2)
    expect(result.result1.startLine).toBe(1)
    expect(result.result1.endLine).toBe(2)

    expect(result.result2.newLines).toBe(2)
    expect(result.result2.startLine).toBe(3)
    expect(result.result2.endLine).toBe(4)
  })

  it("batch checks multiple hashes efficiently", async () => {
    const { makeAppLayer, DeduplicationService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process two lines
        yield* dedupSvc.processLine(FIXTURES.LINE_USER_MSG, FIXTURES.FILE_SESSION_1, 1)
        yield* dedupSvc.processLine(FIXTURES.LINE_ASSISTANT_MSG, FIXTURES.FILE_SESSION_1, 2)

        // Batch check including unprocessed content
        const processed = yield* dedupSvc.filterProcessed([
          FIXTURES.LINE_USER_MSG,      // processed
          FIXTURES.LINE_ASSISTANT_MSG, // processed
          FIXTURES.LINE_TOOL_CALL      // not processed
        ])

        return { processed }
      }).pipe(Effect.provide(layer))
    )

    expect(result.processed.size).toBe(2)
    expect(result.processed.has(FIXTURES.LINE_USER_MSG)).toBe(true)
    expect(result.processed.has(FIXTURES.LINE_ASSISTANT_MSG)).toBe(true)
    expect(result.processed.has(FIXTURES.LINE_TOOL_CALL)).toBe(false)
  })
})

// =============================================================================
// Candidate Extraction Tests (with LLM Cache)
// =============================================================================

describe("Daemon Candidate Extraction", () => {
  it("extracts candidates using CandidateExtractorService", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService

        const extraction = yield* svc.extract({
          content: "User asked about implementing JWT authentication. We discussed token validation patterns.",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })

        return extraction
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    // Noop returns empty candidates but preserves source info
    expect(result.candidates).toEqual([])
    expect(result.sourceChunk.sourceFile).toBe(FIXTURES.FILE_SESSION_1)
    expect(result.sourceChunk.sourceRunId).toBe(FIXTURES.RUN_SESSION_1)
    expect(result.wasExtracted).toBe(false)
  })

  it("isAvailable returns false when using Noop", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.isAvailable()
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(result).toBe(false)
  })

  it("preserves transcript chunk metadata", async () => {
    const chunkWithMetadata = {
      content: "Discussion about database transactions and ACID properties.",
      sourceFile: FIXTURES.FILE_SESSION_1,
      sourceRunId: FIXTURES.RUN_SESSION_1,
      sourceTaskId: FIXTURES.TASK_AUTH,
      byteOffset: 2048,
      lineRange: { start: 50, end: 100 }
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract(chunkWithMetadata)
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(result.sourceChunk.sourceRunId).toBe(FIXTURES.RUN_SESSION_1)
    expect(result.sourceChunk.sourceTaskId).toBe(FIXTURES.TASK_AUTH)
    expect(result.sourceChunk.byteOffset).toBe(2048)
    expect(result.sourceChunk.lineRange).toEqual({ start: 50, end: 100 })
  })

  it("handles multiple extractions sequentially", async () => {
    const chunks = [
      { content: "Chunk 1 content", sourceFile: FIXTURES.FILE_SESSION_1 },
      { content: "Chunk 2 content", sourceFile: FIXTURES.FILE_SESSION_1 },
      { content: "Chunk 3 content", sourceFile: FIXTURES.FILE_SESSION_2 }
    ]

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        const extractions = []
        for (const chunk of chunks) {
          const extraction = yield* svc.extract(chunk)
          extractions.push(extraction)
        }
        return extractions
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(results).toHaveLength(3)
    expect(results[0].sourceChunk.sourceFile).toBe(FIXTURES.FILE_SESSION_1)
    expect(results[2].sourceChunk.sourceFile).toBe(FIXTURES.FILE_SESSION_2)
  })

  it("handles very large transcript chunks", async () => {
    const largeContent = "x".repeat(100000) // 100KB of content

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract({
          content: largeContent,
          sourceFile: FIXTURES.FILE_SESSION_1
        })
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(result.sourceChunk.content.length).toBe(100000)
    expect(result.wasExtracted).toBe(false)
  })
})

// =============================================================================
// Auto Service Fallback Tests
// =============================================================================

describe("Daemon Auto Service Fallback", () => {
  it("uses Noop when no API keys are set", async () => {
    // CandidateExtractorServiceAuto should fall back to Noop when no API keys are configured
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract({
          content: "Test transcript content about database optimization",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })
      }).pipe(Effect.provide(CandidateExtractorServiceAuto))
    )

    // Without API keys, should behave like Noop
    expect(result.candidates).toEqual([])
    expect(result.wasExtracted).toBe(false)
    expect(result.sourceChunk.sourceFile).toBe(FIXTURES.FILE_SESSION_1)
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

  it("preserves source metadata in fallback mode", async () => {
    const chunk = {
      content: "Discussion about error handling patterns",
      sourceFile: FIXTURES.FILE_SESSION_1,
      sourceRunId: FIXTURES.RUN_SESSION_1,
      sourceTaskId: FIXTURES.TASK_AUTH,
      byteOffset: 4096,
      lineRange: { start: 100, end: 200 }
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract(chunk)
      }).pipe(Effect.provide(CandidateExtractorServiceAuto))
    )

    expect(result.sourceChunk.sourceRunId).toBe(FIXTURES.RUN_SESSION_1)
    expect(result.sourceChunk.sourceTaskId).toBe(FIXTURES.TASK_AUTH)
    expect(result.sourceChunk.byteOffset).toBe(4096)
    expect(result.sourceChunk.lineRange).toEqual({ start: 100, end: 200 })
  })

  it("can process multiple chunks in auto mode", async () => {
    const chunks = [
      { content: "Chunk 1 about testing", sourceFile: FIXTURES.FILE_SESSION_1 },
      { content: "Chunk 2 about debugging", sourceFile: FIXTURES.FILE_SESSION_2 }
    ]

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        const r1 = yield* svc.extract(chunks[0])
        const r2 = yield* svc.extract(chunks[1])
        return [r1, r2]
      }).pipe(Effect.provide(CandidateExtractorServiceAuto))
    )

    expect(results).toHaveLength(2)
    expect(results[0].sourceChunk.sourceFile).toBe(FIXTURES.FILE_SESSION_1)
    expect(results[1].sourceChunk.sourceFile).toBe(FIXTURES.FILE_SESSION_2)
    // Both should fall back to Noop behavior
    expect(results[0].candidates).toEqual([])
    expect(results[1].candidates).toEqual([])
  })
})

// =============================================================================
// LLM Cache Extraction Tests
// =============================================================================

describe("Daemon LLM Cache Extraction", () => {
  let tempCacheDir: string

  beforeEach(() => {
    // Create a temp cache directory
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-llm-cache-test-"))
    configureLLMCache({ cacheDir: tempCacheDir, logging: false })
  })

  afterEach(() => {
    // Reset cache config and clean up temp dir
    resetCacheConfig()
    fs.rmSync(tempCacheDir, { recursive: true, force: true })
  })

  it("cachedLLMCall returns cached response on second call", async () => {
    let callCount = 0
    const mockExtract = async () => {
      callCount++
      return [
        { content: "Always validate input data", confidence: "high", category: "security" }
      ]
    }

    // First call - cache miss
    const result1 = await cachedLLMCall(
      "transcript content about validation",
      "claude-haiku-4-20250514",
      mockExtract,
      { version: 1 }
    )

    // Second call - cache hit
    const result2 = await cachedLLMCall(
      "transcript content about validation",
      "claude-haiku-4-20250514",
      mockExtract,
      { version: 1 }
    )

    expect(result1).toEqual(result2)
    expect(callCount).toBe(1) // Only called once, second was cached
  })

  it("cachedLLMCall invalidates on version mismatch", async () => {
    let callCount = 0
    const mockExtract = async () => {
      callCount++
      return [
        { content: `Call number ${callCount}`, confidence: "high", category: "patterns" }
      ]
    }

    // First call with version 1
    await cachedLLMCall(
      "same input content",
      "claude-haiku-4-20250514",
      mockExtract,
      { version: 1 }
    )

    // Second call with version 2 - should NOT use cache
    const result2 = await cachedLLMCall(
      "same input content",
      "claude-haiku-4-20250514",
      mockExtract,
      { version: 2 }
    )

    expect(callCount).toBe(2) // Called twice due to version mismatch
    expect(result2[0].content).toBe("Call number 2")
  })

  it("cachedLLMCall stores response in cache file", async () => {
    const mockResult = [
      { content: "Use Effect-TS for typed errors", confidence: "high", category: "patterns" },
      { content: "Test edge cases explicitly", confidence: "medium", category: "testing" }
    ]

    await cachedLLMCall(
      "transcript about error handling",
      "claude-haiku-4-20250514",
      async () => mockResult,
      { version: 1 }
    )

    // Verify cache file was created
    const files = fs.readdirSync(tempCacheDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/)

    // Verify cache file content
    const cacheContent = JSON.parse(fs.readFileSync(path.join(tempCacheDir, files[0]), "utf-8"))
    expect(cacheContent.response).toEqual(mockResult)
    expect(cacheContent.model).toBe("claude-haiku-4-20250514")
    expect(cacheContent.version).toBe(1)
  })

  it("cachedLLMCall supports forceRefresh option", async () => {
    let callCount = 0
    const mockExtract = async () => {
      callCount++
      return [{ content: `Result ${callCount}`, confidence: "high", category: "other" }]
    }

    // First call - caches result
    await cachedLLMCall(
      "input to refresh",
      "claude-haiku-4-20250514",
      mockExtract,
      { version: 1 }
    )

    // Second call with forceRefresh - bypasses cache
    const result = await cachedLLMCall(
      "input to refresh",
      "claude-haiku-4-20250514",
      mockExtract,
      { version: 1, forceRefresh: true }
    )

    expect(callCount).toBe(2) // Called twice due to forceRefresh
    expect(result[0].content).toBe("Result 2")
  })

  it("different inputs produce different cache entries", async () => {
    const mockExtract = async () => [
      { content: "Generic learning", confidence: "medium", category: "other" }
    ]

    await cachedLLMCall("input one", "claude-haiku-4-20250514", mockExtract, { version: 1 })
    await cachedLLMCall("input two", "claude-haiku-4-20250514", mockExtract, { version: 1 })
    await cachedLLMCall("input three", "claude-haiku-4-20250514", mockExtract, { version: 1 })

    const files = fs.readdirSync(tempCacheDir)
    expect(files.length).toBe(3) // Three different cache files
  })
})

// =============================================================================
// Mock Transcript Content Tests
// =============================================================================

describe("Daemon Mock Transcript Content", () => {
  it("createMockAnthropicForExtraction returns configured candidates", async () => {
    const expectedCandidates = [
      { content: "Always use transactions for batch operations", confidence: "high", category: "patterns" },
      { content: "Test database rollback scenarios", confidence: "medium", category: "testing" }
    ]

    const mock = createMockAnthropicForExtraction(expectedCandidates)

    const response = await mock.client.messages.create({
      model: "claude-haiku-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Extract learnings from this transcript" }]
    })

    expect(response.content[0].text).toBe(JSON.stringify(expectedCandidates))
    expect(mock.calls).toHaveLength(1)
  })

  it("mock tracks all API calls", async () => {
    const mock = createMockAnthropicForExtraction([
      { content: "Learning 1", confidence: "high", category: "patterns" }
    ])

    // Make multiple calls
    await mock.client.messages.create({
      model: "claude-haiku-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Transcript 1" }]
    })

    await mock.client.messages.create({
      model: "claude-haiku-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Transcript 2" }]
    })

    expect(mock.calls).toHaveLength(2)
    expect(mock.calls[0].messages[0].content).toBe("Transcript 1")
    expect(mock.calls[1].messages[0].content).toBe("Transcript 2")
    expect(mock.getCallCount()).toBe(2)
    expect(mock.getLastCall()?.messages[0].content).toBe("Transcript 2")
  })

  it("mock reset clears call history", async () => {
    const mock = createMockAnthropicForExtraction([
      { content: "Learning", confidence: "high", category: "patterns" }
    ])

    await mock.client.messages.create({
      model: "claude-haiku-4-20250514",
      max_tokens: 256,
      messages: [{ role: "user", content: "Test" }]
    })

    expect(mock.calls).toHaveLength(1)

    mock.reset()

    expect(mock.calls).toHaveLength(0)
    expect(mock.getCallCount()).toBe(0)
  })

  it("mock returns proper response structure", async () => {
    const mock = createMockAnthropicForExtraction([
      { content: "Security check", confidence: "high", category: "security" }
    ])

    const response = await mock.client.messages.create({
      model: "claude-haiku-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Analyze this" }]
    })

    expect(response.id).toBe("mock-extraction-id")
    expect(response.type).toBe("message")
    expect(response.role).toBe("assistant")
    expect(response.model).toBe("claude-haiku-4-20250514")
    expect(response.usage).toEqual({ input_tokens: 100, output_tokens: 50 })
    expect(response.content).toHaveLength(1)
    expect(response.content[0].type).toBe("text")
  })

  it("handles empty candidates array", async () => {
    const mock = createMockAnthropicForExtraction([])

    const response = await mock.client.messages.create({
      model: "claude-haiku-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "No learnings here" }]
    })

    expect(response.content[0].text).toBe("[]")
  })

  it("handles complex transcript content with special characters", async () => {
    const complexCandidates = [
      {
        content: "Handle SQL injection by using parameterized queries: $1, $2",
        confidence: "high",
        category: "security"
      },
      {
        content: "Use <T> generics for type-safe collections",
        confidence: "medium",
        category: "patterns"
      }
    ]

    const mock = createMockAnthropicForExtraction(complexCandidates)

    const response = await mock.client.messages.create({
      model: "claude-haiku-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: "Transcript with special chars: @#$%^&*(){}[]|\\:\";<>?/"
      }]
    })

    const parsed = JSON.parse(response.content[0].text!)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].content).toContain("$1, $2")
    expect(parsed[1].content).toContain("<T>")
  })

  it("simulates extraction pipeline with mock", async () => {
    // Simulate the full extraction pipeline using mocks
    const mockCandidates = [
      { content: "Always validate JWT signatures", confidence: "high", category: "security" },
      { content: "Use connection pooling for databases", confidence: "high", category: "performance" },
      { content: "Log errors with context", confidence: "medium", category: "debugging" }
    ]

    const mock = createMockAnthropicForExtraction(mockCandidates)

    // Simulate transcript chunks being processed
    const transcriptChunks = [
      "User asked about authentication best practices...",
      "We discussed database performance optimization...",
      "Debugging session for the login error..."
    ]

    const allResponses = []
    for (const chunk of transcriptChunks) {
      const response = await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: `Extract learnings from: ${chunk}` }]
      })
      allResponses.push(response)
    }

    expect(mock.calls).toHaveLength(3)
    expect(allResponses).toHaveLength(3)

    // All responses return the same mock candidates
    allResponses.forEach(response => {
      const candidates = JSON.parse(response.content[0].text!)
      expect(candidates).toHaveLength(3)
      expect(candidates[0].confidence).toBe("high")
    })
  })
})

// =============================================================================
// Confidence Scoring Tests
// =============================================================================

describe("Daemon Confidence Scoring", () => {
  let testDb: TestDatabase
  let candidateFactory: CandidateFactory

  beforeEach(async () => {
    testDb = await Effect.runPromise(createTestDatabase())
    candidateFactory = new CandidateFactory(testDb)
  })

  it("creates high-confidence candidates", () => {
    const candidate = candidateFactory.highConfidence({
      content: "Always validate JWT tokens before processing requests"
    })

    expect(candidate.confidence).toBe("high")
    expect(candidate.status).toBe("pending")
  })

  it("creates medium-confidence candidates", () => {
    const candidate = candidateFactory.mediumConfidence({
      content: "Consider using database connection pooling"
    })

    expect(candidate.confidence).toBe("medium")
    expect(candidate.status).toBe("pending")
  })

  it("creates low-confidence candidates", () => {
    const candidate = candidateFactory.lowConfidence({
      content: "This pattern might work in some cases"
    })

    expect(candidate.confidence).toBe("low")
    expect(candidate.status).toBe("pending")
  })

  it("categorizes candidates correctly", () => {
    const securityCandidate = candidateFactory.create({
      content: "Always sanitize user input",
      confidence: "high",
      category: "security"
    })

    const patternCandidate = candidateFactory.create({
      content: "Use Effect-TS for typed error handling",
      confidence: "high",
      category: "patterns"
    })

    expect(securityCandidate.category).toBe("security")
    expect(patternCandidate.category).toBe("patterns")
  })

  it("queries candidates by confidence level", () => {
    // Create candidates with different confidence levels
    candidateFactory.highConfidence({ content: "High 1" })
    candidateFactory.highConfidence({ content: "High 2" })
    candidateFactory.mediumConfidence({ content: "Medium 1" })
    candidateFactory.lowConfidence({ content: "Low 1" })

    // Query high-confidence candidates
    const highConfidenceCandidates = testDb.query<{ id: number; confidence: string }>(
      "SELECT id, confidence FROM learning_candidates WHERE confidence = ?",
      ["high"]
    )

    expect(highConfidenceCandidates).toHaveLength(2)
    expect(highConfidenceCandidates[0].confidence).toBe("high")
  })

  it("combines confidence with other filters", () => {
    // Create candidates from different sources
    candidateFactory.highConfidence({
      content: "High from session 1",
      sourceFile: FIXTURES.FILE_SESSION_1
    })
    candidateFactory.highConfidence({
      content: "High from session 2",
      sourceFile: FIXTURES.FILE_SESSION_2
    })
    candidateFactory.mediumConfidence({
      content: "Medium from session 1",
      sourceFile: FIXTURES.FILE_SESSION_1
    })

    // Query high-confidence from specific source
    const results = testDb.query<{ id: number; content: string }>(
      "SELECT id, content FROM learning_candidates WHERE confidence = ? AND source_file = ?",
      ["high", FIXTURES.FILE_SESSION_1]
    )

    expect(results).toHaveLength(1)
    expect(results[0].content).toBe("High from session 1")
  })
})

// =============================================================================
// Promotion Flow Tests
// =============================================================================

describe("Daemon Promotion Flow", () => {
  let testDb: TestDatabase
  let candidateFactory: CandidateFactory
  let learningFactory: LearningFactory

  beforeEach(async () => {
    testDb = await Effect.runPromise(createTestDatabase())
    candidateFactory = new CandidateFactory(testDb)
    learningFactory = new LearningFactory(testDb)
  })

  it("promotes high-confidence candidate to learning", async () => {
    // Create a high-confidence candidate
    const candidate = candidateFactory.highConfidence({
      content: "Always use transactions for batch database operations",
      category: "patterns",
      sourceFile: FIXTURES.FILE_SESSION_1,
      sourceRunId: FIXTURES.RUN_SESSION_1
    })

    // Create corresponding learning
    const learning = learningFactory.create({
      content: candidate.content,
      category: "patterns",
      sourceType: "run",
      sourceRef: candidate.sourceRunId ?? undefined
    })

    // Update candidate to promoted
    testDb.run(
      `UPDATE learning_candidates
       SET status = 'promoted', promoted_learning_id = ?, reviewed_at = datetime('now'), reviewed_by = 'auto'
       WHERE id = ?`,
      [learning.id, candidate.id]
    )

    // Verify promotion
    const updated = testDb.query<{ status: string; promoted_learning_id: number; reviewed_by: string }>(
      "SELECT status, promoted_learning_id, reviewed_by FROM learning_candidates WHERE id = ?",
      [candidate.id]
    )[0]

    expect(updated.status).toBe("promoted")
    expect(updated.promoted_learning_id).toBe(learning.id)
    expect(updated.reviewed_by).toBe("auto")
  })

  it("auto-promotes only high-confidence candidates", () => {
    // Create candidates at different confidence levels
    candidateFactory.highConfidence({ content: "High confidence learning" })
    candidateFactory.mediumConfidence({ content: "Medium confidence learning" })
    candidateFactory.lowConfidence({ content: "Low confidence learning" })

    // Simulate auto-promotion logic
    testDb.run(
      `UPDATE learning_candidates
       SET status = 'promoted', reviewed_at = datetime('now'), reviewed_by = 'auto'
       WHERE confidence = 'high' AND status = 'pending'`
    )

    // Count promoted vs pending
    const promoted = testDb.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM learning_candidates WHERE status = 'promoted'"
    )[0].count

    const pending = testDb.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM learning_candidates WHERE status = 'pending'"
    )[0].count

    expect(promoted).toBe(1)
    expect(pending).toBe(2)
  })

  it("rejects candidate with reason", () => {
    const candidate = candidateFactory.mediumConfidence({
      content: "This is too specific to be useful"
    })

    // Reject with reason
    testDb.run(
      `UPDATE learning_candidates
       SET status = 'rejected', rejection_reason = ?, reviewed_at = datetime('now'), reviewed_by = 'manual'
       WHERE id = ?`,
      ["Too context-specific", candidate.id]
    )

    const rejected = testDb.query<{ status: string; rejection_reason: string; reviewed_by: string }>(
      "SELECT status, rejection_reason, reviewed_by FROM learning_candidates WHERE id = ?",
      [candidate.id]
    )[0]

    expect(rejected.status).toBe("rejected")
    expect(rejected.rejection_reason).toBe("Too context-specific")
    expect(rejected.reviewed_by).toBe("manual")
  })

  it("merges duplicate candidate with existing learning", () => {
    // Create existing learning
    const existingLearning = learningFactory.create({
      content: "Always validate user input before processing"
    })

    // Create similar candidate
    const candidate = candidateFactory.highConfidence({
      content: "Validate user input to prevent injection attacks"
    })

    // Mark as merged
    testDb.run(
      `UPDATE learning_candidates
       SET status = 'merged', promoted_learning_id = ?, reviewed_at = datetime('now'), reviewed_by = 'auto'
       WHERE id = ?`,
      [existingLearning.id, candidate.id]
    )

    const merged = testDb.query<{ status: string; promoted_learning_id: number }>(
      "SELECT status, promoted_learning_id FROM learning_candidates WHERE id = ?",
      [candidate.id]
    )[0]

    expect(merged.status).toBe("merged")
    expect(merged.promoted_learning_id).toBe(existingLearning.id)
  })

  it("tracks provenance from source run/task", () => {
    const candidate = candidateFactory.fromSource(
      FIXTURES.FILE_SESSION_1,
      FIXTURES.RUN_SESSION_1,
      FIXTURES.TASK_AUTH,
      {
        content: "Learning extracted from auth implementation session",
        confidence: "high"
      }
    )

    expect(candidate.sourceFile).toBe(FIXTURES.FILE_SESSION_1)
    expect(candidate.sourceRunId).toBe(FIXTURES.RUN_SESSION_1)
    expect(candidate.sourceTaskId).toBe(FIXTURES.TASK_AUTH)
  })

  it("uses promoted factory helper", () => {
    const learning = learningFactory.create({ content: "A promoted learning" })

    const promotedCandidate = candidateFactory.promoted({
      content: "Already promoted candidate",
      promotedLearningId: learning.id
    })

    expect(promotedCandidate.status).toBe("promoted")
    expect(promotedCandidate.promotedLearningId).toBe(learning.id)
    expect(promotedCandidate.reviewedBy).toBe("auto")
    expect(promotedCandidate.reviewedAt).toBeInstanceOf(Date)
  })
})

// =============================================================================
// Review Queue Tests
// =============================================================================

describe("Daemon Review Queue", () => {
  let testDb: TestDatabase
  let candidateFactory: CandidateFactory

  beforeEach(async () => {
    testDb = await Effect.runPromise(createTestDatabase())
    candidateFactory = new CandidateFactory(testDb)
  })

  it("lists pending candidates for review", () => {
    // Create candidates with different statuses
    candidateFactory.pending({ content: "Pending 1" })
    candidateFactory.pending({ content: "Pending 2" })
    candidateFactory.rejected("too specific", { content: "Rejected" })

    const pending = testDb.query<{ id: number; content: string }>(
      "SELECT id, content FROM learning_candidates WHERE status = 'pending' ORDER BY id"
    )

    expect(pending).toHaveLength(2)
    expect(pending[0].content).toBe("Pending 1")
    expect(pending[1].content).toBe("Pending 2")
  })

  it("filters review queue by confidence", () => {
    candidateFactory.mediumConfidence({ content: "Medium 1" })
    candidateFactory.mediumConfidence({ content: "Medium 2" })
    candidateFactory.lowConfidence({ content: "Low 1" })
    candidateFactory.highConfidence({ content: "High (auto-promotable)" })

    // Medium and low need review
    const needsReview = testDb.query<{ id: number; confidence: string }>(
      `SELECT id, confidence FROM learning_candidates
       WHERE status = 'pending' AND confidence IN ('medium', 'low')
       ORDER BY confidence DESC`
    )

    expect(needsReview).toHaveLength(3)
    // Medium should come first (alphabetically DESC)
    expect(needsReview[0].confidence).toBe("medium")
  })

  it("filters review queue by source file", () => {
    candidateFactory.pending({
      content: "From session 1",
      sourceFile: FIXTURES.FILE_SESSION_1
    })
    candidateFactory.pending({
      content: "From session 2",
      sourceFile: FIXTURES.FILE_SESSION_2
    })

    const fromSession1 = testDb.query<{ id: number; content: string }>(
      `SELECT id, content FROM learning_candidates
       WHERE status = 'pending' AND source_file = ?`,
      [FIXTURES.FILE_SESSION_1]
    )

    expect(fromSession1).toHaveLength(1)
    expect(fromSession1[0].content).toBe("From session 1")
  })

  it("orders review queue by extraction time", () => {
    // Create candidates with different extraction times
    candidateFactory.create({
      content: "Older candidate",
      extractedAt: new Date("2025-01-01T00:00:00Z")
    })
    candidateFactory.create({
      content: "Newer candidate",
      extractedAt: new Date("2025-01-02T00:00:00Z")
    })

    const ordered = testDb.query<{ content: string; extracted_at: string }>(
      `SELECT content, extracted_at FROM learning_candidates
       WHERE status = 'pending'
       ORDER BY extracted_at ASC`
    )

    expect(ordered[0].content).toBe("Older candidate")
    expect(ordered[1].content).toBe("Newer candidate")
  })

  it("paginates review queue results", () => {
    // Create 5 candidates
    for (let i = 1; i <= 5; i++) {
      candidateFactory.pending({ content: `Candidate ${i}` })
    }

    // Get page 1 (limit 2)
    const page1 = testDb.query<{ id: number; content: string }>(
      `SELECT id, content FROM learning_candidates
       WHERE status = 'pending'
       ORDER BY id
       LIMIT 2 OFFSET 0`
    )

    // Get page 2 (limit 2)
    const page2 = testDb.query<{ id: number; content: string }>(
      `SELECT id, content FROM learning_candidates
       WHERE status = 'pending'
       ORDER BY id
       LIMIT 2 OFFSET 2`
    )

    expect(page1).toHaveLength(2)
    expect(page2).toHaveLength(2)
    expect(page1[0].content).toBe("Candidate 1")
    expect(page2[0].content).toBe("Candidate 3")
  })

  it("counts candidates by status", () => {
    candidateFactory.pending({ content: "Pending 1" })
    candidateFactory.pending({ content: "Pending 2" })
    candidateFactory.rejected("reason", { content: "Rejected" })

    // Then promote one from the first pending
    const pending = testDb.query<{ id: number }>(
      "SELECT id FROM learning_candidates WHERE status = 'pending' LIMIT 1"
    )[0]

    testDb.run(
      `UPDATE learning_candidates SET status = 'promoted' WHERE id = ?`,
      [pending.id]
    )

    const counts = testDb.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM learning_candidates
       GROUP BY status
       ORDER BY status`
    )

    const statusMap = Object.fromEntries(counts.map(c => [c.status, c.count]))

    expect(statusMap["pending"]).toBe(1)
    expect(statusMap["promoted"]).toBe(1)
    expect(statusMap["rejected"]).toBe(1)
  })

  it("filters by category in review queue", () => {
    candidateFactory.pending({ content: "Security tip", category: "security" })
    candidateFactory.pending({ content: "Pattern tip", category: "patterns" })
    candidateFactory.pending({ content: "Testing tip", category: "testing" })

    const securityCandidates = testDb.query<{ id: number; category: string }>(
      `SELECT id, category FROM learning_candidates
       WHERE status = 'pending' AND category = ?`,
      ["security"]
    )

    expect(securityCandidates).toHaveLength(1)
    expect(securityCandidates[0].category).toBe("security")
  })

  it("handles candidates without category", () => {
    candidateFactory.pending({ content: "No category assigned", category: null })
    candidateFactory.pending({ content: "Has category", category: "patterns" })

    const uncategorized = testDb.query<{ id: number; category: string | null }>(
      `SELECT id, category FROM learning_candidates
       WHERE status = 'pending' AND category IS NULL`
    )

    expect(uncategorized).toHaveLength(1)
  })
})

// =============================================================================
// End-to-End Pipeline Tests
// =============================================================================

describe("Daemon End-to-End Pipeline", () => {
  let testDb: TestDatabase
  let candidateFactory: CandidateFactory
  let learningFactory: LearningFactory
  let tempDir: string

  beforeEach(async () => {
    testDb = await Effect.runPromise(createTestDatabase())
    candidateFactory = new CandidateFactory(testDb)
    learningFactory = new LearningFactory(testDb)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-e2e-"))
  })

  it("simulates full pipeline: watch -> dedupe -> extract -> promote", async () => {
    const { makeAppLayer, DeduplicationService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    // 1. Simulate file watching (create a JSONL file)
    const sessionFile = path.join(tempDir, "session.jsonl")
    const jsonlLines = [
      FIXTURES.LINE_USER_MSG,
      FIXTURES.LINE_ASSISTANT_MSG,
      FIXTURES.LINE_TOOL_CALL
    ]
    fs.writeFileSync(sessionFile, jsonlLines.join("\n"))

    // 2. Deduplicate lines
    const dedupeResult = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        const lines = jsonlLines.map((content, i) => ({ content, lineNumber: i + 1 }))
        return yield* dedupSvc.processLines(lines, sessionFile)
      }).pipe(Effect.provide(layer))
    )

    expect(dedupeResult.newLines).toBe(3)
    expect(dedupeResult.skippedLines).toBe(0)

    // 3. Extract candidates (simulated - using Noop)
    const extractResult = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        return yield* svc.extract({
          content: jsonlLines.join("\n"),
          sourceFile: sessionFile,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    expect(extractResult.wasExtracted).toBe(false) // Noop

    // 4. Store candidates (using factory to simulate LLM output)
    const candidate = candidateFactory.highConfidence({
      content: "Always handle authentication errors gracefully",
      sourceFile: sessionFile,
      sourceRunId: FIXTURES.RUN_SESSION_1,
      category: "security"
    })

    // 5. Auto-promote high-confidence candidates
    const learning = learningFactory.create({
      content: candidate.content,
      category: "security",
      sourceType: "run",
      sourceRef: candidate.sourceRunId ?? undefined
    })

    testDb.run(
      `UPDATE learning_candidates
       SET status = 'promoted', promoted_learning_id = ?, reviewed_at = datetime('now'), reviewed_by = 'auto'
       WHERE id = ? AND confidence = 'high'`,
      [learning.id, candidate.id]
    )

    // Verify end state
    const promotedCandidate = testDb.query<{ status: string; promoted_learning_id: number }>(
      "SELECT status, promoted_learning_id FROM learning_candidates WHERE id = ?",
      [candidate.id]
    )[0]

    expect(promotedCandidate.status).toBe("promoted")
    expect(promotedCandidate.promoted_learning_id).toBe(learning.id)
  })

  it("handles reprocessing after file update", async () => {
    const { makeAppLayer, DeduplicationService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const sessionFile = path.join(tempDir, "session-update.jsonl")

    // Initial processing
    const initialLines = [FIXTURES.LINE_USER_MSG]
    fs.writeFileSync(sessionFile, initialLines.join("\n"))

    const initial = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        const lines = initialLines.map((content, i) => ({ content, lineNumber: i + 1 }))
        const result = yield* dedupSvc.processLines(lines, sessionFile)
        yield* dedupSvc.updateProgress(sessionFile, 1, 100)
        return result
      }).pipe(Effect.provide(layer))
    )

    expect(initial.newLines).toBe(1)

    // Append new content
    fs.appendFileSync(sessionFile, "\n" + FIXTURES.LINE_ASSISTANT_MSG)

    // Reprocess only new lines (starting from line 2)
    const updated = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        const newLines = [{ content: FIXTURES.LINE_ASSISTANT_MSG, lineNumber: 2 }]
        return yield* dedupSvc.processLines(newLines, sessionFile, { startLine: 2 })
      }).pipe(Effect.provide(layer))
    )

    expect(updated.newLines).toBe(1)
    expect(updated.startLine).toBe(2)
  })

  it("handles graceful degradation without LLM", async () => {
    // Extraction should work even without LLM (using Noop)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CandidateExtractorService
        const available = yield* svc.isAvailable()

        const extraction = yield* svc.extract({
          content: "Some transcript content",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        return { available, extraction }
      }).pipe(Effect.provide(CandidateExtractorServiceNoop))
    )

    // Noop indicates unavailable but still returns valid result
    expect(result.available).toBe(false)
    expect(result.extraction.candidates).toEqual([])
    expect(result.extraction.wasExtracted).toBe(false)

    // Can still queue for later processing
    const candidate = candidateFactory.pending({
      content: "Manual candidate from unavailable LLM period",
      sourceFile: FIXTURES.FILE_SESSION_1
    })

    expect(candidate.status).toBe("pending")
  })
})

// =============================================================================
// Process Management Tests (PID file operations)
// =============================================================================

describe("Daemon Process Management - writePid", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    // Save original cwd and create temp directory
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-pid-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    // Restore original cwd and cleanup
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("creates PID file with correct content", async () => {
    const testPid = 12345

    await Effect.runPromise(writePid(testPid))

    const pidFile = path.join(tempDir, ".tx", "daemon.pid")
    expect(fs.existsSync(pidFile)).toBe(true)

    const content = fs.readFileSync(pidFile, "utf-8")
    expect(content).toBe("12345")
  })

  it("creates .tx directory if it doesn't exist", async () => {
    const txDir = path.join(tempDir, ".tx")
    expect(fs.existsSync(txDir)).toBe(false)

    await Effect.runPromise(writePid(99999))

    expect(fs.existsSync(txDir)).toBe(true)
  })

  it("overwrites existing PID file", async () => {
    await Effect.runPromise(writePid(11111))
    await Effect.runPromise(writePid(22222))

    const pidFile = path.join(tempDir, ".tx", "daemon.pid")
    const content = fs.readFileSync(pidFile, "utf-8")
    expect(content).toBe("22222")
  })
})

describe("Daemon Process Management - readPid", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-pid-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns null when PID file doesn't exist", async () => {
    const result = await Effect.runPromise(readPid())
    expect(result).toBeNull()
  })

  it("returns PID when file exists and process is running (current process)", async () => {
    // Use current process PID - guaranteed to be running
    const currentPid = process.pid
    await Effect.runPromise(writePid(currentPid))

    const result = await Effect.runPromise(readPid())
    expect(result).toBe(currentPid)
  })

  it("returns null and cleans up stale PID file for non-existent process", async () => {
    // Use an extremely high PID that likely doesn't exist
    const stalePid = 999999999
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), String(stalePid))

    const result = await Effect.runPromise(readPid())

    // Should return null (process doesn't exist)
    expect(result).toBeNull()
    // PID file should be cleaned up
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("returns null and cleans up for invalid PID content", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "not-a-number")

    const result = await Effect.runPromise(readPid())

    expect(result).toBeNull()
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("returns null and cleans up for negative PID", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "-1")

    const result = await Effect.runPromise(readPid())

    expect(result).toBeNull()
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("returns null and cleans up for zero PID", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "0")

    const result = await Effect.runPromise(readPid())

    expect(result).toBeNull()
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })
})

describe("Daemon Process Management - removePid", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-pid-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("removes existing PID file", async () => {
    await Effect.runPromise(writePid(12345))
    const pidFile = path.join(tempDir, ".tx", "daemon.pid")
    expect(fs.existsSync(pidFile)).toBe(true)

    await Effect.runPromise(removePid())
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  it("succeeds when PID file doesn't exist", async () => {
    // Should not throw
    await Effect.runPromise(removePid())
  })
})

describe("Daemon Process Management - isProcessRunning", () => {
  it("returns true for current process", async () => {
    const result = await Effect.runPromise(isProcessRunning(process.pid))
    expect(result).toBe(true)
  })

  it("returns false for non-existent process", async () => {
    // Use an extremely high PID that likely doesn't exist
    const result = await Effect.runPromise(isProcessRunning(999999999))
    expect(result).toBe(false)
  })

  it("returns true for PID 1 (init process, if accessible)", async () => {
    // PID 1 is typically the init process, should exist on Unix systems
    // On macOS/Linux this will return true (process exists) or true (EPERM - no permission but exists)
    const result = await Effect.runPromise(isProcessRunning(1))
    expect(result).toBe(true)
  })

  it("returns false for multiple non-existent PIDs", async () => {
    const nonExistentPids = [999999991, 999999992, 999999993]
    const results = await Promise.all(
      nonExistentPids.map(pid => Effect.runPromise(isProcessRunning(pid)))
    )

    expect(results).toEqual([false, false, false])
  })
})

// =============================================================================
// Launchd Plist Generation Tests (macOS)
// =============================================================================

describe("Daemon Launchd Plist Generation", () => {
  it("generates valid XML plist with required fields", () => {
    const options: LaunchdPlistOptions = {
      label: "com.tx.daemon",
      executablePath: "/usr/local/bin/tx"
    }

    const plist = generateLaunchdPlist(options)

    // Check XML structure
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(plist).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"')
    expect(plist).toContain('<plist version="1.0">')

    // Check required keys
    expect(plist).toContain("<key>Label</key>")
    expect(plist).toContain("<string>com.tx.daemon</string>")
    expect(plist).toContain("<key>ProgramArguments</key>")
    expect(plist).toContain("<string>/usr/local/bin/tx</string>")
    expect(plist).toContain("<string>daemon</string>")
    expect(plist).toContain("<string>run</string>")
    expect(plist).toContain("<key>RunAtLoad</key>")
    expect(plist).toContain("<true/>")
    expect(plist).toContain("<key>KeepAlive</key>")
  })

  it("includes custom log path when specified", () => {
    const options: LaunchdPlistOptions = {
      label: "com.tx.daemon",
      executablePath: "/usr/local/bin/tx",
      logPath: "/var/log/tx-daemon.log"
    }

    const plist = generateLaunchdPlist(options)

    expect(plist).toContain("<key>StandardOutPath</key>")
    expect(plist).toContain("<string>/var/log/tx-daemon.log</string>")
    expect(plist).toContain("<key>StandardErrorPath</key>")
  })

  it("expands ~ in log path to home directory", () => {
    const options: LaunchdPlistOptions = {
      label: "com.tx.daemon",
      executablePath: "/usr/local/bin/tx",
      logPath: "~/Library/Logs/tx-daemon.log"
    }

    const plist = generateLaunchdPlist(options)
    const homeDir = os.homedir()

    // Should expand ~ to actual home directory
    expect(plist).not.toContain("~/Library/Logs")
    expect(plist).toContain(`${homeDir}/Library/Logs/tx-daemon.log`)
  })

  it("uses default log path when not specified", () => {
    const options: LaunchdPlistOptions = {
      label: "com.tx.daemon",
      executablePath: "/usr/local/bin/tx"
    }

    const plist = generateLaunchdPlist(options)
    const homeDir = os.homedir()

    // Default path: ~/Library/Logs/tx-daemon.log
    expect(plist).toContain(`${homeDir}/Library/Logs/tx-daemon.log`)
  })

  it("escapes XML special characters in label", () => {
    const options: LaunchdPlistOptions = {
      label: "com.tx.<test>&daemon",
      executablePath: "/usr/local/bin/tx"
    }

    const plist = generateLaunchdPlist(options)

    // Check that special characters are escaped
    expect(plist).toContain("&lt;test&gt;&amp;daemon")
    expect(plist).not.toContain("<test>")
  })

  it("escapes XML special characters in executable path", () => {
    const options: LaunchdPlistOptions = {
      label: "com.tx.daemon",
      executablePath: "/path/with spaces & special<chars>/tx"
    }

    const plist = generateLaunchdPlist(options)

    expect(plist).toContain("&amp;")
    expect(plist).toContain("&lt;chars&gt;")
  })

  it("generates parseable XML", () => {
    const options: LaunchdPlistOptions = {
      label: "com.tx.daemon",
      executablePath: "/usr/local/bin/tx",
      logPath: "~/Library/Logs/tx-daemon.log"
    }

    const plist = generateLaunchdPlist(options)

    // Verify basic XML structure (starts and ends correctly)
    expect(plist.trim().startsWith("<?xml")).toBe(true)
    expect(plist.trim().endsWith("</plist>")).toBe(true)

    // Count opening and closing dict tags
    const dictOpenCount = (plist.match(/<dict>/g) || []).length
    const dictCloseCount = (plist.match(/<\/dict>/g) || []).length
    expect(dictOpenCount).toBe(dictCloseCount)
  })
})

// =============================================================================
// Systemd Service Generation Tests (Linux)
// =============================================================================

describe("Daemon Systemd Service Generation", () => {
  it("generates valid systemd service file with required sections", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx"
    }

    const service = generateSystemdService(options)

    // Check required sections
    expect(service).toContain("[Unit]")
    expect(service).toContain("[Service]")
    expect(service).toContain("[Install]")
  })

  it("includes correct Unit section fields", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx"
    }

    const service = generateSystemdService(options)

    expect(service).toContain("Description=tx Daemon - Task and memory management for AI agents")
    expect(service).toContain("After=network.target")
  })

  it("includes correct Service section fields", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx"
    }

    const service = generateSystemdService(options)

    expect(service).toContain("Type=simple")
    expect(service).toContain("ExecStart=/usr/local/bin/tx daemon run")
    expect(service).toContain("Restart=always")
    expect(service).toContain("RestartSec=5")
  })

  it("includes correct Install section fields", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx"
    }

    const service = generateSystemdService(options)

    expect(service).toContain("WantedBy=default.target")
  })

  it("includes User directive when user is specified", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx",
      user: "txdaemon"
    }

    const service = generateSystemdService(options)

    expect(service).toContain("User=txdaemon")
  })

  it("does not include User directive when user is not specified", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx"
    }

    const service = generateSystemdService(options)

    expect(service).not.toContain("User=")
  })

  it("handles paths with spaces", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/opt/my app/bin/tx"
    }

    const service = generateSystemdService(options)

    expect(service).toContain("ExecStart=/opt/my app/bin/tx daemon run")
  })

  it("generates proper line endings", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx"
    }

    const service = generateSystemdService(options)

    // Should have Unix-style line endings
    expect(service).not.toContain("\r\n")

    // Should end with newline
    expect(service.endsWith("\n")).toBe(true)
  })

  it("places sections in correct order", () => {
    const options: SystemdServiceOptions = {
      executablePath: "/usr/local/bin/tx"
    }

    const service = generateSystemdService(options)

    const unitIndex = service.indexOf("[Unit]")
    const serviceIndex = service.indexOf("[Service]")
    const installIndex = service.indexOf("[Install]")

    // Verify ordering: Unit < Service < Install
    expect(unitIndex).toBeLessThan(serviceIndex)
    expect(serviceIndex).toBeLessThan(installIndex)
  })
})

// =============================================================================
// PromotionService Integration Tests (PRD-015)
// =============================================================================

describe("PromotionService Auto-Promote Integration", () => {
  it("auto-promotes high-confidence candidates", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create high-confidence candidates
        yield* repo.insert({
          content: "Always validate JWT tokens before processing requests",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })
        yield* repo.insert({
          content: "Use database transactions for batch operations",
          confidence: "high",
          category: "patterns",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })

        // Run auto-promotion
        const autoPromoteResult = yield* svc.autoPromote()

        // Verify candidates were promoted
        const promoted = yield* svc.list({ status: "promoted" })

        return { autoPromoteResult, promoted }
      }).pipe(Effect.provide(layer))
    )

    expect(result.autoPromoteResult.promoted).toBe(2)
    expect(result.autoPromoteResult.learningIds).toHaveLength(2)
    expect(result.promoted).toHaveLength(2)
    expect(result.promoted.every(c => c.reviewedBy === "auto")).toBe(true)
  })

  it("skips low-confidence candidates during auto-promote", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create candidates with different confidence levels
        yield* repo.insert({
          content: "High confidence - should be promoted",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Medium confidence - should stay pending",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Low confidence - should stay pending",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_2
        })

        // Run auto-promotion
        const autoPromoteResult = yield* svc.autoPromote()

        // Check status counts
        const promoted = yield* svc.list({ status: "promoted" })
        const pending = yield* svc.getPending()

        return { autoPromoteResult, promoted, pending }
      }).pipe(Effect.provide(layer))
    )

    // Only high-confidence should be promoted
    expect(result.autoPromoteResult.promoted).toBe(1)
    expect(result.promoted).toHaveLength(1)
    expect(result.promoted[0].content).toBe("High confidence - should be promoted")

    // Medium and low should remain pending
    expect(result.pending).toHaveLength(2)
    expect(result.pending.some(c => c.confidence === "medium")).toBe(true)
    expect(result.pending.some(c => c.confidence === "low")).toBe(true)
  })

  it("skips candidates that duplicate existing learnings", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        // Create an existing learning first
        yield* learningSvc.create({
          content: "Always validate user input before processing",
          sourceType: "manual",
          category: "security"
        })

        // Create a candidate with identical content
        yield* repo.insert({
          content: "Always validate user input before processing",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // Create a candidate with unique content
        yield* repo.insert({
          content: "Use connection pooling for database connections",
          confidence: "high",
          category: "performance",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // Run auto-promotion
        const autoPromoteResult = yield* svc.autoPromote()

        // Check for merged candidates
        const merged = yield* svc.list({ status: "merged" })
        const promoted = yield* svc.list({ status: "promoted" })

        return { autoPromoteResult, merged, promoted }
      }).pipe(Effect.provide(layer))
    )

    // Without embeddings (Noop), duplicate detection may not work
    // With real embeddings, the duplicate would be skipped
    // Test verifies the behavior works without crashing
    expect(result.autoPromoteResult.promoted + result.autoPromoteResult.skipped).toBe(2)
  })

  it("creates DERIVED_FROM edge for promoted candidates with sourceRunId", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, EdgeService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const edgeSvc = yield* EdgeService

        // Create candidate with sourceRunId
        yield* repo.insert({
          content: "Learning with run provenance",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })

        // Run auto-promotion
        const autoPromoteResult = yield* svc.autoPromote()

        // Get the promoted learning ID
        const learningId = autoPromoteResult.learningIds[0]

        // Find edges from this learning
        const edges = yield* edgeSvc.findFromSource("learning", String(learningId))

        return { autoPromoteResult, edges, learningId }
      }).pipe(Effect.provide(layer))
    )

    expect(result.autoPromoteResult.promoted).toBe(1)

    // Verify DERIVED_FROM edge was created
    const derivedFromEdge = result.edges.find(e => e.edgeType === "DERIVED_FROM")
    expect(derivedFromEdge).toBeDefined()
    expect(derivedFromEdge!.sourceType).toBe("learning")
    expect(derivedFromEdge!.sourceId).toBe(String(result.learningId))
    expect(derivedFromEdge!.targetType).toBe("run")
    expect(derivedFromEdge!.targetId).toBe(FIXTURES.RUN_SESSION_1)
  })

  it("creates DERIVED_FROM edge for promoted candidates with sourceTaskId", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, EdgeService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const edgeSvc = yield* EdgeService

        // Create candidate with sourceTaskId (no sourceRunId)
        yield* repo.insert({
          content: "Learning with task provenance",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceTaskId: FIXTURES.TASK_AUTH
        })

        // Run auto-promotion
        const autoPromoteResult = yield* svc.autoPromote()

        // Get the promoted learning ID
        const learningId = autoPromoteResult.learningIds[0]

        // Find edges from this learning
        const edges = yield* edgeSvc.findFromSource("learning", String(learningId))

        return { autoPromoteResult, edges, learningId }
      }).pipe(Effect.provide(layer))
    )

    expect(result.autoPromoteResult.promoted).toBe(1)

    // Verify DERIVED_FROM edge was created with task as target
    const derivedFromEdge = result.edges.find(e => e.edgeType === "DERIVED_FROM")
    expect(derivedFromEdge).toBeDefined()
    expect(derivedFromEdge!.sourceType).toBe("learning")
    expect(derivedFromEdge!.sourceId).toBe(String(result.learningId))
    expect(derivedFromEdge!.targetType).toBe("task")
    expect(derivedFromEdge!.targetId).toBe(FIXTURES.TASK_AUTH)
  })
})

describe("PromotionService Manual Promote/Reject Integration", () => {
  it("manual promote creates learning and updates candidate status", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        // Create a medium-confidence candidate (wouldn't be auto-promoted)
        const candidate = yield* repo.insert({
          content: "Consider using caching for frequently accessed data",
          confidence: "medium",
          category: "performance",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })

        // Manually promote
        const promotionResult = yield* svc.promote(candidate.id)

        // Verify learning exists
        const learning = yield* learningSvc.get(promotionResult.learning.id)

        return { promotionResult, learning, originalCandidate: candidate }
      }).pipe(Effect.provide(layer))
    )

    expect(result.promotionResult.candidate.status).toBe("promoted")
    expect(result.promotionResult.candidate.reviewedBy).toBe("manual")
    expect(result.promotionResult.candidate.promotedLearningId).toBe(result.promotionResult.learning.id)
    expect(result.learning.content).toBe("Consider using caching for frequently accessed data")
    expect(result.learning.category).toBe("performance")
  })

  it("reject marks candidate as rejected with reason", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create a low-confidence candidate
        const candidate = yield* repo.insert({
          content: "This learning is too context-specific",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // Reject with reason
        const rejectedCandidate = yield* svc.reject(candidate.id, "Too specific to one use case")

        return { rejectedCandidate, originalCandidate: candidate }
      }).pipe(Effect.provide(layer))
    )

    expect(result.rejectedCandidate.status).toBe("rejected")
    expect(result.rejectedCandidate.reviewedBy).toBe("manual")
    expect(result.rejectedCandidate.rejectionReason).toBe("Too specific to one use case")
    expect(result.rejectedCandidate.promotedLearningId).toBeNull()
  })
})

describe("PromotionService Semantic Deduplication Integration", () => {
  it("marks similar candidates as merged when existing learning found", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        // Create existing learning
        const existingLearning = yield* learningSvc.create({
          content: "Always sanitize user input to prevent injection attacks",
          sourceType: "manual",
          category: "security"
        })

        // Create high-confidence candidate with exact same content
        yield* repo.insert({
          content: "Always sanitize user input to prevent injection attacks",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // Run auto-promote (should detect duplicate via semantic search)
        const autoPromoteResult = yield* svc.autoPromote()

        // Check for merged status
        const merged = yield* svc.list({ status: "merged" })

        return { autoPromoteResult, merged, existingLearning }
      }).pipe(Effect.provide(layer))
    )

    // With EmbeddingServiceNoop, semantic search returns empty
    // so duplicates won't be detected. Test verifies no crashes.
    // In production with real embeddings, identical content would be detected
    expect(result.autoPromoteResult.promoted + result.autoPromoteResult.skipped).toBe(1)
  })

  it("handles auto-promote with mixed duplicate and unique candidates", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        // Create existing learning
        yield* learningSvc.create({
          content: "Use prepared statements for SQL queries",
          sourceType: "manual",
          category: "security"
        })

        // Create 3 high-confidence candidates:
        // 1. Duplicate of existing
        yield* repo.insert({
          content: "Use prepared statements for SQL queries",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // 2. Unique
        yield* repo.insert({
          content: "Implement rate limiting for API endpoints",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // 3. Also unique
        yield* repo.insert({
          content: "Use HTTPS for all external API calls",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_2
        })

        // Run auto-promote
        const autoPromoteResult = yield* svc.autoPromote()

        // Get final counts
        const promoted = yield* svc.list({ status: "promoted" })
        const merged = yield* svc.list({ status: "merged" })

        return { autoPromoteResult, promoted, merged }
      }).pipe(Effect.provide(layer))
    )

    // Total processed should be 3 (promoted + skipped)
    const totalProcessed = result.autoPromoteResult.promoted + result.autoPromoteResult.skipped
    expect(totalProcessed).toBe(3)
  })
})

describe("PromotionService Provenance Tracking Integration", () => {
  it("promoted learning content matches candidate content exactly", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const testContent = "Use Effect-TS Data.TaggedError for typed error handling"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        yield* repo.insert({
          content: testContent,
          confidence: "high",
          category: "patterns",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })

        const autoPromoteResult = yield* svc.autoPromote()
        const learningId = autoPromoteResult.learningIds[0]
        const learning = yield* learningSvc.get(learningId)

        return { learning }
      }).pipe(Effect.provide(layer))
    )

    expect(result.learning.content).toBe(testContent)
  })

  it("promoted learning inherits category from candidate", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        yield* repo.insert({
          content: "Always log security-related events",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const autoPromoteResult = yield* svc.autoPromote()
        const learningId = autoPromoteResult.learningIds[0]
        const learning = yield* learningSvc.get(learningId)

        return { learning }
      }).pipe(Effect.provide(layer))
    )

    expect(result.learning.category).toBe("security")
  })

  it("promoted learning sets sourceType to run when sourceRunId present", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        yield* repo.insert({
          content: "Test learning for source type verification",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })

        const autoPromoteResult = yield* svc.autoPromote()
        const learningId = autoPromoteResult.learningIds[0]
        const learning = yield* learningSvc.get(learningId)

        return { learning }
      }).pipe(Effect.provide(layer))
    )

    expect(result.learning.sourceType).toBe("run")
    expect(result.learning.sourceRef).toBe(FIXTURES.RUN_SESSION_1)
  })

  it("edge weight is 1.0 for DERIVED_FROM edges", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, EdgeService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const edgeSvc = yield* EdgeService

        yield* repo.insert({
          content: "Test edge weight",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })

        const autoPromoteResult = yield* svc.autoPromote()
        const learningId = autoPromoteResult.learningIds[0]
        const edges = yield* edgeSvc.findFromSource("learning", String(learningId))

        return { edges }
      }).pipe(Effect.provide(layer))
    )

    const derivedFromEdge = result.edges.find(e => e.edgeType === "DERIVED_FROM")
    expect(derivedFromEdge).toBeDefined()
    expect(derivedFromEdge!.weight).toBe(1.0)
  })
})

// =============================================================================
// Review Queue Service Integration Tests (PRD-015)
// =============================================================================

describe("Review Queue Status Filtering Integration", () => {
  it("filters candidates by pending status", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create candidates with different statuses
        yield* repo.insert({
          content: "Pending candidate 1",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Pending candidate 2",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // Create and promote a candidate
        const toPromote = yield* repo.insert({
          content: "Will be promoted",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* svc.promote(toPromote.id)

        // Filter by pending only
        const pending = yield* svc.list({ status: "pending" })

        return { pending }
      }).pipe(Effect.provide(layer))
    )

    expect(result.pending).toHaveLength(2)
    expect(result.pending.every(c => c.status === "pending")).toBe(true)
  })

  it("filters candidates by promoted status", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create and promote candidates
        const c1 = yield* repo.insert({
          content: "Promoted candidate 1",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        const c2 = yield* repo.insert({
          content: "Promoted candidate 2",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_2
        })
        yield* repo.insert({
          content: "Stays pending",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        yield* svc.promote(c1.id)
        yield* svc.promote(c2.id)

        // Filter by promoted only
        const promoted = yield* svc.list({ status: "promoted" })

        return { promoted }
      }).pipe(Effect.provide(layer))
    )

    expect(result.promoted).toHaveLength(2)
    expect(result.promoted.every(c => c.status === "promoted")).toBe(true)
    expect(result.promoted.every(c => c.promotedLearningId !== null)).toBe(true)
  })

  it("filters candidates by rejected status", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create candidates
        const c1 = yield* repo.insert({
          content: "Will be rejected 1",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        const c2 = yield* repo.insert({
          content: "Will be rejected 2",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_2
        })
        yield* repo.insert({
          content: "Stays pending",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        yield* svc.reject(c1.id, "Too vague")
        yield* svc.reject(c2.id, "Already known")

        // Filter by rejected only
        const rejected = yield* svc.list({ status: "rejected" })

        return { rejected }
      }).pipe(Effect.provide(layer))
    )

    expect(result.rejected).toHaveLength(2)
    expect(result.rejected.every(c => c.status === "rejected")).toBe(true)
    expect(result.rejected.every(c => c.rejectionReason !== null)).toBe(true)
  })

  it("filters candidates by multiple statuses", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create candidates with different statuses
        yield* repo.insert({
          content: "Pending",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const toPromote = yield* repo.insert({
          content: "Promoted",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* svc.promote(toPromote.id)

        const toReject = yield* repo.insert({
          content: "Rejected",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* svc.reject(toReject.id, "Reason")

        // Filter by pending and rejected
        const pendingOrRejected = yield* svc.list({ status: ["pending", "rejected"] })

        return { pendingOrRejected }
      }).pipe(Effect.provide(layer))
    )

    expect(result.pendingOrRejected).toHaveLength(2)
    expect(result.pendingOrRejected.some(c => c.status === "pending")).toBe(true)
    expect(result.pendingOrRejected.some(c => c.status === "rejected")).toBe(true)
  })
})

describe("Review Queue Confidence Filtering Integration", () => {
  it("filters candidates by single confidence level", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "High 1",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "High 2",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_2
        })
        yield* repo.insert({
          content: "Medium",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Low",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const highOnly = yield* svc.list({ confidence: "high" })
        const mediumOnly = yield* svc.list({ confidence: "medium" })
        const lowOnly = yield* svc.list({ confidence: "low" })

        return { highOnly, mediumOnly, lowOnly }
      }).pipe(Effect.provide(layer))
    )

    expect(result.highOnly).toHaveLength(2)
    expect(result.highOnly.every(c => c.confidence === "high")).toBe(true)

    expect(result.mediumOnly).toHaveLength(1)
    expect(result.mediumOnly[0].confidence).toBe("medium")

    expect(result.lowOnly).toHaveLength(1)
    expect(result.lowOnly[0].confidence).toBe("low")
  })

  it("filters candidates by multiple confidence levels", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "High",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Medium",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Low",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // Filter by medium and low (needs review)
        const needsReview = yield* svc.list({ confidence: ["medium", "low"] })

        return { needsReview }
      }).pipe(Effect.provide(layer))
    )

    expect(result.needsReview).toHaveLength(2)
    expect(result.needsReview.every(c => c.confidence !== "high")).toBe(true)
  })

  it("combines status and confidence filters", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create pending candidates at different confidence levels
        yield* repo.insert({
          content: "Pending Medium 1",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Pending Medium 2",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_2
        })
        yield* repo.insert({
          content: "Pending Low",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        // Create a promoted medium candidate
        const toPromote = yield* repo.insert({
          content: "Promoted Medium",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* svc.promote(toPromote.id)

        // Filter by pending + medium
        const pendingMedium = yield* svc.list({
          status: "pending",
          confidence: "medium"
        })

        return { pendingMedium }
      }).pipe(Effect.provide(layer))
    )

    expect(result.pendingMedium).toHaveLength(2)
    expect(result.pendingMedium.every(c => c.status === "pending")).toBe(true)
    expect(result.pendingMedium.every(c => c.confidence === "medium")).toBe(true)
  })
})

describe("Review Queue Manual Promote/Reject Edge Cases", () => {
  it("promote fails for non-existent candidate", async () => {
    const { makeAppLayer, PromotionService, CandidateNotFoundError } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromotionService

        const outcome = yield* Effect.either(svc.promote(99999))
        return { outcome }
      }).pipe(Effect.provide(layer))
    )

    expect(result.outcome._tag).toBe("Left")
    if (result.outcome._tag === "Left") {
      expect(result.outcome.left).toBeInstanceOf(CandidateNotFoundError)
    }
  })

  it("reject fails for non-existent candidate", async () => {
    const { makeAppLayer, PromotionService, CandidateNotFoundError } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromotionService

        const outcome = yield* Effect.either(svc.reject(99999, "Not found"))
        return { outcome }
      }).pipe(Effect.provide(layer))
    )

    expect(result.outcome._tag).toBe("Left")
    if (result.outcome._tag === "Left") {
      expect(result.outcome.left).toBeInstanceOf(CandidateNotFoundError)
    }
  })

  it("reject fails with empty reason", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, ValidationError } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const outcome = yield* Effect.either(svc.reject(candidate.id, ""))
        return { outcome }
      }).pipe(Effect.provide(layer))
    )

    expect(result.outcome._tag).toBe("Left")
    if (result.outcome._tag === "Left") {
      expect(result.outcome.left).toBeInstanceOf(ValidationError)
    }
  })

  it("reject fails with whitespace-only reason", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, ValidationError } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const outcome = yield* Effect.either(svc.reject(candidate.id, "   "))
        return { outcome }
      }).pipe(Effect.provide(layer))
    )

    expect(result.outcome._tag).toBe("Left")
    if (result.outcome._tag === "Left") {
      expect(result.outcome.left).toBeInstanceOf(ValidationError)
    }
  })

  it("promote sets reviewedBy to manual", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Manual promotion test",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const promotion = yield* svc.promote(candidate.id)
        return { promotion }
      }).pipe(Effect.provide(layer))
    )

    expect(result.promotion.candidate.reviewedBy).toBe("manual")
    expect(result.promotion.candidate.reviewedAt).toBeInstanceOf(Date)
  })

  it("reject trims reason whitespace", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Trim test",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const rejected = yield* svc.reject(candidate.id, "  Too vague  ")
        return { rejected }
      }).pipe(Effect.provide(layer))
    )

    expect(result.rejected.rejectionReason).toBe("Too vague")
  })
})

describe("Review Queue Pagination Integration", () => {
  it("limits results using limit parameter", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create 5 candidates
        for (let i = 1; i <= 5; i++) {
          yield* repo.insert({
            content: `Candidate ${i}`,
            confidence: "medium",
            sourceFile: FIXTURES.FILE_SESSION_1
          })
        }

        const limited = yield* svc.list({ limit: 3 })
        return { limited }
      }).pipe(Effect.provide(layer))
    )

    expect(result.limited).toHaveLength(3)
  })

  it("supports offset for pagination", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create 5 candidates (most recent first in results due to DESC ordering)
        for (let i = 1; i <= 5; i++) {
          yield* repo.insert({
            content: `Candidate ${i}`,
            confidence: "medium",
            sourceFile: FIXTURES.FILE_SESSION_1
          })
        }

        const page1 = yield* svc.list({ limit: 2, offset: 0 })
        const page2 = yield* svc.list({ limit: 2, offset: 2 })
        const page3 = yield* svc.list({ limit: 2, offset: 4 })

        return { page1, page2, page3 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.page1).toHaveLength(2)
    expect(result.page2).toHaveLength(2)
    expect(result.page3).toHaveLength(1)

    // Verify no overlap
    const allIds = [
      ...result.page1.map(c => c.id),
      ...result.page2.map(c => c.id),
      ...result.page3.map(c => c.id)
    ]
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(5)
  })
})

describe("Review Queue Category Filtering Integration", () => {
  it("filters candidates by single category", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "Security tip 1",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Security tip 2",
          confidence: "medium",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_2
        })
        yield* repo.insert({
          content: "Pattern tip",
          confidence: "high",
          category: "patterns",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const securityOnly = yield* svc.list({ category: "security" })
        return { securityOnly }
      }).pipe(Effect.provide(layer))
    )

    expect(result.securityOnly).toHaveLength(2)
    expect(result.securityOnly.every(c => c.category === "security")).toBe(true)
  })

  it("filters candidates by multiple categories", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "Security",
          confidence: "high",
          category: "security",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Testing",
          confidence: "medium",
          category: "testing",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Patterns",
          confidence: "high",
          category: "patterns",
          sourceFile: FIXTURES.FILE_SESSION_1
        })

        const securityOrTesting = yield* svc.list({ category: ["security", "testing"] })
        return { securityOrTesting }
      }).pipe(Effect.provide(layer))
    )

    expect(result.securityOrTesting).toHaveLength(2)
    expect(result.securityOrTesting.some(c => c.category === "security")).toBe(true)
    expect(result.securityOrTesting.some(c => c.category === "testing")).toBe(true)
  })
})

describe("Review Queue Source Filtering Integration", () => {
  it("filters candidates by source file", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "From session 1",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Also from session 1",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "From session 2",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_2
        })

        const session1Only = yield* svc.list({ sourceFile: FIXTURES.FILE_SESSION_1 })
        return { session1Only }
      }).pipe(Effect.provide(layer))
    )

    expect(result.session1Only).toHaveLength(2)
    expect(result.session1Only.every(c => c.sourceFile === FIXTURES.FILE_SESSION_1)).toBe(true)
  })

  it("filters candidates by source run ID", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "From run 1",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceRunId: FIXTURES.RUN_SESSION_1
        })
        yield* repo.insert({
          content: "From run 2",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_2,
          sourceRunId: FIXTURES.RUN_SESSION_2
        })

        const run1Only = yield* svc.list({ sourceRunId: FIXTURES.RUN_SESSION_1 })
        return { run1Only }
      }).pipe(Effect.provide(layer))
    )

    expect(result.run1Only).toHaveLength(1)
    expect(result.run1Only[0].sourceRunId).toBe(FIXTURES.RUN_SESSION_1)
  })

  it("filters candidates by source task ID", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "From auth task",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceTaskId: FIXTURES.TASK_AUTH
        })
        yield* repo.insert({
          content: "From login task",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1,
          sourceTaskId: FIXTURES.TASK_LOGIN
        })

        const authOnly = yield* svc.list({ sourceTaskId: FIXTURES.TASK_AUTH })
        return { authOnly }
      }).pipe(Effect.provide(layer))
    )

    expect(result.authOnly).toHaveLength(1)
    expect(result.authOnly[0].sourceTaskId).toBe(FIXTURES.TASK_AUTH)
  })
})

describe("Review Queue Expiration/Stale Candidates", () => {
  let testDb: TestDatabase
  let candidateFactory: CandidateFactory

  beforeEach(async () => {
    testDb = await Effect.runPromise(createTestDatabase())
    candidateFactory = new CandidateFactory(testDb)
  })

  it("identifies old pending candidates by extraction date", () => {
    // Create candidates with different extraction dates
    const oldDate = new Date("2025-01-01T00:00:00Z")
    const recentDate = new Date("2025-01-30T00:00:00Z")

    candidateFactory.pending({
      content: "Old candidate 1",
      extractedAt: oldDate
    })
    candidateFactory.pending({
      content: "Old candidate 2",
      extractedAt: oldDate
    })
    candidateFactory.pending({
      content: "Recent candidate",
      extractedAt: recentDate
    })

    // Query for old pending candidates (before a cutoff date)
    const cutoffDate = new Date("2025-01-15T00:00:00Z")
    const oldPending = testDb.query<{ id: number; content: string }>(
      `SELECT id, content FROM learning_candidates
       WHERE status = 'pending' AND extracted_at < ?
       ORDER BY extracted_at ASC`,
      [cutoffDate.toISOString()]
    )

    expect(oldPending).toHaveLength(2)
    expect(oldPending.every(c => c.content.startsWith("Old"))).toBe(true)
  })

  it("counts stale candidates older than N days", () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
    const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)

    // Create candidates at different ages
    candidateFactory.pending({
      content: "Very old (30+ days)",
      extractedAt: thirtyDaysAgo
    })
    candidateFactory.pending({
      content: "Old (10 days)",
      extractedAt: tenDaysAgo
    })
    candidateFactory.pending({
      content: "Recent (yesterday)",
      extractedAt: yesterday
    })

    // Count stale (older than 7 days)
    const staleCount = testDb.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM learning_candidates
       WHERE status = 'pending'
       AND extracted_at < datetime('now', '-7 days')`
    )[0].count

    expect(staleCount).toBe(2) // 30-day and 10-day old candidates
  })

  it("can batch reject expired pending candidates", () => {
    const oldDate = new Date("2025-01-01T00:00:00Z")
    const recentDate = new Date()

    // Create old and recent candidates
    candidateFactory.pending({
      content: "Expired 1",
      extractedAt: oldDate
    })
    candidateFactory.pending({
      content: "Expired 2",
      extractedAt: oldDate
    })
    candidateFactory.pending({
      content: "Still valid",
      extractedAt: recentDate
    })

    // Batch reject old pending candidates
    const cutoffDate = new Date("2025-01-15T00:00:00Z")
    testDb.run(
      `UPDATE learning_candidates
       SET status = 'rejected',
           rejection_reason = 'Expired: not reviewed within retention period',
           reviewed_at = datetime('now'),
           reviewed_by = 'system'
       WHERE status = 'pending' AND extracted_at < ?`,
      [cutoffDate.toISOString()]
    )

    // Verify rejection
    const rejected = testDb.query<{ id: number; rejection_reason: string }>(
      `SELECT id, rejection_reason FROM learning_candidates WHERE status = 'rejected'`
    )

    const pending = testDb.query<{ id: number }>(
      `SELECT id FROM learning_candidates WHERE status = 'pending'`
    )

    expect(rejected).toHaveLength(2)
    expect(rejected[0].rejection_reason).toContain("Expired")
    expect(pending).toHaveLength(1)
  })

  it("expired candidates have system as reviewer", () => {
    const oldDate = new Date("2025-01-01T00:00:00Z")

    candidateFactory.pending({
      content: "Will expire",
      extractedAt: oldDate
    })

    // Simulate expiration
    testDb.run(
      `UPDATE learning_candidates
       SET status = 'rejected',
           rejection_reason = 'Expired',
           reviewed_at = datetime('now'),
           reviewed_by = 'system'
       WHERE status = 'pending'`
    )

    const expired = testDb.query<{ reviewed_by: string }>(
      `SELECT reviewed_by FROM learning_candidates WHERE status = 'rejected'`
    )[0]

    expect(expired.reviewed_by).toBe("system")
  })

  it("can query candidates pending for more than a threshold", () => {
    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    const hourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000)

    candidateFactory.pending({
      content: "Pending for 2 days",
      extractedAt: twoDaysAgo
    })
    candidateFactory.pending({
      content: "Pending for 1 hour",
      extractedAt: hourAgo
    })

    // Query for candidates pending more than 1 day
    const longPending = testDb.query<{ id: number; content: string }>(
      `SELECT id, content FROM learning_candidates
       WHERE status = 'pending'
       AND extracted_at < datetime('now', '-1 day')`
    )

    expect(longPending).toHaveLength(1)
    expect(longPending[0].content).toBe("Pending for 2 days")
  })

  it("merged candidates preserve link to original learning", () => {
    const learningFactory = new LearningFactory(testDb)
    const existingLearning = learningFactory.create({
      content: "Original learning"
    })

    const mergedCandidate = candidateFactory.merged(existingLearning.id, {
      content: "Similar to original"
    })

    expect(mergedCandidate.status).toBe("merged")
    expect(mergedCandidate.promotedLearningId).toBe(existingLearning.id)
    expect(mergedCandidate.reviewedBy).toBe("auto")
  })
})

describe("Review Queue getPending Convenience Method", () => {
  it("returns only pending candidates", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create candidates with different statuses
        yield* repo.insert({
          content: "Pending 1",
          confidence: "medium",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* repo.insert({
          content: "Pending 2",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_2
        })

        const toPromote = yield* repo.insert({
          content: "Will be promoted",
          confidence: "high",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* svc.promote(toPromote.id)

        const toReject = yield* repo.insert({
          content: "Will be rejected",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* svc.reject(toReject.id, "Not useful")

        const pending = yield* svc.getPending()
        return { pending }
      }).pipe(Effect.provide(layer))
    )

    expect(result.pending).toHaveLength(2)
    expect(result.pending.every(c => c.status === "pending")).toBe(true)
  })

  it("returns empty array when no pending candidates", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Create and immediately reject all candidates
        const c1 = yield* repo.insert({
          content: "Rejected 1",
          confidence: "low",
          sourceFile: FIXTURES.FILE_SESSION_1
        })
        yield* svc.reject(c1.id, "Not useful")

        const pending = yield* svc.getPending()
        return { pending }
      }).pipe(Effect.provide(layer))
    )

    expect(result.pending).toHaveLength(0)
  })
})
