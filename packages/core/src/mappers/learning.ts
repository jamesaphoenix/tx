/**
 * Learning mappers - convert database rows to domain objects
 */

import { Schema } from "effect"
import type {
  Learning,
  LearningSourceType,
  LearningRow
} from "../types/index.js"
import { LEARNING_SOURCE_TYPES } from "../types/index.js"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"
import { coerceDbResult } from "../utils/db-result.js"

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
export type { LearningRow } from "../types/index.js"
export { LEARNING_SOURCE_TYPES }

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
 * Always copies the bytes into a fresh ArrayBuffer. A Float32Array view onto
 * the SQLite/Node buffer (`new Float32Array(buffer.buffer, ...)`) aliases
 * pooled memory: Node backs small Buffers (<= 4KB, i.e. <= 1024 floats — which
 * covers typical 384/768-dim embeddings) with a shared pool ArrayBuffer that
 * may be reused while the returned vector is still referenced (e.g. across the
 * rows of RetrieverService.findWithEmbeddings), silently corrupting embeddings
 * and the cosine-similarity ranking computed from them. The memory.ts mapper
 * copies for the same reason; keep these consistent.
 */
const bufferToFloat32Array = (buffer: Buffer): Float32Array => {
  const copy = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(copy).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  return new Float32Array(copy)
}

/**
 * Convert Float32Array to Buffer for SQLite storage.
 */
export const float32ArrayToBuffer = (arr: Float32Array): Buffer => {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

/**
 * Convert a database row to a Learning domain object.
 * Validates source_type at runtime.
 */
export const rowToLearning = (row: LearningRow): Learning => {
  if (!isValidSourceType(row.source_type)) {
    throw new InvalidStatusError({
      entity: "learning",
      status: row.source_type,
      validStatuses: LEARNING_SOURCE_TYPES,
      rowId: row.id
    })
  }
  return {
    id: coerceDbResult<Learning["id"]>(row.id),
    content: row.content,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    createdAt: parseDate(row.created_at, "created_at", row.id),
    keywords: parseKeywords(row.keywords),
    category: row.category,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at ? parseDate(row.last_used_at, "last_used_at", row.id) : null,
    outcomeScore: row.outcome_score,
    embedding: row.embedding ? coerceDbResult<Float32Array<ArrayBuffer>>(bufferToFloat32Array(row.embedding)) : null
  }
}

/**
 * Convert a database row to a Learning domain object WITHOUT deserializing the embedding.
 * Use this for code paths that discard the embedding (MCP serialization, API responses, BM25 search).
 * Avoids allocating Float32Array buffers (~6KB per learning) that would be immediately GC'd.
 */
export const rowToLearningWithoutEmbedding = (row: Omit<LearningRow, "embedding">): Learning => {
  if (!isValidSourceType(row.source_type)) {
    throw new InvalidStatusError({
      entity: "learning",
      status: row.source_type,
      validStatuses: LEARNING_SOURCE_TYPES,
      rowId: row.id
    })
  }
  return {
    id: coerceDbResult<Learning["id"]>(row.id),
    content: row.content,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    createdAt: parseDate(row.created_at, "created_at", row.id),
    keywords: parseKeywords(row.keywords),
    category: row.category,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at ? parseDate(row.last_used_at, "last_used_at", row.id) : null,
    outcomeScore: row.outcome_score,
    embedding: null
  }
}
