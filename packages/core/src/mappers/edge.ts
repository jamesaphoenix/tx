/**
 * Edge mappers - convert database rows to domain objects
 */

import { Schema } from "effect"
import type {
  Edge,
  EdgeType,
  NodeType,
  EdgeRow
} from "@jamesaphoenix/tx-types"
import { EDGE_TYPES, NODE_TYPES } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

// Re-export type from @tx/types for convenience
export type { EdgeRow } from "@jamesaphoenix/tx-types"

/**
 * Schema for metadata - a record of string keys to unknown values.
 */
const MetadataSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

/**
 * Safely parse and validate metadata JSON string.
 * Returns empty object if parsing fails or validation fails.
 */
const parseMetadata = (metadataJson: string | null): Record<string, unknown> => {
  if (!metadataJson) return {}

  try {
    const parsed: unknown = JSON.parse(metadataJson)
    return Schema.decodeUnknownSync(MetadataSchema)(parsed)
  } catch {
    return {}
  }
}

/**
 * Check if a string is a valid EdgeType.
 */
export const isValidEdgeType = (s: string): s is EdgeType => {
  return (EDGE_TYPES as readonly string[]).includes(s)
}

/**
 * Check if a string is a valid NodeType.
 */
export const isValidNodeType = (s: string): s is NodeType => {
  return (NODE_TYPES as readonly string[]).includes(s)
}

/**
 * Convert a database row to an Edge domain object.
 * Validates edge_type, source_type, and target_type at runtime.
 */
export const rowToEdge = (row: EdgeRow): Edge => {
  if (!isValidEdgeType(row.edge_type)) {
    throw new InvalidStatusError({
      entity: "edge",
      status: row.edge_type,
      validStatuses: EDGE_TYPES,
      rowId: row.id
    })
  }
  if (!isValidNodeType(row.source_type)) {
    throw new InvalidStatusError({
      entity: "edge.source_type",
      status: row.source_type,
      validStatuses: NODE_TYPES,
      rowId: row.id
    })
  }
  if (!isValidNodeType(row.target_type)) {
    throw new InvalidStatusError({
      entity: "edge.target_type",
      status: row.target_type,
      validStatuses: NODE_TYPES,
      rowId: row.id
    })
  }
  return {
    id: row.id as Edge["id"],
    edgeType: row.edge_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    weight: row.weight,
    metadata: parseMetadata(row.metadata),
    createdAt: parseDate(row.created_at, "created_at", row.id),
    invalidatedAt: row.invalidated_at ? parseDate(row.invalidated_at, "invalidated_at", row.id) : null
  }
}
