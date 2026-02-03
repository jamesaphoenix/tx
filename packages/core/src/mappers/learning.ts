/**
 * Learning mappers - convert database rows to domain objects
 */

import type {
  Learning,
  LearningId,
  LearningSourceType,
  LearningRow
} from "@jamesaphoenix/tx-types"

// Re-export types and constants from @tx/types for convenience
export type { LearningRow } from "@jamesaphoenix/tx-types"
export { LEARNING_SOURCE_TYPES } from "@jamesaphoenix/tx-types"

/**
 * Check if a string is a valid LearningSourceType.
 */
export const isValidSourceType = (s: string): s is LearningSourceType => {
  const sources: readonly string[] = ["compaction", "run", "manual", "claude_md"]
  return sources.includes(s)
}

/**
 * Convert a SQLite BLOB (Buffer) to Float32Array.
 */
const bufferToFloat32Array = (buffer: Buffer): Float32Array => {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  )
  return new Float32Array(arrayBuffer)
}

/**
 * Convert Float32Array to Buffer for SQLite storage.
 */
export const float32ArrayToBuffer = (arr: Float32Array): Buffer => {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

/**
 * Convert a database row to a Learning domain object.
 */
export const rowToLearning = (row: LearningRow): Learning => ({
  id: row.id as LearningId,
  content: row.content,
  sourceType: row.source_type as LearningSourceType,
  sourceRef: row.source_ref,
  createdAt: new Date(row.created_at),
  keywords: row.keywords ? JSON.parse(row.keywords) : [],
  category: row.category,
  usageCount: row.usage_count,
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
  outcomeScore: row.outcome_score,
  embedding: row.embedding ? bufferToFloat32Array(row.embedding) : null
})
