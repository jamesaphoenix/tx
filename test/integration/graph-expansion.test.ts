/**
 * Graph Expansion Service Integration Tests
 *
 * Tests for the BFS graph expansion algorithm with weight decay.
 * Uses SHA256-based fixtures from @tx/test-utils per Rule 3.
 *
 * Coverage:
 * - Linear chain traversal with depth limit
 * - Weight decay accumulation (score = initial * 0.7^hops)
 * - Cycle prevention (visited set)
 * - MaxNodes limit
 * - Empty seeds (returns empty)
 * - Branching graph expansion
 */

import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`graph-expansion-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  // Learning names for reference
  LEARNING_ROOT: fixtureId("learning-root"),
  LEARNING_A: fixtureId("learning-a"),
  LEARNING_B: fixtureId("learning-b"),
  LEARNING_C: fixtureId("learning-c"),
  LEARNING_D: fixtureId("learning-d"),
  LEARNING_E: fixtureId("learning-e"),
} as const

// =============================================================================
// LINEAR CHAIN TRAVERSAL TESTS
// =============================================================================

describe("Graph Expansion - Linear Chain", () => {
  it("traverses a linear chain with depth limit", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create chain: L1 -> L2 -> L3 -> L4
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
          weight: 1.0,
        })
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
          weight: 1.0,
        })
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l4.id),
          weight: 1.0,
        })

        // Expand from L1 with depth 2 (should find L2, L3 but not L4)
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2 }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.seeds).toHaveLength(1)
    expect(result.expanded).toHaveLength(2) // L2 at depth 1, L3 at depth 2
    expect(result.stats.maxDepthReached).toBe(2)

    const expandedContents = result.expanded.map((e) => e.learning.content)
    expect(expandedContents).toContain("L2")
    expect(expandedContents).toContain("L3")
    expect(expandedContents).not.toContain("L4")
  })

  it("respects depth 0 (seeds only)", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 0 }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.seeds).toHaveLength(1)
    expect(result.expanded).toHaveLength(0)
    expect(result.all).toHaveLength(1)
  })
})

// =============================================================================
// WEIGHT DECAY TESTS
// =============================================================================

describe("Graph Expansion - Weight Decay", () => {
  it("applies weight decay per hop (default 0.7)", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create: L1 -> L2 -> L3
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
          weight: 1.0, // Full weight
        })
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
          weight: 1.0, // Full weight
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2, decayFactor: 0.7 }
        )
      }).pipe(Effect.provide(layer))
    )

    // L2 at hop 1: 1.0 * 1.0 * 0.7 = 0.7
    const l2 = result.expanded.find((e) => e.learning.content === "L2")
    expect(l2).toBeDefined()
    expect(l2!.decayedScore).toBeCloseTo(0.7, 5)
    expect(l2!.hops).toBe(1)

    // L3 at hop 2: 0.7 * 1.0 * 0.7 = 0.49
    const l3 = result.expanded.find((e) => e.learning.content === "L3")
    expect(l3).toBeDefined()
    expect(l3!.decayedScore).toBeCloseTo(0.49, 5)
    expect(l3!.hops).toBe(2)
  })

  it("applies edge weight in decay calculation", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
          weight: 0.5, // Half weight
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, decayFactor: 0.7 }
        )
      }).pipe(Effect.provide(layer))
    )

    // L2: 1.0 * 0.5 * 0.7 = 0.35
    const l2 = result.expanded.find((e) => e.learning.content === "L2")
    expect(l2!.decayedScore).toBeCloseTo(0.35, 5)
    expect(l2!.edgeWeight).toBe(0.5)
  })

  it("uses custom decay factor", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
          weight: 1.0,
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, decayFactor: 0.5 }
        )
      }).pipe(Effect.provide(layer))
    )

    // L2: 1.0 * 1.0 * 0.5 = 0.5
    const l2 = result.expanded.find((e) => e.learning.content === "L2")
    expect(l2!.decayedScore).toBeCloseTo(0.5, 5)
  })
})

// =============================================================================
// CYCLE PREVENTION TESTS
// =============================================================================

describe("Graph Expansion - Cycle Prevention", () => {
  it("prevents cycles with visited set", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

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

        // Expand with depth 5 - should not hang
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 5 }
        )
      }).pipe(Effect.provide(layer))
    )

    // Should visit L2 and L3 exactly once
    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L3")
    expect(result.stats.nodesVisited).toBe(3) // L1 (seed) + L2 + L3
  })

  it("handles bidirectional edges (A <-> B)", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        // Bidirectional edges
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

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 10 }
        )
      }).pipe(Effect.provide(layer))
    )

    // L2 should only appear once
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2")
    expect(result.expanded[0].hops).toBe(1)
  })

  it("handles diamond pattern (L1 -> L2 -> L4, L1 -> L3 -> L4)", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        // Diamond pattern
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

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 3 }
        )
      }).pipe(Effect.provide(layer))
    )

    // L2, L3 at depth 1, L4 at depth 2 (visited first through one path)
    expect(result.expanded).toHaveLength(3)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L3")
    expect(contents).toContain("L4")

    // L4 should only appear once (first path wins)
    const l4Entries = result.expanded.filter((e) => e.learning.content === "L4")
    expect(l4Entries).toHaveLength(1)
  })
})

// =============================================================================
// MAX NODES LIMIT TESTS
// =============================================================================

describe("Graph Expansion - MaxNodes Limit", () => {
  it("respects maxNodes limit", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create star pattern: L1 -> L2, L3, L4, L5
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })
        const l5 = yield* learningSvc.create({ content: "L5", sourceType: "manual" })

        for (const target of [l2, l3, l4, l5]) {
          yield* edgeSvc.createEdge({
            edgeType: "SIMILAR_TO",
            sourceType: "learning",
            sourceId: String(l1.id),
            targetType: "learning",
            targetId: String(target.id),
          })
        }

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, maxNodes: 2 }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.expanded).toHaveLength(2)
    expect(result.stats.expandedCount).toBe(2)
  })
})

// =============================================================================
// EMPTY SEEDS TESTS
// =============================================================================

describe("Graph Expansion - Empty Seeds", () => {
  it("returns empty result for empty seeds", async () => {
    const { makeAppLayer, GraphExpansionService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const expansionSvc = yield* GraphExpansionService
        return yield* expansionSvc.expand([], { depth: 2 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.seeds).toHaveLength(0)
    expect(result.expanded).toHaveLength(0)
    expect(result.all).toHaveLength(0)
    expect(result.stats.seedCount).toBe(0)
    expect(result.stats.expandedCount).toBe(0)
  })
})

// =============================================================================
// BRANCHING GRAPH TESTS
// =============================================================================

describe("Graph Expansion - Branching Graph", () => {
  it("expands branching graph structure", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create: L1 -> L2, L1 -> L3, L2 -> L4
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

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2 }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.seeds).toHaveLength(1)
    expect(result.expanded).toHaveLength(3) // Branch1, Branch2 at depth 1, Leaf at depth 2

    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("Branch1")
    expect(contents).toContain("Branch2")
    expect(contents).toContain("Leaf")
  })

  it("sorts expanded results by decayed score", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create: L1 -> L2 (high weight), L1 -> L3 (low weight)
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
          weight: 0.9, // High weight
        })
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l3.id),
          weight: 0.3, // Low weight
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, decayFactor: 0.7 }
        )
      }).pipe(Effect.provide(layer))
    )

    // Results should be sorted by decayed score (highest first)
    expect(result.expanded).toHaveLength(2)
    expect(result.expanded[0].decayedScore).toBeGreaterThan(result.expanded[1].decayedScore)
    expect(result.expanded[0].learning.content).toBe("L2") // 0.9 * 0.7 = 0.63
    expect(result.expanded[1].learning.content).toBe("L3") // 0.3 * 0.7 = 0.21
  })
})

// =============================================================================
// EDGE TYPE FILTERING TESTS
// =============================================================================

describe("Graph Expansion - Edge Type Filtering", () => {
  it("filters expansion by edge types", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2-similar", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3-derived", sourceType: "manual" })

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

        // Only expand via SIMILAR_TO edges
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, edgeTypes: ["SIMILAR_TO"] }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2-similar")
    expect(result.expanded[0].sourceEdge).toBe("SIMILAR_TO")
  })
})

// =============================================================================
// BIDIRECTIONAL TRAVERSAL TESTS
// =============================================================================

describe("Graph Expansion - Bidirectional Traversal", () => {
  it("traverses both incoming and outgoing edges", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // L1 -> L2, L3 -> L2 (L2 has incoming from L1 and L3)
        const l1 = yield* learningSvc.create({ content: "Source", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Center", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "OtherSource", sourceType: "manual" })

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

        // Expand from L2 - should find both L1 and L3 via bidirectional traversal
        return yield* expansionSvc.expand(
          [{ learning: l2, score: 1.0 }],
          { depth: 1 }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("Source")
    expect(contents).toContain("OtherSource")
  })
})

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe("Graph Expansion - Validation", () => {
  it("rejects negative depth", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: -1 }
        )
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("rejects decay factor <= 0", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { decayFactor: 0 }
        )
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })

  it("rejects decay factor > 1", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { decayFactor: 1.5 }
        )
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })

  it("rejects maxNodes < 1", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { maxNodes: 0 }
        )
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })
})

// =============================================================================
// PATH TRACKING TESTS
// =============================================================================

describe("Graph Expansion - Path Tracking", () => {
  it("tracks path from seed to expanded node", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // L1 -> L2 -> L3
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

        const expansion = yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2 }
        )

        return { expansion, l1, l2, l3 }
      }).pipe(Effect.provide(layer))
    )

    // L2 path should be [L1, L2]
    const l2Expanded = result.expansion.expanded.find((e) => e.learning.content === "L2")
    expect(l2Expanded!.path).toHaveLength(2)
    expect(l2Expanded!.path[0]).toBe(result.l1.id)
    expect(l2Expanded!.path[1]).toBe(result.l2.id)

    // L3 path should be [L1, L2, L3]
    const l3Expanded = result.expansion.expanded.find((e) => e.learning.content === "L3")
    expect(l3Expanded!.path).toHaveLength(3)
    expect(l3Expanded!.path[0]).toBe(result.l1.id)
    expect(l3Expanded!.path[1]).toBe(result.l2.id)
    expect(l3Expanded!.path[2]).toBe(result.l3.id)
  })

  it("seeds have path of just themselves", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        const expansion = yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 0 }
        )

        return { expansion, l1 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.expansion.seeds).toHaveLength(1)
    expect(result.expansion.seeds[0].path).toHaveLength(1)
    expect(result.expansion.seeds[0].path[0]).toBe(result.l1.id)
    expect(result.expansion.seeds[0].sourceEdge).toBeNull()
    expect(result.expansion.seeds[0].edgeWeight).toBeNull()
  })
})

// =============================================================================
// MULTIPLE SEEDS TESTS
// =============================================================================

describe("Graph Expansion - Multiple Seeds", () => {
  it("expands from multiple seeds", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Two separate graphs: L1 -> L2, L3 -> L4
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

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
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        return yield* expansionSvc.expand(
          [
            { learning: l1, score: 1.0 },
            { learning: l3, score: 0.8 },
          ],
          { depth: 1 }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.seeds).toHaveLength(2)
    expect(result.expanded).toHaveLength(2) // L2 and L4

    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L4")
  })

  it("does not duplicate when seeds share neighbors", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // L1 -> L3, L2 -> L3 (both seeds point to L3)
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l3.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
        })

        return yield* expansionSvc.expand(
          [
            { learning: l1, score: 1.0 },
            { learning: l2, score: 0.9 },
          ],
          { depth: 1 }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.seeds).toHaveLength(2)
    // L3 should only appear once
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L3")
  })
})
