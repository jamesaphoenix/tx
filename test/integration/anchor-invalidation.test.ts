/**
 * Anchor Invalidation and Maintenance Integration Tests
 *
 * Tests for PRD-017: Graph RAG - Anchor Invalidation and Graph Maintenance
 *
 * Coverage:
 * - Periodic verification (batch verification)
 * - On-access verification with caching behavior
 * - Soft delete (invalidate) and restore operations
 * - Self-healing with similarity thresholds
 * - Swarm verification (parallel batch processing)
 * - Git hook integration (post-refactor verification)
 *
 * Success Metrics (PRD-017):
 * - >95% stale anchor detection rate within 24h
 * - <5% false positive rate
 * - >80% self-healing success rate for minor edits
 * - 10K anchors/min verification throughput
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 * Previously created a new database per test, now creates 1 per describe block.
 *
 * @see docs/prd/PRD-017-invalidation-maintenance.md
 * @see docs/design/DD-017-invalidation-maintenance.md
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services at module level (no more dynamic imports)
import {
  SqliteClient,
  AnchorRepository,
  AnchorRepositoryLive,
  LearningRepositoryLive,
  AnchorService,
  LearningService
} from "@jamesaphoenix/tx-core"
import type { AnchorStatus } from "@jamesaphoenix/tx-types"
import type { Database } from "bun:sqlite"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs for determinism)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`anchor-invalidation-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  // Learnings for anchors
  LEARNING_VALID: fixtureId("learning-valid"),
  LEARNING_DRIFTED: fixtureId("learning-drifted"),
  LEARNING_INVALID: fixtureId("learning-invalid"),
  LEARNING_PINNED: fixtureId("learning-pinned"),

  // File paths
  FILE_EXISTS: "src/services/task-service.ts",
  FILE_DELETED: "src/services/deleted-service.ts",
  FILE_DRIFTED: "src/services/drifted-service.ts",

  // Content hashes
  HASH_VALID: "a".repeat(64),
  HASH_DRIFTED: "b".repeat(64),
  HASH_OLD: "c".repeat(64),
  HASH_NEW: "d".repeat(64),
} as const

// =============================================================================
// Helper Functions for Repository-Level Tests
// =============================================================================

function makeTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as any)
  return Layer.mergeAll(
    AnchorRepositoryLive,
    LearningRepositoryLive
  ).pipe(Layer.provide(infra))
}

function createTestLearning(db: Database, content: string): number {
  const now = new Date().toISOString()
  const result = db.prepare(
    `INSERT INTO learnings (content, source_type, created_at) VALUES (?, 'manual', ?)`
  ).run(content, now)
  return Number(result.lastInsertRowid)
}

function createTestAnchorDirect(
  db: Database,
  learningId: number,
  opts: {
    anchorType?: string
    anchorValue?: string
    filePath?: string
    status?: AnchorStatus
    pinned?: boolean
    contentHash?: string | null
    symbolFqname?: string | null
    lineStart?: number | null
    lineEnd?: number | null
    createdAt?: Date
  }
): number {
  const now = opts.createdAt?.toISOString() ?? new Date().toISOString()
  const result = db.prepare(
    `INSERT INTO learning_anchors
     (learning_id, anchor_type, anchor_value, file_path, status, pinned, content_hash, symbol_fqname, line_start, line_end, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    learningId,
    opts.anchorType ?? "glob",
    opts.anchorValue ?? "src/**/*.ts",
    opts.filePath ?? "src/test.ts",
    opts.status ?? "valid",
    opts.pinned ? 1 : 0,
    opts.contentHash ?? null,
    opts.symbolFqname ?? null,
    opts.lineStart ?? null,
    opts.lineEnd ?? null,
    now
  )
  return Number(result.lastInsertRowid)
}

// =============================================================================
// Periodic Verification Tests (via AnchorService)
// =============================================================================

describe("Anchor Invalidation - Periodic Verification", () => {
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

  it("verifyAll returns summary of all anchors", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        // Create learning
        const learning = yield* learningSvc.create({
          content: "Test learning for periodic verification",
          sourceType: "manual"
        })

        // Create anchors with different statuses via service
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "valid1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "valid2.ts",
          value: "*.ts"
        })

        // Mark one as drifted
        yield* anchorSvc.updateAnchorStatus(2, "drifted")

        // Create another and mark as invalid
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "invalid.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(3, "invalid")

        return yield* anchorSvc.verifyAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(3)
    expect(result.verified).toBe(1) // valid anchors
    expect(result.drifted).toBe(1)
    expect(result.invalid).toBe(1)
  })

  it("verifyAnchorsForFile verifies only anchors for specified file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        // Create anchors for target file
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_EXISTS,
          value: "*.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_EXISTS,
          value: "TaskService",
          symbolFqname: `${FIXTURES.FILE_EXISTS}::TaskService`
        })
        yield* anchorSvc.updateAnchorStatus(2, "drifted")

        // Create anchor for other file
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "other-file.ts",
          value: "*.ts"
        })

        return yield* anchorSvc.verifyAnchorsForFile(FIXTURES.FILE_EXISTS)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(2) // Only FILE_EXISTS anchors
    expect(result.verified).toBe(1)
    expect(result.drifted).toBe(1)
  })

  it("verifyAll skips pinned anchors from verification changes", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        // Create and pin first anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "pinned.ts",
          value: "*.ts"
        })
        yield* anchorSvc.pin(1)

        // Create regular anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "regular.ts",
          value: "*.ts"
        })

        const summary = yield* anchorSvc.verifyAll()
        const pinnedAnchor = yield* anchorSvc.get(1)

        return { summary, pinnedAnchor }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.summary.total).toBe(2)
    expect(result.pinnedAnchor.pinned).toBe(true)
    expect(result.pinnedAnchor.status).toBe("valid")
  })

  it("getStatus returns graph health summary", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        // Create mixed anchors
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "v1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "v2.ts",
          value: "*.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "d1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(3, "drifted")
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "i1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(4, "invalid")
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "p1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.pin(5)

        return yield* anchorSvc.getStatus()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(5)
    expect(result.valid).toBe(3) // 2 valid + 1 pinned (which is also valid)
    expect(result.drifted).toBe(1)
    expect(result.invalid).toBe(1)
    expect(result.pinned).toBe(1)
  })
})

// =============================================================================
// On-Access Verification (Lazy) Tests
// =============================================================================

describe("Anchor Invalidation - On-Access Verification", () => {
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

  it("verifyAnchor returns verification result for valid anchor", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_EXISTS,
          value: "src/**/*.ts"
        })

        return yield* anchorSvc.verifyAnchor(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.anchorId).toBe(1)
    expect(result.previousStatus).toBe("valid")
    expect(result.newStatus).toBe("valid")
    expect(result.verified).toBe(true)
  })

  it("verifyAnchor updates verifiedAt timestamp", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_EXISTS,
          value: "*.ts"
        })

        const beforeVerify = yield* anchorSvc.get(1)
        yield* anchorSvc.verifyAnchor(1)
        const afterVerify = yield* anchorSvc.get(1)

        return { beforeVerify, afterVerify }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.beforeVerify.verifiedAt).toBeNull()
    expect(result.afterVerify.verifiedAt).not.toBeNull()
    expect(result.afterVerify.verifiedAt).toBeInstanceOf(Date)
  })

  it("verifyAnchor fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.verifyAnchor(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("verifyAnchor handles different anchor types", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        // Glob anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_EXISTS,
          value: "src/**/*.ts"
        })

        // Symbol anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_EXISTS,
          value: "TaskService",
          symbolFqname: `${FIXTURES.FILE_EXISTS}::TaskService`
        })

        // Hash anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_EXISTS,
          value: FIXTURES.HASH_VALID,
          lineStart: 10,
          lineEnd: 20
        })

        // Line range anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "line_range",
          filePath: FIXTURES.FILE_EXISTS,
          value: "10-25",
          lineStart: 10,
          lineEnd: 25
        })

        return {
          glob: yield* anchorSvc.verifyAnchor(1),
          symbol: yield* anchorSvc.verifyAnchor(2),
          hash: yield* anchorSvc.verifyAnchor(3),
          lineRange: yield* anchorSvc.verifyAnchor(4)
        }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(results.glob.verified).toBe(true)
    expect(results.symbol.verified).toBe(true)
    expect(results.hash.verified).toBe(true)
    expect(results.lineRange.verified).toBe(true)
  })
})

// =============================================================================
// Soft Delete and Restore Tests
// =============================================================================

describe("Anchor Invalidation - Soft Delete and Restore", () => {
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

  it("invalidate marks anchor as invalid with reason", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_DELETED,
          value: "*.ts"
        })

        return yield* anchorSvc.invalidate(1, "File was deleted")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.status).toBe("invalid")
  })

  it("restore returns invalid anchor to valid status", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_EXISTS,
          value: "*.ts"
        })

        // Invalidate then restore
        yield* anchorSvc.invalidate(1, "Test invalidation")
        return yield* anchorSvc.restore(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.status).toBe("valid")
    expect(result.verifiedAt).not.toBeNull()
  })

  it("invalidate fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.invalidate(999, "Test reason")
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("restore fails with AnchorNotFoundError for nonexistent ID", async () => {
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

  it("restore uses old_status from invalidation log (drifted -> invalid -> restored to drifted)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for drifted restore",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_DRIFTED,
          value: "*.ts"
        })

        // First mark as drifted
        yield* anchorSvc.updateAnchorStatus(1, "drifted", "Content changed slightly")
        const drifted = yield* anchorSvc.get(1)

        // Then invalidate (drifted -> invalid)
        yield* anchorSvc.invalidate(1, "File deleted")
        const invalidated = yield* anchorSvc.get(1)

        // Restore should go back to drifted (the old_status from invalidation log)
        const restored = yield* anchorSvc.restore(1)

        return { drifted, invalidated, restored }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.drifted.status).toBe("drifted")
    expect(result.invalidated.status).toBe("invalid")
    expect(result.restored.status).toBe("drifted") // Should restore to old_status, not 'valid'
  })

  it("restore restores old_content_hash from invalidation log", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning for content hash restore",
          sourceType: "manual"
        })

        // Create hash anchor with content hash
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_EXISTS,
          value: FIXTURES.HASH_VALID,
          contentHash: FIXTURES.HASH_VALID
        })

        const original = yield* anchorSvc.get(1)

        // Simulate invalidation with hash change - use repo directly to set new hash
        yield* anchorRepo.update(1, { contentHash: FIXTURES.HASH_DRIFTED })

        // Then invalidate - this logs the old_content_hash (which is now HASH_DRIFTED)
        // We need to manually log with the original hash to simulate the scenario
        yield* anchorRepo.updateStatus(1, "invalid")
        yield* anchorRepo.logInvalidation({
          anchorId: 1,
          oldStatus: "valid",
          newStatus: "invalid",
          reason: "File deleted",
          detectedBy: "manual",
          oldContentHash: FIXTURES.HASH_VALID, // Original hash before any changes
          newContentHash: FIXTURES.HASH_DRIFTED
        })

        const invalidated = yield* anchorSvc.get(1)

        // Restore should bring back the old content hash
        const restored = yield* anchorSvc.restore(1)

        return { original, invalidated, restored }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.original.contentHash).toBe(FIXTURES.HASH_VALID)
    expect(result.invalidated.contentHash).toBe(FIXTURES.HASH_DRIFTED)
    expect(result.restored.contentHash).toBe(FIXTURES.HASH_VALID) // Should restore to old_content_hash
    expect(result.restored.status).toBe("valid")
  })

  it("restore logs the action with detected_by='manual'", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        const learning = yield* learningSvc.create({
          content: "Test learning for restore logging",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_EXISTS,
          value: "*.ts"
        })

        // Invalidate via agent detection
        yield* anchorSvc.invalidate(1, "File deleted", "agent")

        // Restore
        yield* anchorSvc.restore(1)

        // Get all invalidation logs
        return yield* anchorRepo.getInvalidationLogs(1)
      }).pipe(Effect.provide(shared.layer))
    )

    // Should have 2 logs: one for invalidation, one for restore
    expect(logs).toHaveLength(2)

    // Most recent (first in DESC order) should be the restore log
    const restoreLog = logs[0]
    expect(restoreLog.oldStatus).toBe("invalid")
    expect(restoreLog.newStatus).toBe("valid")
    expect(restoreLog.detectedBy).toBe("manual")
    expect(restoreLog.reason).toContain("Restored to valid")

    // Second should be the invalidation log
    const invalidationLog = logs[1]
    expect(invalidationLog.oldStatus).toBe("valid")
    expect(invalidationLog.newStatus).toBe("invalid")
    expect(invalidationLog.detectedBy).toBe("agent")
  })
})

// =============================================================================
// Pruning Tests
// =============================================================================

describe("Anchor Invalidation - Pruning", () => {
  let shared: SharedTestLayerResult
  let learningId: number

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("prune deletes old invalid anchors via repository", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for pruning")
    const learning2 = createTestLearning(db, "Another learning")

    // Create old invalid anchor (backdated to 100 days ago)
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
    createTestAnchorDirect(db, learningId, {
      filePath: "old-invalid.ts",
      status: "invalid",
      createdAt: oldDate
    })

    // Create recent invalid anchor
    createTestAnchorDirect(db, learning2, {
      filePath: "recent-invalid.ts",
      status: "invalid"
    })

    // Create old valid anchor (should NOT be deleted)
    createTestAnchorDirect(db, learningId, {
      filePath: "old-valid.ts",
      status: "valid",
      createdAt: oldDate
    })

    const layer = makeTestLayer(db)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.deleteOldInvalid(90) // 90 days
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(1)

    // Verify remaining anchors
    const remaining = db.prepare("SELECT * FROM learning_anchors").all() as any[]
    expect(remaining).toHaveLength(2) // recent invalid + old valid
  })

  it("prune does not delete valid anchors regardless of age", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for pruning")
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) // 1 year ago

    createTestAnchorDirect(db, learningId, {
      filePath: "very-old-valid.ts",
      status: "valid",
      createdAt: oldDate
    })

    const layer = makeTestLayer(db)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.deleteOldInvalid(30)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(0)
  })
})

// =============================================================================
// Pinned Anchors Tests
// =============================================================================

describe("Anchor Invalidation - Pinned Anchors", () => {
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

  it("pin sets pinned flag to true", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "to-pin.ts",
          value: "*.ts"
        })

        return yield* anchorSvc.pin(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.pinned).toBe(true)
  })

  it("unpin sets pinned flag to false", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "to-unpin.ts",
          value: "*.ts"
        })

        yield* anchorSvc.pin(1)
        return yield* anchorSvc.unpin(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.pinned).toBe(false)
  })

  it("pin fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.pin(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("unpin fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.unpin(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("pinned anchors are tracked in status summary", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "pinned1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.pin(1)

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "pinned2.ts",
          value: "*.ts"
        })
        yield* anchorSvc.pin(2)

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "not-pinned.ts",
          value: "*.ts"
        })

        return yield* anchorSvc.getStatus()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.pinned).toBe(2)
    expect(result.total).toBe(3)
  })
})

// =============================================================================
// Self-Healing Tests (via Repository)
// =============================================================================

describe("Anchor Invalidation - Self-Healing", () => {
  let shared: SharedTestLayerResult
  let learningId: number

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("hash anchor maintains contentHash for similarity comparison", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for self-healing")
    const anchorId = createTestAnchorDirect(db, learningId, {
      anchorType: "hash",
      anchorValue: FIXTURES.HASH_VALID,
      filePath: FIXTURES.FILE_EXISTS,
      contentHash: FIXTURES.HASH_VALID,
      lineStart: 10,
      lineEnd: 20
    })

    const layer = makeTestLayer(db)
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.findById(anchorId)
      }).pipe(Effect.provide(layer))
    )

    expect(anchor).not.toBeNull()
    expect(anchor!.contentHash).toBe(FIXTURES.HASH_VALID)
    expect(anchor!.lineStart).toBe(10)
    expect(anchor!.lineEnd).toBe(20)
  })

  it("anchor can be updated with new contentHash after self-healing", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for self-healing")
    const anchorId = createTestAnchorDirect(db, learningId, {
      anchorType: "hash",
      filePath: FIXTURES.FILE_EXISTS,
      contentHash: FIXTURES.HASH_OLD
    })

    const layer = makeTestLayer(db)
    // Simulate self-healing by updating the hash
    const updated = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.update(anchorId, { contentHash: FIXTURES.HASH_NEW })
      }).pipe(Effect.provide(layer))
    )

    expect(updated).not.toBeNull()
    expect(updated!.contentHash).toBe(FIXTURES.HASH_NEW)
  })

  it("invalidation log tracks hash changes for self-healing auditing", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for self-healing")
    const anchorId = createTestAnchorDirect(db, learningId, {
      anchorType: "hash",
      filePath: FIXTURES.FILE_DRIFTED,
      contentHash: FIXTURES.HASH_OLD,
      status: "valid"
    })

    const layer = makeTestLayer(db)
    // Simulate failed self-healing - content changed too much
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.updateStatus(anchorId, "drifted")
        yield* repo.logInvalidation({
          anchorId,
          oldStatus: "valid",
          newStatus: "drifted",
          reason: "hash_mismatch",
          detectedBy: "periodic",
          oldContentHash: FIXTURES.HASH_OLD,
          newContentHash: FIXTURES.HASH_NEW,
          similarityScore: 0.6 // Below threshold
        })
      }).pipe(Effect.provide(layer))
    )

    // Check audit log
    const logs = db.prepare(
      "SELECT * FROM invalidation_log WHERE anchor_id = ?"
    ).all(anchorId) as any[]

    expect(logs).toHaveLength(1)
    expect(logs[0].old_content_hash).toBe(FIXTURES.HASH_OLD)
    expect(logs[0].new_content_hash).toBe(FIXTURES.HASH_NEW)
    expect(logs[0].similarity_score).toBe(0.6)
    expect(logs[0].reason).toBe("hash_mismatch")
  })

  it("successful self-healing logs with high similarity score", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for self-healing")
    const anchorId = createTestAnchorDirect(db, learningId, {
      anchorType: "hash",
      filePath: FIXTURES.FILE_EXISTS,
      contentHash: FIXTURES.HASH_OLD,
      status: "valid"
    })

    const layer = makeTestLayer(db)
    // Simulate successful self-healing
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.update(anchorId, { contentHash: FIXTURES.HASH_NEW })
        yield* repo.logInvalidation({
          anchorId,
          oldStatus: "valid",
          newStatus: "valid",
          reason: "self_healed",
          detectedBy: "periodic",
          oldContentHash: FIXTURES.HASH_OLD,
          newContentHash: FIXTURES.HASH_NEW,
          similarityScore: 0.92 // Above 0.8 threshold
        })
      }).pipe(Effect.provide(layer))
    )

    // Check audit log
    const logs = db.prepare(
      "SELECT * FROM invalidation_log WHERE anchor_id = ?"
    ).all(anchorId) as any[]

    expect(logs).toHaveLength(1)
    expect(logs[0].similarity_score).toBeGreaterThan(0.8)
    expect(logs[0].reason).toBe("self_healed")
    expect(logs[0].new_status).toBe("valid") // Status remains valid after self-heal
  })
})

// =============================================================================
// Swarm Verification (Parallel Batch) Tests
// =============================================================================

describe("Anchor Invalidation - Swarm Verification", () => {
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

  it("verifyAll handles large number of anchors", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for batch",
          sourceType: "manual"
        })

        // Create 20 anchors
        for (let i = 0; i < 20; i++) {
          yield* anchorSvc.createAnchor({
            learningId: learning.id,
            anchorType: "glob",
            filePath: `file-${i}.ts`,
            value: "*.ts"
          })
          // Mark every 5th as drifted
          if (i % 5 === 0) {
            yield* anchorSvc.updateAnchorStatus(i + 1, "drifted")
          }
        }

        return yield* anchorSvc.verifyAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(20)
    expect(result.drifted).toBe(4) // 0, 5, 10, 15
    expect(result.verified).toBe(16)
  })

  it("verifyAnchorsForFile handles multiple anchors per file", async () => {
    const targetFile = "src/multi-anchor-file.ts"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        // Create multiple anchors for same file
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: targetFile,
          value: "*.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: targetFile,
          value: "Symbol1",
          symbolFqname: `${targetFile}::Symbol1`
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: targetFile,
          value: "Symbol2",
          symbolFqname: `${targetFile}::Symbol2`
        })
        yield* anchorSvc.updateAnchorStatus(3, "drifted")

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: targetFile,
          value: FIXTURES.HASH_VALID
        })

        return yield* anchorSvc.verifyAnchorsForFile(targetFile)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(4)
    expect(result.verified).toBe(3)
    expect(result.drifted).toBe(1)
  })

  it("findDrifted returns anchors that need review", async () => {
    const drifted = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "valid.ts",
          value: "*.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "drifted1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(2, "drifted")
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "drifted2.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(3, "drifted")
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "invalid.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(4, "invalid")

        return yield* anchorSvc.findDrifted()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(drifted).toHaveLength(2)
    drifted.forEach(a => expect(a.status).toBe("drifted"))
  })

  it("findInvalid returns soft-deleted anchors", async () => {
    const invalid = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual"
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "valid.ts",
          value: "*.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "invalid1.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(2, "invalid")
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "invalid2.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(3, "invalid")
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "drifted.ts",
          value: "*.ts"
        })
        yield* anchorSvc.updateAnchorStatus(4, "drifted")

        return yield* anchorSvc.findInvalid()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(invalid).toHaveLength(2)
    invalid.forEach(a => expect(a.status).toBe("invalid"))
  })
})

// =============================================================================
// Git Hook Integration Tests
// =============================================================================

describe("Anchor Invalidation - Git Hook Integration", () => {
  let shared: SharedTestLayerResult
  let learningId: number

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("invalidation supports git_hook as detection source", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for git hooks")
    const anchorId = createTestAnchorDirect(db, learningId, {
      filePath: "changed-by-commit.ts",
      status: "valid"
    })

    const layer = makeTestLayer(db)
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.updateStatus(anchorId, "invalid")
        yield* repo.logInvalidation({
          anchorId,
          oldStatus: "valid",
          newStatus: "invalid",
          reason: "File modified in commit abc123",
          detectedBy: "git_hook"
        })
      }).pipe(Effect.provide(layer))
    )

    // Check audit log
    const logs = db.prepare(
      "SELECT * FROM invalidation_log WHERE anchor_id = ?"
    ).all(anchorId) as any[]

    expect(logs).toHaveLength(1)
    expect(logs[0].detected_by).toBe("git_hook")
    expect(logs[0].reason).toBe("File modified in commit abc123")
  })

  it("findByFilePath enables targeted post-commit verification", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for git hooks")

    // Simulate files changed in a commit
    const changedFiles = [
      "src/services/auth.ts",
      "src/services/user.ts",
      "src/utils/validate.ts"
    ]

    // Create anchors for these files
    changedFiles.forEach((file, i) => {
      createTestAnchorDirect(db, learningId, { filePath: file, anchorValue: `anchor-${i}` })
    })

    // Also create anchors for unrelated files
    createTestAnchorDirect(db, learningId, { filePath: "src/unrelated.ts" })

    const layer = makeTestLayer(db)
    // Verify only changed files (simulating git hook)
    let totalVerified = 0
    for (const file of changedFiles) {
      const anchors = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* AnchorRepository
          return yield* repo.findByFilePath(file)
        }).pipe(Effect.provide(layer))
      )
      totalVerified += anchors.length
    }

    expect(totalVerified).toBe(3) // Only anchors for changed files
  })

  it("invalidation supports all detection sources", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for git hooks")

    const sources: Array<"periodic" | "lazy" | "manual" | "agent" | "git_hook"> = [
      "periodic",
      "lazy",
      "manual",
      "agent",
      "git_hook"
    ]

    const layer = makeTestLayer(db)
    for (const source of sources) {
      const anchorId = createTestAnchorDirect(db, learningId, {
        filePath: `file-${source}.ts`,
        status: "valid"
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* AnchorRepository
          yield* repo.updateStatus(anchorId, "invalid")
          yield* repo.logInvalidation({
            anchorId,
            oldStatus: "valid",
            newStatus: "invalid",
            reason: `Detected by ${source}`,
            detectedBy: source
          })
        }).pipe(Effect.provide(layer))
      )
    }

    // Check all sources were logged
    const logs = db.prepare("SELECT DISTINCT detected_by FROM invalidation_log").all() as any[]
    const loggedSources = logs.map(l => l.detected_by)

    expect(loggedSources).toContain("periodic")
    expect(loggedSources).toContain("lazy")
    expect(loggedSources).toContain("manual")
    expect(loggedSources).toContain("agent")
    expect(loggedSources).toContain("git_hook")
  })
})

// =============================================================================
// Stale Detection Accuracy Tests (PRD-017 Metrics)
// =============================================================================

describe("Anchor Invalidation - Stale Detection Metrics", () => {
  let shared: SharedTestLayerResult
  let learningId: number

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("status changes are tracked accurately in audit log", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for metrics")
    const anchorId = createTestAnchorDirect(db, learningId, {
      filePath: "tracked.ts",
      status: "valid"
    })

    const layer = makeTestLayer(db)
    // Simulate lifecycle: valid -> drifted -> invalid -> restored (valid)
    const statusChanges = [
      { from: "valid", to: "drifted", reason: "content_changed" },
      { from: "drifted", to: "invalid", reason: "file_deleted" }
    ]

    for (const change of statusChanges) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* AnchorRepository
          yield* repo.updateStatus(anchorId, change.to as AnchorStatus)
          yield* repo.logInvalidation({
            anchorId,
            oldStatus: change.from as AnchorStatus,
            newStatus: change.to as AnchorStatus,
            reason: change.reason,
            detectedBy: "periodic"
          })
        }).pipe(Effect.provide(layer))
      )
    }

    // Restore via direct repo call
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.updateStatus(anchorId, "valid")
        yield* repo.logInvalidation({
          anchorId,
          oldStatus: "invalid",
          newStatus: "valid",
          reason: "Manual restoration",
          detectedBy: "manual"
        })
      }).pipe(Effect.provide(layer))
    )

    // Check complete audit trail
    const logs = db.prepare(
      "SELECT * FROM invalidation_log WHERE anchor_id = ? ORDER BY id ASC"
    ).all(anchorId) as any[]

    expect(logs).toHaveLength(3)
    expect(logs[0].old_status).toBe("valid")
    expect(logs[0].new_status).toBe("drifted")
    expect(logs[1].old_status).toBe("drifted")
    expect(logs[1].new_status).toBe("invalid")
    expect(logs[2].old_status).toBe("invalid")
    expect(logs[2].new_status).toBe("valid")
  })

  it("getStatusSummary provides metrics for monitoring", async () => {
    const db = shared.getDb()
    learningId = createTestLearning(db, "Test learning for metrics")

    // Create a distribution of anchors
    for (let i = 0; i < 10; i++) {
      createTestAnchorDirect(db, learningId, { filePath: `valid-${i}.ts`, status: "valid" })
    }
    for (let i = 0; i < 3; i++) {
      createTestAnchorDirect(db, learningId, { filePath: `drifted-${i}.ts`, status: "drifted" })
    }
    for (let i = 0; i < 2; i++) {
      createTestAnchorDirect(db, learningId, { filePath: `invalid-${i}.ts`, status: "invalid" })
    }
    createTestAnchorDirect(db, learningId, { filePath: "pinned.ts", status: "valid", pinned: true })

    const layer = makeTestLayer(db)
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.getStatusSummary()
      }).pipe(Effect.provide(layer))
    )

    expect(status.total).toBe(16)
    expect(status.valid).toBe(11) // 10 valid + 1 pinned (which is also valid)
    expect(status.drifted).toBe(3)
    expect(status.invalid).toBe(2)
    expect(status.pinned).toBe(1)

    // Calculate accuracy metrics
    const accuracyRate = status.valid / status.total
    expect(accuracyRate).toBeGreaterThan(0.5) // More than half are valid
  })
})

// =============================================================================
// AnchorService via @tx/core makeAppLayer Tests
// =============================================================================

describe("Anchor Invalidation via makeAppLayer", () => {
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

  it("invalidation workflow via makeAppLayer", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        // Create learning
        const learning = yield* learningSvc.create({
          content: "Test learning for invalidation workflow",
          sourceType: "manual"
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "src/test.ts",
          value: "src/**/*.ts"
        })

        // Invalidate
        const invalidated = yield* anchorSvc.invalidate(1, "Test invalidation")

        // Check status
        const status = yield* anchorSvc.getStatus()

        // Restore
        const restored = yield* anchorSvc.restore(1)

        // Final status
        const finalStatus = yield* anchorSvc.getStatus()

        return { invalidated, status, restored, finalStatus }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invalidated.status).toBe("invalid")
    expect(result.status.invalid).toBe(1)
    expect(result.restored.status).toBe("valid")
    expect(result.finalStatus.valid).toBe(1)
    expect(result.finalStatus.invalid).toBe(0)
  })
})
