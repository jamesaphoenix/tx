/**
 * SwarmVerificationService Integration Tests
 *
 * Tests for PRD-017: Bulk invalidation via agent swarm (IM-004)
 *
 * Coverage:
 * 1. verifyAnchors with small batch uses sequential processing
 * 2. verifyAnchors with large batch uses swarm (concurrent agents)
 * 3. verifyAll processes all valid anchors
 * 4. verifyGlob filters anchors by glob pattern
 * 5. verifyChangedFiles verifies anchors for specified files
 * 6. Swarm metrics tracked correctly (duration, counts, concurrency)
 * 7. Majority vote helper function works correctly
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 *
 * @see docs/prd/PRD-017-invalidation-maintenance.md
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services once at module level
import {
  SwarmVerificationService,
  LearningService,
  AnchorService,
  AnchorRepository,
  calculateMajorityVote
} from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs for determinism)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`swarm-verification-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  LEARNING_1: fixtureId("learning-1"),
  LEARNING_2: fixtureId("learning-2"),
  FILE_1: "file1.ts",
  FILE_2: "file2.ts",
  FILE_3: "file3.ts",
  GLOB_PATTERN: "**/*.ts",
} as const

// =============================================================================
// Helper Functions
// =============================================================================

let tempDir: string

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tx-swarm-verification-test-"))
  return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // Ignore errors during cleanup
  }
}

async function createTestFile(dir: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(dir, fileName)
  await fs.writeFile(filePath, content, "utf-8")
  return filePath
}

// =============================================================================
// SwarmVerificationService Tests
// =============================================================================

describe("SwarmVerificationService Integration", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  describe("verifyAnchors - batch verification", () => {
    it("uses sequential processing for small batches", async () => {
      // Create test files
      const file1 = await createTestFile(tempDir, FIXTURES.FILE_1, "export const a = 1")
      const file2 = await createTestFile(tempDir, FIXTURES.FILE_2, "export const b = 2")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create 2 anchors (below SWARM_THRESHOLD of 20)
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: file1,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: file2,
            value: "*.ts"
          })

          return yield* swarmSvc.verifyAnchors([1, 2], { baseDir: tempDir })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(2)
      expect(result.metrics.agentsUsed).toBe(1) // Sequential = 1 agent
      expect(result.metrics.unchanged).toBe(2)
      expect(result.results.length).toBe(2)
    })

    it("uses swarm processing when forceSwarm is true", async () => {
      // Create test files
      const files: string[] = []
      for (let i = 0; i < 5; i++) {
        const file = await createTestFile(tempDir, `file${i}.ts`, `export const x${i} = ${i}`)
        files.push(file)
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create anchors for each file
          for (const file of files) {
            yield* anchorSvc.createAnchor({
              learningId: learning.id,
              anchorType: "glob",
              filePath: file,
              value: "*.ts"
            })
          }

          return yield* swarmSvc.verifyAnchors([1, 2, 3, 4, 5], {
            baseDir: tempDir,
            forceSwarm: true,
            batchSize: 2 // 5 anchors / 2 per batch = 3 batches
          })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(5)
      expect(result.metrics.totalBatches).toBe(3) // ceil(5/2) = 3 batches
      expect(result.metrics.agentsUsed).toBe(3) // min(batches, maxConcurrent)
      expect(result.metrics.unchanged).toBe(5)
    })

    it("handles empty anchor list gracefully", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const swarmSvc = yield* SwarmVerificationService
          return yield* swarmSvc.verifyAnchors([], { baseDir: tempDir })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(0)
      expect(result.metrics.totalBatches).toBe(0)
      expect(result.metrics.agentsUsed).toBe(0)
      expect(result.results.length).toBe(0)
    })
  })

  describe("verifyAll - verify all valid anchors", () => {
    it("processes all valid anchors using swarm for large batches", async () => {
      // Create many test files to trigger swarm
      const files: string[] = []
      for (let i = 0; i < 25; i++) {
        const file = await createTestFile(tempDir, `file${i}.ts`, `export const v${i} = ${i}`)
        files.push(file)
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create 25 anchors (above SWARM_THRESHOLD of 20)
          for (const file of files) {
            yield* anchorSvc.createAnchor({
              learningId: learning.id,
              anchorType: "glob",
              filePath: file,
              value: "*.ts"
            })
          }

          return yield* swarmSvc.verifyAll({ baseDir: tempDir })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(25)
      expect(result.metrics.agentsUsed).toBeGreaterThan(1) // Should use multiple agents
      expect(result.metrics.unchanged).toBe(25)
    })

    it("skips pinned anchors when skipPinned is true", async () => {
      const file1 = await createTestFile(tempDir, FIXTURES.FILE_1, "export const a = 1")
      const file2 = await createTestFile(tempDir, FIXTURES.FILE_2, "export const b = 2")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: file1,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: file2,
            value: "*.ts"
          })

          // Pin one anchor
          yield* anchorSvc.pin(1)

          return yield* swarmSvc.verifyAll({ baseDir: tempDir, skipPinned: true })
        }).pipe(Effect.provide(shared.layer))
      )

      // Only unpinned anchor should be verified
      expect(result.metrics.totalAnchors).toBe(1)
      expect(result.metrics.unchanged).toBe(1)
    })
  })

  describe("verifyGlob - verify anchors matching glob", () => {
    it("verifies only anchors matching glob pattern", async () => {
      const tsFile = await createTestFile(tempDir, "code.ts", "export const ts = true")
      const jsFile = await createTestFile(tempDir, "code.js", "export const js = true")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create anchor for .ts file
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: tsFile,
            value: "*.ts"
          })

          // Create anchor for .js file
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: jsFile,
            value: "*.js"
          })

          // Verify only .ts files
          return yield* swarmSvc.verifyGlob("**/*.ts", { baseDir: tempDir })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(1) // Only .ts anchor
      expect(result.metrics.unchanged).toBe(1)
    })
  })

  describe("verifyChangedFiles - verify anchors for specific files", () => {
    it("verifies anchors for changed files only", async () => {
      const file1 = await createTestFile(tempDir, FIXTURES.FILE_1, "export const a = 1")
      const file2 = await createTestFile(tempDir, FIXTURES.FILE_2, "export const b = 2")
      const file3 = await createTestFile(tempDir, FIXTURES.FILE_3, "export const c = 3")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create anchors for all files
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: file1,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: file2,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: file3,
            value: "*.ts"
          })

          // Only file1 and file2 changed
          return yield* swarmSvc.verifyChangedFiles([file1, file2], { baseDir: tempDir })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(2) // Only file1 and file2
      expect(result.metrics.unchanged).toBe(2)
    })

    it("sets detectedBy to git_hook by default", async () => {
      // File doesn't exist, so it will be marked invalid
      const filePath = path.join(tempDir, "nonexistent.ts")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService
          const anchorRepo = yield* AnchorRepository

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: filePath,
            value: "*.ts"
          })

          yield* swarmSvc.verifyChangedFiles([filePath], { baseDir: tempDir })

          // Check invalidation log
          const logs = yield* anchorRepo.getInvalidationLogs(1)
          return logs
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result[0].detectedBy).toBe("git_hook")
    })
  })

  describe("swarm metrics tracking", () => {
    it("tracks all metrics correctly", async () => {
      // Create some valid files and some that will be invalid
      const validFile = await createTestFile(tempDir, "valid.ts", "export const v = 1")
      const invalidFilePath = path.join(tempDir, "invalid.ts") // Does not exist

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create valid anchor
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: validFile,
            value: "*.ts"
          })

          // Create anchor for non-existent file
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: invalidFilePath,
            value: "*.ts"
          })

          return yield* swarmSvc.verifyAnchors([1, 2], { baseDir: tempDir })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(2)
      expect(result.metrics.unchanged).toBe(1)
      expect(result.metrics.invalid).toBe(1)
      expect(result.metrics.duration).toBeGreaterThanOrEqual(0)
      expect(result.metrics.agentDurations.length).toBeGreaterThan(0)
      expect(result.metrics.errors).toBe(0)
      expect(result.metrics.needsReview).toBe(0)
    })
  })

  describe("calculateMajorityVote utility", () => {
    it("returns consensus when majority agrees", async () => {
      const results = [
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "valid" as const, action: "unchanged" as const },
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "valid" as const, action: "unchanged" as const },
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "drifted" as const, action: "drifted" as const },
      ]

      const vote = calculateMajorityVote(results)

      expect(vote.anchorId).toBe(1)
      expect(vote.consensus).toBe("valid")
      expect(vote.needsReview).toBe(false)
      expect(vote.votes.get("valid")).toBe(2)
      expect(vote.votes.get("drifted")).toBe(1)
    })

    it("marks as needsReview when there is a tie", async () => {
      const results = [
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "valid" as const, action: "unchanged" as const },
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "drifted" as const, action: "drifted" as const },
      ]

      const vote = calculateMajorityVote(results)

      expect(vote.anchorId).toBe(1)
      expect(vote.consensus).toBe(null)
      expect(vote.needsReview).toBe(true)
    })

    it("handles unanimous agreement", async () => {
      const results = [
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "invalid" as const, action: "invalidated" as const },
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "invalid" as const, action: "invalidated" as const },
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "invalid" as const, action: "invalidated" as const },
        { anchorId: 1, previousStatus: "valid" as const, newStatus: "invalid" as const, action: "invalidated" as const },
      ]

      const vote = calculateMajorityVote(results)

      expect(vote.consensus).toBe("invalid")
      expect(vote.needsReview).toBe(false)
      expect(vote.votes.get("invalid")).toBe(4)
    })
  })

  describe("concurrent agent processing", () => {
    it("limits concurrent agents to maxConcurrent setting", async () => {
      // Create many files
      const files: string[] = []
      for (let i = 0; i < 20; i++) {
        const file = await createTestFile(tempDir, `concurrent${i}.ts`, `export const c${i} = ${i}`)
        files.push(file)
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const swarmSvc = yield* SwarmVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          for (const file of files) {
            yield* anchorSvc.createAnchor({
              learningId: learning.id,
              anchorType: "glob",
              filePath: file,
              value: "*.ts"
            })
          }

          const anchorIds = Array.from({ length: 20 }, (_, i) => i + 1)

          return yield* swarmSvc.verifyAnchors(anchorIds, {
            baseDir: tempDir,
            forceSwarm: true,
            batchSize: 5, // 20 anchors / 5 per batch = 4 batches
            maxConcurrent: 2 // Limit to 2 concurrent agents
          })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.metrics.totalAnchors).toBe(20)
      expect(result.metrics.totalBatches).toBe(4)
      expect(result.metrics.agentsUsed).toBe(2) // Limited to maxConcurrent
      expect(result.metrics.unchanged).toBe(20)
    })
  })
})
