/**
 * AnchorVerificationService Integration Tests
 *
 * Tests for PRD-017: Periodic anchor verification service
 *
 * Coverage:
 * 1. verify valid anchor returns unchanged
 * 2. verify drifted anchor (hash mismatch) marks as drifted
 * 3. verify invalid anchor (file deleted) marks as invalid
 * 4. verifyAll processes all anchors
 * 5. verifyFile verifies only file-specific anchors
 * 6. verification results logged to invalidation_log
 *
 * @see docs/prd/PRD-017-invalidation-maintenance.md
 * @see docs/design/DD-017-invalidation-maintenance.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs for determinism)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`anchor-verification-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  LEARNING_1: fixtureId("learning-1"),
  LEARNING_2: fixtureId("learning-2"),
  FILE_VALID: "valid-file.ts",
  FILE_DELETED: "deleted-file.ts",
  FILE_DRIFTED: "drifted-file.ts",
  FILE_WITH_SYMBOL: "symbol-file.ts",
  GLOB_PATTERN: "**/*.ts",
  SYMBOL_NAME: "MyTestFunction",
  SYMBOL_FQNAME: "symbol-file.ts::MyTestFunction",
} as const

// =============================================================================
// Helper Functions
// =============================================================================

let tempDir: string

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tx-anchor-verification-test-"))
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

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

// =============================================================================
// AnchorVerificationService Tests
// =============================================================================

describe("AnchorVerificationService Integration", () => {
  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  describe("verify - single anchor verification", () => {
    it("returns unchanged for valid glob anchor with existing file", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create test file
      const filePath = await createTestFile(tempDir, FIXTURES.FILE_VALID, "export const valid = true")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          // Create learning and anchor
          const learning = yield* learningSvc.create({
            content: "Test learning for valid file",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: filePath,
            value: "*.ts"
          })

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("unchanged")
      expect(result.previousStatus).toBe("valid")
      expect(result.newStatus).toBe("valid")
    })

    it("marks anchor as invalid when file is deleted", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create test file then delete it
      const filePath = await createTestFile(tempDir, FIXTURES.FILE_DELETED, "export const deleted = true")
      await fs.unlink(filePath)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning for deleted file",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: filePath,
            value: "*.ts"
          })

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("invalidated")
      expect(result.newStatus).toBe("invalid")
      expect(result.reason).toBe("file_deleted")
    })

    it("marks hash anchor as drifted when content changes", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create test file with initial content
      const initialContent = "export const original = true"
      const filePath = await createTestFile(tempDir, FIXTURES.FILE_DRIFTED, initialContent)
      const originalHash = computeHash(initialContent)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning for drifted file",
            sourceType: "manual"
          })

          // Create hash anchor with original hash
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "hash",
            filePath: filePath,
            value: originalHash,
            contentHash: originalHash
          })

          // Modify the file content
          yield* Effect.promise(() => fs.writeFile(filePath, "export const modified = true", "utf-8"))

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("drifted")
      expect(result.newStatus).toBe("drifted")
      expect(result.reason).toBe("hash_mismatch")
      expect(result.oldContentHash).toBe(originalHash)
      expect(result.newContentHash).not.toBe(originalHash)
    })

    it("marks symbol anchor as invalid when symbol is removed", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create file without the expected symbol
      const filePath = await createTestFile(
        tempDir,
        FIXTURES.FILE_WITH_SYMBOL,
        "export const SomeOtherFunction = () => {}"
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning for symbol",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "symbol",
            filePath: filePath,
            value: FIXTURES.SYMBOL_NAME,
            symbolFqname: FIXTURES.SYMBOL_FQNAME
          })

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("invalidated")
      expect(result.newStatus).toBe("invalid")
      expect(result.reason).toBe("symbol_missing")
    })

    it("returns unchanged for symbol anchor when symbol exists", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create file with the expected symbol
      const filePath = await createTestFile(
        tempDir,
        FIXTURES.FILE_WITH_SYMBOL,
        `export function ${FIXTURES.SYMBOL_NAME}() { return true }`
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning for symbol",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "symbol",
            filePath: filePath,
            value: FIXTURES.SYMBOL_NAME,
            symbolFqname: FIXTURES.SYMBOL_FQNAME
          })

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("unchanged")
      expect(result.newStatus).toBe("valid")
    })

    it("skips verification for pinned anchors", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create file then delete it - but anchor is pinned so should remain unchanged
      const filePath = await createTestFile(tempDir, "pinned.ts", "export const pinned = true")
      await fs.unlink(filePath)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning for pinned anchor",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: filePath,
            value: "*.ts"
          })

          // Pin the anchor
          yield* anchorSvc.pin(1)

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("unchanged")
      expect(result.newStatus).toBe("valid") // Still valid because pinned
    })
  })

  describe("verifyAll - batch verification", () => {
    it("processes all anchors and returns summary", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create some valid files
      const validFile1 = await createTestFile(tempDir, "valid1.ts", "export const v1 = true")
      const validFile2 = await createTestFile(tempDir, "valid2.ts", "export const v2 = true")
      const deletedFilePath = path.join(tempDir, "deleted.ts")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create anchors
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: validFile1,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: validFile2,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: deletedFilePath,
            value: "*.ts"
          })

          return yield* verificationSvc.verifyAll({ baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.total).toBe(3)
      expect(result.unchanged).toBe(2) // Two valid files
      expect(result.invalid).toBe(1) // One deleted file
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it("skips pinned anchors by default", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const validFile = await createTestFile(tempDir, "valid.ts", "export const valid = true")
      const deletedFilePath = path.join(tempDir, "pinned-deleted.ts")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: validFile,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: deletedFilePath,
            value: "*.ts"
          })

          // Pin the deleted file's anchor
          yield* anchorSvc.pin(2)

          return yield* verificationSvc.verifyAll({ baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      // Pinned anchor should be counted as unchanged, not invalid
      expect(result.unchanged).toBe(2)
      expect(result.invalid).toBe(0)
    })
  })

  describe("verifyFile - file-specific verification", () => {
    it("verifies only anchors for the specified file", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const targetFile = await createTestFile(tempDir, "target.ts", "export const target = true")
      const otherFile = await createTestFile(tempDir, "other.ts", "export const other = true")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Create multiple anchors for target file
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: targetFile,
            value: "*.ts"
          })
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: targetFile,
            value: "target*.ts"
          })

          // Create anchor for other file
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: otherFile,
            value: "*.ts"
          })

          return yield* verificationSvc.verifyFile(targetFile, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.total).toBe(2) // Only target file's anchors
      expect(result.unchanged).toBe(2)
    })
  })

  describe("invalidation logging", () => {
    it("logs invalidation when anchor becomes invalid", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService, AnchorRepository } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const filePath = path.join(tempDir, "to-delete.ts")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService
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

          // Verify - should mark as invalid
          yield* verificationSvc.verify(1, { baseDir: tempDir, detectedBy: "periodic" })

          // Check invalidation log
          const logs = yield* anchorRepo.getInvalidationLogs(1)

          return logs
        }).pipe(Effect.provide(layer))
      )

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].oldStatus).toBe("valid")
      expect(result[0].newStatus).toBe("invalid")
      expect(result[0].reason).toBe("file_deleted")
      expect(result[0].detectedBy).toBe("periodic")
    })

    it("logs drift when content hash changes", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService, AnchorRepository } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const initialContent = "export const original = 1"
      const filePath = await createTestFile(tempDir, "drift.ts", initialContent)
      const originalHash = computeHash(initialContent)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService
          const anchorRepo = yield* AnchorRepository

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "hash",
            filePath: filePath,
            value: originalHash,
            contentHash: originalHash
          })

          // Modify file
          yield* Effect.promise(() => fs.writeFile(filePath, "export const modified = 2", "utf-8"))

          // Verify - should mark as drifted
          yield* verificationSvc.verify(1, { baseDir: tempDir, detectedBy: "manual" })

          // Check invalidation log
          const logs = yield* anchorRepo.getInvalidationLogs(1)

          return logs
        }).pipe(Effect.provide(layer))
      )

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].oldStatus).toBe("valid")
      expect(result[0].newStatus).toBe("drifted")
      expect(result[0].reason).toBe("hash_mismatch")
      expect(result[0].detectedBy).toBe("manual")
      expect(result[0].oldContentHash).toBe(originalHash)
      expect(result[0].newContentHash).not.toBe(originalHash)
    })
  })

  describe("line_range anchor verification", () => {
    it("returns unchanged when file has enough lines", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create file with 10 lines
      const content = Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1}`).join("\n")
      const filePath = await createTestFile(tempDir, "multiline.ts", content)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "line_range",
            filePath: filePath,
            value: "5-8",
            lineStart: 5,
            lineEnd: 8
          })

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("unchanged")
      expect(result.newStatus).toBe("valid")
    })

    it("marks as drifted when file has fewer lines than required", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      // Create file with only 3 lines
      const filePath = await createTestFile(tempDir, "short.ts", "line1\nline2\nline3")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService

          const learning = yield* learningSvc.create({
            content: "Test learning",
            sourceType: "manual"
          })

          // Anchor requires lines 5-10
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "line_range",
            filePath: filePath,
            value: "5-10",
            lineStart: 5,
            lineEnd: 10
          })

          return yield* verificationSvc.verify(1, { baseDir: tempDir })
        }).pipe(Effect.provide(layer))
      )

      expect(result.action).toBe("drifted")
      expect(result.newStatus).toBe("drifted")
      expect(result.reason).toBe("line_count_insufficient")
    })
  })

  describe("detection source tracking", () => {
    it("tracks periodic detection source", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService, AnchorRepository } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const filePath = path.join(tempDir, "nonexistent.ts")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService
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

          yield* verificationSvc.verify(1, { baseDir: tempDir, detectedBy: "periodic" })

          const logs = yield* anchorRepo.getInvalidationLogs(1)
          return logs
        }).pipe(Effect.provide(layer))
      )

      expect(result[0].detectedBy).toBe("periodic")
    })

    it("tracks lazy detection source", async () => {
      const { makeAppLayer, AnchorVerificationService, LearningService, AnchorService, AnchorRepository } = await import("@tx/core")
      const layer = makeAppLayer(":memory:")

      const filePath = path.join(tempDir, "nonexistent.ts")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const learningSvc = yield* LearningService
          const anchorSvc = yield* AnchorService
          const verificationSvc = yield* AnchorVerificationService
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

          // Default detection source is "lazy"
          yield* verificationSvc.verify(1, { baseDir: tempDir })

          const logs = yield* anchorRepo.getInvalidationLogs(1)
          return logs
        }).pipe(Effect.provide(layer))
      )

      expect(result[0].detectedBy).toBe("lazy")
    })
  })
})
