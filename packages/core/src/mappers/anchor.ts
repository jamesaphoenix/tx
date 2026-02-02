/**
 * Anchor mappers - convert database rows to domain objects
 */

import type {
  Anchor,
  AnchorId,
  AnchorType,
  AnchorStatus,
  AnchorRow
} from "@tx/types"

// Re-export type from @tx/types for convenience
export type { AnchorRow } from "@tx/types"

/**
 * Convert a database row to an Anchor domain object.
 */
export const rowToAnchor = (row: AnchorRow): Anchor => ({
  id: row.id as AnchorId,
  learningId: row.learning_id,
  anchorType: row.anchor_type as AnchorType,
  anchorValue: row.anchor_value,
  filePath: row.file_path,
  symbolFqname: row.symbol_fqname,
  lineStart: row.line_start,
  lineEnd: row.line_end,
  contentHash: row.content_hash,
  status: row.status as AnchorStatus,
  verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
  createdAt: new Date(row.created_at)
})
