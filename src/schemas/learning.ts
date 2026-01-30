// Learning types for the contextual learnings system
// See PRD-010 and DD-010 for specification

export const LEARNING_SOURCE_TYPES = [
  "compaction", "run", "manual", "claude_md"
] as const

export type LearningSourceType = typeof LEARNING_SOURCE_TYPES[number]

export type LearningId = number & { readonly _brand: unique symbol }

export interface Learning {
  readonly id: LearningId
  readonly content: string
  readonly sourceType: LearningSourceType
  readonly sourceRef: string | null
  readonly createdAt: Date
  readonly keywords: string[]
  readonly category: string | null
  readonly usageCount: number
  readonly lastUsedAt: Date | null
  readonly outcomeScore: number | null
  readonly embedding: Float32Array | null
}

export interface LearningWithScore extends Learning {
  readonly relevanceScore: number
  readonly bm25Score: number
  readonly vectorScore: number
  readonly recencyScore: number
}

export interface CreateLearningInput {
  readonly content: string
  readonly sourceType?: LearningSourceType
  readonly sourceRef?: string | null
  readonly keywords?: string[]
  readonly category?: string | null
}

export interface UpdateLearningInput {
  readonly usageCount?: number
  readonly lastUsedAt?: Date
  readonly outcomeScore?: number
  readonly embedding?: Float32Array
}

export interface LearningQuery {
  readonly query: string
  readonly limit?: number
  readonly minScore?: number
  readonly category?: string
  readonly sourceType?: LearningSourceType
}

export interface ContextResult {
  readonly taskId: string
  readonly taskTitle: string
  readonly learnings: readonly LearningWithScore[]
  readonly searchQuery: string
  readonly searchDuration: number
}

export interface LearningSearchResult {
  readonly learnings: readonly Learning[]
  readonly query: string
  readonly searchDuration: number
}

// DB row type (snake_case from SQLite)
export interface LearningRow {
  id: number
  content: string
  source_type: string
  source_ref: string | null
  created_at: string
  keywords: string | null
  category: string | null
  usage_count: number
  last_used_at: string | null
  outcome_score: number | null
  embedding: Buffer | null
}

// Row with BM25 score from FTS5 query
export interface LearningRowWithBM25 extends LearningRow {
  bm25_score: number
}

export const isValidSourceType = (s: string): s is LearningSourceType =>
  LEARNING_SOURCE_TYPES.includes(s as LearningSourceType)

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

// Helper to convert SQLite BLOB (Buffer) to Float32Array
const bufferToFloat32Array = (buffer: Buffer): Float32Array => {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  )
  return new Float32Array(arrayBuffer)
}

// Helper to convert Float32Array to Buffer for SQLite storage
export const float32ArrayToBuffer = (arr: Float32Array): Buffer => {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}
