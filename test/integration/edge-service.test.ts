/**
 * EdgeService Integration Tests
 *
 * Tests the EdgeService at the service layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services once at module level
import { EdgeService, LearningService } from "@jamesaphoenix/tx-core"

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

  it("createEdge creates an edge with valid input", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.id).toBe(1)
    expect(result.edgeType).toBe("DERIVED_FROM")
    expect(result.sourceType).toBe("learning")
    expect(result.targetType).toBe("learning")
    expect(result.weight).toBe(0.8)
  })

  it("createEdge uses default weight of 1.0", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.weight).toBe(1.0)
  })

  it("get returns edge by ID", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.id).toBe(1)
    expect(result.edgeType).toBe("ANCHORED_TO")
  })

  it("get fails with EdgeNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.get(999)
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("EdgeNotFoundError")
    }
  })

  it("update changes edge weight", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.weight).toBe(0.9)
  })

  it("invalidateEdge soft deletes an edge", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invalidated).toBe(true)
    expect(result.getResult._tag).toBe("Left")
  })
})

// =============================================================================
// EdgeService Validation Tests
// =============================================================================

describe("EdgeService validation", () => {
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

  it("createEdge fails with ValidationError for invalid edge type", async () => {
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
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for invalid source type", async () => {
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
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for invalid target type", async () => {
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
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for empty source ID", async () => {
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
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for weight > 1", async () => {
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
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for weight < 0", async () => {
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
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for NaN weight", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: "1",
          targetType: "file",
          targetId: "src/db.ts",
          weight: NaN,
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for Infinity weight", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: "1",
          targetType: "file",
          targetId: "src/db.ts",
          weight: Infinity,
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge fails with ValidationError for -Infinity weight", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: "1",
          targetType: "file",
          targetId: "src/db.ts",
          weight: -Infinity,
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("createEdge accepts boundary weight 0", async () => {
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
          weight: 0,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.weight).toBe(0)
  })

  it("createEdge accepts boundary weight 1", async () => {
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
          weight: 1,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.weight).toBe(1)
  })

  it("update fails with ValidationError for NaN weight", async () => {
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

        return yield* edgeSvc.update(1, { weight: NaN })
      }).pipe(Effect.provide(shared.layer), Effect.either)
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

  it("findNeighbors returns outgoing neighbors", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    result.forEach(n => expect(n.nodeType).toBe("file"))
  })

  it("findNeighbors returns incoming neighbors", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].nodeType).toBe("learning")
  })

  it("findNeighbors filters by edge type", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("ANCHORED_TO")
  })

  it("findNeighbors with depth > 1 traverses multiple hops", async () => {
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
      }).pipe(Effect.provide(shared.layer))
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

  it("findPath returns path between two nodes", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result![0].edgeType).toBe("DERIVED_FROM")
  })

  it("findPath returns null when no path exists", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("findPath finds multi-hop path", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })
})

// =============================================================================
// EdgeService Query Tests
// =============================================================================

describe("EdgeService query operations", () => {
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

  it("findByType returns edges of specific type", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("ANCHORED_TO")
  })

  it("findFromSource returns all edges from a source", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
  })

  it("findToTarget returns all edges to a target", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
  })

  it("countByType returns counts for each edge type", async () => {
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
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.get("ANCHORED_TO")).toBe(2)
    expect(result.get("IMPORTS")).toBe(1)
  })
})

// =============================================================================
// EdgeService Batch Query Tests (findFromMultipleSources)
// =============================================================================

describe("EdgeService batch operations", () => {
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

  it("findFromMultipleSources returns edges grouped by source ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create 3 learnings
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

        // Create edges from learning1 to 2 files
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
          sourceId: String(learning1.id),
          targetType: "file",
          targetId: "src/layer.ts",
        })

        // Create edge from learning2 to 1 file
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning2.id),
          targetType: "file",
          targetId: "src/services/task-service.ts",
        })

        // learning3 has no edges

        // Query all three sources at once
        const edgesMap = yield* edgeSvc.findFromMultipleSources(
          "learning",
          [String(learning1.id), String(learning2.id), String(learning3.id)]
        )

        return {
          edgesMap,
          ids: {
            id1: String(learning1.id),
            id2: String(learning2.id),
            id3: String(learning3.id)
          }
        }
      }).pipe(Effect.provide(shared.layer))
    )

    // Should have entries for all 3 learnings
    expect(result.edgesMap.size).toBe(3)

    // Learning 1 should have 2 edges
    const edges1 = result.edgesMap.get(result.ids.id1)
    expect(edges1).toBeDefined()
    expect(edges1!.length).toBe(2)

    // Learning 2 should have 1 edge
    const edges2 = result.edgesMap.get(result.ids.id2)
    expect(edges2).toBeDefined()
    expect(edges2!.length).toBe(1)

    // Learning 3 should have empty array (not undefined)
    const edges3 = result.edgesMap.get(result.ids.id3)
    expect(edges3).toBeDefined()
    expect(edges3!.length).toBe(0)
  })

  it("findFromMultipleSources returns empty map for empty input", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const edgeSvc = yield* EdgeService
        return yield* edgeSvc.findFromMultipleSources("learning", [])
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(0)
  })

  it("findFromMultipleSources edges are sorted by weight descending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        // Create edges with different weights
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/low-weight.ts",
          weight: 0.3,
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/high-weight.ts",
          weight: 0.9,
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/mid-weight.ts",
          weight: 0.6,
        })

        const edgesMap = yield* edgeSvc.findFromMultipleSources(
          "learning",
          [String(learning.id)]
        )

        return edgesMap.get(String(learning.id))
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeDefined()
    expect(result!.length).toBe(3)

    // Should be sorted by weight descending
    expect(result![0].weight).toBe(0.9)
    expect(result![1].weight).toBe(0.6)
    expect(result![2].weight).toBe(0.3)
  })

  it("findFromMultipleSources only returns valid (non-invalidated) edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const learning = yield* learningSvc.create({
          content: "Learning",
          sourceType: "manual",
        })

        // Create two edges
        const edge1 = yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/valid.ts",
        })
        yield* edgeSvc.createEdge({
          edgeType: "ANCHORED_TO",
          sourceType: "learning",
          sourceId: String(learning.id),
          targetType: "file",
          targetId: "src/also-valid.ts",
        })

        // Invalidate the first edge
        yield* edgeSvc.invalidateEdge(edge1.id)

        const edgesMap = yield* edgeSvc.findFromMultipleSources(
          "learning",
          [String(learning.id)]
        )

        return edgesMap.get(String(learning.id))
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeDefined()
    // Only the non-invalidated edge should remain
    expect(result!.length).toBe(1)
    expect(result![0].targetId).toBe("src/also-valid.ts")
  })
})
