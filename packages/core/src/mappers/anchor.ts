/**
 * Anchor mappers - convert database rows to domain objects
 */

import type {
  Anchor,
  AnchorId,
  AnchorType,
  AnchorStatus,
  AnchorRow,
  InvalidationLog,
  InvalidationLogRow,
  InvalidationSource
} from "@tx/types"

// Re-export types from @tx/types for convenience
export type { AnchorRow, InvalidationLogRow } from "@tx/types"

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
  pinned: row.pinned === 1,
  verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
  createdAt: new Date(row.created_at)
})

/**
 * Convert a database row to an InvalidationLog domain object.
 */
export const rowToInvalidationLog = (row: InvalidationLogRow): InvalidationLog => ({
  id: row.id,
  anchorId: row.anchor_id,
  oldStatus: row.old_status as AnchorStatus,
  newStatus: row.new_status as AnchorStatus,
  reason: row.reason,
  detectedBy: row.detected_by as InvalidationSource,
  oldContentHash: row.old_content_hash,
  newContentHash: row.new_content_hash,
  similarityScore: row.similarity_score,
  invalidatedAt: new Date(row.invalidated_at)
})
