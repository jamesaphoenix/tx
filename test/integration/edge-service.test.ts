/**
 * EdgeService Integration Tests
 *
 * Tests the EdgeService at the service layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 */

import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`edge-service-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  LEARNING_1: fixtureId("learning-1"),
  LEARNING_2: fixtureId("learning-2"),
  FILE_1: fixtureId("file-1"),
  FILE_2: fixtureId("file-2"),
  TASK_1: fixtureId("task-1"),
  TASK_2: fixtureId("task-2"),
} as const

// Suppress unused warning - kept for documentation and future use
void FIXTURES

// =============================================================================
// EdgeService CRUD Tests (via @tx/core)
// =============================================================================

describe("EdgeService Integration via @tx/core", () => {
  it("createEdge creates an edge with valid input", async () => {
    const { makeAppLayer, EdgeService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create learnings first
        const learning1 = yield* learningSvc.create({
          content: "Learning 1",
          sourceType: "manual",
        })
        const learning2 = yield* learningSvc.create({
          content: "Learning 2",
          sourceType: "manual",
        })

        // Create edge
        return yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning1.id),
          targetType: "learning",
          targetId: String(learning2.id),
          weight: 0.8,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toBe(1)
    expect(result.edgeType).toBe("DERIVED_FROM")
    expect(result.sourceType).toBe("learning")
    expect(result.targetType).toBe("learning")
    expect(result.weight).toBe(0.8)
  })

  it("createEdge uses default weight of 1.0", async () => {
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
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.weight).toBe(1.0)
  })

  it("get returns edge by ID", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })

        return yield* edgeSvc.get(1)
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toBe(1)
    expect(result.edgeType).toBe("ANCHORED_TO")
  })

  it("get fails with EdgeNotFoundError for nonexistent ID", async () => {
    const { makeAppLayer, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.get(999)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("EdgeNotFoundError")
    }
  })

  it("update changes edge weight", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
          weight: 0.5,
        })

        return yield* edgeSvc.update(1, { weight: 0.9 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.weight).toBe(0.9)
  })

  it("invalidateEdge soft deletes an edge", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })

        const invalidated = yield* edgeSvc.invalidateEdge(1)

        // After invalidation, get should fail
        const getResult = yield* edgeSvc.get(1).pipe(Effect.either)

        return { invalidated, getResult }
      }).pipe(Effect.provide(layer))
    )

    expect(result.invalidated).toBe(true)
    expect(result.getResult._tag).toBe("Left")
  })
})

// =============================================================================
// EdgeService Validation Tests
// =============================================================================

describe("EdgeService validation", () => {
  it("createEdge fails with ValidationError for invalid edge type", async () => {
    const { makeAppLayer, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.createEdge({
          edgeType: "INVALID_TYPE" as any,
          sourceType: "learning",
          sourceId: "1",
          targetType: "file",
          targetId: "src/db.ts",
        })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for invalid source type", async () => {
    const { makeAppLayer, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "invalid" as any,
          sourceId: "1",
          targetType: "file",
          targetId: "src/db.ts",
        })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for invalid target type", async () => {
    const { makeAppLayer, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: "1",
          targetType: "invalid" as any,
          targetId: "src/db.ts",
        })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for empty source ID", async () => {
    const { makeAppLayer, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: "",
          targetType: "file",
          targetId: "src/db.ts",
        })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for weight > 1", async () => {
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
          targetId: "src/db.ts",
          weight: 1.5,
        })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for weight < 0", async () => {
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
          targetId: "src/db.ts",
          weight: -0.5,
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
// EdgeService Neighbor Finding Tests
// =============================================================================

describe("EdgeService neighbor operations", () => {
  it("findNeighbors returns outgoing neighbors", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/services/task-service.ts",
        })

        return yield* edgeSvc.findNeighbors("learning", String(learning.id), {
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    result.forEach(n => expect(n.nodeType).toBe("file"))
  })

  it("findNeighbors returns incoming neighbors", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning1.id),
          targetType: "learning",
          targetId: String(learning2.id),
        })

        return yield* edgeSvc.findNeighbors("learning", String(learning2.id), {
          direction: "incoming",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].nodeType).toBe("learning")
  })

  it("findNeighbors filters by edge type", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/services/task-service.ts",
        })

        return yield* edgeSvc.findNeighbors("learning", String(learning.id), {
          edgeTypes: ["ANCHORED_TO"],
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("ANCHORED_TO")
  })

  it("findNeighbors with depth > 1 traverses multiple hops", async () => {
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
        const learning3 = yield* learningSvc.create({
          content: "Learning 3",
          sourceType: "manual",
        })

        // learning1 -> learning2 -> learning3
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning1.id),
          targetType: "learning",
          targetId: String(learning2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning2.id),
          targetType: "learning",
          targetId: String(learning3.id),
        })

        return yield* edgeSvc.findNeighbors("learning", String(learning1.id), {
          depth: 2,
          direction: "outgoing",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    // Should find both learning2 (depth 1) and learning3 (depth 2)
    const depths = result.map(n => n.depth)
    expect(depths).toContain(1)
    expect(depths).toContain(2)
  })
})

// =============================================================================
// EdgeService Path Finding Tests
// =============================================================================

describe("EdgeService path finding", () => {
  it("findPath returns path between two nodes", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning1.id),
          targetType: "learning",
          targetId: String(learning2.id),
        })

        return yield* edgeSvc.findPath(
          "learning",
          String(learning1.id),
          "learning",
          String(learning2.id)
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result![0].edgeType).toBe("DERIVED_FROM")
  })

  it("findPath returns null when no path exists", async () => {
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

        // No edge between them

        return yield* edgeSvc.findPath(
          "learning",
          String(learning1.id),
          "learning",
          String(learning2.id)
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })

  it("findPath finds multi-hop path", async () => {
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
        const learning3 = yield* learningSvc.create({
          content: "Learning 3",
          sourceType: "manual",
        })

        // learning1 -> learning2 -> learning3
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning1.id),
          targetType: "learning",
          targetId: String(learning2.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(learning2.id),
          targetType: "learning",
          targetId: String(learning3.id),
        })

        return yield* edgeSvc.findPath(
          "learning",
          String(learning1.id),
          "learning",
          String(learning3.id)
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })
})

// =============================================================================
// EdgeService Query Tests
// =============================================================================

describe("EdgeService query operations", () => {
  it("findByType returns edges of specific type", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/services/task-service.ts",
        })

        return yield* edgeSvc.findByType("ANCHORED_TO")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("ANCHORED_TO")
  })

  it("findFromSource returns all edges from a source", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/services/task-service.ts",
        })

        return yield* edgeSvc.findFromSource("learning", String(learning.id))
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
  })

  it("findToTarget returns all edges to a target", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning1.id),
          targetType: "file",
          targetId: "src/db.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning2.id),
          targetType: "file",
          targetId: "src/db.ts",
        })

        return yield* edgeSvc.findToTarget("file", "src/db.ts")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
  })

  it("countByType returns counts for each edge type", async () => {
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

        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/db.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/services/task-service.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/utils.ts",
        })

        return yield* edgeSvc.countByType()
      }).pipe(Effect.provide(layer))
    )

    expect(result.get("ANCHORED_TO")).toBe(2)
    expect(result.get("IMPORTS")).toBe(1)
  })
})
