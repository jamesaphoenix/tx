/**
 * EdgeRepository Integration Tests
 *
 * Tests the EdgeRepository at the repository layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * This tests the repository directly, covering:
 * - CRUD operations
 * - Batch operations (findByMultipleSources)
 * - Path finding (BFS with edge cases)
 * - Neighbor queries with direction filters
 * - Edge type counts
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 *
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import repository and types
import { EdgeRepository } from "@jamesaphoenix/tx-core"
import type { EdgeType, NodeType, CreateEdgeInput } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`edge-repo-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  LEARNING_1: fixtureId("learning-1"),
  LEARNING_2: fixtureId("learning-2"),
  LEARNING_3: fixtureId("learning-3"),
  LEARNING_4: fixtureId("learning-4"),
  LEARNING_5: fixtureId("learning-5"),
  FILE_1: fixtureId("file-1"),
  FILE_2: fixtureId("file-2"),
  FILE_3: fixtureId("file-3"),
  TASK_1: fixtureId("task-1"),
  TASK_2: fixtureId("task-2"),
} as const

// =============================================================================
// Helper: Create Edge Data
// =============================================================================

const createEdgeData = (
  overrides?: Partial<CreateEdgeInput>
): CreateEdgeInput => ({
  edgeType: overrides?.edgeType ?? "ANCHORED_TO" as EdgeType,
  sourceType: overrides?.sourceType ?? "learning" as NodeType,
  sourceId: overrides?.sourceId ?? FIXTURES.LEARNING_1,
  targetType: overrides?.targetType ?? "file" as NodeType,
  targetId: overrides?.targetId ?? FIXTURES.FILE_1,
  weight: overrides?.weight,
  metadata: overrides?.metadata,
})

// =============================================================================
// EdgeRepository.create Tests
// =============================================================================

describe("EdgeRepository.create", () => {
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

  it("creates edge with required fields", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.create(createEdgeData())
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.id).toBe(1)
    expect(result.edgeType).toBe("ANCHORED_TO")
    expect(result.sourceType).toBe("learning")
    expect(result.sourceId).toBe(FIXTURES.LEARNING_1)
    expect(result.targetType).toBe("file")
    expect(result.targetId).toBe(FIXTURES.FILE_1)
    expect(result.weight).toBe(1.0) // Default weight
    expect(result.metadata).toEqual({})
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.invalidatedAt).toBeNull()
  })

  it("creates edge with custom weight", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.create(createEdgeData({ weight: 0.75 }))
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.weight).toBe(0.75)
  })

  it("creates edge with metadata", async () => {
    const metadata = { reason: "test", confidence: 0.9 }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.create(createEdgeData({ metadata }))
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.metadata).toEqual(metadata)
  })

  it("auto-increments IDs for multiple inserts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const e1 = yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_1 }))
        const e2 = yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_2 }))
        const e3 = yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_3 }))

        return { e1, e2, e3 }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.e1.id).toBe(1)
    expect(result.e2.id).toBe(2)
    expect(result.e3.id).toBe(3)
  })

  it("creates edges with different edge types", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const derived = yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))

        const imports = yield* repo.create(createEdgeData({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: FIXTURES.FILE_1,
          targetType: "file",
          targetId: FIXTURES.FILE_2,
        }))

        return { derived, imports }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.derived.edgeType).toBe("DERIVED_FROM")
    expect(result.imports.edgeType).toBe("IMPORTS")
  })
})

// =============================================================================
// EdgeRepository.findById Tests
// =============================================================================

describe("EdgeRepository.findById", () => {
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

  it("returns edge by ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const created = yield* repo.create(createEdgeData())
        return yield* repo.findById(created.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.id).toBe(1)
    expect(result!.edgeType).toBe("ANCHORED_TO")
  })

  it("returns null for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findById(999)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("returns null for invalidated edge", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const created = yield* repo.create(createEdgeData())
        yield* repo.invalidate(created.id)
        return yield* repo.findById(created.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// EdgeRepository.findBySource Tests
// =============================================================================

describe("EdgeRepository.findBySource", () => {
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

  it("returns all edges from a source", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_2, // Different source
          targetId: FIXTURES.FILE_3,
        }))

        return yield* repo.findBySource("learning", FIXTURES.LEARNING_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    expect(result[0].sourceId).toBe(FIXTURES.LEARNING_1)
    expect(result[1].sourceId).toBe(FIXTURES.LEARNING_1)
  })

  it("returns empty array when no edges from source", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findBySource("learning", "nonexistent")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  it("excludes invalidated edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const edge1 = yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
        }))

        yield* repo.invalidate(edge1.id)

        return yield* repo.findBySource("learning", FIXTURES.LEARNING_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].targetId).toBe(FIXTURES.FILE_2)
  })

  it("orders by created_at ASC", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_3,
        }))

        return yield* repo.findBySource("learning", FIXTURES.LEARNING_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(3)
    // IDs should be in order (1, 2, 3) since created sequentially
    expect(result[0].id).toBe(1)
    expect(result[1].id).toBe(2)
    expect(result[2].id).toBe(3)
  })
})

// =============================================================================
// EdgeRepository.findByTarget Tests
// =============================================================================

describe("EdgeRepository.findByTarget", () => {
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

  it("returns all edges to a target", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_2,
          targetId: FIXTURES.FILE_1, // Same target
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_3,
          targetId: FIXTURES.FILE_2, // Different target
        }))

        return yield* repo.findByTarget("file", FIXTURES.FILE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    expect(result[0].targetId).toBe(FIXTURES.FILE_1)
    expect(result[1].targetId).toBe(FIXTURES.FILE_1)
  })

  it("returns empty array when no edges to target", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findByTarget("file", "nonexistent")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  it("excludes invalidated edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const edge1 = yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_2,
          targetId: FIXTURES.FILE_1,
        }))

        yield* repo.invalidate(edge1.id)

        return yield* repo.findByTarget("file", FIXTURES.FILE_1)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].sourceId).toBe(FIXTURES.LEARNING_2)
  })
})

// =============================================================================
// EdgeRepository.findByMultipleSources Tests (Batch Operations)
// =============================================================================

describe("EdgeRepository.findByMultipleSources", () => {
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

  it("returns edges grouped by source ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // Learning 1 has 2 edges
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
        }))

        // Learning 2 has 1 edge
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_2,
          targetId: FIXTURES.FILE_3,
        }))

        // Learning 3 has no edges

        return yield* repo.findByMultipleSources(
          "learning",
          [FIXTURES.LEARNING_1, FIXTURES.LEARNING_2, FIXTURES.LEARNING_3]
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(3)
    expect(result.get(FIXTURES.LEARNING_1)).toHaveLength(2)
    expect(result.get(FIXTURES.LEARNING_2)).toHaveLength(1)
    expect(result.get(FIXTURES.LEARNING_3)).toHaveLength(0) // Empty array, not undefined
  })

  it("returns empty map for empty input", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findByMultipleSources("learning", [])
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(0)
  })

  it("edges are sorted by weight descending then created_at ascending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // Create edges with different weights
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
          weight: 0.3,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
          weight: 0.9,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_3,
          weight: 0.6,
        }))

        return yield* repo.findByMultipleSources("learning", [FIXTURES.LEARNING_1])
      }).pipe(Effect.provide(shared.layer))
    )

    const edges = result.get(FIXTURES.LEARNING_1)!
    expect(edges).toHaveLength(3)
    expect(edges[0].weight).toBe(0.9)
    expect(edges[1].weight).toBe(0.6)
    expect(edges[2].weight).toBe(0.3)
  })

  it("excludes invalidated edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const edge1 = yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
        }))

        yield* repo.invalidate(edge1.id)

        return yield* repo.findByMultipleSources("learning", [FIXTURES.LEARNING_1])
      }).pipe(Effect.provide(shared.layer))
    )

    const edges = result.get(FIXTURES.LEARNING_1)!
    expect(edges).toHaveLength(1)
    expect(edges[0].targetId).toBe(FIXTURES.FILE_2)
  })

  it("handles large batch queries efficiently", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // Create edges for multiple sources
        for (let i = 0; i < 10; i++) {
          yield* repo.create(createEdgeData({
            sourceId: `learning-${i}`,
            targetId: `file-${i}`,
          }))
        }

        const sourceIds = Array.from({ length: 10 }, (_, i) => `learning-${i}`)
        return yield* repo.findByMultipleSources("learning", sourceIds)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(10)
    for (let i = 0; i < 10; i++) {
      expect(result.get(`learning-${i}`)).toHaveLength(1)
    }
  })
})

// =============================================================================
// EdgeRepository.findByEdgeType Tests
// =============================================================================

describe("EdgeRepository.findByEdgeType", () => {
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

  it("returns all edges of a specific type", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: FIXTURES.FILE_1,
          targetType: "file",
          targetId: FIXTURES.FILE_3,
        }))

        return yield* repo.findByEdgeType("ANCHORED_TO")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    result.forEach(e => expect(e.edgeType).toBe("ANCHORED_TO"))
  })

  it("returns empty array when no edges of type exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        yield* repo.create(createEdgeData({ edgeType: "ANCHORED_TO" }))
        return yield* repo.findByEdgeType("IMPORTS")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  it("orders by weight descending then created_at ascending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_1,
          weight: 0.3,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_2,
          weight: 0.9,
        }))

        return yield* repo.findByEdgeType("ANCHORED_TO")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result[0].weight).toBe(0.9)
    expect(result[1].weight).toBe(0.3)
  })
})

// =============================================================================
// EdgeRepository.countByType Tests
// =============================================================================

describe("EdgeRepository.countByType", () => {
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

  it("returns counts for each edge type", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: FIXTURES.FILE_1,
          targetType: "file",
          targetId: FIXTURES.FILE_3,
        }))

        return yield* repo.countByType()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.get("ANCHORED_TO")).toBe(2)
    expect(result.get("IMPORTS")).toBe(1)
  })

  it("returns empty map when no edges exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.countByType()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.size).toBe(0)
  })

  it("excludes invalidated edges from counts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const edge1 = yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          targetId: FIXTURES.FILE_2,
        }))

        yield* repo.invalidate(edge1.id)

        return yield* repo.countByType()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.get("ANCHORED_TO")).toBe(1)
  })
})

// =============================================================================
// EdgeRepository.findNeighbors Tests
// =============================================================================

describe("EdgeRepository.findNeighbors", () => {
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

  it("returns outgoing neighbors (default direction is both)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> FILE_1
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        // LEARNING_1 -> FILE_2
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
        }))

        return yield* repo.findNeighbors("learning", FIXTURES.LEARNING_1, {
          direction: "outgoing",
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    result.forEach(n => {
      expect(n.nodeType).toBe("file")
      expect(n.direction).toBe("outgoing")
    })
  })

  it("returns incoming neighbors", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> FILE_1
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        // LEARNING_2 -> FILE_1
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_2,
          targetId: FIXTURES.FILE_1,
        }))

        return yield* repo.findNeighbors("file", FIXTURES.FILE_1, {
          direction: "incoming",
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    result.forEach(n => {
      expect(n.nodeType).toBe("learning")
      expect(n.direction).toBe("incoming")
    })
  })

  it("returns both directions by default", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> LEARNING_2 (outgoing from LEARNING_2's perspective)
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        // LEARNING_2 -> LEARNING_3 (incoming from LEARNING_2's perspective)
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_2,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_3,
        }))

        return yield* repo.findNeighbors("learning", FIXTURES.LEARNING_2)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    const directions = result.map(n => n.direction)
    expect(directions).toContain("incoming")
    expect(directions).toContain("outgoing")
  })

  it("filters by edge types", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // ANCHORED_TO edge
        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        // IMPORTS edge (should be excluded)
        yield* repo.create(createEdgeData({
          edgeType: "IMPORTS",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "file",
          targetId: FIXTURES.FILE_2,
        }))

        return yield* repo.findNeighbors("learning", FIXTURES.LEARNING_1, {
          edgeTypes: ["ANCHORED_TO"],
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("ANCHORED_TO")
  })

  it("filters by multiple edge types", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          edgeType: "ANCHORED_TO",
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "IMPORTS",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "file",
          targetId: FIXTURES.FILE_2,
        }))

        return yield* repo.findNeighbors("learning", FIXTURES.LEARNING_1, {
          edgeTypes: ["ANCHORED_TO", "DERIVED_FROM"],
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(2)
    const types = result.map(n => n.edgeType)
    expect(types).toContain("ANCHORED_TO")
    expect(types).toContain("DERIVED_FROM")
    expect(types).not.toContain("IMPORTS")
  })

  it("returns empty array when no neighbors", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findNeighbors("learning", "nonexistent")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  it("orders by weight descending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
          weight: 0.3,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
          weight: 0.9,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_3,
          weight: 0.6,
        }))

        return yield* repo.findNeighbors("learning", FIXTURES.LEARNING_1, {
          direction: "outgoing",
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result[0].weight).toBe(0.9)
    expect(result[1].weight).toBe(0.6)
    expect(result[2].weight).toBe(0.3)
  })

  it("excludes invalidated edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const edge1 = yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_1,
        }))
        yield* repo.create(createEdgeData({
          sourceId: FIXTURES.LEARNING_1,
          targetId: FIXTURES.FILE_2,
        }))

        yield* repo.invalidate(edge1.id)

        return yield* repo.findNeighbors("learning", FIXTURES.LEARNING_1, {
          direction: "outgoing",
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].nodeId).toBe(FIXTURES.FILE_2)
  })
})

// =============================================================================
// EdgeRepository.findPath Tests (BFS)
// =============================================================================

describe("EdgeRepository.findPath", () => {
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

  it("finds direct path between two nodes", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> LEARNING_2
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))

        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_2
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result![0].edgeType).toBe("DERIVED_FROM")
  })

  it("finds multi-hop path", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> LEARNING_2 -> LEARNING_3
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_2,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_3,
        }))

        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_3
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it("returns null when no path exists", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> LEARNING_2 (no connection to LEARNING_3)
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))

        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_3
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("returns null when no edges exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_2
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("respects maxDepth limit", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> LEARNING_2 -> LEARNING_3 -> LEARNING_4
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_2,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_3,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_3,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_4,
        }))

        // Path exists but requires 3 hops; maxDepth=2 should fail
        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_4,
          2 // maxDepth
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("finds path within maxDepth", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> LEARNING_2 -> LEARNING_3
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_2,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_3,
        }))

        // Path requires 2 hops; maxDepth=2 should succeed
        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_3,
          2
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it("handles cycles by visiting nodes only once (BFS)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // Create a cycle: LEARNING_1 -> LEARNING_2 -> LEARNING_3 -> LEARNING_1
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_2,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_3,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_3,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_1, // Back to start
        }))

        // Should still find path to LEARNING_3 without infinite loop
        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_3
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it("does not traverse invalidated edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // LEARNING_1 -> LEARNING_2 -> LEARNING_3
        const edge1 = yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_2,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_3,
        }))

        // Invalidate first edge, breaking the path
        yield* repo.invalidate(edge1.id)

        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_3
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("finds shortest path (BFS property)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        // Long path: LEARNING_1 -> LEARNING_2 -> LEARNING_3 -> LEARNING_4
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_2,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_2,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_3,
        }))
        yield* repo.create(createEdgeData({
          edgeType: "DERIVED_FROM",
          sourceId: FIXTURES.LEARNING_3,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_4,
        }))

        // Short path: LEARNING_1 -> LEARNING_4 (direct)
        yield* repo.create(createEdgeData({
          edgeType: "SIMILAR_TO",
          sourceId: FIXTURES.LEARNING_1,
          targetType: "learning",
          targetId: FIXTURES.LEARNING_4,
        }))

        return yield* repo.findPath(
          "learning", FIXTURES.LEARNING_1,
          "learning", FIXTURES.LEARNING_4
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // BFS should find the shortest path (1 edge)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
  })
})

// =============================================================================
// EdgeRepository.update Tests
// =============================================================================

describe("EdgeRepository.update", () => {
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

  it("updates weight", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const edge = yield* repo.create(createEdgeData({ weight: 0.5 }))
        return yield* repo.update(edge.id, { weight: 0.9 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.weight).toBe(0.9)
  })

  it("updates metadata", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const edge = yield* repo.create(createEdgeData({ metadata: { old: true } }))
        return yield* repo.update(edge.id, { metadata: { new: true, version: 2 } })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.metadata).toEqual({ new: true, version: 2 })
  })

  it("returns current row when no updates provided", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const edge = yield* repo.create(createEdgeData({ weight: 0.5 }))
        return yield* repo.update(edge.id, {})
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.weight).toBe(0.5)
  })

  it("returns null for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.update(999, { weight: 0.9 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("returns null for invalidated edge", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const edge = yield* repo.create(createEdgeData())
        yield* repo.invalidate(edge.id)
        return yield* repo.update(edge.id, { weight: 0.9 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// EdgeRepository.invalidate Tests
// =============================================================================

describe("EdgeRepository.invalidate", () => {
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

  it("soft deletes an edge", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const edge = yield* repo.create(createEdgeData())
        const invalidated = yield* repo.invalidate(edge.id)
        const found = yield* repo.findById(edge.id)
        return { invalidated, found }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.invalidated).toBe(true)
    expect(result.found).toBeNull()
  })

  it("throws EdgeNotFoundError for nonexistent ID", async () => {
    // The invalidate method throws EdgeNotFoundError as a defect when the edge doesn't exist
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.invalidate(999)
      }).pipe(
        Effect.provide(shared.layer),
        Effect.catchAllDefect((defect) => Effect.succeed({ caught: true, defect })),
        Effect.map((r) => r)
      )
    )

    expect((result as any).caught).toBe(true)
    expect(((result as any).defect as any)._tag).toBe("EdgeNotFoundError")
  })

  it("throws EdgeNotFoundError for already invalidated edge", async () => {
    // The invalidate method throws EdgeNotFoundError as a defect when the edge is already invalidated
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        const edge = yield* repo.create(createEdgeData())
        yield* repo.invalidate(edge.id)
        return yield* repo.invalidate(edge.id) // Try again
      }).pipe(
        Effect.provide(shared.layer),
        Effect.catchAllDefect((defect) => Effect.succeed({ caught: true, defect })),
        Effect.map((r) => r)
      )
    )

    expect((result as any).caught).toBe(true)
    expect(((result as any).defect as any)._tag).toBe("EdgeNotFoundError")
  })
})

// =============================================================================
// EdgeRepository.findAll Tests
// =============================================================================

describe("EdgeRepository.findAll", () => {
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

  it("returns all valid edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_1 }))
        yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_2 }))
        yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_3 }))

        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(3)
  })

  it("returns empty array when no edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  it("excludes invalidated edges", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        const edge1 = yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_1 }))
        yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_2 }))

        yield* repo.invalidate(edge1.id)

        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].targetId).toBe(FIXTURES.FILE_2)
  })

  it("orders by created_at ASC", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository

        yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_1 }))
        yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_2 }))
        yield* repo.create(createEdgeData({ targetId: FIXTURES.FILE_3 }))

        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result[0].id).toBe(1)
    expect(result[1].id).toBe(2)
    expect(result[2].id).toBe(3)
  })
})
