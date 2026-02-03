import { Context, Effect, Layer } from "effect"
import { EdgeRepository } from "../repo/edge-repo.js"
import { DatabaseError, EdgeNotFoundError, ValidationError } from "../errors.js"
import type {
  Edge,
  EdgeType,
  NodeType,
  CreateEdgeInput,
  UpdateEdgeInput,
  NeighborNode
} from "@jamesaphoenix/tx-types"

/** Valid edge types - imported at runtime for validation */
const VALID_EDGE_TYPES: readonly EdgeType[] = [
  "ANCHORED_TO",
  "DERIVED_FROM",
  "IMPORTS",
  "CO_CHANGES_WITH",
  "SIMILAR_TO",
  "LINKS_TO",
  "USED_IN_RUN",
  "INVALIDATED_BY"
]

/** Valid node types - imported at runtime for validation */
const VALID_NODE_TYPES: readonly NodeType[] = ["learning", "file", "task", "run"]

/** Extended neighbor with depth information */
export interface NeighborWithDepth extends NeighborNode {
  readonly depth: number
}

/** Options for multi-hop neighbor finding */
export interface FindNeighborsOptions {
  /** Maximum depth to traverse (default: 1) */
  readonly depth?: number
  /** Direction of traversal */
  readonly direction?: "outgoing" | "incoming" | "both"
  /** Filter by edge types */
  readonly edgeTypes?: readonly EdgeType[]
  /** Include the path of edges that led to this neighbor */
  readonly includePath?: boolean
}

/** Neighbor with path information */
export interface NeighborWithPath extends NeighborWithDepth {
  readonly path: readonly Edge[]
}

export class EdgeService extends Context.Tag("EdgeService")<
  EdgeService,
  {
    /**
     * Create an edge between two nodes.
     * Validates edge type, node types, and ensures weight is in [0, 1].
     */
    readonly createEdge: (input: CreateEdgeInput) => Effect.Effect<Edge, ValidationError | DatabaseError>

    /**
     * Find neighbors of a node with optional multi-hop traversal.
     * Supports depth, direction, and edge type filtering.
     */
    readonly findNeighbors: (
      nodeType: NodeType,
      nodeId: string,
      options?: FindNeighborsOptions
    ) => Effect.Effect<readonly NeighborWithDepth[], DatabaseError>

    /**
     * Find a path between two nodes.
     * Returns the sequence of edges, or null if no path exists.
     */
    readonly findPath: (
      fromType: NodeType,
      fromId: string,
      toType: NodeType,
      toId: string,
      maxDepth?: number
    ) => Effect.Effect<readonly Edge[] | null, DatabaseError>

    /**
     * Invalidate (soft delete) an edge.
     */
    readonly invalidateEdge: (id: number) => Effect.Effect<boolean, EdgeNotFoundError | DatabaseError>

    /**
     * Get an edge by ID.
     */
    readonly get: (id: number) => Effect.Effect<Edge, EdgeNotFoundError | DatabaseError>

    /**
     * Update an edge's weight or metadata.
     */
    readonly update: (id: number, input: UpdateEdgeInput) => Effect.Effect<Edge, EdgeNotFoundError | ValidationError | DatabaseError>

    /**
     * Find all edges of a specific type.
     */
    readonly findByType: (edgeType: EdgeType) => Effect.Effect<readonly Edge[], ValidationError | DatabaseError>

    /**
     * Find all edges from a source node.
     */
    readonly findFromSource: (sourceType: NodeType, sourceId: string) => Effect.Effect<readonly Edge[], DatabaseError>

    /**
     * Find all edges from multiple source nodes in a single batch query.
     * Eliminates N+1 queries when fetching edges for multiple nodes.
     */
    readonly findFromMultipleSources: (
      sourceType: NodeType,
      sourceIds: readonly string[]
    ) => Effect.Effect<ReadonlyMap<string, readonly Edge[]>, DatabaseError>

    /**
     * Find all edges to a target node.
     */
    readonly findToTarget: (targetType: NodeType, targetId: string) => Effect.Effect<readonly Edge[], DatabaseError>

    /**
     * Count edges by type.
     */
    readonly countByType: () => Effect.Effect<Map<EdgeType, number>, DatabaseError>
  }
>() {}

/**
 * Validate edge type.
 */
const validateEdgeType = (edgeType: EdgeType): Effect.Effect<EdgeType, ValidationError> =>
  Effect.gen(function* () {
    if (!VALID_EDGE_TYPES.includes(edgeType)) {
      return yield* Effect.fail(new ValidationError({
        reason: `Invalid edge type: ${edgeType}. Valid types: ${VALID_EDGE_TYPES.join(", ")}`
      }))
    }
    return edgeType
  })

/**
 * Validate node type.
 */
const validateNodeType = (nodeType: NodeType, field: string): Effect.Effect<NodeType, ValidationError> =>
  Effect.gen(function* () {
    if (!VALID_NODE_TYPES.includes(nodeType)) {
      return yield* Effect.fail(new ValidationError({
        reason: `Invalid ${field}: ${nodeType}. Valid types: ${VALID_NODE_TYPES.join(", ")}`
      }))
    }
    return nodeType
  })

/**
 * Validate weight is in [0, 1] range.
 */
const validateWeight = (weight: number | undefined): Effect.Effect<number, ValidationError> =>
  Effect.gen(function* () {
    const w = weight ?? 1.0
    if (w < 0 || w > 1) {
      return yield* Effect.fail(new ValidationError({
        reason: `Weight must be between 0 and 1, got: ${w}`
      }))
    }
    return w
  })

/**
 * Validate node ID is non-empty.
 */
const validateNodeId = (nodeId: string, field: string): Effect.Effect<string, ValidationError> =>
  Effect.gen(function* () {
    if (!nodeId || nodeId.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({
        reason: `${field} is required and cannot be empty`
      }))
    }
    return nodeId
  })

export const EdgeServiceLive = Layer.effect(
  EdgeService,
  Effect.gen(function* () {
    const edgeRepo = yield* EdgeRepository

    return {
      createEdge: (input) =>
        Effect.gen(function* () {
          // Validate all inputs
          yield* validateEdgeType(input.edgeType)
          yield* validateNodeType(input.sourceType, "sourceType")
          yield* validateNodeType(input.targetType, "targetType")
          yield* validateNodeId(input.sourceId, "sourceId")
          yield* validateNodeId(input.targetId, "targetId")
          yield* validateWeight(input.weight)

          // Create the edge
          return yield* edgeRepo.create(input)
        }),

      findNeighbors: (nodeType, nodeId, options = {}) =>
        Effect.gen(function* () {
          const depth = options.depth ?? 1
          const direction = options.direction ?? "both"
          const edgeTypes = options.edgeTypes

          // For depth 1, use the repository directly
          if (depth === 1) {
            const neighbors = yield* edgeRepo.findNeighbors(nodeType, nodeId, { direction, edgeTypes })
            return neighbors.map(n => ({ ...n, depth: 1 }))
          }

          // Multi-hop BFS traversal
          const visited = new Set<string>([`${nodeType}:${nodeId}`])
          const result: NeighborWithDepth[] = []
          let frontier: Array<{ nodeType: NodeType; nodeId: string }> = [{ nodeType, nodeId }]

          for (let currentDepth = 1; currentDepth <= depth; currentDepth++) {
            const nextFrontier: Array<{ nodeType: NodeType; nodeId: string }> = []

            for (const node of frontier) {
              const neighbors = yield* edgeRepo.findNeighbors(node.nodeType, node.nodeId, { direction, edgeTypes })

              for (const neighbor of neighbors) {
                const key = `${neighbor.nodeType}:${neighbor.nodeId}`
                if (!visited.has(key)) {
                  visited.add(key)
                  result.push({ ...neighbor, depth: currentDepth })
                  nextFrontier.push({ nodeType: neighbor.nodeType, nodeId: neighbor.nodeId })
                }
              }
            }

            frontier = nextFrontier
            if (frontier.length === 0) break
          }

          return result
        }),

      findPath: (fromType, fromId, toType, toId, maxDepth = 5) =>
        edgeRepo.findPath(fromType, fromId, toType, toId, maxDepth),

      invalidateEdge: (id) => edgeRepo.invalidate(id),

      get: (id) =>
        Effect.gen(function* () {
          const edge = yield* edgeRepo.findById(id)
          if (!edge) {
            return yield* Effect.fail(new EdgeNotFoundError({ id }))
          }
          return edge
        }),

      update: (id, input) =>
        Effect.gen(function* () {
          // Validate weight if provided
          if (input.weight !== undefined) {
            yield* validateWeight(input.weight)
          }

          // Get existing edge to verify it exists
          const existing = yield* edgeRepo.findById(id)
          if (!existing) {
            return yield* Effect.fail(new EdgeNotFoundError({ id }))
          }

          // Update the edge
          const updated = yield* edgeRepo.update(id, input)
          if (!updated) {
            return yield* Effect.fail(new EdgeNotFoundError({ id }))
          }
          return updated
        }),

      findByType: (edgeType) =>
        Effect.gen(function* () {
          yield* validateEdgeType(edgeType)
          return yield* edgeRepo.findByEdgeType(edgeType)
        }),

      findFromSource: (sourceType, sourceId) =>
        edgeRepo.findBySource(sourceType, sourceId),

      findFromMultipleSources: (sourceType, sourceIds) =>
        edgeRepo.findByMultipleSources(sourceType, sourceIds),

      findToTarget: (targetType, targetId) =>
        edgeRepo.findByTarget(targetType, targetId),

      countByType: () =>
        Effect.gen(function* () {
          const dbCounts = yield* edgeRepo.countByType()
          const counts = new Map<EdgeType, number>()

          // Initialize all types with 0
          for (const type of VALID_EDGE_TYPES) {
            counts.set(type, 0)
          }

          // Merge in the actual counts from database
          for (const [edgeType, count] of dbCounts) {
            counts.set(edgeType, count)
          }

          return counts
        })
    }
  })
)
