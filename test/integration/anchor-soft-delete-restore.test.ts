/**
 * Integration tests for Anchor Soft Delete and Restore
 *
 * Tests for PRD-017: Graph RAG - Soft Delete and Restore Operations
 *
 * Coverage (per task tx-2ead092d):
 * 1. remove() marks anchor as invalid instead of deleting
 * 2. remove() logs to invalidation_log
 * 3. restore() reverts anchor status from invalid to valid
 * 4. restore() logs action
 * 5. hardDelete() actually removes record
 * 6. Cannot restore anchor that was never invalidated (graceful handling)
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 *
 * @see docs/prd/PRD-017-invalidation-maintenance.md
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services once at module level
import {
  AnchorService,
  AnchorRepository,
  LearningService
} from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs for determinism)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`anchor-soft-delete-restore-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  LEARNING_1: fixtureId("learning-1"),
  LEARNING_2: fixtureId("learning-2"),
  FILE_PATH_1: "src/services/task-service.ts",
  FILE_PATH_2: "src/db.ts",
  GLOB_PATTERN: "src/**/*.ts",
  CONTENT_HASH: "a".repeat(64), // Valid SHA256 hash
} as const

// =============================================================================
// Requirement 1: remove() marks anchor as invalid instead of deleting
// =============================================================================

describe("Soft Delete - remove() marks as invalid", () => {
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

  it("remove() sets anchor status to 'invalid' instead of deleting", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        // Create learning and anchor
        const learning = yield* learningSvc.create({
          content: "Test learning for soft delete",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Soft delete the anchor
        const removed = yield* anchorSvc.remove(1)

        // Verify anchor still exists with status='invalid'
        const anchor = yield* anchorSvc.get(1)

        return { removed, anchor }
      }).pipe(Effect.provide(shared.layer))
    )

    // The anchor should still exist
    expect(result.anchor.id).toBe(1)
    // Status should be 'invalid' (soft deleted)
    expect(result.removed.status).toBe("invalid")
    expect(result.anchor.status).toBe("invalid")
  })

  it("remove() preserves anchor data after soft delete", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        // Create anchor with specific data
        const original = yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Soft delete
        yield* anchorSvc.remove(original.id)

        // Get anchor after soft delete
        const afterRemove = yield* anchorSvc.get(original.id)

        return { original, afterRemove }
      }).pipe(Effect.provide(shared.layer))
    )

    // All original data should be preserved
    expect(result.afterRemove.id).toBe(result.original.id)
    expect(result.afterRemove.learningId).toBe(result.original.learningId)
    expect(result.afterRemove.anchorType).toBe(result.original.anchorType)
    expect(result.afterRemove.anchorValue).toBe(result.original.anchorValue)
    expect(result.afterRemove.filePath).toBe(result.original.filePath)
    // Only status should have changed
    expect(result.afterRemove.status).toBe("invalid")
  })

  it("remove() from valid status changes to invalid", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        const beforeRemove = yield* anchorSvc.get(1)
        const afterRemove = yield* anchorSvc.remove(1)

        return { beforeRemove, afterRemove }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.beforeRemove.status).toBe("valid")
    expect(result.afterRemove.status).toBe("invalid")
  })

  it("remove() from drifted status changes to invalid", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Set to drifted first
        yield* anchorSvc.updateAnchorStatus(1, "drifted")
        const beforeRemove = yield* anchorSvc.get(1)

        // Then soft delete
        const afterRemove = yield* anchorSvc.remove(1)

        return { beforeRemove, afterRemove }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.beforeRemove.status).toBe("drifted")
    expect(result.afterRemove.status).toBe("invalid")
  })

  it("remove() fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.remove(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })
})

// =============================================================================
// Requirement 2: remove() logs to invalidation_log
// =============================================================================

describe("Soft Delete - remove() logs to invalidation_log", () => {
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

  it("remove() creates invalidation_log entry", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN,
        })

        yield* anchorSvc.remove(1, "Test soft delete reason")

        // Check status which returns recent invalidation logs
        return yield* anchorSvc.getStatus()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.recentInvalidations.length).toBeGreaterThan(0)
    const log = result.recentInvalidations[0]
    expect(log.anchorId).toBe(1)
    expect(log.oldStatus).toBe("valid")
    expect(log.newStatus).toBe("invalid")
    expect(log.reason).toBe("Test soft delete reason")
  })

  it("remove() logs with detected_by='manual'", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        yield* anchorSvc.remove(1, "Testing detectedBy field")

        // Get logs directly from repo
        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.length).toBe(1)
    expect(result[0].detectedBy).toBe("manual")
  })

  it("remove() logs preserve old_content_hash when present", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        // Create hash anchor with content hash
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.CONTENT_HASH,
        })

        yield* anchorSvc.remove(1, "Test with content hash")

        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.length).toBe(1)
    expect(result[0].oldContentHash).toBe(FIXTURES.CONTENT_HASH)
  })

  it("remove() uses default reason when none provided", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Remove without providing reason
        yield* anchorSvc.remove(1)

        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.length).toBe(1)
    expect(result[0].reason).toBe("Soft deleted")
  })
})

// =============================================================================
// Requirement 3: restore() reverts anchor status from invalid to valid
// =============================================================================

describe("Restore - restore() reverts status", () => {
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

  it("restore() changes status from invalid to valid", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for restore",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Soft delete (invalidate)
        yield* anchorSvc.remove(1, "Test invalidation")
        const afterRemove = yield* anchorSvc.get(1)

        // Restore
        const restored = yield* anchorSvc.restore(1)

        return { afterRemove, restored }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.afterRemove.status).toBe("invalid")
    expect(result.restored.status).toBe("valid")
  })

  it("restore() restores to old_status from invalidation log", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for drifted restore",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Set to drifted
        yield* anchorSvc.updateAnchorStatus(1, "drifted")
        const asDrifted = yield* anchorSvc.get(1)

        // Invalidate (drifted -> invalid)
        yield* anchorSvc.invalidate(1, "File deleted")
        const asInvalid = yield* anchorSvc.get(1)

        // Restore should go back to drifted (old_status)
        const restored = yield* anchorSvc.restore(1)

        return { asDrifted, asInvalid, restored }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.asDrifted.status).toBe("drifted")
    expect(result.asInvalid.status).toBe("invalid")
    expect(result.restored.status).toBe("drifted") // Restored to old_status
  })

  it("restore() updates verifiedAt timestamp", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        const original = yield* anchorSvc.get(1)

        yield* anchorSvc.invalidate(1, "Test")
        const restored = yield* anchorSvc.restore(1)

        return { original, restored }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.original.verifiedAt).toBeNull()
    expect(result.restored.verifiedAt).not.toBeNull()
  })

  it("restore() restores old_content_hash when available", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        // Create hash anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.CONTENT_HASH,
          contentHash: FIXTURES.CONTENT_HASH,
        })

        const original = yield* anchorSvc.get(1)

        // Change content hash before invalidating
        const newHash = "b".repeat(64)
        yield* anchorRepo.update(1, { contentHash: newHash })

        // Now invalidate with proper log entry
        yield* anchorRepo.updateStatus(1, "invalid")
        yield* anchorRepo.logInvalidation({
          anchorId: 1,
          oldStatus: "valid",
          newStatus: "invalid",
          reason: "Test invalidation",
          detectedBy: "manual",
          oldContentHash: FIXTURES.CONTENT_HASH, // Original hash
          newContentHash: newHash,
        })

        const invalidated = yield* anchorSvc.get(1)

        // Restore
        const restored = yield* anchorSvc.restore(1)

        return { original, invalidated, restored }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.original.contentHash).toBe(FIXTURES.CONTENT_HASH)
    expect(result.invalidated.contentHash).toBe("b".repeat(64))
    expect(result.restored.contentHash).toBe(FIXTURES.CONTENT_HASH) // Restored
  })

  it("restore() fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.restore(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })
})

// =============================================================================
// Requirement 4: restore() logs action
// =============================================================================

describe("Restore - restore() logs action", () => {
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

  it("restore() creates invalidation_log entry", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        yield* anchorSvc.invalidate(1, "Test invalidation")
        yield* anchorSvc.restore(1)

        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    // Should have 2 logs: invalidation and restore
    expect(logs.length).toBe(2)

    // Most recent (first in DESC order) should be restore
    const restoreLog = logs[0]
    expect(restoreLog.oldStatus).toBe("invalid")
    expect(restoreLog.newStatus).toBe("valid")
  })

  it("restore() logs with detected_by='manual'", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Invalidate via different source
        yield* anchorSvc.invalidate(1, "Agent detected issue", "agent")
        yield* anchorSvc.restore(1)

        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    // Restore log should always use 'manual' as detectedBy
    const restoreLog = logs[0]
    expect(restoreLog.detectedBy).toBe("manual")

    // Invalidation log should show 'agent'
    const invalidationLog = logs[1]
    expect(invalidationLog.detectedBy).toBe("agent")
  })

  it("restore() log includes reason mentioning old status", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        yield* anchorSvc.invalidate(1, "Test invalidation")
        yield* anchorSvc.restore(1)

        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    const restoreLog = logs[0]
    expect(restoreLog.reason).toContain("Restored")
  })
})

// =============================================================================
// Requirement 5: hardDelete() actually removes record
// =============================================================================

describe("Hard Delete - hardDelete() removes record", () => {
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

  it("hardDelete() permanently removes anchor from database", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Verify anchor exists before hard delete
        yield* anchorSvc.get(1)

        // Hard delete
        yield* anchorSvc.hardDelete(1)

        // Try to get anchor - should fail
        return yield* anchorSvc.get(1).pipe(Effect.either)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("hardDelete() differs from remove() - record is gone", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        // Create two anchors
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "soft-delete.ts",
          value: "*.ts",
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "hard-delete.ts",
          value: "*.ts",
        })

        // Soft delete anchor 1
        yield* anchorSvc.remove(1)
        // Hard delete anchor 2
        yield* anchorSvc.hardDelete(2)

        // Anchor 1 should still be accessible (just invalid)
        const softDeleted = yield* anchorSvc.get(1)

        // Anchor 2 should not exist
        const hardDeletedResult = yield* anchorSvc.get(2).pipe(Effect.either)

        return { softDeleted, hardDeletedResult }
      }).pipe(Effect.provide(shared.layer))
    )

    // Soft deleted anchor is still accessible
    expect(result.softDeleted.id).toBe(1)
    expect(result.softDeleted.status).toBe("invalid")

    // Hard deleted anchor is gone
    expect(result.hardDeletedResult._tag).toBe("Left")
  })

  it("hardDelete() fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.hardDelete(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("hardDelete() works on already-invalidated anchors", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // First soft delete
        yield* anchorSvc.remove(1)

        // Then hard delete
        yield* anchorSvc.hardDelete(1)

        // Should be gone
        return yield* anchorSvc.get(1).pipe(Effect.either)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result._tag).toBe("Left")
  })
})

// =============================================================================
// Requirement 6: Cannot restore anchor that was never invalidated
// =============================================================================

describe("Restore - anchor never invalidated", () => {
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

  it("restore() on valid anchor defaults to valid (graceful handling)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        const beforeRestore = yield* anchorSvc.get(1)

        // Restore without prior invalidation
        const afterRestore = yield* anchorSvc.restore(1)

        return { beforeRestore, afterRestore }
      }).pipe(Effect.provide(shared.layer))
    )

    // Anchor was already valid, restore keeps it valid
    expect(result.beforeRestore.status).toBe("valid")
    expect(result.afterRestore.status).toBe("valid")
  })

  it("restore() on never-invalidated anchor logs with 'Manual restoration' reason", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Restore without prior invalidation
        yield* anchorSvc.restore(1)

        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    // Should create a restore log even without prior invalidation
    expect(logs.length).toBe(1)
    expect(logs[0].reason).toBe("Manual restoration")
    expect(logs[0].oldStatus).toBe("valid")
    expect(logs[0].newStatus).toBe("valid")
  })

  it("restore() on drifted (never invalidated) anchor restores to valid by default", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Set to drifted (not invalid)
        yield* anchorSvc.updateAnchorStatus(1, "drifted")
        const beforeRestore = yield* anchorSvc.get(1)

        // Restore - no invalidation log exists with newStatus='invalid'
        const afterRestore = yield* anchorSvc.restore(1)

        return { beforeRestore, afterRestore }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.beforeRestore.status).toBe("drifted")
    // Without an invalidation log to 'invalid', defaults to restoring to 'valid'
    expect(result.afterRestore.status).toBe("valid")
  })

  it("restore() updates verifiedAt even on never-invalidated anchor", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        const before = yield* anchorSvc.get(1)
        yield* anchorSvc.restore(1)
        const after = yield* anchorSvc.get(1)

        return { before, after }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.before.verifiedAt).toBeNull()
    expect(result.after.verifiedAt).not.toBeNull()
  })
})

// =============================================================================
// Integration: Full Soft Delete / Restore Lifecycle
// =============================================================================

describe("Integration - Full Lifecycle", () => {
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

  it("complete lifecycle: create -> remove -> restore -> hardDelete", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for lifecycle",
          sourceType: "manual",
        })

        // 1. Create
        const created = yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })
        expect(created.status).toBe("valid")

        // 2. Soft delete (remove)
        const removed = yield* anchorSvc.remove(1, "Temporary removal")
        expect(removed.status).toBe("invalid")

        // 3. Restore
        const restored = yield* anchorSvc.restore(1)
        expect(restored.status).toBe("valid")

        // 4. Hard delete
        yield* anchorSvc.hardDelete(1)
        const checkDeleted = yield* anchorSvc.get(1).pipe(Effect.either)
        expect(checkDeleted._tag).toBe("Left")

        return { created, removed, restored, checkDeleted }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.created.status).toBe("valid")
    expect(result.removed.status).toBe("invalid")
    expect(result.restored.status).toBe("valid")
    expect(result.checkDeleted._tag).toBe("Left")
  })

  it("multiple soft delete / restore cycles maintain correct logs", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Cycle 1
        yield* anchorSvc.invalidate(1, "First invalidation")
        yield* anchorSvc.restore(1)

        // Cycle 2
        yield* anchorSvc.invalidate(1, "Second invalidation")
        yield* anchorSvc.restore(1)

        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    // Should have 4 log entries: invalidate, restore, invalidate, restore
    expect(logs.length).toBe(4)

    // Logs are returned in DESC order (most recent first)
    expect(logs[0].newStatus).toBe("valid") // Second restore
    expect(logs[1].newStatus).toBe("invalid") // Second invalidation
    expect(logs[2].newStatus).toBe("valid") // First restore
    expect(logs[3].newStatus).toBe("invalid") // First invalidation
  })
})
