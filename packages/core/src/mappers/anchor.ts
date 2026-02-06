/**
 * Anchor mappers - convert database rows to domain objects
 */

import type {
  Anchor,
  AnchorType,
  AnchorStatus,
  AnchorRow,
  InvalidationLog,
  InvalidationLogRow,
  InvalidationSource
} from "@jamesaphoenix/tx-types"
import {
  ANCHOR_TYPES,
  ANCHOR_STATUSES,
  INVALIDATION_SOURCES
} from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

// Re-export types from @tx/types for convenience
export type { AnchorRow, InvalidationLogRow } from "@jamesaphoenix/tx-types"

/**
 * Check if a string is a valid AnchorType.
 */
export const isValidAnchorType = (s: string): s is AnchorType => {
  return (ANCHOR_TYPES as readonly string[]).includes(s)
}

/**
 * Check if a string is a valid AnchorStatus.
 */
export const isValidAnchorStatus = (s: string): s is AnchorStatus => {
  return (ANCHOR_STATUSES as readonly string[]).includes(s)
}

/**
 * Check if a string is a valid InvalidationSource.
 */
export const isValidInvalidationSource = (s: string): s is InvalidationSource => {
  return (INVALIDATION_SOURCES as readonly string[]).includes(s)
}

/**
 * Convert a database row to an Anchor domain object.
 * Validates anchor_type and status at runtime.
 */
export const rowToAnchor = (row: AnchorRow): Anchor => {
  if (!isValidAnchorType(row.anchor_type)) {
    throw new InvalidStatusError({
      entity: "anchor",
      status: row.anchor_type,
      validStatuses: ANCHOR_TYPES,
      rowId: row.id
    })
  }
  if (!isValidAnchorStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "anchor",
      status: row.status,
      validStatuses: ANCHOR_STATUSES,
      rowId: row.id
    })
  }
  return {
    id: row.id as Anchor["id"],
    learningId: row.learning_id,
    anchorType: row.anchor_type,
    anchorValue: row.anchor_value,
    filePath: row.file_path,
    symbolFqname: row.symbol_fqname,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    contentHash: row.content_hash,
    contentPreview: row.content_preview,
    status: row.status,
    pinned: row.pinned === 1,
    verifiedAt: row.verified_at ? parseDate(row.verified_at, "verified_at", row.id) : null,
    createdAt: parseDate(row.created_at, "created_at", row.id)
  }
}

/**
 * Convert a database row to an InvalidationLog domain object.
 * Validates old_status, new_status, and detected_by at runtime.
 */
export const rowToInvalidationLog = (row: InvalidationLogRow): InvalidationLog => {
  if (!isValidAnchorStatus(row.old_status)) {
    throw new InvalidStatusError({
      entity: "invalidation_log.old_status",
      status: row.old_status,
      validStatuses: ANCHOR_STATUSES,
      rowId: row.id
    })
  }
  if (!isValidAnchorStatus(row.new_status)) {
    throw new InvalidStatusError({
      entity: "invalidation_log.new_status",
      status: row.new_status,
      validStatuses: ANCHOR_STATUSES,
      rowId: row.id
    })
  }
  if (!isValidInvalidationSource(row.detected_by)) {
    throw new InvalidStatusError({
      entity: "invalidation_log.detected_by",
      status: row.detected_by,
      validStatuses: INVALIDATION_SOURCES,
      rowId: row.id
    })
  }
  return {
    id: row.id,
    anchorId: row.anchor_id,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    reason: row.reason,
    detectedBy: row.detected_by,
    oldContentHash: row.old_content_hash,
    newContentHash: row.new_content_hash,
    similarityScore: row.similarity_score,
    invalidatedAt: parseDate(row.invalidated_at, "invalidated_at", row.id)
  }
}
