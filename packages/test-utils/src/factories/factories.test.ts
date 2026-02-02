/**
 * Tests for entity factories.
 *
 * Verifies that all factories correctly create test data with
 * proper defaults and customizable options.
 */

import { Effect } from "effect"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { TestDatabase } from "../database/index.js"
import { createTestDatabase } from "../database/index.js"
import {
  TaskFactory,
  createTestTask,
  createTestTasks,
  LearningFactory,
  createTestLearning,
  createTestLearnings,
  EdgeFactory,
  createTestEdge,
  createEdgeBetweenLearnings,
  AnchorFactory,
  createTestAnchor,
  CandidateFactory,
  createTestCandidate,
  fixtureId
} from "./index.js"

describe("TaskFactory", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("should create a task with default values", () => {
    const task = createTestTask(db)

    expect(task.id).toMatch(/^tx-[a-f0-9]{8}$/)
    expect(task.title).toMatch(/^Test Task \d+$/)
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(500)
    expect(task.description).toBe("")
    expect(task.parentId).toBeNull()
    expect(task.createdAt).toBeInstanceOf(Date)
  })

  it("should create a task with custom values", () => {
    const task = createTestTask(db, {
      id: "tx-custom01",
      title: "Custom Task",
      description: "A custom description",
      status: "active",
      score: 800
    })

    expect(task.id).toBe("tx-custom01")
    expect(task.title).toBe("Custom Task")
    expect(task.description).toBe("A custom description")
    expect(task.status).toBe("active")
    expect(task.score).toBe(800)
  })

  it("should create multiple tasks", () => {
    const tasks = createTestTasks(db, 5)

    expect(tasks).toHaveLength(5)
    const ids = tasks.map((t) => t.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(5) // All IDs should be unique
  })

  it("should create task hierarchy with children", () => {
    const factory = new TaskFactory(db)
    const { parent, children } = factory.withChildren(
      { title: "Parent Task" },
      3,
      { status: "backlog" }
    )

    expect(parent.title).toBe("Parent Task")
    expect(children).toHaveLength(3)
    children.forEach((child) => {
      expect(child.parentId).toBe(parent.id)
    })
  })

  it("should create completed task with completedAt timestamp", () => {
    const factory = new TaskFactory(db)
    const task = factory.completed({ title: "Done Task" })

    expect(task.status).toBe("done")
    expect(task.completedAt).toBeInstanceOf(Date)
  })

  it("should persist task to database", () => {
    const task = createTestTask(db, { title: "Persisted Task" })

    const rows = db.query<{ id: string; title: string }>(
      "SELECT id, title FROM tasks WHERE id = ?",
      [task.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Persisted Task")
  })
})

describe("LearningFactory", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("should create a learning with default values", () => {
    const learning = createTestLearning(db)

    expect(learning.id).toBeGreaterThan(0)
    expect(learning.content).toMatch(/^Test learning \d+$/)
    expect(learning.sourceType).toBe("manual")
    expect(learning.sourceRef).toBeNull()
    expect(learning.keywords).toEqual([])
    expect(learning.category).toBeNull()
    expect(learning.usageCount).toBe(0)
  })

  it("should create a learning with custom values", () => {
    const learning = createTestLearning(db, {
      content: "Always use Effect-TS for typed errors",
      category: "patterns",
      sourceType: "run",
      sourceRef: "run-123",
      keywords: ["effect", "typescript", "errors"]
    })

    expect(learning.content).toBe("Always use Effect-TS for typed errors")
    expect(learning.category).toBe("patterns")
    expect(learning.sourceType).toBe("run")
    expect(learning.sourceRef).toBe("run-123")
    expect(learning.keywords).toEqual(["effect", "typescript", "errors"])
  })

  it("should create multiple learnings", () => {
    const learnings = createTestLearnings(db, 5, { category: "testing" })

    expect(learnings).toHaveLength(5)
    learnings.forEach((l) => {
      expect(l.category).toBe("testing")
    })
  })

  it("should create learning with embedding", () => {
    const factory = new LearningFactory(db)
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])
    const learning = factory.withEmbedding(embedding, { content: "Vector test" })

    expect(learning.embedding).toBeInstanceOf(Float32Array)
    expect(learning.embedding?.length).toBe(5)
  })

  it("should persist learning to database", () => {
    const learning = createTestLearning(db, { content: "Persisted Learning" })

    const rows = db.query<{ id: number; content: string }>(
      "SELECT id, content FROM learnings WHERE id = ?",
      [learning.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe("Persisted Learning")
  })
})

describe("EdgeFactory", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("should create an edge with default values", () => {
    const edge = createTestEdge(db)

    expect(edge.id).toBeGreaterThan(0)
    expect(edge.edgeType).toBe("SIMILAR_TO")
    expect(edge.sourceType).toBe("learning")
    expect(edge.targetType).toBe("learning")
    expect(edge.weight).toBe(1.0)
    expect(edge.metadata).toEqual({})
  })

  it("should create edge between two learnings", () => {
    const edge = createEdgeBetweenLearnings(db, 1, 2, "SIMILAR_TO", 0.85)

    expect(edge.edgeType).toBe("SIMILAR_TO")
    expect(edge.sourceType).toBe("learning")
    expect(edge.sourceId).toBe("1")
    expect(edge.targetType).toBe("learning")
    expect(edge.targetId).toBe("2")
    expect(edge.weight).toBe(0.85)
  })

  it("should create anchor edge to file", () => {
    const factory = new EdgeFactory(db)
    const edge = factory.anchorToFile(1, "src/service.ts", 0.9)

    expect(edge.edgeType).toBe("ANCHORED_TO")
    expect(edge.sourceId).toBe("1")
    expect(edge.targetType).toBe("file")
    expect(edge.targetId).toBe("src/service.ts")
  })

  it("should create derived-from edge", () => {
    const factory = new EdgeFactory(db)
    const edge = factory.derivedFromRun(1, "run-abc123")

    expect(edge.edgeType).toBe("DERIVED_FROM")
    expect(edge.targetType).toBe("run")
    expect(edge.targetId).toBe("run-abc123")
  })

  it("should persist edge to database", () => {
    const edge = createTestEdge(db, {
      sourceId: "1",
      targetId: "2",
      weight: 0.75
    })

    const rows = db.query<{ id: number; weight: number }>(
      "SELECT id, weight FROM learning_edges WHERE id = ?",
      [edge.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].weight).toBe(0.75)
  })
})

describe("AnchorFactory", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    // Create a learning for anchors to reference
    createTestLearning(db, { id: 1 })
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("should create an anchor with required values", () => {
    const anchor = createTestAnchor(db, { learningId: 1 })

    expect(anchor.id).toBeGreaterThan(0)
    expect(anchor.learningId).toBe(1)
    expect(anchor.anchorType).toBe("symbol")
    expect(anchor.status).toBe("valid")
  })

  it("should create symbol anchor", () => {
    const factory = new AnchorFactory(db)
    const anchor = factory.symbolAnchor(1, "src/service.ts", "handleRequest")

    expect(anchor.anchorType).toBe("symbol")
    expect(anchor.anchorValue).toBe("handleRequest")
    expect(anchor.filePath).toBe("src/service.ts")
    expect(anchor.symbolFqname).toBe("src/service.ts::handleRequest")
  })

  it("should create glob anchor", () => {
    const factory = new AnchorFactory(db)
    const anchor = factory.globAnchor(1, "src/repo/*.ts")

    expect(anchor.anchorType).toBe("glob")
    expect(anchor.anchorValue).toBe("src/repo/*.ts")
  })

  it("should create line range anchor", () => {
    const factory = new AnchorFactory(db)
    const anchor = factory.lineRangeAnchor(1, "src/service.ts", 10, 25)

    expect(anchor.anchorType).toBe("line_range")
    expect(anchor.lineStart).toBe(10)
    expect(anchor.lineEnd).toBe(25)
  })

  it("should create drifted anchor", () => {
    const factory = new AnchorFactory(db)
    const anchor = factory.driftedAnchor(1, "src/changed.ts")

    expect(anchor.status).toBe("drifted")
  })

  it("should persist anchor to database", () => {
    const anchor = createTestAnchor(db, {
      learningId: 1,
      filePath: "src/test.ts"
    })

    const rows = db.query<{ id: number; file_path: string }>(
      "SELECT id, file_path FROM learning_anchors WHERE id = ?",
      [anchor.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].file_path).toBe("src/test.ts")
  })
})

describe("CandidateFactory", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("should create a candidate with default values", () => {
    const candidate = createTestCandidate(db)

    expect(candidate.id).toBeGreaterThan(0)
    expect(candidate.content).toMatch(/^Test candidate learning \d+$/)
    expect(candidate.confidence).toBe("medium")
    expect(candidate.status).toBe("pending")
    expect(candidate.sourceFile).toMatch(/^~\/.claude\/projects\/test\/session-\d+\.jsonl$/)
  })

  it("should create high-confidence candidate", () => {
    const factory = new CandidateFactory(db)
    const candidate = factory.highConfidence({ content: "Always use Effect" })

    expect(candidate.confidence).toBe("high")
    expect(candidate.content).toBe("Always use Effect")
  })

  it("should create promoted candidate", () => {
    // First create a learning to reference
    const learning = createTestLearning(db, { id: 100 })

    const factory = new CandidateFactory(db)
    const candidate = factory.promoted({
      content: "Promoted learning",
      promotedLearningId: learning.id
    })

    expect(candidate.status).toBe("promoted")
    expect(candidate.promotedLearningId).toBe(learning.id)
    expect(candidate.reviewedBy).toBe("auto")
    expect(candidate.reviewedAt).toBeInstanceOf(Date)
  })

  it("should create rejected candidate", () => {
    const factory = new CandidateFactory(db)
    const candidate = factory.rejected("Too specific to context", {
      content: "Very specific learning"
    })

    expect(candidate.status).toBe("rejected")
    expect(candidate.rejectionReason).toBe("Too specific to context")
    expect(candidate.reviewedAt).toBeInstanceOf(Date)
  })

  it("should create merged candidate", () => {
    const learning = createTestLearning(db, { id: 50 })

    const factory = new CandidateFactory(db)
    const candidate = factory.merged(learning.id, { content: "Duplicate learning" })

    expect(candidate.status).toBe("merged")
    expect(candidate.promotedLearningId).toBe(learning.id)
  })

  it("should persist candidate to database", () => {
    const candidate = createTestCandidate(db, {
      content: "Persisted Candidate",
      confidence: "high"
    })

    const rows = db.query<{ id: number; content: string; confidence: string }>(
      "SELECT id, content, confidence FROM learning_candidates WHERE id = ?",
      [candidate.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe("Persisted Candidate")
    expect(rows[0].confidence).toBe("high")
  })
})

describe("fixtureId", () => {
  it("should generate deterministic IDs", () => {
    const id1 = fixtureId("test-fixture")
    const id2 = fixtureId("test-fixture")

    expect(id1).toBe(id2)
    expect(id1).toMatch(/^tx-[a-f0-9]{8}$/)
  })

  it("should generate different IDs for different inputs", () => {
    const id1 = fixtureId("fixture-a")
    const id2 = fixtureId("fixture-b")

    expect(id1).not.toBe(id2)
  })
})

describe("EdgeRepository.findByMultipleSources", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("should return empty map for empty sourceIds array", async () => {
    // Import EdgeRepository and create layer
    const { EdgeRepository, EdgeRepositoryLive, SqliteClient } = await import("@tx/core")
    const { Layer } = await import("effect")

    // Create a SqliteClient layer from the test database
    const TestSqliteClient = Layer.succeed(SqliteClient, db.db as any)
    const TestEdgeRepoLayer = Layer.provide(EdgeRepositoryLive, TestSqliteClient)

    const program = Effect.gen(function* () {
      const edgeRepo = yield* EdgeRepository
      return yield* edgeRepo.findByMultipleSources("learning", [])
    })

    const result = await Effect.runPromise(Effect.provide(program, TestEdgeRepoLayer))

    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
  })

  it("should fetch edges for multiple source IDs in one query", async () => {
    // Create test edges using a single factory to avoid ID collisions
    const edgeFactory = new EdgeFactory(db)
    edgeFactory.create({ sourceType: "learning", sourceId: "1", targetId: "10", weight: 0.9 })
    edgeFactory.create({ sourceType: "learning", sourceId: "1", targetId: "11", weight: 0.8 })
    edgeFactory.create({ sourceType: "learning", sourceId: "2", targetId: "20", weight: 0.7 })
    edgeFactory.create({ sourceType: "learning", sourceId: "3", targetId: "30", weight: 0.6 })

    // Import EdgeRepository and create layer
    const { EdgeRepository, EdgeRepositoryLive, SqliteClient } = await import("@tx/core")
    const { Layer } = await import("effect")

    const TestSqliteClient = Layer.succeed(SqliteClient, db.db as any)
    const TestEdgeRepoLayer = Layer.provide(EdgeRepositoryLive, TestSqliteClient)

    const program = Effect.gen(function* () {
      const edgeRepo = yield* EdgeRepository
      return yield* edgeRepo.findByMultipleSources("learning", ["1", "2"])
    })

    const result = await Effect.runPromise(Effect.provide(program, TestEdgeRepoLayer))

    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(2)

    // Check source 1 has 2 edges
    const source1Edges = result.get("1")
    expect(source1Edges).toBeDefined()
    expect(source1Edges).toHaveLength(2)
    // Edges should be sorted by weight DESC
    expect(source1Edges![0].weight).toBe(0.9)
    expect(source1Edges![1].weight).toBe(0.8)

    // Check source 2 has 1 edge
    const source2Edges = result.get("2")
    expect(source2Edges).toBeDefined()
    expect(source2Edges).toHaveLength(1)
    expect(source2Edges![0].targetId).toBe("20")
  })

  it("should return empty arrays for sourceIds with no edges", async () => {
    // Create edge only for source 1
    createTestEdge(db, { sourceType: "learning", sourceId: "1", targetId: "10" })

    const { EdgeRepository, EdgeRepositoryLive, SqliteClient } = await import("@tx/core")
    const { Layer } = await import("effect")

    const TestSqliteClient = Layer.succeed(SqliteClient, db.db as any)
    const TestEdgeRepoLayer = Layer.provide(EdgeRepositoryLive, TestSqliteClient)

    const program = Effect.gen(function* () {
      const edgeRepo = yield* EdgeRepository
      return yield* edgeRepo.findByMultipleSources("learning", ["1", "2", "3"])
    })

    const result = await Effect.runPromise(Effect.provide(program, TestEdgeRepoLayer))

    expect(result.size).toBe(3)
    expect(result.get("1")).toHaveLength(1)
    expect(result.get("2")).toHaveLength(0)
    expect(result.get("3")).toHaveLength(0)
  })

  it("should filter by sourceType", async () => {
    // Create edges with different source types using a single factory
    const edgeFactory = new EdgeFactory(db)
    edgeFactory.create({ sourceType: "learning", sourceId: "1", targetId: "10" })
    edgeFactory.create({ sourceType: "file", sourceId: "1", targetId: "20" })

    const { EdgeRepository, EdgeRepositoryLive, SqliteClient } = await import("@tx/core")
    const { Layer } = await import("effect")

    const TestSqliteClient = Layer.succeed(SqliteClient, db.db as any)
    const TestEdgeRepoLayer = Layer.provide(EdgeRepositoryLive, TestSqliteClient)

    const program = Effect.gen(function* () {
      const edgeRepo = yield* EdgeRepository
      return yield* edgeRepo.findByMultipleSources("learning", ["1"])
    })

    const result = await Effect.runPromise(Effect.provide(program, TestEdgeRepoLayer))

    expect(result.size).toBe(1)
    const edges = result.get("1")
    expect(edges).toHaveLength(1)
    expect(edges![0].sourceType).toBe("learning")
  })

  it("should exclude invalidated edges", async () => {
    // Create a valid edge
    createTestEdge(db, { sourceType: "learning", sourceId: "1", targetId: "10" })

    // Create an invalidated edge by inserting directly
    db.exec(`
      INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id, weight, metadata, invalidated_at)
      VALUES ('SIMILAR_TO', 'learning', '1', 'learning', '11', 1.0, '{}', datetime('now'))
    `)

    const { EdgeRepository, EdgeRepositoryLive, SqliteClient } = await import("@tx/core")
    const { Layer } = await import("effect")

    const TestSqliteClient = Layer.succeed(SqliteClient, db.db as any)
    const TestEdgeRepoLayer = Layer.provide(EdgeRepositoryLive, TestSqliteClient)

    const program = Effect.gen(function* () {
      const edgeRepo = yield* EdgeRepository
      return yield* edgeRepo.findByMultipleSources("learning", ["1"])
    })

    const result = await Effect.runPromise(Effect.provide(program, TestEdgeRepoLayer))

    expect(result.size).toBe(1)
    const edges = result.get("1")
    expect(edges).toHaveLength(1) // Only the valid edge
    expect(edges![0].targetId).toBe("10")
  })
})
