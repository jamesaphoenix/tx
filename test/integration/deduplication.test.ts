/**
 * DeduplicationService Integration Tests
 *
 * Tests the DeduplicationService for JSONL line hash-based deduplication.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 * Previously created a new database per test, now creates 1 per describe block.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services once at module level
import { DeduplicationService } from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures
// =============================================================================

const FIXTURES = {
  FILE_1: "/tmp/test/session1.jsonl",
  FILE_2: "/tmp/test/session2.jsonl",
  LINE_1: '{"type":"user","content":"Hello world"}',
  LINE_2: '{"type":"assistant","content":"Hi there!"}',
  LINE_3: '{"type":"tool_call","tool":"Read","input":{"path":"src/index.ts"}}',
} as const

// =============================================================================
// DeduplicationService CRUD Tests
// =============================================================================

describe("DeduplicationService Integration", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("processLine records new hash and returns isNew=true", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.isNew).toBe(true)
    expect(result.hash).toBeDefined()
    expect(result.hash.length).toBe(64) // SHA256 hex length
    expect(result.lineNumber).toBe(1)
    expect(result.content).toBe(FIXTURES.LINE_1)
  })

  it("processLine returns isNew=false for duplicate content", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // First time - should be new
        const first = yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)

        // Second time - same content, different file/line
        const second = yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_2, 5)

        return { first, second }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.first.isNew).toBe(true)
    expect(result.second.isNew).toBe(false)
    expect(result.first.hash).toBe(result.second.hash)
  })

  it("processLines handles batch processing efficiently", async () => {
    const lines = [
      { content: FIXTURES.LINE_1, lineNumber: 1 },
      { content: FIXTURES.LINE_2, lineNumber: 2 },
      { content: FIXTURES.LINE_3, lineNumber: 3 },
    ]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLines(lines, FIXTURES.FILE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.filePath).toBe(FIXTURES.FILE_1)
    expect(result.totalLines).toBe(3)
    expect(result.newLines).toBe(3)
    expect(result.skippedLines).toBe(0)
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(3)
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it("processLines skips already processed lines", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // First batch
        const lines1 = [
          { content: FIXTURES.LINE_1, lineNumber: 1 },
          { content: FIXTURES.LINE_2, lineNumber: 2 },
        ]
        const first = yield* dedupSvc.processLines(lines1, FIXTURES.FILE_1)

        // Second batch with overlap
        const lines2 = [
          { content: FIXTURES.LINE_1, lineNumber: 1 }, // duplicate
          { content: FIXTURES.LINE_3, lineNumber: 2 }, // new
        ]
        const second = yield* dedupSvc.processLines(lines2, FIXTURES.FILE_2)

        return { first, second }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.first.newLines).toBe(2)
    expect(result.first.skippedLines).toBe(0)
    expect(result.second.newLines).toBe(1)
    expect(result.second.skippedLines).toBe(1)
  })

  it("processLines respects startLine option for incremental processing", async () => {
    const lines = [
      { content: FIXTURES.LINE_1, lineNumber: 1 },
      { content: FIXTURES.LINE_2, lineNumber: 2 },
      { content: FIXTURES.LINE_3, lineNumber: 3 },
    ]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLines(lines, FIXTURES.FILE_1, { startLine: 2 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.newLines).toBe(2) // Only lines 2 and 3
    expect(result.startLine).toBe(2)
    expect(result.endLine).toBe(3)
  })

  it("processLines respects maxLines option", async () => {
    const lines = [
      { content: FIXTURES.LINE_1, lineNumber: 1 },
      { content: FIXTURES.LINE_2, lineNumber: 2 },
      { content: FIXTURES.LINE_3, lineNumber: 3 },
    ]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLines(lines, FIXTURES.FILE_1, { maxLines: 2 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.newLines).toBe(2)
    expect(result.endLine).toBe(2)
  })
})

// =============================================================================
// Hash Checking Tests
// =============================================================================

describe("DeduplicationService hash checking", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("isProcessed returns false for new content", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.isProcessed(FIXTURES.LINE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBe(false)
  })

  it("isProcessed returns true after processing", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process the line first
        yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)

        // Check if processed
        return yield* dedupSvc.isProcessed(FIXTURES.LINE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBe(true)
  })

  it("filterProcessed returns set of processed contents", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process some lines
        yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)
        yield* dedupSvc.processLine(FIXTURES.LINE_2, FIXTURES.FILE_1, 2)

        // Check multiple contents
        return yield* dedupSvc.filterProcessed([
          FIXTURES.LINE_1, // processed
          FIXTURES.LINE_2, // processed
          FIXTURES.LINE_3, // not processed
        ])
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(2)
    expect(result.has(FIXTURES.LINE_1)).toBe(true)
    expect(result.has(FIXTURES.LINE_2)).toBe(true)
    expect(result.has(FIXTURES.LINE_3)).toBe(false)
  })

  it("computeHash returns consistent SHA256 hash", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        const hash1 = dedupSvc.computeHash(FIXTURES.LINE_1)
        const hash2 = dedupSvc.computeHash(FIXTURES.LINE_1)
        const hash3 = dedupSvc.computeHash(FIXTURES.LINE_2)

        return { hash1, hash2, hash3 }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.hash1).toBe(result.hash2) // Same content = same hash
    expect(result.hash1).not.toBe(result.hash3) // Different content = different hash
    expect(result.hash1.length).toBe(64) // SHA256 hex length
  })
})

// =============================================================================
// File Progress Tests
// =============================================================================

describe("DeduplicationService file progress", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("getProgress returns null for unknown file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.getProgress("/unknown/file.jsonl")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("updateProgress creates new progress record", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.updateProgress(
          FIXTURES.FILE_1,
          100,
          5000,
          10000,
          "abc123"
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.filePath).toBe(FIXTURES.FILE_1)
    expect(result.lastLineProcessed).toBe(100)
    expect(result.lastByteOffset).toBe(5000)
    expect(result.fileSize).toBe(10000)
    expect(result.fileChecksum).toBe("abc123")
    expect(result.lastProcessedAt).toBeInstanceOf(Date)
  })

  it("updateProgress updates existing progress record", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Create initial progress
        yield* dedupSvc.updateProgress(FIXTURES.FILE_1, 50, 2500)

        // Update progress
        const updated = yield* dedupSvc.updateProgress(FIXTURES.FILE_1, 100, 5000)

        return updated
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.lastLineProcessed).toBe(100)
    expect(result.lastByteOffset).toBe(5000)
  })

  it("getProgress returns saved progress", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        yield* dedupSvc.updateProgress(FIXTURES.FILE_1, 100, 5000, 10000, "abc123")

        return yield* dedupSvc.getProgress(FIXTURES.FILE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.filePath).toBe(FIXTURES.FILE_1)
    expect(result!.lastLineProcessed).toBe(100)
  })
})

// =============================================================================
// Reset Tests
// =============================================================================

describe("DeduplicationService reset", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("resetFile clears hashes and progress for a file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process some lines
        const lines = [
          { content: FIXTURES.LINE_1, lineNumber: 1 },
          { content: FIXTURES.LINE_2, lineNumber: 2 },
        ]
        yield* dedupSvc.processLines(lines, FIXTURES.FILE_1)
        yield* dedupSvc.updateProgress(FIXTURES.FILE_1, 2, 1000)

        // Reset
        const resetResult = yield* dedupSvc.resetFile(FIXTURES.FILE_1)

        // Check progress is cleared
        const progress = yield* dedupSvc.getProgress(FIXTURES.FILE_1)

        // Lines should now be "new" again
        const reprocess = yield* dedupSvc.processLines(lines, FIXTURES.FILE_1)

        return { resetResult, progress, reprocess }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.resetResult.hashesDeleted).toBe(2)
    expect(result.progress).toBeNull()
    expect(result.reprocess.newLines).toBe(2) // Lines are new again
  })

  it("resetFile only affects specified file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process lines in two files
        yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)
        yield* dedupSvc.processLine(FIXTURES.LINE_2, FIXTURES.FILE_2, 1)

        // Reset only file 1
        yield* dedupSvc.resetFile(FIXTURES.FILE_1)

        // Check: LINE_1 should be new, LINE_2 should still be processed
        const isLine1Processed = yield* dedupSvc.isProcessed(FIXTURES.LINE_1)
        const isLine2Processed = yield* dedupSvc.isProcessed(FIXTURES.LINE_2)

        return { isLine1Processed, isLine2Processed }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.isLine1Processed).toBe(false) // Reset
    expect(result.isLine2Processed).toBe(true) // Still processed
  })
})

// =============================================================================
// Statistics Tests
// =============================================================================

describe("DeduplicationService statistics", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("getStats returns counts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process lines in multiple files
        yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)
        yield* dedupSvc.processLine(FIXTURES.LINE_2, FIXTURES.FILE_1, 2)
        yield* dedupSvc.processLine(FIXTURES.LINE_3, FIXTURES.FILE_2, 1)

        yield* dedupSvc.updateProgress(FIXTURES.FILE_1, 2, 1000)
        yield* dedupSvc.updateProgress(FIXTURES.FILE_2, 1, 500)

        return yield* dedupSvc.getStats()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.totalHashes).toBe(3)
    expect(result.trackedFiles).toBe(2)
  })

  it("getStats returns zeros for empty database", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.getStats()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.totalHashes).toBe(0)
    expect(result.trackedFiles).toBe(0)
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe("DeduplicationService edge cases", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("handles empty lines array", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLines([], FIXTURES.FILE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.totalLines).toBe(0)
    expect(result.newLines).toBe(0)
    expect(result.skippedLines).toBe(0)
  })

  it("handles empty content string", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLine("", FIXTURES.FILE_1, 1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.isNew).toBe(true)
    expect(result.hash.length).toBe(64)
  })

  it("handles very long content", async () => {
    const longContent = "x".repeat(100000)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLine(longContent, FIXTURES.FILE_1, 1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.isNew).toBe(true)
    expect(result.hash.length).toBe(64)
  })

  it("handles unicode content", async () => {
    const unicodeContent = '{"message": "Hello 世界 🌍 مرحبا"}'

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLine(unicodeContent, FIXTURES.FILE_1, 1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.isNew).toBe(true)
    expect(result.content).toBe(unicodeContent)
  })
})
