import { Context, Effect, Layer } from "effect"
import { EDGE_TYPES } from "@jamesaphoenix/tx-types"
import { EdgeService, type NeighborWithDepth } from "../edge-service.js"
import { LearningRepository } from "../../repo/learning-repo.js"
import { AnchorRepository } from "../../repo/anchor-repo.js"
import { DatabaseError, ValidationError } from "../../errors.js"
import { expandFromFilesGraph } from "./from-files.js"
import type { EdgeType, LearningId } from "@jamesaphoenix/tx-types"
import type {
  EdgeTypeFilter,
  FileExpansionOptions,
  FileExpansionResult,
  GraphExpansionOptions,
  GraphExpansionResult,
  SeedLearning,
  ExpandedLearning
} from "../graph-expansion.js"

/**
 * Default expansion options.
 */
const DEFAULT_OPTIONS: Required<Omit<GraphExpansionOptions, "edgeTypes">> = {
  depth: 2,
  decayFactor: 0.7,
  maxNodes: 100,
  direction: "both",
}

/**
 * Type guard to check if edgeTypes is a simple array (backwards compatibility).
 */
const isSimpleEdgeTypeArray = (
  edgeTypes: EdgeTypeFilter | readonly EdgeType[] | undefined
): edgeTypes is readonly EdgeType[] | undefined => {
  if (edgeTypes === undefined) return true
  return Array.isArray(edgeTypes)
}

/**
 * Validate an EdgeTypeFilter for conflicting include/exclude entries.
 * Returns a ValidationError if the same edge type appears in both include and exclude.
 */
const validateEdgeTypeFilter = (
  filter: EdgeTypeFilter,
  context: string = "edgeTypes"
): Effect.Effect<void, ValidationError> =>
  Effect.gen(function* () {
    const { include, exclude, perHop } = filter

    // Check for overlapping types in include and exclude
    if (include && exclude) {
      const includeSet = new Set(include)
      const overlap = exclude.filter(t => includeSet.has(t))
      if (overlap.length > 0) {
        return yield* Effect.fail(new ValidationError({
          reason: `${context}: conflicting filters - edge types appear in both include and exclude: ${overlap.join(", ")}`
        }))
      }
    }

    // Recursively validate perHop filters
    if (perHop) {
      for (const [hop, hopFilter] of Object.entries(perHop)) {
        yield* validateEdgeTypeFilter(hopFilter, `${context}.perHop[${hop}]`)
      }
    }
  })

/**
 * Resolve EdgeTypeFilter to an array of edge types for a specific hop.
 * Returns undefined if all edge types should be traversed.
 */
const resolveEdgeTypesForHop = (
  filter: EdgeTypeFilter | readonly EdgeType[] | undefined,
  hop: number
): readonly EdgeType[] | undefined => {
  // Simple array or undefined - pass through
  if (isSimpleEdgeTypeArray(filter)) {
    return filter
  }

  // Check for hop-specific override
  const hopFilter = filter.perHop?.[hop]
  if (hopFilter) {
    // Recursively resolve (perHop filters don't have perHop themselves typically)
    return resolveEdgeTypesForHop(hopFilter, hop)
  }

  // Apply include/exclude from base filter
  const { include, exclude } = filter

  if (include && include.length > 0) {
    return include
  }

  if (exclude && exclude.length > 0) {
    // Return all edge types except excluded ones
    return EDGE_TYPES.filter(t => !exclude.includes(t))
  }

  // No filtering - return undefined to traverse all
  return undefined
}

/**
 * Validate expansion options.
 */
const validateOptions = (options: GraphExpansionOptions): Effect.Effect<void, ValidationError> =>
  Effect.gen(function* () {
    const depth = options.depth ?? DEFAULT_OPTIONS.depth
    const decayFactor = options.decayFactor ?? DEFAULT_OPTIONS.decayFactor
    const maxNodes = options.maxNodes ?? DEFAULT_OPTIONS.maxNodes

    if (depth < 0) {
      return yield* Effect.fail(new ValidationError({
        reason: `Expansion depth must be >= 0, got: ${depth}`
      }))
    }

    if (depth > 10) {
      return yield* Effect.fail(new ValidationError({
        reason: `Expansion depth must be <= 10, got: ${depth}`
      }))
    }

    if (decayFactor <= 0 || decayFactor > 1) {
      return yield* Effect.fail(new ValidationError({
        reason: `Decay factor must be in (0, 1], got: ${decayFactor}`
      }))
    }

    if (maxNodes < 1) {
      return yield* Effect.fail(new ValidationError({
        reason: `Max nodes must be >= 1, got: ${maxNodes}`
      }))
    }

    // Validate EdgeTypeFilter if provided
    if (options.edgeTypes && !isSimpleEdgeTypeArray(options.edgeTypes)) {
      yield* validateEdgeTypeFilter(options.edgeTypes)
    }
  })

type GraphExpansionDeps = {
  readonly edgeService: Context.Tag.Service<typeof EdgeService>
  readonly learningRepo: Context.Tag.Service<typeof LearningRepository>
  readonly anchorRepo: Context.Tag.Service<typeof AnchorRepository>
}

const buildLiveHandlers = (deps: GraphExpansionDeps) => ({
  expand: (seeds: readonly SeedLearning[], options: GraphExpansionOptions = {}) =>
    Effect.gen(function* () {
      // Validate options
      yield* validateOptions(options)

      const depth = options.depth ?? DEFAULT_OPTIONS.depth
      const decayFactor = options.decayFactor ?? DEFAULT_OPTIONS.decayFactor
      const maxNodes = options.maxNodes ?? DEFAULT_OPTIONS.maxNodes
      const edgeTypeFilter = options.edgeTypes
      // Map direction option to findNeighbors terminology
      const directionOpt = options.direction ?? DEFAULT_OPTIONS.direction
      const findDirection: "outgoing" | "incoming" | "both" =
        directionOpt === "outbound" ? "outgoing"
          : directionOpt === "inbound" ? "incoming"
          : "both"

      // Handle empty seeds
      if (seeds.length === 0) {
        return {
          seeds: [],
          expanded: [],
          all: [],
          stats: {
            seedCount: 0,
            expandedCount: 0,
            maxDepthReached: 0,
            nodesVisited: 0,
            maxNodesReached: false,
          },
        }
      }

      // Track visited learning IDs to prevent cycles
      const visited = new Set<number>()

      // Convert seeds to ExpandedLearning format
      const seedLearnings: ExpandedLearning[] = seeds.map((seed) => {
        visited.add(seed.learning.id)
        return {
          learning: seed.learning,
          hops: 0,
          decayedScore: seed.score,
          path: [seed.learning.id],
          sourceEdge: null,
          edgeWeight: null,
        }
      })

      // If depth is 0, just return seeds
      if (depth === 0) {
        return {
          seeds: seedLearnings,
          expanded: [],
          all: seedLearnings,
          stats: {
            seedCount: seedLearnings.length,
            expandedCount: 0,
            maxDepthReached: 0,
            nodesVisited: seedLearnings.length,
            maxNodesReached: seedLearnings.length >= maxNodes,
          },
        }
      }

      // BFS frontier: nodes to expand from
      type FrontierNode = {
        learningId: number
        score: number
        path: readonly LearningId[]
      }

      let frontier: FrontierNode[] = seeds.map((seed) => ({
        learningId: seed.learning.id,
        score: seed.score,
        path: [seed.learning.id],
      }))

      const expanded: ExpandedLearning[] = []
      let maxDepthReached = 0
      let maxNodesReached = false
      const totalNodes = () => seedLearnings.length + expanded.length

      // BFS traversal
      for (let currentHop = 1; currentHop <= depth; currentHop++) {
        if (frontier.length === 0) break
        if (totalNodes() >= maxNodes) { maxNodesReached = true; break }

        const nextFrontier: FrontierNode[] = []

        for (const node of frontier) {
          if (totalNodes() >= maxNodes) { maxNodesReached = true; break }

          // Find neighbors bidirectionally (per PRD-016 resolved question #1)
          // Resolve edge types for this specific hop (supports per-hop overrides)
          const edgeTypesForHop = resolveEdgeTypesForHop(edgeTypeFilter, currentHop)
          const neighbors = yield* deps.edgeService.findNeighbors(
            "learning",
            String(node.learningId),
            {
              depth: 1,
              direction: findDirection,
              edgeTypes: edgeTypesForHop,
            }
          )

          // Filter to only learning neighbors and process
          const learningNeighbors = neighbors.filter(
            (n): n is NeighborWithDepth & { nodeType: "learning" } =>
              n.nodeType === "learning"
          )

          for (const neighbor of learningNeighbors) {
            if (totalNodes() >= maxNodes) { maxNodesReached = true; break }

            const neighborId = parseInt(neighbor.nodeId, 10)
            if (isNaN(neighborId)) continue
            if (visited.has(neighborId)) continue

            visited.add(neighborId)

            // Fetch the learning to include in results
            const learning = yield* deps.learningRepo.findById(neighborId)
            if (!learning) continue

            // Calculate decayed score: parentScore * edgeWeight * decayFactor
            const newScore = node.score * neighbor.weight * decayFactor
            const newPath = [...node.path, learning.id]

            expanded.push({
              learning,
              hops: currentHop,
              decayedScore: newScore,
              path: newPath,
              sourceEdge: neighbor.edgeType,
              edgeWeight: neighbor.weight,
            })

            maxDepthReached = currentHop

            // Add to next frontier for further expansion
            nextFrontier.push({
              learningId: learning.id,
              score: newScore,
              path: newPath,
            })
          }
        }

        frontier = nextFrontier
      }

      // Sort expanded by decayed score (highest first)
      expanded.sort((a, b) => b.decayedScore - a.decayedScore)

      // Enforce maxNodes limit on total (seeds + expanded)
      const expandedLimit = Math.max(0, maxNodes - seedLearnings.length)
      const limitedExpanded = expanded.slice(0, expandedLimit)
      if (expanded.length > expandedLimit) maxNodesReached = true

      const all = [...seedLearnings, ...limitedExpanded]

      return {
        seeds: seedLearnings,
        expanded: limitedExpanded,
        all,
        stats: {
          seedCount: seedLearnings.length,
          expandedCount: limitedExpanded.length,
          maxDepthReached,
          nodesVisited: visited.size,
          maxNodesReached,
        },
      }
    }),

  expandFromFiles: (files: readonly string[], options: FileExpansionOptions = {}) =>
    expandFromFilesGraph(deps, files, options)
})

export const buildGraphExpansionServiceLive = <
  TService extends Context.Tag<any, {
    readonly expand: (
      seeds: readonly SeedLearning[],
      options?: GraphExpansionOptions
    ) => Effect.Effect<GraphExpansionResult, ValidationError | DatabaseError>
    readonly expandFromFiles: (
      files: readonly string[],
      options?: FileExpansionOptions
    ) => Effect.Effect<FileExpansionResult, ValidationError | DatabaseError>
  }>
>(serviceTag: TService): Layer.Layer<TService, never, EdgeService | LearningRepository | AnchorRepository> =>
  Layer.effect(
    serviceTag,
    Effect.gen(function* () {
      const edgeService = yield* EdgeService
      const learningRepo = yield* LearningRepository
      const anchorRepo = yield* AnchorRepository

      return buildLiveHandlers({ edgeService, learningRepo, anchorRepo })
    })
  )
