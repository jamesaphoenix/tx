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

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  createTestDatabase,
  CandidateFactory,
  LearningFactory,
  fixtureId,
  type TestDatabase
} from "@tx/test-utils"
import {
  CandidateExtractorService,
  CandidateExtractorServiceNoop
} from "@tx/core"

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
    const { makeAppLayer, DeduplicationService } = await import("@tx/core")
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
    const { makeAppLayer, DeduplicationService } = await import("@tx/core")
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
    const { makeAppLayer, DeduplicationService } = await import("@tx/core")
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
    const { makeAppLayer, DeduplicationService } = await import("@tx/core")
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
    const { makeAppLayer, DeduplicationService } = await import("@tx/core")
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
    const { makeAppLayer, DeduplicationService } = await import("@tx/core")
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
    const { makeAppLayer, DeduplicationService } = await import("@tx/core")
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
