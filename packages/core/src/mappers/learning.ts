/**
 * Learning mappers - convert database rows to domain objects
 */

import { Schema } from "effect"
import type {
  Learning,
  LearningId,
  LearningSourceType,
  LearningRow
} from "@jamesaphoenix/tx-types"

/**
 * Schema for keywords - an array of strings.
 * Used to validate JSON.parse output before casting to string[].
 */
const KeywordsSchema = Schema.Array(Schema.String)

/**
 * Safely parse and validate keywords JSON string.
 * Returns empty array if parsing fails or validation fails.
 */
const parseKeywords = (keywordsJson: string | null): string[] => {
  if (!keywordsJson) return []

  try {
    const parsed: unknown = JSON.parse(keywordsJson)
    const result = Schema.decodeUnknownSync(KeywordsSchema)(parsed)
    // Spread to convert readonly array to mutable array
    return [...result]
  } catch {
    // Return empty array on parse error or validation failure
    return []
  }
}

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
 *
 * OPTIMIZATION: Uses a view on the existing buffer when byte offset is aligned
 * to avoid allocating a copy. This significantly reduces memory usage when
 * loading many learnings with embeddings (e.g., in RetrieverService.findWithEmbeddings).
 *
 * Float32Array requires 4-byte alignment. When the buffer's byteOffset is aligned,
 * we create a view directly on the underlying ArrayBuffer. Otherwise, we fall back
 * to creating a copy.
 */
const bufferToFloat32Array = (buffer: Buffer): Float32Array => {
  // Check if byte offset is 4-byte aligned (required for Float32Array)
  if (buffer.byteOffset % 4 === 0) {
    // Create a view directly on the buffer's ArrayBuffer - no copy!
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
  }

  // Fallback: byte offset not aligned, must copy to a new ArrayBuffer
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
  keywords: parseKeywords(row.keywords),
  category: row.category,
  usageCount: row.usage_count,
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
  outcomeScore: row.outcome_score,
  embedding: row.embedding ? bufferToFloat32Array(row.embedding) : null
})
