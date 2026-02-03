import { Context, Effect, Layer } from "effect"
import { EdgeService, type NeighborWithDepth } from "./edge-service.js"
import { LearningRepository } from "../repo/learning-repo.js"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { DatabaseError, ValidationError } from "../errors.js"
import type { Learning, EdgeType, LearningId } from "@jamesaphoenix/tx-types"
import { EDGE_TYPES } from "@jamesaphoenix/tx-types"

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
 * Filter configuration for edge types during graph traversal.
 * Supports include/exclude lists and per-hop overrides.
 */
export interface EdgeTypeFilter {
  /** Only traverse these edge types (mutually exclusive with exclude for same types) */
  readonly include?: readonly EdgeType[]
  /** Traverse all edge types except these (mutually exclusive with include for same types) */
  readonly exclude?: readonly EdgeType[]
  /** Depth-specific filter overrides (1-indexed, matching hop number) */
  readonly perHop?: Readonly<Record<number, EdgeTypeFilter>>
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
  /** Filter by specific edge types (default: all types).
   * Accepts either a simple array for backwards compatibility or EdgeTypeFilter for advanced filtering. */
  readonly edgeTypes?: EdgeTypeFilter | readonly EdgeType[]
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

/**
 * Options for file-based graph expansion.
 * Expands from files via IMPORTS and CO_CHANGES_WITH edges to find related learnings.
 * See PRD-016 for specification.
 */
export interface FileExpansionOptions {
  /** Maximum traversal depth for file relationships (default: 2) */
  readonly depth?: number
  /** Score decay factor per hop (default: 0.7) */
  readonly decayFactor?: number
  /** Maximum learnings to return (default: 100) */
  readonly maxNodes?: number
}

/**
 * A learning discovered through file-based graph expansion.
 * Contains metadata about how the learning was found via file relationships.
 */
export interface FileExpandedLearning {
  readonly learning: Learning
  /** The source file path that led to this learning */
  readonly sourceFile: string
  /** Number of hops from the source file (0 = directly anchored to input file) */
  readonly hops: number
  /** Score after applying weight decay per hop */
  readonly decayedScore: number
  /** Edge type that connected this learning (ANCHORED_TO for direct, IMPORTS or CO_CHANGES_WITH for expanded) */
  readonly sourceEdge: EdgeType
  /** Edge weight (null for directly anchored learnings, weight value for IMPORTS/CO_CHANGES_WITH) */
  readonly edgeWeight: number | null
}

/**
 * Result of file-based graph expansion operation.
 */
export interface FileExpansionResult {
  /** Learnings directly anchored to the input files (hop 0) */
  readonly anchored: readonly FileExpandedLearning[]
  /** Learnings discovered through file expansion (hops > 0 via IMPORTS/CO_CHANGES_WITH) */
  readonly expanded: readonly FileExpandedLearning[]
  /** All learnings (anchored + expanded), sorted by decayedScore */
  readonly all: readonly FileExpandedLearning[]
  /** Statistics about the expansion */
  readonly stats: {
    readonly inputFileCount: number
    readonly anchoredCount: number
    readonly expandedCount: number
    readonly maxDepthReached: number
    readonly filesVisited: number
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

    /**
     * Expand from file paths to find related learnings.
     * First finds learnings ANCHORED_TO the input files, then expands via
     * IMPORTS and CO_CHANGES_WITH edges to find learnings anchored to related files.
     *
     * @param files - File paths to expand from (e.g., ["src/auth.ts", "src/jwt.ts"])
     * @param options - Expansion configuration (depth, decay, limits)
     * @returns Anchored and expanded learnings with file relationship metadata
     */
    readonly expandFromFiles: (
      files: readonly string[],
      options?: FileExpansionOptions
    ) => Effect.Effect<FileExpansionResult, ValidationError | DatabaseError>
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
      }),

    expandFromFiles: (files) =>
      Effect.succeed({
        anchored: [],
        expanded: [],
        all: [],
        stats: {
          inputFileCount: files.length,
          anchoredCount: 0,
          expandedCount: 0,
          maxDepthReached: 0,
          filesVisited: files.length
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

export const GraphExpansionServiceLive = Layer.effect(
  GraphExpansionService,
  Effect.gen(function* () {
    const edgeService = yield* EdgeService
    const learningRepo = yield* LearningRepository
    const anchorRepo = yield* AnchorRepository

    return {
      expand: (seeds, options = {}) =>
        Effect.gen(function* () {
          // Validate options
          yield* validateOptions(options)

          const depth = options.depth ?? DEFAULT_OPTIONS.depth
          const decayFactor = options.decayFactor ?? DEFAULT_OPTIONS.decayFactor
          const maxNodes = options.maxNodes ?? DEFAULT_OPTIONS.maxNodes
          const edgeTypeFilter = options.edgeTypes

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
              // Resolve edge types for this specific hop (supports per-hop overrides)
              const edgeTypesForHop = resolveEdgeTypesForHop(edgeTypeFilter, currentHop)
              const neighbors = yield* edgeService.findNeighbors(
                "learning",
                String(node.learningId),
                {
                  depth: 1,
                  direction: "both",
                  edgeTypes: edgeTypesForHop,
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

      expandFromFiles: (files, options = {}) =>
        Effect.gen(function* () {
          // Validate options
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

          // Handle empty files input
          if (files.length === 0) {
            return {
              anchored: [],
              expanded: [],
              all: [],
              stats: {
                inputFileCount: 0,
                anchoredCount: 0,
                expandedCount: 0,
                maxDepthReached: 0,
                filesVisited: 0,
              },
            }
          }

          // Track visited files and learnings to prevent duplicates
          const visitedFiles = new Set<string>(files)
          const visitedLearningIds = new Set<number>()

          // Step 1: Find learnings ANCHORED_TO the input files (hop 0)
          const anchoredLearnings: FileExpandedLearning[] = []

          for (const filePath of files) {
            const anchors = yield* anchorRepo.findByFilePath(filePath)

            // Filter to only valid anchors
            const validAnchors = anchors.filter(a => a.status === "valid")

            for (const anchor of validAnchors) {
              if (visitedLearningIds.has(anchor.learningId)) continue
              visitedLearningIds.add(anchor.learningId)

              const learning = yield* learningRepo.findById(anchor.learningId)
              if (!learning) continue

              anchoredLearnings.push({
                learning,
                sourceFile: filePath,
                hops: 0,
                decayedScore: 1.0, // Base score for directly anchored learnings
                sourceEdge: "ANCHORED_TO",
                edgeWeight: null,
              })
            }
          }

          // If depth is 0, just return anchored learnings
          if (depth === 0) {
            const limitedAnchored = anchoredLearnings.slice(0, maxNodes)
            return {
              anchored: limitedAnchored,
              expanded: [],
              all: limitedAnchored,
              stats: {
                inputFileCount: files.length,
                anchoredCount: limitedAnchored.length,
                expandedCount: 0,
                maxDepthReached: 0,
                filesVisited: files.length,
              },
            }
          }

          // Step 2-5: BFS traverse via IMPORTS and CO_CHANGES_WITH edges
          type FileFrontierNode = {
            filePath: string
            score: number // Score inherited from parent
          }

          let frontier: FileFrontierNode[] = files.map(f => ({
            filePath: f,
            score: 1.0,
          }))

          const expandedLearnings: FileExpandedLearning[] = []
          let maxDepthReached = 0
          const totalLearnings = () => anchoredLearnings.length + expandedLearnings.length

          // BFS traversal through file relationships
          for (let currentHop = 1; currentHop <= depth; currentHop++) {
            if (frontier.length === 0) break
            if (totalLearnings() >= maxNodes) break

            const nextFrontier: FileFrontierNode[] = []

            for (const node of frontier) {
              if (totalLearnings() >= maxNodes) break

              // Find related files via IMPORTS and CO_CHANGES_WITH edges
              // Note: For file nodes, nodeType is "file" and nodeId is the file path
              const neighbors = yield* edgeService.findNeighbors(
                "file",
                node.filePath,
                {
                  depth: 1,
                  direction: "both",
                  edgeTypes: ["IMPORTS", "CO_CHANGES_WITH"],
                }
              )

              // Filter to only file neighbors
              const fileNeighbors = neighbors.filter(
                (n): n is NeighborWithDepth & { nodeType: "file" } =>
                  n.nodeType === "file"
              )

              for (const neighbor of fileNeighbors) {
                if (totalLearnings() >= maxNodes) break

                const relatedFilePath = neighbor.nodeId
                if (visitedFiles.has(relatedFilePath)) continue
                visitedFiles.add(relatedFilePath)

                // Calculate decayed score for this hop
                const hopScore = node.score * neighbor.weight * decayFactor

                // Find learnings anchored to this related file
                const anchors = yield* anchorRepo.findByFilePath(relatedFilePath)
                const validAnchors = anchors.filter(a => a.status === "valid")

                for (const anchor of validAnchors) {
                  if (totalLearnings() >= maxNodes) break
                  if (visitedLearningIds.has(anchor.learningId)) continue
                  visitedLearningIds.add(anchor.learningId)

                  const learning = yield* learningRepo.findById(anchor.learningId)
                  if (!learning) continue

                  expandedLearnings.push({
                    learning,
                    sourceFile: relatedFilePath,
                    hops: currentHop,
                    decayedScore: hopScore,
                    sourceEdge: neighbor.edgeType,
                    edgeWeight: neighbor.weight,
                  })

                  maxDepthReached = currentHop
                }

                // Add to next frontier for further expansion
                nextFrontier.push({
                  filePath: relatedFilePath,
                  score: hopScore,
                })
              }
            }

            frontier = nextFrontier
          }

          // Sort expanded by decayed score (highest first)
          expandedLearnings.sort((a, b) => b.decayedScore - a.decayedScore)

          // Enforce maxNodes limit
          const totalAvailable = anchoredLearnings.length + expandedLearnings.length
          let limitedAnchored = anchoredLearnings
          let limitedExpanded = expandedLearnings

          if (totalAvailable > maxNodes) {
            // Prioritize anchored learnings, then fill with expanded
            if (anchoredLearnings.length >= maxNodes) {
              limitedAnchored = anchoredLearnings.slice(0, maxNodes)
              limitedExpanded = []
            } else {
              const remainingSlots = maxNodes - anchoredLearnings.length
              limitedExpanded = expandedLearnings.slice(0, remainingSlots)
            }
          }

          // Combine all and sort by decayedScore
          const all = [...limitedAnchored, ...limitedExpanded]
          all.sort((a, b) => b.decayedScore - a.decayedScore)

          return {
            anchored: limitedAnchored,
            expanded: limitedExpanded,
            all,
            stats: {
              inputFileCount: files.length,
              anchoredCount: limitedAnchored.length,
              expandedCount: limitedExpanded.length,
              maxDepthReached,
              filesVisited: visitedFiles.size,
            },
          }
        }),
    }
  })
)
