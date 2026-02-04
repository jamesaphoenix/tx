/**
 * Edge types for tx
 *
 * Type definitions for graph edges that connect nodes in the knowledge graph.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Node types in the graph - entities that can be connected by edges.
 */
export const NODE_TYPES = ["learning", "file", "task", "run"] as const;

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

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Node type - one of the valid graph node types. */
export const NodeTypeSchema = Schema.Literal(...NODE_TYPES)
export type NodeType = typeof NodeTypeSchema.Type

/** Edge type - one of the valid graph edge types. */
export const EdgeTypeSchema = Schema.Literal(...EDGE_TYPES)
export type EdgeType = typeof EdgeTypeSchema.Type

/** Edge ID - branded integer. */
export const EdgeIdSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("EdgeId")
)
export type EdgeId = typeof EdgeIdSchema.Type

/** Edge entity - connects two nodes in the graph. */
export const EdgeSchema = Schema.Struct({
  id: EdgeIdSchema,
  edgeType: EdgeTypeSchema,
  sourceType: NodeTypeSchema,
  sourceId: Schema.String,
  targetType: NodeTypeSchema,
  targetId: Schema.String,
  weight: Schema.Number, // 0-1
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  createdAt: Schema.DateFromSelf,
  invalidatedAt: Schema.NullOr(Schema.DateFromSelf),
})
export type Edge = typeof EdgeSchema.Type

/** Input for creating a new edge. */
export const CreateEdgeInputSchema = Schema.Struct({
  edgeType: EdgeTypeSchema,
  sourceType: NodeTypeSchema,
  sourceId: Schema.String,
  targetType: NodeTypeSchema,
  targetId: Schema.String,
  weight: Schema.optional(Schema.Number),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type CreateEdgeInput = typeof CreateEdgeInputSchema.Type

/** Input for updating an edge. */
export const UpdateEdgeInputSchema = Schema.Struct({
  weight: Schema.optional(Schema.Number),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type UpdateEdgeInput = typeof UpdateEdgeInputSchema.Type

/** Neighbor node returned from graph traversal. */
export const NeighborNodeSchema = Schema.Struct({
  nodeType: NodeTypeSchema,
  nodeId: Schema.String,
  edgeType: EdgeTypeSchema,
  weight: Schema.Number,
  direction: Schema.Literal("outgoing", "incoming"),
})
export type NeighborNode = typeof NeighborNodeSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for edges (snake_case from SQLite). */
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
