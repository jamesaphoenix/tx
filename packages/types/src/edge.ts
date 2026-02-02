/**
 * Edge types for tx
 *
 * Type definitions for graph edges that connect nodes in the knowledge graph.
 * Zero runtime dependencies - pure TypeScript types only.
 */

/**
 * Branded type for edge IDs.
 */
export type EdgeId = number & { readonly _brand: unique symbol };

/**
 * Node types in the graph - entities that can be connected by edges.
 */
export const NODE_TYPES = ["learning", "file", "task", "run"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Edge types - strong ENUMs (fixed ontology, not pluggable).
 * - ANCHORED_TO: Learning is anchored to a file/location
 * - DERIVED_FROM: Learning is derived from another learning
 * - IMPORTS: File imports another file
 * - CO_CHANGES_WITH: Files frequently change together
 * - SIMILAR_TO: Learnings are semantically similar
 * - LINKS_TO: Explicit link reference
 * - USED_IN_RUN: Learning was used in a run
 * - INVALIDATED_BY: Learning was invalidated by another
 */
export const EDGE_TYPES = [
  "ANCHORED_TO",
  "DERIVED_FROM",
  "IMPORTS",
  "CO_CHANGES_WITH",
  "SIMILAR_TO",
  "LINKS_TO",
  "USED_IN_RUN",
  "INVALIDATED_BY",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * Edge entity - connects two nodes in the graph.
 */
export interface Edge {
  readonly id: EdgeId;
  readonly edgeType: EdgeType;
  readonly sourceType: NodeType;
  readonly sourceId: string;
  readonly targetType: NodeType;
  readonly targetId: string;
  readonly weight: number; // 0-1
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly invalidatedAt: Date | null;
}

/**
 * Input for creating a new edge.
 */
export interface CreateEdgeInput {
  readonly edgeType: EdgeType;
  readonly sourceType: NodeType;
  readonly sourceId: string;
  readonly targetType: NodeType;
  readonly targetId: string;
  readonly weight?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Input for updating an edge.
 */
export interface UpdateEdgeInput {
  readonly weight?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Database row type for edges (snake_case from SQLite).
 */
export interface EdgeRow {
  id: number;
  edge_type: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  weight: number;
  metadata: string;
  created_at: string;
  invalidated_at: string | null;
}

/**
 * Neighbor node returned from graph traversal.
 */
export interface NeighborNode {
  readonly nodeType: NodeType;
  readonly nodeId: string;
  readonly edgeType: EdgeType;
  readonly weight: number;
  readonly direction: "outgoing" | "incoming";
}
