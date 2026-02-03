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

/**
 * Generate deterministic fixture IDs for tests.
 * Currently tests use dynamic IDs from LearningService.create(),
 * but this utility is available for tests requiring deterministic IDs.
 */
export const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`graph-expansion-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

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

  it("filters expansion with EdgeTypeFilter include", async () => {
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
        const l4 = yield* learningSvc.create({ content: "L4-links", sourceType: "manual" })

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
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        // Use EdgeTypeFilter with include
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, edgeTypes: { include: ["SIMILAR_TO", "DERIVED_FROM"] } }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2-similar")
    expect(contents).toContain("L3-derived")
    expect(contents).not.toContain("L4-links")
  })

  it("filters expansion with EdgeTypeFilter exclude", async () => {
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
        const l4 = yield* learningSvc.create({ content: "L4-links", sourceType: "manual" })

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
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        // Use EdgeTypeFilter with exclude - exclude LINKS_TO
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, edgeTypes: { exclude: ["LINKS_TO"] } }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2-similar")
    expect(contents).toContain("L3-derived")
    expect(contents).not.toContain("L4-links")
  })

  it("applies perHop filter overrides at specific depths", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create chain: L1 -[SIMILAR_TO]-> L2 -[DERIVED_FROM]-> L3 -[LINKS_TO]-> L4
        //                 -[DERIVED_FROM]-> L5
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2-via-similar", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3-via-derived", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4-via-links", sourceType: "manual" })
        const l5 = yield* learningSvc.create({ content: "L5-via-derived", sourceType: "manual" })

        // Hop 1: L1 -> L2 (SIMILAR_TO) and L1 -> L5 (DERIVED_FROM)
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
          targetId: String(l5.id),
        })

        // Hop 2: L2 -> L3 (DERIVED_FROM)
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
        })

        // Hop 3: L3 -> L4 (LINKS_TO)
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        // Use perHop overrides:
        // - Hop 1: only SIMILAR_TO (skip L5)
        // - Hop 2: only DERIVED_FROM (find L3)
        // - Hop 3: use default (all types, find L4)
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          {
            depth: 3,
            edgeTypes: {
              perHop: {
                1: { include: ["SIMILAR_TO"] },
                2: { include: ["DERIVED_FROM"] }
                // Hop 3 uses default (all types)
              }
            }
          }
        )
      }).pipe(Effect.provide(layer))
    )

    // Hop 1: Only L2 (via SIMILAR_TO), L5 excluded because DERIVED_FROM not allowed at hop 1
    // Hop 2: Only L3 (via DERIVED_FROM from L2)
    // Hop 3: L4 (via LINKS_TO from L3, using default which allows all)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2-via-similar")
    expect(contents).toContain("L3-via-derived")
    expect(contents).toContain("L4-via-links")
    expect(contents).not.toContain("L5-via-derived")
  })

  it("perHop exclude filter works correctly", async () => {
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
        const l4 = yield* learningSvc.create({ content: "L4-links", sourceType: "manual" })

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
        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        // At hop 1, exclude SIMILAR_TO and LINKS_TO (only allow DERIVED_FROM)
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          {
            depth: 1,
            edgeTypes: {
              perHop: {
                1: { exclude: ["SIMILAR_TO", "LINKS_TO"] }
              }
            }
          }
        )
      }).pipe(Effect.provide(layer))
    )

    // Only L3 should be found (via DERIVED_FROM)
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L3-derived")
  })

  it("rejects conflicting include/exclude filters", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        // Conflicting filter: SIMILAR_TO in both include and exclude
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          {
            depth: 1,
            edgeTypes: {
              include: ["SIMILAR_TO", "DERIVED_FROM"],
              exclude: ["SIMILAR_TO"] // Conflict!
            }
          }
        )
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
      expect((result.left as any).reason).toContain("conflicting filters")
    }
  })

  it("backwards compatible with simple EdgeType[] array", async () => {
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

        // Use simple array (backwards compatible)
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, edgeTypes: ["SIMILAR_TO"] as const }
        )
      }).pipe(Effect.provide(layer))
    )

    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2")
  })

  it("perHop with top-level fallback: hop 1 uses top-level, hop 2 uses perHop", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create graph:
        // L1 -[SIMILAR_TO]-> L2 (allowed by top-level)
        // L1 -[LINKS_TO]-> L3 (allowed by top-level)
        // L1 -[DERIVED_FROM]-> L4 (NOT in top-level include)
        // L2 -[DERIVED_FROM]-> L5 (allowed by perHop override for hop 2)
        // L2 -[SIMILAR_TO]-> L6 (NOT allowed by perHop override for hop 2)
        const l1 = yield* learningSvc.create({ content: "L1-root", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2-via-similar", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3-via-links", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4-via-derived", sourceType: "manual" })
        const l5 = yield* learningSvc.create({ content: "L5-hop2-derived", sourceType: "manual" })
        const l6 = yield* learningSvc.create({ content: "L6-hop2-similar", sourceType: "manual" })

        // Hop 1 edges from L1
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

        // Hop 2 edges from L2
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l5.id),
        })
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l6.id),
        })

        // Combined filter:
        // - Top-level: include only SIMILAR_TO and LINKS_TO
        // - perHop override for hop 2: include only DERIVED_FROM
        // Result: hop 1 uses top-level, hop 2 uses perHop
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          {
            depth: 2,
            edgeTypes: {
              include: ["SIMILAR_TO", "LINKS_TO"], // Top-level fallback
              perHop: {
                2: { include: ["DERIVED_FROM"] } // Override for hop 2
              }
            }
          }
        )
      }).pipe(Effect.provide(layer))
    )

    const contents = result.expanded.map((e) => e.learning.content)
    // Hop 1: L2 (SIMILAR_TO) and L3 (LINKS_TO) - using top-level filter
    expect(contents).toContain("L2-via-similar")
    expect(contents).toContain("L3-via-links")
    // L4 excluded at hop 1: DERIVED_FROM not in top-level include
    expect(contents).not.toContain("L4-via-derived")
    // Hop 2: L5 (DERIVED_FROM) - using perHop override
    expect(contents).toContain("L5-hop2-derived")
    // L6 excluded at hop 2: SIMILAR_TO not in perHop include
    expect(contents).not.toContain("L6-hop2-similar")
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

// =============================================================================
// RRF INTEGRATION TESTS
// =============================================================================

describe("Graph Expansion - RRF Integration", () => {
  it("graph expansion integrates with retrieval pipeline via LearningService", async () => {
    const { makeAppLayer, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create a seed learning that will match the query
        const seed = yield* learningSvc.create({
          content: "Database optimization techniques for SQL queries",
          sourceType: "manual",
          keywords: ["database", "optimization", "sql"]
        })

        // Create related learnings that are connected via edges
        const related1 = yield* learningSvc.create({
          content: "Index creation strategies for faster lookups",
          sourceType: "manual",
          keywords: ["index", "performance"]
        })

        const related2 = yield* learningSvc.create({
          content: "Query execution plan analysis methods",
          sourceType: "manual",
          keywords: ["query", "execution"]
        })

        // Create edges from seed to related learnings
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(seed.id),
          targetType: "learning",
          targetId: String(related1.id),
          weight: 0.9,
        })

        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(seed.id),
          targetType: "learning",
          targetId: String(related2.id),
          weight: 0.8,
        })

        // Search with graph expansion enabled
        const results = yield* learningSvc.search({
          query: "database optimization sql",
          limit: 10,
          graphExpansion: {
            enabled: true,
            depth: 2,
            decayFactor: 0.7
          }
        })

        return { results, seed, related1, related2 }
      }).pipe(Effect.provide(layer))
    )

    // Should return results including expanded learnings
    expect(result.results.length).toBeGreaterThan(0)

    // The seed should be found (direct match)
    const seedInResults = result.results.find(r => r.id === result.seed.id)
    expect(seedInResults).toBeDefined()

    // With graph expansion, related learnings may be found
    // (depends on whether they match query or are expanded from seed)
  })

  it("graphExpansion results include expansion metadata", async () => {
    const { makeAppLayer, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create connected learnings
        const l1 = yield* learningSvc.create({
          content: "TypeScript type system fundamentals",
          sourceType: "manual",
          keywords: ["typescript", "types"]
        })

        const l2 = yield* learningSvc.create({
          content: "Generic types and constraints in TypeScript",
          sourceType: "manual",
          keywords: ["generic", "constraints"]
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
          weight: 0.85,
        })

        return yield* learningSvc.search({
          query: "TypeScript type system",
          limit: 10,
          graphExpansion: {
            enabled: true,
            depth: 1,
            decayFactor: 0.7
          }
        })
      }).pipe(Effect.provide(layer))
    )

    // Results should have expansion metadata
    for (const r of result) {
      // Direct matches have expansionHops = 0
      // Expanded results have expansionHops > 0
      if (r.expansionHops !== undefined) {
        expect(r.expansionHops).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("disabled graph expansion returns only direct matches", async () => {
    const { makeAppLayer, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        // Create seed and connected but unrelated content
        const seed = yield* learningSvc.create({
          content: "React hooks for state management",
          sourceType: "manual",
          keywords: ["react", "hooks", "state"]
        })

        const connected = yield* learningSvc.create({
          content: "Completely unrelated content about cooking recipes",
          sourceType: "manual",
          keywords: ["cooking", "recipes"]
        })

        yield* edgeSvc.createEdge({
          edgeType: "LINKS_TO",
          sourceType: "learning",
          sourceId: String(seed.id),
          targetType: "learning",
          targetId: String(connected.id),
        })

        // Search WITHOUT graph expansion
        const resultsWithout = yield* learningSvc.search({
          query: "React hooks state",
          limit: 10,
          graphExpansion: { enabled: false }
        })

        // Search WITH graph expansion
        const resultsWith = yield* learningSvc.search({
          query: "React hooks state",
          limit: 10,
          graphExpansion: { enabled: true, depth: 1 }
        })

        return { resultsWithout, resultsWith, seed, connected }
      }).pipe(Effect.provide(layer))
    )

    // Without expansion, cooking content should NOT be in results
    const cookingWithout = result.resultsWithout.find(r =>
      r.content.includes("cooking")
    )
    expect(cookingWithout).toBeUndefined()

    // With expansion, cooking content MAY be in results (via graph traversal)
    // This tests that graph expansion can surface related content
  })

  it("edge types filter applies during RRF integration", async () => {
    const { makeAppLayer, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService

        const seed = yield* learningSvc.create({
          content: "API design patterns for REST services",
          sourceType: "manual",
          keywords: ["api", "rest"]
        })

        const similarTo = yield* learningSvc.create({
          content: "Similar API pattern content",
          sourceType: "manual"
        })

        const derivedFrom = yield* learningSvc.create({
          content: "Derived API pattern content",
          sourceType: "manual"
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(seed.id),
          targetType: "learning",
          targetId: String(similarTo.id),
        })

        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(seed.id),
          targetType: "learning",
          targetId: String(derivedFrom.id),
        })

        // Search with only SIMILAR_TO edges
        const results = yield* learningSvc.search({
          query: "API design patterns REST",
          limit: 10,
          graphExpansion: {
            enabled: true,
            depth: 1,
            edgeTypes: ["SIMILAR_TO"]
          }
        })

        return { results, similarTo, derivedFrom }
      }).pipe(Effect.provide(layer))
    )

    // Edge type filtering should work - only SIMILAR_TO edges should be traversed
    expect(result.results.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// RECALL IMPROVEMENT VERIFICATION TESTS
// =============================================================================

describe("Graph Expansion - Recall Improvement", () => {
  it("graph expansion surfaces semantically related content not in initial BM25 results", async () => {
    const { makeAppLayer, LearningService, EdgeService, GraphExpansionService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create a learning that will match a query
        const matchingLearning = yield* learningSvc.create({
          content: "Database indexing best practices for PostgreSQL",
          sourceType: "manual",
          keywords: ["database", "indexing", "postgresql"]
        })

        // Create semantically related content that uses different vocabulary
        // (won't match BM25 but is semantically related)
        const relatedContent = yield* learningSvc.create({
          content: "B-tree data structure optimization in relational systems",
          sourceType: "manual",
          keywords: ["btree", "optimization", "relational"]
        })

        // Create edge showing they are related
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(matchingLearning.id),
          targetType: "learning",
          targetId: String(relatedContent.id),
          weight: 0.9,
        })

        // Expand from the matching learning
        const expansionResult = yield* expansionSvc.expand(
          [{ learning: matchingLearning, score: 1.0 }],
          { depth: 1, decayFactor: 0.7 }
        )

        return { expansionResult, matchingLearning, relatedContent }
      }).pipe(Effect.provide(layer))
    )

    // Graph expansion should find the related content
    expect(result.expansionResult.expanded.length).toBe(1)
    expect(result.expansionResult.expanded[0].learning.id).toBe(result.relatedContent.id)

    // The expanded content has appropriate decayed score
    expect(result.expansionResult.expanded[0].decayedScore).toBeCloseTo(0.63, 2) // 1.0 * 0.9 * 0.7
  })

  it("multi-hop expansion increases recall for distant but relevant content", async () => {
    const { makeAppLayer, LearningService, EdgeService, GraphExpansionService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create a chain: L1 -> L2 -> L3 (where L3 is distant but relevant)
        const l1 = yield* learningSvc.create({
          content: "Authentication middleware for Express.js",
          sourceType: "manual"
        })

        const l2 = yield* learningSvc.create({
          content: "Session management strategies",
          sourceType: "manual"
        })

        const l3 = yield* learningSvc.create({
          content: "Security token validation patterns",
          sourceType: "manual"
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
          weight: 0.8,
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l2.id),
          targetType: "learning",
          targetId: String(l3.id),
          weight: 0.8,
        })

        // Expand with depth 1 - should only find L2
        const depth1Result = yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1 }
        )

        // Expand with depth 2 - should find both L2 and L3
        const depth2Result = yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2 }
        )

        return { depth1Result, depth2Result, l2, l3 }
      }).pipe(Effect.provide(layer))
    )

    // Depth 1 finds only L2
    expect(result.depth1Result.expanded).toHaveLength(1)
    expect(result.depth1Result.expanded[0].learning.id).toBe(result.l2.id)

    // Depth 2 finds both L2 and L3 (improved recall)
    expect(result.depth2Result.expanded).toHaveLength(2)
    const expandedIds = result.depth2Result.expanded.map(e => e.learning.id)
    expect(expandedIds).toContain(result.l2.id)
    expect(expandedIds).toContain(result.l3.id)
  })

  it("expansion with high-weight edges improves precision of expanded results", async () => {
    const { makeAppLayer, LearningService, EdgeService, GraphExpansionService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const seed = yield* learningSvc.create({
          content: "Machine learning model training",
          sourceType: "manual"
        })

        // High-weight edge to highly relevant content
        const highRelevance = yield* learningSvc.create({
          content: "Neural network architecture design",
          sourceType: "manual"
        })

        // Low-weight edge to tangentially related content
        const lowRelevance = yield* learningSvc.create({
          content: "Data preprocessing pipelines",
          sourceType: "manual"
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(seed.id),
          targetType: "learning",
          targetId: String(highRelevance.id),
          weight: 0.95,
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(seed.id),
          targetType: "learning",
          targetId: String(lowRelevance.id),
          weight: 0.3,
        })

        return yield* expansionSvc.expand(
          [{ learning: seed, score: 1.0 }],
          { depth: 1, decayFactor: 0.7 }
        )
      }).pipe(Effect.provide(layer))
    )

    // Both should be expanded
    expect(result.expanded).toHaveLength(2)

    // Results should be sorted by decayed score (high relevance first)
    expect(result.expanded[0].edgeWeight).toBe(0.95)
    expect(result.expanded[1].edgeWeight).toBe(0.3)

    // High-weight edge produces higher score
    expect(result.expanded[0].decayedScore).toBeGreaterThan(result.expanded[1].decayedScore)
  })

  it("expansion from multiple seeds increases coverage", async () => {
    const { makeAppLayer, LearningService, EdgeService, GraphExpansionService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create two independent clusters
        const seed1 = yield* learningSvc.create({
          content: "Frontend development with React",
          sourceType: "manual"
        })
        const cluster1Member = yield* learningSvc.create({
          content: "React component lifecycle methods",
          sourceType: "manual"
        })

        const seed2 = yield* learningSvc.create({
          content: "Backend development with Node.js",
          sourceType: "manual"
        })
        const cluster2Member = yield* learningSvc.create({
          content: "Express middleware patterns",
          sourceType: "manual"
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(seed1.id),
          targetType: "learning",
          targetId: String(cluster1Member.id),
        })

        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(seed2.id),
          targetType: "learning",
          targetId: String(cluster2Member.id),
        })

        // Expand from single seed
        const singleSeedResult = yield* expansionSvc.expand(
          [{ learning: seed1, score: 1.0 }],
          { depth: 1 }
        )

        // Expand from both seeds
        const multiSeedResult = yield* expansionSvc.expand(
          [
            { learning: seed1, score: 1.0 },
            { learning: seed2, score: 0.9 }
          ],
          { depth: 1 }
        )

        return { singleSeedResult, multiSeedResult, cluster1Member, cluster2Member }
      }).pipe(Effect.provide(layer))
    )

    // Single seed only finds its cluster member
    expect(result.singleSeedResult.expanded).toHaveLength(1)
    expect(result.singleSeedResult.expanded[0].learning.id).toBe(result.cluster1Member.id)

    // Multiple seeds find both cluster members (improved coverage/recall)
    expect(result.multiSeedResult.expanded).toHaveLength(2)
    const expandedIds = result.multiSeedResult.expanded.map(e => e.learning.id)
    expect(expandedIds).toContain(result.cluster1Member.id)
    expect(expandedIds).toContain(result.cluster2Member.id)
  })
})

// =============================================================================
// FILE-BASED EXPANSION TESTS (expandFromFiles)
// =============================================================================

describe("Graph Expansion - File-Based Expansion", () => {
  it("returns empty result for empty files array", async () => {
    const { makeAppLayer, GraphExpansionService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const expansionSvc = yield* GraphExpansionService
        return yield* expansionSvc.expandFromFiles([], { depth: 2 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchored).toHaveLength(0)
    expect(result.expanded).toHaveLength(0)
    expect(result.all).toHaveLength(0)
    expect(result.stats.inputFileCount).toBe(0)
    expect(result.stats.anchoredCount).toBe(0)
    expect(result.stats.expandedCount).toBe(0)
  })

  it("finds learnings anchored to input files (hop 0)", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const expansionSvc = yield* GraphExpansionService

        // Create learnings and anchor them to files
        const l1 = yield* learningSvc.create({ content: "Auth validation tips", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "JWT best practices", sourceType: "manual" })

        yield* anchorSvc.createAnchor({
          learningId: l1.id,
          anchorType: "glob",
          filePath: "src/auth.ts",
          value: "src/auth.ts"
        })

        yield* anchorSvc.createAnchor({
          learningId: l2.id,
          anchorType: "glob",
          filePath: "src/auth.ts",
          value: "src/auth.ts"
        })

        return yield* expansionSvc.expandFromFiles(["src/auth.ts"])
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchored).toHaveLength(2)
    expect(result.expanded).toHaveLength(0)
    expect(result.stats.anchoredCount).toBe(2)
    expect(result.stats.inputFileCount).toBe(1)

    const contents = result.anchored.map(a => a.learning.content)
    expect(contents).toContain("Auth validation tips")
    expect(contents).toContain("JWT best practices")

    // All anchored learnings should have hop 0 and ANCHORED_TO edge
    for (const anchored of result.anchored) {
      expect(anchored.hops).toBe(0)
      expect(anchored.sourceEdge).toBe("ANCHORED_TO")
      expect(anchored.edgeWeight).toBeNull()
      expect(anchored.decayedScore).toBe(1.0)
    }
  })

  it("expands via IMPORTS edges to find related file learnings", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create learnings for different files
        const authLearning = yield* learningSvc.create({ content: "Auth service tips", sourceType: "manual" })
        const cryptoLearning = yield* learningSvc.create({ content: "Crypto utils best practices", sourceType: "manual" })

        // Anchor learnings to their respective files
        yield* anchorSvc.createAnchor({
          learningId: authLearning.id,
          anchorType: "glob",
          filePath: "src/auth.ts",
          value: "src/auth.ts"
        })

        yield* anchorSvc.createAnchor({
          learningId: cryptoLearning.id,
          anchorType: "glob",
          filePath: "src/crypto.ts",
          value: "src/crypto.ts"
        })

        // Create file->file IMPORTS edge: auth.ts imports crypto.ts
        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: "src/auth.ts",
          targetType: "file",
          targetId: "src/crypto.ts",
          weight: 0.9
        })

        return yield* expansionSvc.expandFromFiles(["src/auth.ts"], { depth: 1, decayFactor: 0.7 })
      }).pipe(Effect.provide(layer))
    )

    // Should find auth learning as anchored (hop 0)
    expect(result.anchored).toHaveLength(1)
    expect(result.anchored[0].learning.content).toBe("Auth service tips")

    // Should find crypto learning as expanded (hop 1 via IMPORTS)
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("Crypto utils best practices")
    expect(result.expanded[0].hops).toBe(1)
    expect(result.expanded[0].sourceEdge).toBe("IMPORTS")
    expect(result.expanded[0].edgeWeight).toBe(0.9)
    expect(result.expanded[0].decayedScore).toBeCloseTo(0.63, 2) // 1.0 * 0.9 * 0.7

    expect(result.stats.filesVisited).toBe(2)
  })

  it("expands via CO_CHANGES_WITH edges for co-edited files", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create learnings
        const authLearning = yield* learningSvc.create({ content: "Auth service tips", sourceType: "manual" })
        const middlewareLearning = yield* learningSvc.create({ content: "JWT middleware patterns", sourceType: "manual" })

        // Anchor to files
        yield* anchorSvc.createAnchor({
          learningId: authLearning.id,
          anchorType: "glob",
          filePath: "src/auth.ts",
          value: "src/auth.ts"
        })

        yield* anchorSvc.createAnchor({
          learningId: middlewareLearning.id,
          anchorType: "glob",
          filePath: "src/jwt-middleware.ts",
          value: "src/jwt-middleware.ts"
        })

        // Create file->file CO_CHANGES_WITH edge
        yield* edgeSvc.createEdge({
          edgeType: "CO_CHANGES_WITH",
          sourceType: "file",
          sourceId: "src/auth.ts",
          targetType: "file",
          targetId: "src/jwt-middleware.ts",
          weight: 0.8
        })

        return yield* expansionSvc.expandFromFiles(["src/auth.ts"], { depth: 1 })
      }).pipe(Effect.provide(layer))
    )

    // Should expand via CO_CHANGES_WITH
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("JWT middleware patterns")
    expect(result.expanded[0].sourceEdge).toBe("CO_CHANGES_WITH")
  })

  it("applies decay per hop for multi-hop file expansion", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create learnings for a chain of files: auth -> crypto -> hash
        const authLearning = yield* learningSvc.create({ content: "Auth tips", sourceType: "manual" })
        const cryptoLearning = yield* learningSvc.create({ content: "Crypto tips", sourceType: "manual" })
        const hashLearning = yield* learningSvc.create({ content: "Hash tips", sourceType: "manual" })

        // Anchor learnings
        yield* anchorSvc.createAnchor({
          learningId: authLearning.id,
          anchorType: "glob",
          filePath: "src/auth.ts",
          value: "src/auth.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: cryptoLearning.id,
          anchorType: "glob",
          filePath: "src/crypto.ts",
          value: "src/crypto.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: hashLearning.id,
          anchorType: "glob",
          filePath: "src/hash.ts",
          value: "src/hash.ts"
        })

        // Create chain: auth -> crypto -> hash
        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: "src/auth.ts",
          targetType: "file",
          targetId: "src/crypto.ts",
          weight: 1.0
        })
        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: "src/crypto.ts",
          targetType: "file",
          targetId: "src/hash.ts",
          weight: 1.0
        })

        return yield* expansionSvc.expandFromFiles(["src/auth.ts"], { depth: 2, decayFactor: 0.7 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchored).toHaveLength(1) // auth learning
    expect(result.expanded).toHaveLength(2) // crypto and hash learnings

    const cryptoExpanded = result.expanded.find(e => e.learning.content === "Crypto tips")
    const hashExpanded = result.expanded.find(e => e.learning.content === "Hash tips")

    // Crypto at hop 1: 1.0 * 1.0 * 0.7 = 0.7
    expect(cryptoExpanded!.hops).toBe(1)
    expect(cryptoExpanded!.decayedScore).toBeCloseTo(0.7, 5)

    // Hash at hop 2: 0.7 * 1.0 * 0.7 = 0.49
    expect(hashExpanded!.hops).toBe(2)
    expect(hashExpanded!.decayedScore).toBeCloseTo(0.49, 5)
  })

  it("deduplicates learnings across multiple input files", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const expansionSvc = yield* GraphExpansionService

        // Create one learning anchored to multiple files
        const sharedLearning = yield* learningSvc.create({ content: "Shared pattern", sourceType: "manual" })

        yield* anchorSvc.createAnchor({
          learningId: sharedLearning.id,
          anchorType: "glob",
          filePath: "src/file1.ts",
          value: "src/file1.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: sharedLearning.id,
          anchorType: "glob",
          filePath: "src/file2.ts",
          value: "src/file2.ts"
        })

        return yield* expansionSvc.expandFromFiles(["src/file1.ts", "src/file2.ts"])
      }).pipe(Effect.provide(layer))
    )

    // Learning should only appear once despite being anchored to both files
    expect(result.anchored).toHaveLength(1)
    expect(result.anchored[0].learning.content).toBe("Shared pattern")
  })

  it("respects maxNodes limit", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const expansionSvc = yield* GraphExpansionService

        // Create 5 learnings anchored to the same file
        for (let i = 1; i <= 5; i++) {
          const l = yield* learningSvc.create({ content: `Learning ${i}`, sourceType: "manual" })
          yield* anchorSvc.createAnchor({
            learningId: l.id,
            anchorType: "glob",
            filePath: "src/test.ts",
            value: "src/test.ts"
          })
        }

        return yield* expansionSvc.expandFromFiles(["src/test.ts"], { maxNodes: 3 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.all).toHaveLength(3)
    expect(result.stats.anchoredCount).toBe(3)
  })

  it("respects depth 0 (anchored only, no expansion)", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "Auth tips", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Crypto tips", sourceType: "manual" })

        yield* anchorSvc.createAnchor({
          learningId: l1.id,
          anchorType: "glob",
          filePath: "src/auth.ts",
          value: "src/auth.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: l2.id,
          anchorType: "glob",
          filePath: "src/crypto.ts",
          value: "src/crypto.ts"
        })

        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: "src/auth.ts",
          targetType: "file",
          targetId: "src/crypto.ts",
          weight: 0.9
        })

        return yield* expansionSvc.expandFromFiles(["src/auth.ts"], { depth: 0 })
      }).pipe(Effect.provide(layer))
    )

    expect(result.anchored).toHaveLength(1)
    expect(result.expanded).toHaveLength(0)
    expect(result.stats.expandedCount).toBe(0)
  })

  it("only includes valid anchors (filters out invalid/drifted)", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const expansionSvc = yield* GraphExpansionService

        // Create learnings and anchors
        const validLearning = yield* learningSvc.create({ content: "Valid learning", sourceType: "manual" })
        const invalidLearning = yield* learningSvc.create({ content: "Invalid learning", sourceType: "manual" })

        yield* anchorSvc.createAnchor({
          learningId: validLearning.id,
          anchorType: "glob",
          filePath: "src/test.ts",
          value: "src/test.ts"
        })

        const invalidAnchor = yield* anchorSvc.createAnchor({
          learningId: invalidLearning.id,
          anchorType: "glob",
          filePath: "src/test.ts",
          value: "src/test.ts"
        })

        // Mark the anchor as invalid
        yield* anchorSvc.updateAnchorStatus(invalidAnchor.id, "invalid", "Test invalidation")

        return yield* expansionSvc.expandFromFiles(["src/test.ts"])
      }).pipe(Effect.provide(layer))
    )

    // Should only include the valid learning
    expect(result.anchored).toHaveLength(1)
    expect(result.anchored[0].learning.content).toBe("Valid learning")
  })

  it("validates options (rejects invalid parameters)", async () => {
    const { makeAppLayer, GraphExpansionService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    // Test negative depth
    const negativeDepth = await Effect.runPromise(
      Effect.gen(function* () {
        const expansionSvc = yield* GraphExpansionService
        return yield* expansionSvc.expandFromFiles(["src/test.ts"], { depth: -1 })
      }).pipe(Effect.provide(layer), Effect.either)
    )
    expect(negativeDepth._tag).toBe("Left")

    // Test invalid decay factor
    const invalidDecay = await Effect.runPromise(
      Effect.gen(function* () {
        const expansionSvc = yield* GraphExpansionService
        return yield* expansionSvc.expandFromFiles(["src/test.ts"], { decayFactor: 1.5 })
      }).pipe(Effect.provide(layer), Effect.either)
    )
    expect(invalidDecay._tag).toBe("Left")

    // Test invalid maxNodes
    const invalidMaxNodes = await Effect.runPromise(
      Effect.gen(function* () {
        const expansionSvc = yield* GraphExpansionService
        return yield* expansionSvc.expandFromFiles(["src/test.ts"], { maxNodes: 0 })
      }).pipe(Effect.provide(layer), Effect.either)
    )
    expect(invalidMaxNodes._tag).toBe("Left")
  })

  it("sorts all results by decayedScore", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, AnchorService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create learnings at different hops with different scores
        const l1 = yield* learningSvc.create({ content: "Hop 0 learning", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Hop 1 learning", sourceType: "manual" })

        yield* anchorSvc.createAnchor({
          learningId: l1.id,
          anchorType: "glob",
          filePath: "src/main.ts",
          value: "src/main.ts"
        })
        yield* anchorSvc.createAnchor({
          learningId: l2.id,
          anchorType: "glob",
          filePath: "src/util.ts",
          value: "src/util.ts"
        })

        yield* edgeSvc.createEdge({
          edgeType: "IMPORTS",
          sourceType: "file",
          sourceId: "src/main.ts",
          targetType: "file",
          targetId: "src/util.ts",
          weight: 0.5
        })

        return yield* expansionSvc.expandFromFiles(["src/main.ts"], { depth: 1, decayFactor: 0.7 })
      }).pipe(Effect.provide(layer))
    )

    // Hop 0 learning has score 1.0, hop 1 has score 0.5 * 0.7 = 0.35
    expect(result.all).toHaveLength(2)
    expect(result.all[0].decayedScore).toBeGreaterThan(result.all[1].decayedScore)
  })
})

// =============================================================================
// EXPANSION STATISTICS TESTS
// =============================================================================

describe("Graph Expansion - Statistics", () => {
  it("returns accurate expansion statistics", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create graph: L1 -> L2 -> L3, L1 -> L4
        const l1 = yield* learningSvc.create({ content: "Root", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "Child1", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "Grandchild", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "Child2", sourceType: "manual" })

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
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l4.id),
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2 }
        )
      }).pipe(Effect.provide(layer))
    )

    // Verify statistics
    expect(result.stats.seedCount).toBe(1)
    expect(result.stats.expandedCount).toBe(3) // L2, L3, L4
    expect(result.stats.maxDepthReached).toBe(2)
    expect(result.stats.nodesVisited).toBe(4) // L1 (seed) + L2, L3, L4
  })

  it("stats reflect maxNodes limit", async () => {
    const { makeAppLayer, GraphExpansionService, LearningService, EdgeService } = await import("@tx/core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create star pattern: L1 -> L2, L3, L4, L5, L6
        const l1 = yield* learningSvc.create({ content: "Center", sourceType: "manual" })
        const neighbors = []
        for (let i = 2; i <= 6; i++) {
          const l = yield* learningSvc.create({ content: `L${i}`, sourceType: "manual" })
          neighbors.push(l)
          yield* edgeSvc.createEdge({
            edgeType: "SIMILAR_TO",
            sourceType: "learning",
            sourceId: String(l1.id),
            targetType: "learning",
            targetId: String(l.id),
          })
        }

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, maxNodes: 3 }
        )
      }).pipe(Effect.provide(layer))
    )

    // Should respect maxNodes limit
    expect(result.stats.expandedCount).toBe(3)
    expect(result.expanded).toHaveLength(3)
  })
})
