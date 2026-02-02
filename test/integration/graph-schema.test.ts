/**
 * Graph Schema Integration Tests
 *
 * Tests for the graph schema including anchors, edges, traversal, and graph operations.
 * Uses SHA256-based fixtures from @tx/test-utils per Rule 3.
 *
 * Coverage:
 * - Anchor CRUD operations
 * - Edge CRUD operations
 * - Multi-hop traversal
 * - Edge type filtering
 * - Cycle detection
 * - Bidirectional queries
 */

import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`graph-schema-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  // Learning IDs
  LEARNING_1: fixtureId("learning-1"),
  LEARNING_2: fixtureId("learning-2"),
  LEARNING_3: fixtureId("learning-3"),
  LEARNING_4: fixtureId("learning-4"),
  LEARNING_5: fixtureId("learning-5"),
  // File paths
  FILE_PATH_1: "src/services/task-service.ts",
  FILE_PATH_2: "src/db.ts",
  FILE_PATH_3: "src/repo/learning-repo.ts",
  FILE_PATH_4: "src/utils/helpers.ts",
  // Glob patterns
  GLOB_PATTERN_1: "src/**/*.ts",
  GLOB_PATTERN_2: "src/services/*.ts",
  // Symbol names
  SYMBOL_FQNAME_1: "src/services/task-service.ts::TaskService",
  SYMBOL_FQNAME_2: "src/services/task-service.ts::createTask",
  SYMBOL_FQNAME_3: "src/db.ts::SqliteClient",
  // Content hash (valid SHA256)
  CONTENT_HASH_1: "a".repeat(64),
  CONTENT_HASH_2: "b".repeat(64),
  // Task IDs
  TASK_1: "tx-task001",
  TASK_2: "tx-task002",
  // Run IDs
  RUN_1: "run-001",
  RUN_2: "run-002",
} as const

// =============================================================================
// ANCHOR CRUD TESTS
// =============================================================================

describe("Graph Schema - Anchor CRUD", () => {
  it("creates a glob anchor and retrieves it", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for glob anchor",
          sourceType: "manual",
        })

        const anchor = yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN_1,
        })

        const retrieved = yield* anchorSvc.get(anchor.id)
        return { created: anchor, retrieved }
      }).pipe(Effect.provide(layer))
    )

    expect(result.created.id).toBe(result.retrieved.id)
    expect(result.retrieved.anchorType).toBe("glob")
    expect(result.retrieved.anchorValue).toBe(FIXTURES.GLOB_PATTERN_1)
    expect(result.retrieved.status).toBe("valid")
  })

  it("creates a hash anchor with content hash and line range", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for hash anchor",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.CONTENT_HASH_1,
          lineStart: 10,
          lineEnd: 25,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchorType).toBe("hash")
    expect(result.contentHash).toBe(FIXTURES.CONTENT_HASH_1)
    expect(result.lineStart).toBe(10)
    expect(result.lineEnd).toBe(25)
  })

  it("creates a symbol anchor with fully qualified name", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for symbol anchor",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_1,
          value: "TaskService",
          symbolFqname: FIXTURES.SYMBOL_FQNAME_1,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchorType).toBe("symbol")
    expect(result.symbolFqname).toBe(FIXTURES.SYMBOL_FQNAME_1)
    expect(result.anchorValue).toBe("TaskService")
  })

  it("creates a line_range anchor with line numbers", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning for line range anchor",
          sourceType: "manual",
        })

        return yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "line_range",
          filePath: FIXTURES.FILE_PATH_2,
          value: "50-75",
          lineStart: 50,
          lineEnd: 75,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchorType).toBe("line_range")
    expect(result.lineStart).toBe(50)
    expect(result.lineEnd).toBe(75)
  })

  it("soft deletes an anchor (sets status='invalid')", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Test learning",
          sourceType: "manual",
        })

        const anchor = yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN_1,
        })

        const removed = yield* anchorSvc.remove(anchor.id)

        // Anchor still exists but with status='invalid'
        const retrieved = yield* anchorSvc.get(anchor.id)

        return { removed, retrieved }
      }).pipe(Effect.provide(layer))
    )

    expect(result.removed.status).toBe("invalid")
    expect(result.retrieved.status).toBe("invalid")
  })

  it("finds all anchors for a specific file path", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

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

        // Create two anchors for the same file
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
          symbolFqname: FIXTURES.SYMBOL_FQNAME_1,
        })
        // Create one anchor for a different file
        yield* anchorSvc.createAnchor({
          learningId: learning1.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_2,
          value: "*.ts",
        })

        return yield* anchorSvc.findAnchorsForFile(FIXTURES.FILE_PATH_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    result.forEach((a) => expect(a.filePath).toBe(FIXTURES.FILE_PATH_1))
  })

  it("finds all anchors for a specific learning", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Learning with multiple anchors",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.GLOB_PATTERN_1,
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_2,
          value: "SqliteClient",
          symbolFqname: FIXTURES.SYMBOL_FQNAME_3,
        })
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "line_range",
          filePath: FIXTURES.FILE_PATH_3,
          value: "1-50",
          lineStart: 1,
          lineEnd: 50,
        })

        return yield* anchorSvc.findAnchorsForLearning(learning.id)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(3)
  })
})

// =============================================================================
// EDGE CRUD TESTS
// =============================================================================

describe("Graph Schema - Edge CRUD", () => {
  it("creates an edge between two learnings", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning1 = yield* learningSvc.create({
          content: "Learning 1",
          sourceType: "manual",
        })
        const learning2 = yield* learningSvc.create({
          content: "Learning 2",
          sourceType: "manual",
        })

        return yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(learning1.id),
          targetType: "learning",
          targetId: String(learning2.id),
          weight: 0.85,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.edgeType).toBe("SIMILAR_TO")
    expect(result.sourceType).toBe("learning")
    expect(result.targetType).toBe("learning")
    expect(result.weight).toBe(0.85)
  })

  it("creates ANCHORED_TO edge from learning to file", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning about file",
          sourceType: "manual",
        })

        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
          weight: 1.0,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.edgeType).toBe("ANCHORED_TO")
    expect(result.targetType).toBe("file")
    expect(result.targetId).toBe(FIXTURES.FILE_PATH_1)
  })

  it("creates DERIVED_FROM edge for provenance tracking", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Derived learning",
          sourceType: "manual",
        })

        return yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "run",
          targetId: FIXTURES.RUN_1,
          weight: 1.0,
          metadata: { session: "test-session" },
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.edgeType).toBe("DERIVED_FROM")
    expect(result.targetType).toBe("run")
    expect(result.targetId).toBe(FIXTURES.RUN_1)
  })

  it("updates edge weight", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        const edge = yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
          weight: 0.5,
        })

        return yield* edgeSvc.update(edge.id, { weight: 0.95 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.weight).toBe(0.95)
  })

  it("invalidates (soft-deletes) an edge", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        const edge = yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })

        yield* edgeSvc.invalidateEdge(edge.id)

        // After invalidation, get should fail
        return yield* edgeSvc.get(edge.id).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
  })

  it("validates edge types at creation", async () => {
    const { makeAppLayer, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService

        return yield* edgeSvc.createEdge({
          edgeType: "INVALID_EDGE_TYPE" as any,
          sourceType: "learning",
          sourceId: "1",
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("validates weight bounds (0-1)", async () => {
    const { makeAppLayer, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService

        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: "1",
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
          weight: 1.5, // Invalid: > 1
        })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })
})

// =============================================================================
// MULTI-HOP TRAVERSAL TESTS
// =============================================================================

describe("Graph Schema - Multi-hop Traversal", () => {
  it("traverses a linear chain with depth limit", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create chain: L1 -> L2 -> L3 -> L4
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        // Traverse from L1 with depth 2 (should find L2, L3 but not L4)
        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          depth: 2,
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.length).toBe(2)
    const depths = result.map((n) => n.depth)
    expect(depths).toContain(1)
    expect(depths).toContain(2)
    // L4 should not be found (depth 3)
    expect(depths).not.toContain(3)
  })

  it("traverses a branching graph structure", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create branching: L1 -> L2, L1 -> L3, L2 -> L4
        const l1 = yield* learningSvc.create({ content: "Root", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Branch1", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "Branch2", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "Leaf", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        // Traverse from L1 with depth 2
        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          depth: 2,
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    // Should find L2, L3 at depth 1 and L4 at depth 2
    expect(result.length).toBe(3)
    const nodeIds = result.map((n) => n.nodeId)
    expect(nodeIds).toHaveLength(3) // L2, L3, L4
  })

  it("finds path between two nodes", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create: L1 -> L2 -> L3
        const l1 = yield* learningSvc.create({ content: "Start", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Middle", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "End", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
        })

        return yield* edgeSvc.findPath(
          "learning",
          String(l1.id),
          "learning",
          String(l3.id)
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(2) // Two edges in the path
  })

  it("returns null when no path exists", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create disconnected nodes
        const l1 = yield* learningSvc.create({ content: "Island 1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Island 2", sourceType: "manual" })

        // No edges between them

        return yield* edgeSvc.findPath(
          "learning",
          String(l1.id),
          "learning",
          String(l2.id)
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// EDGE TYPE FILTERING TESTS
// =============================================================================

describe("Graph Schema - Edge Type Filtering", () => {
  it("filters neighbors by edge type", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "Source", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Target 1", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "Target 2", sourceType: "manual" })

        // Create different edge types from l1
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l3.id),
        })

        // Find only SIMILAR_TO edges
        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          edgeTypes: ["SIMILAR_TO"],
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("SIMILAR_TO")
  })

  it("filters by multiple edge types", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "Source", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Similar", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "Linked", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "Derived", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        // Filter by SIMILAR_TO and LINKS_TO
        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          edgeTypes: ["SIMILAR_TO", "LINKS_TO"],
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    const edgeTypes = result.map((n) => n.edgeType)
    expect(edgeTypes).toContain("SIMILAR_TO")
    expect(edgeTypes).toContain("LINKS_TO")
    expect(edgeTypes).not.toContain("DERIVED_FROM")
  })

  it("finds edges by type globally", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })

        return yield* edgeSvc.findByType("SIMILAR_TO")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    result.forEach((e) => expect(e.edgeType).toBe("SIMILAR_TO"))
  })

  it("counts edges by type", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_2,
        })

        return yield* edgeSvc.countByType()
      }).pipe(Effect.provide(layer))
    )

    expect(result.get("SIMILAR_TO")).toBe(1)
    expect(result.get("ANCHORED_TO")).toBe(2)
  })
})

// =============================================================================
// CYCLE DETECTION TESTS
// =============================================================================

describe("Graph Schema - Cycle Detection", () => {
  it("handles cycles in traversal without infinite loop", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create cycle: L1 -> L2 -> L3 -> L1
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        // Traverse with depth 5 - should not hang
        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          depth: 5,
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    // Should visit each node once
    expect(result.length).toBe(2) // L2 and L3 (not L1 since it's the start)
    const nodeIds = result.map((n) => n.nodeId)
    const uniqueNodeIds = [...new Set(nodeIds)]
    expect(uniqueNodeIds.length).toBe(nodeIds.length) // No duplicates
  })

  it("handles self-referential cycles in simple two-node case", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create: L1 <-> L2 (bidirectional)
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          depth: 10,
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    // Should only visit L2 once
    expect(result.length).toBe(1)
    const l2Node = result[0]
    expect(l2Node.depth).toBe(1)
  })

  it("detects diamond pattern in graph", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Diamond pattern: L1 -> L2 -> L4, L1 -> L3 -> L4
        const l1 = yield* learningSvc.create({ content: "Top", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Left", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "Right", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "Bottom", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l4.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          depth: 3,
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    // Should find L2, L3 at depth 1 and L4 at depth 2 (only once)
    expect(result.length).toBe(3) // L2, L3, L4
    const nodeIds = result.map((n) => n.nodeId)
    const uniqueNodeIds = [...new Set(nodeIds)]
    expect(uniqueNodeIds.length).toBe(3) // L4 should not be duplicated
  })
})

// =============================================================================
// BIDIRECTIONAL QUERY TESTS
// =============================================================================

describe("Graph Schema - Bidirectional Queries", () => {
  it("finds outgoing neighbors only", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2, L3 -> L1 (L1 has outgoing to L2, incoming from L3)
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        return yield* edgeSvc.findNeighbors("learning", String(l1.id), {
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].direction).toBe("outgoing")
  })

  it("finds incoming neighbors only", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2, L3 -> L2 (L2 has incoming from L1 and L3)
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l2.id),
        })

        return yield* edgeSvc.findNeighbors("learning", String(l2.id), {
          direction: "incoming",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    result.forEach((n) => expect(n.direction).toBe("incoming"))
  })

  it("finds both incoming and outgoing neighbors (bidirectional)", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        // L1 -> L2, L2 -> L3, L4 -> L2 (L2 has incoming from L1 & L4, outgoing to L3)
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l4.id),
          targetType: "learning",
          targetId: String(l2.id),
        })

        return yield* edgeSvc.findNeighbors("learning", String(l2.id), {
          direction: "both",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(3) // L1, L3, L4
    const directions = result.map((n) => n.direction)
    expect(directions.filter((d) => d === "incoming")).toHaveLength(2) // L1, L4
    expect(directions.filter((d) => d === "outgoing")).toHaveLength(1) // L3
  })

  it("queries edges to a specific target", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        // Both L1 and L2 anchor to the same file
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })

        return yield* edgeSvc.findToTarget("file", FIXTURES.FILE_PATH_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    result.forEach((e) => {
      expect(e.targetType).toBe("file")
      expect(e.targetId).toBe(FIXTURES.FILE_PATH_1)
    })
  })

  it("queries edges from a specific source", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        // L1 anchors to multiple files
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_2,
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "run",
          targetId: FIXTURES.RUN_1,
        })

        return yield* edgeSvc.findFromSource("learning", String(l1.id))
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(3)
    result.forEach((e) => {
      expect(e.sourceType).toBe("learning")
      expect(e.sourceId).toBe(String(1)) // L1's ID
    })
  })
})

// =============================================================================
// ANCHOR-EDGE INTEGRATION TESTS
// =============================================================================

describe("Graph Schema - Anchor and Edge Integration", () => {
  it("creates anchor and corresponding ANCHORED_TO edge", async () => {
    const { makeAppLayer, AnchorService, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning with anchor and edge",
          sourceType: "manual",
        })

        // Create anchor
        const anchor = yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_1,
          value: "TaskService",
          symbolFqname: FIXTURES.SYMBOL_FQNAME_1,
        })

        // Create corresponding edge
        const edge = yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
          metadata: { anchorId: anchor.id, anchorType: anchor.anchorType },
        })

        return { anchor, edge }
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchor.id).toBeDefined()
    expect(result.edge.edgeType).toBe("ANCHORED_TO")
    expect(result.edge.targetId).toBe(FIXTURES.FILE_PATH_1)
  })

  it("finds learnings related to a file via both anchors and edges", async () => {
    const { makeAppLayer, AnchorService, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const edgeSvc = yield* EdgeService

        const learning1 = yield* learningSvc.create({
          content: "Learning 1",
          sourceType: "manual",
        })
        const learning2 = yield* learningSvc.create({
          content: "Learning 2",
          sourceType: "manual",
        })

        // Learning 1: anchor to file
        yield* anchorSvc.createAnchor({
          learningId: learning1.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "*.ts",
        })

        // Learning 2: edge to file
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning2.id),
          targetType: "file",
          targetId: FIXTURES.FILE_PATH_1,
        })

        const anchors = yield* anchorSvc.findAnchorsForFile(FIXTURES.FILE_PATH_1)
        const edges = yield* edgeSvc.findToTarget("file", FIXTURES.FILE_PATH_1)

        return { anchors, edges }
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchors).toHaveLength(1)
    expect(result.edges).toHaveLength(1)
  })
})

// =============================================================================
// STATUS AND METADATA TESTS
// =============================================================================

describe("Graph Schema - Anchor Status Management", () => {
  it("updates anchor status to drifted", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        const anchor = yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "hash",
          filePath: FIXTURES.FILE_PATH_1,
          value: FIXTURES.CONTENT_HASH_1,
          lineStart: 1,
          lineEnd: 10,
        })

        return yield* anchorSvc.updateAnchorStatus(anchor.id, "drifted")
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("drifted")
  })

  it("updates anchor status to invalid", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        const anchor = yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "symbol",
          filePath: FIXTURES.FILE_PATH_1,
          value: "DeletedFunction",
          symbolFqname: "src/file.ts::DeletedFunction",
        })

        return yield* anchorSvc.updateAnchorStatus(anchor.id, "invalid")
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("invalid")
  })

  it("finds only drifted anchors", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "valid-pattern",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_2,
          value: "drifted-pattern",
        })
        yield* anchorSvc.updateAnchorStatus(2, "drifted")

        return yield* anchorSvc.findDrifted()
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("drifted")
  })

  it("finds only invalid anchors", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_1,
          value: "valid-pattern",
        })

        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH_2,
          value: "invalid-pattern",
        })
        yield* anchorSvc.updateAnchorStatus(2, "invalid")

        return yield* anchorSvc.findInvalid()
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("invalid")
  })
})

describe("Graph Schema - Edge Metadata", () => {
  it("stores and retrieves edge metadata", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        return yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "run",
          targetId: FIXTURES.RUN_1,
          metadata: {
            sessionId: "session-123",
            extractedAt: "2024-01-15T10:30:00Z",
            confidence: 0.92,
          },
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.metadata).toEqual({
      sessionId: "session-123",
      extractedAt: "2024-01-15T10:30:00Z",
      confidence: 0.92,
    })
  })

  it("updates edge metadata", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        const edge = yield* edgeSvc.createEdge({
          edgeType: "USED_IN_RUN",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "run",
          targetId: FIXTURES.RUN_1,
          metadata: { helpful: true },
        })

        return yield* edgeSvc.update(edge.id, {
          metadata: { helpful: true, rating: 5 },
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.metadata).toEqual({ helpful: true, rating: 5 })
  })
})
