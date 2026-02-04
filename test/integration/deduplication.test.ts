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
import { DeduplicationService, BatchProcessingError } from "@jamesaphoenix/tx-core"

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

// =============================================================================
// Batch Processing Tests
// =============================================================================

describe("DeduplicationService batch processing", () => {
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

  it("processLines handles large datasets with custom batch size", async () => {
    // Create 250 unique lines to test batch processing across multiple batches
    const lines = Array.from({ length: 250 }, (_, i) => ({
      content: `{"id": ${i}, "data": "line-${i}-${Date.now()}"}`,
      lineNumber: i + 1
    }))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLines(lines, FIXTURES.FILE_1, { batchSize: 50 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.totalLines).toBe(250)
    expect(result.newLines).toBe(250)
    expect(result.skippedLines).toBe(0)
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(250)
  })

  it("processLines handles batch boundary correctly", async () => {
    // Create exactly 100 lines (default batch size boundary)
    const lines = Array.from({ length: 100 }, (_, i) => ({
      content: `{"batch_boundary_test": ${i}}`,
      lineNumber: i + 1
    }))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.processLines(lines, FIXTURES.FILE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.newLines).toBe(100)
    expect(result.endLine).toBe(100)
  })

  it("filterProcessed handles batching with custom batch size", async () => {
    // Process 150 lines first
    const originalLines = Array.from({ length: 150 }, (_, i) => ({
      content: `{"filter_test": ${i}}`,
      lineNumber: i + 1
    }))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // First process the lines
        yield* dedupSvc.processLines(originalLines, FIXTURES.FILE_1, { batchSize: 50 })

        // Now filter with a mix of processed and unprocessed
        const contentsToFilter = [
          ...originalLines.slice(0, 75).map(l => l.content), // 75 processed
          '{"filter_test": "new_1"}', // unprocessed
          '{"filter_test": "new_2"}', // unprocessed
        ]

        return yield* dedupSvc.filterProcessed(contentsToFilter, { batchSize: 25 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(75) // Only the 75 processed ones
  })

  it("filterProcessed handles empty input", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService
        return yield* dedupSvc.filterProcessed([])
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(0)
  })

  it("filterProcessed with single item", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process one line
        yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)

        // Filter with just that one
        return yield* dedupSvc.filterProcessed([FIXTURES.LINE_1])
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(1)
    expect(result.has(FIXTURES.LINE_1)).toBe(true)
  })
})

// =============================================================================
// Race Condition / Concurrency Tests
// =============================================================================

describe("DeduplicationService race condition handling", () => {
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

  it("concurrent processLine calls for same content result in exactly one isNew=true", async () => {
    // This tests the race condition fix: when multiple concurrent calls try to
    // process the same content, only one should succeed with isNew=true.
    // The atomic INSERT OR IGNORE approach ensures no duplicates are created.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Launch 10 concurrent calls for the same content
        const concurrentCalls = Array.from({ length: 10 }, () =>
          dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)
        )

        const results = yield* Effect.all(concurrentCalls, { concurrency: "unbounded" })
        return results
      }).pipe(Effect.provide(shared.layer))
    )

    // Exactly one should be new, the rest should be duplicates
    const newCount = result.filter(r => r.isNew).length
    const duplicateCount = result.filter(r => !r.isNew).length

    expect(newCount).toBe(1)
    expect(duplicateCount).toBe(9)

    // All should have the same hash
    const hashes = new Set(result.map(r => r.hash))
    expect(hashes.size).toBe(1)
  })

  it("concurrent processLine calls for different content all succeed with isNew=true", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Launch concurrent calls for different content
        const concurrentCalls = [
          dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1),
          dedupSvc.processLine(FIXTURES.LINE_2, FIXTURES.FILE_1, 2),
          dedupSvc.processLine(FIXTURES.LINE_3, FIXTURES.FILE_1, 3),
        ]

        const results = yield* Effect.all(concurrentCalls, { concurrency: "unbounded" })
        return results
      }).pipe(Effect.provide(shared.layer))
    )

    // All should be new since they're different content
    expect(result.every(r => r.isNew)).toBe(true)

    // All should have different hashes
    const hashes = new Set(result.map(r => r.hash))
    expect(hashes.size).toBe(3)
  })

  it("rapid sequential processLine calls handle duplicates correctly", async () => {
    // Test that even rapid sequential calls handle duplicates without errors
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Call processLine many times in rapid sequence
        const results: Array<{ isNew: boolean; hash: string }> = []
        for (let i = 0; i < 20; i++) {
          const r = yield* dedupSvc.processLine(FIXTURES.LINE_1, FIXTURES.FILE_1, 1)
          results.push(r)
        }

        return results
      }).pipe(Effect.provide(shared.layer))
    )

    // First call should be new, all subsequent should be duplicates
    expect(result[0].isNew).toBe(true)
    expect(result.slice(1).every(r => !r.isNew)).toBe(true)
  })

  it("concurrent processLines batches don't create duplicates across batches", async () => {
    // Create lines with some overlap
    const lines1 = [
      { content: FIXTURES.LINE_1, lineNumber: 1 },
      { content: FIXTURES.LINE_2, lineNumber: 2 },
    ]
    const lines2 = [
      { content: FIXTURES.LINE_1, lineNumber: 1 }, // overlap with lines1
      { content: FIXTURES.LINE_3, lineNumber: 2 },
    ]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dedupSvc = yield* DeduplicationService

        // Process both batches concurrently
        const [result1, result2] = yield* Effect.all(
          [
            dedupSvc.processLines(lines1, FIXTURES.FILE_1),
            dedupSvc.processLines(lines2, FIXTURES.FILE_2),
          ],
          { concurrency: "unbounded" }
        )

        // Check final state
        const stats = yield* dedupSvc.getStats()

        return { result1, result2, stats }
      }).pipe(Effect.provide(shared.layer))
    )

    // Combined, we should have processed 3 unique lines (LINE_1 appears in both)
    // Total new lines should be 3 across both results
    expect(result.result1.newLines + result.result2.newLines).toBe(3)
    expect(result.stats.totalHashes).toBe(3)
  })
})

// =============================================================================
// BatchProcessingError Structure Tests
// =============================================================================

describe("BatchProcessingError structure", () => {
  it("BatchProcessingError contains expected fields", () => {
    const error = new BatchProcessingError({
      operation: "hashesExist",
      batchIndex: 2,
      totalBatches: 5,
      partialResult: {
        filePath: "/test/file.jsonl",
        totalLines: 100,
        newLines: 40,
        skippedLines: 10,
        startLine: 1,
        endLine: 50,
        duration: 123
      },
      cause: new Error("Database connection lost")
    })

    expect(error._tag).toBe("BatchProcessingError")
    expect(error.operation).toBe("hashesExist")
    expect(error.batchIndex).toBe(2)
    expect(error.totalBatches).toBe(5)
    expect(error.partialResult.newLines).toBe(40)
    expect(error.partialResult.skippedLines).toBe(10)
    expect(error.message).toContain("batch 3/5") // batchIndex + 1
    expect(error.message).toContain("hashesExist")
  })

  it("BatchProcessingError works with Set partial result for filterProcessed", () => {
    const partialSet = new Set(["content1", "content2"])
    const error = new BatchProcessingError({
      operation: "filterProcessed",
      batchIndex: 1,
      totalBatches: 3,
      partialResult: partialSet,
      cause: new Error("Query timeout")
    })

    expect(error.partialResult).toBeInstanceOf(Set)
    expect(error.partialResult.size).toBe(2)
    expect(error.partialResult.has("content1")).toBe(true)
  })
})
