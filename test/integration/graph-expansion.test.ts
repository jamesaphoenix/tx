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
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 * Previously created ~110 databases, now creates 1 per describe block (~10 total).
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import services once at module level
import {
  GraphExpansionService,
  LearningService,
  EdgeService
} from "@jamesaphoenix/tx-core"

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

  it("traverses a linear chain with depth limit", async () => {
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
      }).pipe(Effect.provide(shared.layer))
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
      }).pipe(Effect.provide(shared.layer))
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

  it("applies weight decay per hop (default 0.7)", async () => {
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
      }).pipe(Effect.provide(shared.layer))
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
          weight: 0.5, // 50% edge weight
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, decayFactor: 0.7 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // L2 at hop 1: 1.0 * 0.5 * 0.7 = 0.35
    const l2 = result.expanded.find((e) => e.learning.content === "L2")
    expect(l2).toBeDefined()
    expect(l2!.decayedScore).toBeCloseTo(0.35, 5)
  })

  it("accumulates decay through multiple hops", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create: L1 -> L2 -> L3 with varying weights
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

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
          weight: 0.6,
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 3, decayFactor: 0.5 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // L2: 1.0 * 0.8 * 0.5 = 0.4
    const l2 = result.expanded.find((e) => e.learning.content === "L2")
    expect(l2).toBeDefined()
    expect(l2!.decayedScore).toBeCloseTo(0.4, 5)

    // L3: 0.4 * 0.6 * 0.5 = 0.12
    const l3 = result.expanded.find((e) => e.learning.content === "L3")
    expect(l3).toBeDefined()
    expect(l3!.decayedScore).toBeCloseTo(0.12, 5)
  })
})

// =============================================================================
// CYCLE PREVENTION TESTS
// =============================================================================

describe("Graph Expansion - Cycle Prevention", () => {
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

  it("handles direct cycle (A -> B -> A)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })

        // Create bidirectional edges
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
          targetId: String(l1.id),
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 10 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should only find L2, not revisit L1
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2")
    expect(result.stats.nodesProcessed).toBe(2) // L1 (seed) + L2
  })

  it("handles triangular cycle (A -> B -> C -> A)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // Create triangular cycle
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
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 10 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should find L2 and L3, but not revisit L1
    expect(result.expanded).toHaveLength(2)
    expect(result.stats.nodesProcessed).toBe(3) // L1 + L2 + L3
  })

  it("handles self-loop (A -> A)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        // Create self-loop
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 10 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should only have seed, no expansion
    expect(result.expanded).toHaveLength(0)
    expect(result.seeds).toHaveLength(1)
    expect(result.stats.nodesProcessed).toBe(1)
  })
})

// =============================================================================
// MAX NODES LIMIT TESTS
// =============================================================================

describe("Graph Expansion - MaxNodes Limit", () => {
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

  it("stops expansion when maxNodes reached", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create chain: L1 -> L2 -> L3 -> L4 -> L5
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })
        const l5 = yield* learningSvc.create({ content: "L5", sourceType: "manual" })

        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l2.id), targetType: "learning", targetId: String(l3.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l3.id), targetType: "learning", targetId: String(l4.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l4.id), targetType: "learning", targetId: String(l5.id) })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 10, maxNodes: 3 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should stop at 3 total nodes (1 seed + 2 expanded)
    expect(result.all).toHaveLength(3)
    expect(result.stats.maxNodesReached).toBe(true)
  })
})

// =============================================================================
// EMPTY SEEDS TESTS
// =============================================================================

describe("Graph Expansion - Empty Seeds", () => {
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

  it("returns empty results for empty seeds", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const expansionSvc = yield* GraphExpansionService
        return yield* expansionSvc.expand([], { depth: 5 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.seeds).toHaveLength(0)
    expect(result.expanded).toHaveLength(0)
    expect(result.all).toHaveLength(0)
  })
})

// =============================================================================
// BRANCHING GRAPH TESTS
// =============================================================================

describe("Graph Expansion - Branching Graph", () => {
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

  it("expands all branches at each depth level", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create tree:
        //       L1
        //      / | \
        //    L2  L3  L4
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l3.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l4.id) })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.expanded).toHaveLength(3)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L3")
    expect(contents).toContain("L4")
  })

  it("handles diamond graph structure", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        // Create diamond:
        //       L1
        //      /  \
        //    L2    L3
        //      \  /
        //       L4
        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l3.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l2.id), targetType: "learning", targetId: String(l4.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l3.id), targetType: "learning", targetId: String(l4.id) })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should find L2, L3 at depth 1, L4 at depth 2 (only once!)
    expect(result.expanded).toHaveLength(3)
    expect(result.stats.nodesProcessed).toBe(4)

    // L4 should appear only once with best score path
    const l4Entries = result.expanded.filter((e) => e.learning.content === "L4")
    expect(l4Entries).toHaveLength(1)
  })
})

// =============================================================================
// EDGE TYPE FILTERING TESTS
// =============================================================================

describe("Graph Expansion - Edge Type Filtering", () => {
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

  it("filters by edge type when specified", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2 via SIMILAR_TO
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        // L1 -> L3 via DERIVED_FROM
        yield* edgeSvc.createEdge({
          edgeType: "DERIVED_FROM",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l3.id),
        })

        // Only expand via SIMILAR_TO
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, edgeTypes: ["SIMILAR_TO"] }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2")
  })

  it("expands via multiple edge types when specified", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "DERIVED_FROM", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l3.id) })
        yield* edgeSvc.createEdge({ edgeType: "CONTRADICTS", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l4.id) })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, edgeTypes: ["SIMILAR_TO", "DERIVED_FROM"] }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L3")
    expect(contents).not.toContain("L4")
  })

  it("expands all edge types when none specified", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "DERIVED_FROM", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l3.id) })

        // No edge type filter
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.expanded).toHaveLength(2)
  })

  it("handles mixed direction edges with direction filtering", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2 (outbound from L1)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        // L3 -> L1 (inbound to L1)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        // Expand outbound only (default)
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, direction: "outbound" }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should only find L2 (outbound), not L3 (inbound)
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2")
  })

  it("handles bidirectional expansion", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2 (outbound from L1)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        // L3 -> L1 (inbound to L1)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        // Expand both directions
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, direction: "both" }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should find both L2 and L3
    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L3")
  })

  it("handles inbound-only expansion", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2 (outbound from L1)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        // L3 -> L1 (inbound to L1)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        // Expand inbound only
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, direction: "inbound" }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should only find L3 (inbound), not L2 (outbound)
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L3")
  })

  it("combines edge type and direction filtering", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })
        const l4 = yield* learningSvc.create({ content: "L4", sourceType: "manual" })

        // L1 -> L2 via SIMILAR_TO (outbound)
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        // L1 -> L3 via DERIVED_FROM (outbound)
        yield* edgeSvc.createEdge({ edgeType: "DERIVED_FROM", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l3.id) })
        // L4 -> L1 via SIMILAR_TO (inbound)
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l4.id), targetType: "learning", targetId: String(l1.id) })

        // Only SIMILAR_TO, both directions
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, edgeTypes: ["SIMILAR_TO"], direction: "both" }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should find L2 (outbound SIMILAR_TO) and L4 (inbound SIMILAR_TO)
    // Should NOT find L3 (wrong edge type)
    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L4")
    expect(contents).not.toContain("L3")
  })

  it("skips inactive learnings during expansion", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3-inactive", sourceType: "manual" })

        // Mark L3 as inactive
        yield* learningSvc.update(l3.id, { active: false })

        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l3.id) })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should only find L2, not L3 (inactive)
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2")
  })

  it("skips soft-deleted learnings during expansion", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3-deleted", sourceType: "manual" })

        // Soft-delete L3
        yield* learningSvc.softDelete(l3.id)

        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l3.id) })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should only find L2, not L3 (soft-deleted)
    expect(result.expanded).toHaveLength(1)
    expect(result.expanded[0].learning.content).toBe("L2")
  })

  it("continues expansion through inactive edges gracefully", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2 -> L3, but L2 is inactive
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l1.id), targetType: "learning", targetId: String(l2.id) })
        yield* edgeSvc.createEdge({ edgeType: "SIMILAR_TO", sourceType: "learning", sourceId: String(l2.id), targetType: "learning", targetId: String(l3.id) })

        // Mark L2 as inactive
        yield* learningSvc.update(l2.id, { active: false })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 2 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should not find anything (L2 blocks the path)
    expect(result.expanded).toHaveLength(0)
  })
})

// =============================================================================
// BIDIRECTIONAL TRAVERSAL TESTS
// =============================================================================

describe("Graph Expansion - Bidirectional Traversal", () => {
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

  it("expands in both directions when configured", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const edgeSvc = yield* EdgeService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })
        const l2 = yield* learningSvc.create({ content: "L2", sourceType: "manual" })
        const l3 = yield* learningSvc.create({ content: "L3", sourceType: "manual" })

        // L1 -> L2 (outbound)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l1.id),
          targetType: "learning",
          targetId: String(l2.id),
        })
        // L3 -> L1 (inbound)
        yield* edgeSvc.createEdge({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: String(l3.id),
          targetType: "learning",
          targetId: String(l1.id),
        })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, direction: "both" }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.expanded).toHaveLength(2)
    const contents = result.expanded.map((e) => e.learning.content)
    expect(contents).toContain("L2")
    expect(contents).toContain("L3")
  })
})

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe("Graph Expansion - Validation", () => {
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

  it("handles negative depth gracefully", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        // Negative depth should be treated as 0
        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: -5 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.expanded).toHaveLength(0)
  })

  it("handles zero decay factor", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, decayFactor: 0 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Zero decay should still work (all expanded nodes have 0 score)
    expect(result.seeds).toHaveLength(1)
  })

  it("handles decay factor greater than 1", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 1, decayFactor: 1.5 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    // Should work, just with amplification instead of decay
    expect(result.seeds).toHaveLength(1)
  })

  it("handles maxNodes of 1 (seeds only)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const expansionSvc = yield* GraphExpansionService

        const l1 = yield* learningSvc.create({ content: "L1", sourceType: "manual" })

        return yield* expansionSvc.expand(
          [{ learning: l1, score: 1.0 }],
          { depth: 5, maxNodes: 1 }
        )
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.all).toHaveLength(1)
    expect(result.expanded).toHaveLength(0)
    expect(result.stats.maxNodesReached).toBe(true)
  })
})
