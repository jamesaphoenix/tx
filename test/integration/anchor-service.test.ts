/**
 * AnchorService Integration Tests
 *
 * Tests the AnchorService at the service layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 * Previously created a new database per test, now creates 1 per describe block.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services once at module level
import { AnchorService, LearningService } from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`anchor-service-test:${name}`)
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
  SYMBOL_FQNAME: "src/services/task-service.ts::TaskService",
  CONTENT_HASH: "a".repeat(64), // Valid SHA256 hash
} as const

// =============================================================================
// AnchorService CRUD Tests (via @tx/core)
// =============================================================================

describe("AnchorService Integration via @tx/core", () => {
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

  it("createAnchor creates a glob anchor with valid input", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        // Create a learning first
        const learning = yield* learningSvc.create({
          content: "Test learning for anchors",
          sourceType: "manual",
        })

        // Create anchor
        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.id).toBe(1)
    expect(result.anchorType).toBe("glob")
    expect(result.anchorValue).toBe(FIXTURES.GLOB_PATTERN)
    expect(result.filePath).toBe(FIXTURES.FILE_PATH_1)
    expect(result.status).toBe("valid")
  })

  it("createAnchor creates a hash anchor with valid SHA256", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.CONTENT_HASH,
          lineStart: 10,
          lineEnd: 20,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.anchorType).toBe("hash")
    expect(result.contentHash).toBe(FIXTURES.CONTENT_HASH)
    expect(result.lineStart).toBe(10)
    expect(result.lineEnd).toBe(20)
  })

  it("createAnchor creates a symbol anchor with FQName", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_1,
          value: "TaskService",
          symbolFqname: FIXTURES.SYMBOL_FQNAME,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.anchorType).toBe("symbol")
    expect(result.symbolFqname).toBe(FIXTURES.SYMBOL_FQNAME)
  })

  it("createAnchor creates a line_range anchor with line numbers", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "line_range",
          filePath: FIXTURES.FILE_PATH_1,
          value: "10-25",
          lineStart: 10,
          lineEnd: 25,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.anchorType).toBe("line_range")
    expect(result.lineStart).toBe(10)
    expect(result.lineEnd).toBe(25)
  })

  it("get returns anchor by ID", async () => {
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

        return yield* anchorSvc.get(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.id).toBe(1)
    expect(result.anchorType).toBe("glob")
  })

  it("get fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.get(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("remove soft deletes an anchor (sets status='invalid')", async () => {
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

        // Soft delete returns the updated anchor
        const removed = yield* anchorSvc.remove(1)

        // Anchor should still exist with status='invalid'
        const anchor = yield* anchorSvc.get(1)

        return { removed, anchor }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.removed.status).toBe("invalid")
    expect(result.anchor.status).toBe("invalid")
    expect(result.anchor.id).toBe(1)
  })

  it("hardDelete permanently removes an anchor", async () => {
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

        yield* anchorSvc.hardDelete(1)

        return yield* anchorSvc.get(1).pipe(Effect.either)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result._tag).toBe("Left")
  })

  it("remove fails with AnchorNotFoundError for nonexistent ID", async () => {
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

  it("hardDelete fails with AnchorNotFoundError for nonexistent ID", async () => {
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

  it("remove logs status change to invalidation_log", async () => {
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

        // Check the status via getStatus which returns recent invalidation logs
        return yield* anchorSvc.getStatus()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invalid).toBe(1)
    expect(result.recentInvalidations.length).toBeGreaterThan(0)
    expect(result.recentInvalidations[0].newStatus).toBe("invalid")
    expect(result.recentInvalidations[0].reason).toBe("Test soft delete reason")
  })
})

// =============================================================================
// AnchorService Validation Tests
// =============================================================================

describe("AnchorService validation", () => {
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

  it("createAnchor fails with ValidationError for invalid anchor type", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "invalid" as any,
          filePath: FIXTURES.FILE_PATH_1,
          value: "test",
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createAnchor fails with ValidationError for empty file path", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: "",
          value: FIXTURES.GLOB_PATTERN,
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createAnchor fails with ValidationError for empty value", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "",
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createAnchor fails with ValidationError for invalid hash format", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_PATH_1,
          value: "not-a-valid-hash",
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createAnchor fails with ValidationError for symbol without FQName", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_1,
          value: "TaskService",
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createAnchor fails with ValidationError for line_range without lineStart", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "line_range",
          filePath: FIXTURES.FILE_PATH_1,
          value: "10-25",
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createAnchor fails with LearningNotFoundError for nonexistent learning", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService

        return yield* anchorSvc.createAnchor({
          learningId: 99999,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN,
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("LearningNotFoundError")
    }
  })
})

// =============================================================================
// AnchorService Query Tests
// =============================================================================

describe("AnchorService query operations", () => {
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

  it("findAnchorsForFile returns all anchors for a file path", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning1 = yield* learningSvc.create({
          content: "Learning 1",
          sourceType: "manual",
        })
        const learning2 = yield* learningSvc.create({
          content: "Learning 2",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning1.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })
        yield* anchorSvc.createAnchor({
          learningId: learning2.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_1,
          value: "TaskService",
          symbolFqname: FIXTURES.SYMBOL_FQNAME,
        })
        yield* anchorSvc.createAnchor({
          learningId: learning1.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_2,
          value: "*.ts",
        })

        return yield* anchorSvc.findAnchorsForFile(FIXTURES.FILE_PATH_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    result.forEach(a => expect(a.filePath).toBe(FIXTURES.FILE_PATH_1))
  })

  it("findAnchorsForLearning returns all anchors for a learning", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning1 = yield* learningSvc.create({
          content: "Learning 1",
          sourceType: "manual",
        })
        const learning2 = yield* learningSvc.create({
          content: "Learning 2",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning1.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })
        yield* anchorSvc.createAnchor({
          learningId: learning1.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_2,
          value: "SqliteClient",
          symbolFqname: "src/db.ts::SqliteClient",
        })
        yield* anchorSvc.createAnchor({
          learningId: learning2.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        return yield* anchorSvc.findAnchorsForLearning(learning1.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
  })
})

// =============================================================================
// AnchorService Status Tests
// =============================================================================

describe("AnchorService status operations", () => {
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

  it("updateAnchorStatus changes anchor status", async () => {
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

        return yield* anchorSvc.updateAnchorStatus(1, "drifted")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.status).toBe("drifted")
  })

  it("updateAnchorStatus fails with ValidationError for invalid status", async () => {
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

        return yield* anchorSvc.updateAnchorStatus(1, "unknown" as any)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("updateAnchorStatus fails with AnchorNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.updateAnchorStatus(999, "drifted")
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("findDrifted returns only drifted anchors", async () => {
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
          value: "valid-anchor",
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_2,
          value: "drifted-anchor",
        })
        yield* anchorSvc.updateAnchorStatus(2, "drifted")

        return yield* anchorSvc.findDrifted()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("drifted")
    expect(result[0].anchorValue).toBe("drifted-anchor")
  })

  it("findInvalid returns only invalid anchors", async () => {
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
          value: "valid-anchor",
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_2,
          value: "invalid-anchor",
        })
        yield* anchorSvc.updateAnchorStatus(2, "invalid")

        return yield* anchorSvc.findInvalid()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("invalid")
    expect(result[0].anchorValue).toBe("invalid-anchor")
  })
})

// =============================================================================
// AnchorService Verification Tests
// =============================================================================

describe("AnchorService verification operations", () => {
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

  it("verifyAnchor returns verification result", async () => {
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

        return yield* anchorSvc.verifyAnchor(1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.anchorId).toBe(1)
    expect(result.previousStatus).toBe("valid")
    expect(result.newStatus).toBe("valid")
    expect(result.verified).toBe(true)
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

  it("verifyAnchorsForFile returns batch verification result", async () => {
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
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_1,
          value: "TaskService",
          symbolFqname: FIXTURES.SYMBOL_FQNAME,
        })

        return yield* anchorSvc.verifyAnchorsForFile(FIXTURES.FILE_PATH_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(2)
    expect(result.verified).toBe(2)
    expect(result.drifted).toBe(0)
    expect(result.invalid).toBe(0)
  })

  it("verifyAnchorsForFile handles mixed statuses", async () => {
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
          value: "valid-anchor",
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "drifted-anchor",
        })
        yield* anchorSvc.updateAnchorStatus(2, "drifted")
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "invalid-anchor",
        })
        yield* anchorSvc.updateAnchorStatus(3, "invalid")

        return yield* anchorSvc.verifyAnchorsForFile(FIXTURES.FILE_PATH_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(3)
    expect(result.verified).toBe(1)
    expect(result.drifted).toBe(1)
    expect(result.invalid).toBe(1)
  })
})
