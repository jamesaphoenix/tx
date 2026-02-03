/**
 * Edge mappers - convert database rows to domain objects
 */

import type {
  Edge,
  EdgeId,
  EdgeType,
  NodeType,
  EdgeRow
} from "@jamesaphoenix/tx-types"

// Re-export type from @tx/types for convenience
export type { EdgeRow } from "@jamesaphoenix/tx-types"

/**
 * Convert a database row to an Edge domain object.
 */
export const rowToEdge = (row: EdgeRow): Edge => ({
  id: row.id as EdgeId,
  edgeType: row.edge_type as EdgeType,
  sourceType: row.source_type as NodeType,
  sourceId: row.source_id,
  targetType: row.target_type as NodeType,
  targetId: row.target_id,
  weight: row.weight,
  metadata: row.metadata ? JSON.parse(row.metadata) : {},
  createdAt: new Date(row.created_at),
  invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : null
})
