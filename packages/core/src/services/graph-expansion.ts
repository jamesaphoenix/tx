import { Context, Effect, Layer } from "effect"
import { EdgeService, type NeighborWithDepth } from "./edge-service.js"
import { LearningRepository } from "../repo/learning-repo.js"
import { DatabaseError, ValidationError } from "../errors.js"
import type { Learning, EdgeType, LearningId } from "@tx/types"

/**
 * Seed learning with an initial score for graph expansion.
 * Typically the RRF score from hybrid search.
 */
export interface SeedLearning {
  readonly learning: Learning
  readonly score: number
}

/**
 * Expanded learning with graph traversal metadata.
 */
export interface ExpandedLearning {
  readonly learning: Learning
  /** Number of hops from the nearest seed (0 = direct seed) */
  readonly hops: number
  /** Score after applying weight decay per hop */
  readonly decayedScore: number
  /** Path of learning IDs from seed to this learning */
  readonly path: readonly LearningId[]
  /** Edge type that connected this learning (null for seeds) */
  readonly sourceEdge: EdgeType | null
  /** The edge weight that led to this learning (null for seeds) */
  readonly edgeWeight: number | null
}

/**
 * Options for graph expansion algorithm.
 */
export interface GraphExpansionOptions {
  /** Maximum traversal depth (default: 2) */
  readonly depth?: number
  /** Score decay factor per hop (default: 0.7) */
  readonly decayFactor?: number
  /** Maximum nodes to return (default: 100) */
  readonly maxNodes?: number
  /** Filter by specific edge types (default: all types) */
  readonly edgeTypes?: readonly EdgeType[]
}

/**
 * Result of graph expansion operation.
 */
export interface GraphExpansionResult {
  /** Seeds that were provided as input */
  readonly seeds: readonly ExpandedLearning[]
  /** Learnings discovered through graph expansion (excludes seeds) */
  readonly expanded: readonly ExpandedLearning[]
  /** Total learnings (seeds + expanded) */
  readonly all: readonly ExpandedLearning[]
  /** Statistics about the expansion */
  readonly stats: {
    readonly seedCount: number
    readonly expandedCount: number
    readonly maxDepthReached: number
    readonly nodesVisited: number
  }
}

export class GraphExpansionService extends Context.Tag("GraphExpansionService")<
  GraphExpansionService,
  {
    /**
     * Expand from seed learnings through the knowledge graph.
     * Uses BFS traversal with weight decay per hop.
     * Bidirectional traversal (both incoming and outgoing edges).
     *
     * @param seeds - Learnings to start expansion from, with initial scores
     * @param options - Expansion configuration (depth, decay, limits)
     * @returns Seeds and expanded learnings with traversal metadata
     */
    readonly expand: (
      seeds: readonly SeedLearning[],
      options?: GraphExpansionOptions
    ) => Effect.Effect<GraphExpansionResult, ValidationError | DatabaseError>
  }
>() {}

/**
 * Noop implementation that returns seeds without expansion.
 * Used when graph expansion is disabled or for testing.
 */
export const GraphExpansionServiceNoop = Layer.succeed(
  GraphExpansionService,
  {
    expand: (seeds) =>
      Effect.succeed({
        seeds: seeds.map(s => ({
          learning: s.learning,
          hops: 0,
          decayedScore: s.score,
          path: [s.learning.id],
          sourceEdge: null,
          edgeWeight: null
        })),
        expanded: [],
        all: seeds.map(s => ({
          learning: s.learning,
          hops: 0,
          decayedScore: s.score,
          path: [s.learning.id],
          sourceEdge: null,
          edgeWeight: null
        })),
        stats: {
          seedCount: seeds.length,
          expandedCount: 0,
          maxDepthReached: 0,
          nodesVisited: seeds.length
        }
      })
  }
)

/**
 * Default expansion options.
 */
const DEFAULT_OPTIONS: Required<Omit<GraphExpansionOptions, "edgeTypes">> = {
  depth: 2,
  decayFactor: 0.7,
  maxNodes: 100,
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
  })

export const GraphExpansionServiceLive = Layer.effect(
  GraphExpansionService,
  Effect.gen(function* () {
    const edgeService = yield* EdgeService
    const learningRepo = yield* LearningRepository

    return {
      expand: (seeds, options = {}) =>
        Effect.gen(function* () {
          // Validate options
          yield* validateOptions(options)

          const depth = options.depth ?? DEFAULT_OPTIONS.depth
          const decayFactor = options.decayFactor ?? DEFAULT_OPTIONS.decayFactor
          const maxNodes = options.maxNodes ?? DEFAULT_OPTIONS.maxNodes
          const edgeTypes = options.edgeTypes

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

          // BFS traversal
          for (let currentHop = 1; currentHop <= depth; currentHop++) {
            if (frontier.length === 0) break
            if (expanded.length >= maxNodes) break

            const nextFrontier: FrontierNode[] = []

            for (const node of frontier) {
              if (expanded.length >= maxNodes) break

              // Find neighbors bidirectionally (per PRD-016 resolved question #1)
              const neighbors = yield* edgeService.findNeighbors(
                "learning",
                String(node.learningId),
                {
                  depth: 1,
                  direction: "both",
                  edgeTypes,
                }
              )

              // Filter to only learning neighbors and process
              const learningNeighbors = neighbors.filter(
                (n): n is NeighborWithDepth & { nodeType: "learning" } =>
                  n.nodeType === "learning"
              )

              for (const neighbor of learningNeighbors) {
                if (expanded.length >= maxNodes) break

                const neighborId = parseInt(neighbor.nodeId, 10)
                if (isNaN(neighborId)) continue
                if (visited.has(neighborId)) continue

                visited.add(neighborId)

                // Fetch the learning to include in results
                const learning = yield* learningRepo.findById(neighborId)
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

          // Enforce maxNodes limit on expanded
          const limitedExpanded = expanded.slice(0, maxNodes)

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
            },
          }
        }),
    }
  })
)
