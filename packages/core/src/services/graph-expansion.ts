import { Context, Effect, Layer } from "effect"
import { DatabaseError, ValidationError } from "../errors.js"
import type { Learning, EdgeType, LearningId } from "@jamesaphoenix/tx-types"
import { buildGraphExpansionServiceLive } from "./graph-expansion/live.js"

/**
 * Seed learning with an initial score for graph expansion.
 * Typically the RRF score from hybrid search.
 */
export type SeedLearning = {
  readonly learning: Learning
  readonly score: number};

/**
 * Expanded learning with graph traversal metadata.
 */
export type ExpandedLearning = {
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
  readonly edgeWeight: number | null};

/**
 * Filter configuration for edge types during graph traversal.
 * Supports include/exclude lists and per-hop overrides.
 */
export type EdgeTypeFilter = {
  /** Only traverse these edge types (mutually exclusive with exclude for same types) */
  readonly include?: readonly EdgeType[]
  /** Traverse all edge types except these (mutually exclusive with include for same types) */
  readonly exclude?: readonly EdgeType[]
  /** Depth-specific filter overrides (1-indexed, matching hop number) */
  readonly perHop?: Readonly<Record<number, EdgeTypeFilter>>};

/**
 * Options for graph expansion algorithm.
 */
export type GraphExpansionOptions = {
  /** Maximum traversal depth (default: 2) */
  readonly depth?: number
  /** Score decay factor per hop (default: 0.7) */
  readonly decayFactor?: number
  /** Maximum nodes to return (default: 100) */
  readonly maxNodes?: number
  /** Filter by specific edge types (default: all types).
   * Accepts either a simple array for backwards compatibility or EdgeTypeFilter for advanced filtering. */
  readonly edgeTypes?: EdgeTypeFilter | readonly EdgeType[]
  /** Direction of edge traversal (default: "both") */
  readonly direction?: "outbound" | "inbound" | "both"};

/**
 * Result of graph expansion operation.
 */
export type GraphExpansionResult = {
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
    readonly maxNodesReached: boolean
  }};

/**
 * Options for file-based graph expansion.
 * Expands from files via IMPORTS and CO_CHANGES_WITH edges to find related learnings.
 * See PRD-016 for specification.
 */
export type FileExpansionOptions = {
  /** Maximum traversal depth for file relationships (default: 2) */
  readonly depth?: number
  /** Score decay factor per hop (default: 0.7) */
  readonly decayFactor?: number
  /** Maximum learnings to return (default: 100) */
  readonly maxNodes?: number};

/**
 * A learning discovered through file-based graph expansion.
 * Contains metadata about how the learning was found via file relationships.
 */
export type FileExpandedLearning = {
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
  readonly edgeWeight: number | null};

/**
 * Result of file-based graph expansion operation.
 */
export type FileExpansionResult = {
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
  }};

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
          nodesVisited: seeds.length,
          maxNodesReached: false
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

export const GraphExpansionServiceLive = buildGraphExpansionServiceLive(GraphExpansionService)
