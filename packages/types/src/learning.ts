/**
 * Learning types for tx
 *
 * Type definitions for the contextual learnings system.
 * See PRD-010 and DD-010 for specification.
 * Zero runtime dependencies - pure TypeScript types only.
 */

/**
 * Valid learning source types.
 */
export const LEARNING_SOURCE_TYPES = [
  "compaction",
  "run",
  "manual",
  "claude_md",
] as const;

/**
 * Learning source type - where the learning came from.
 */
export type LearningSourceType = (typeof LEARNING_SOURCE_TYPES)[number];

/**
 * Branded type for learning IDs.
 */
export type LearningId = number & { readonly _brand: unique symbol };

/**
 * Core learning entity.
 */
export interface Learning {
  readonly id: LearningId;
  readonly content: string;
  readonly sourceType: LearningSourceType;
  readonly sourceRef: string | null;
  readonly createdAt: Date;
  readonly keywords: string[];
  readonly category: string | null;
  readonly usageCount: number;
  readonly lastUsedAt: Date | null;
  readonly outcomeScore: number | null;
  readonly embedding: Float32Array | null;
}

/**
 * Learning with relevance scoring from search results.
 */
export interface LearningWithScore extends Learning {
  readonly relevanceScore: number;
  readonly bm25Score: number;
  readonly vectorScore: number;
  readonly recencyScore: number;
  /** RRF (Reciprocal Rank Fusion) score from combining BM25 and vector rankings */
  readonly rrfScore: number;
  /** Rank in BM25 results (1-indexed, 0 if not in BM25 results) */
  readonly bm25Rank: number;
  /** Rank in vector similarity results (1-indexed, 0 if not in vector results) */
  readonly vectorRank: number;
}

/**
 * Input for creating a new learning.
 */
export interface CreateLearningInput {
  readonly content: string;
  readonly sourceType?: LearningSourceType;
  readonly sourceRef?: string | null;
  readonly keywords?: string[];
  readonly category?: string | null;
}

/**
 * Input for updating an existing learning.
 */
export interface UpdateLearningInput {
  readonly usageCount?: number;
  readonly lastUsedAt?: Date;
  readonly outcomeScore?: number;
  readonly embedding?: Float32Array;
}

/**
 * Query options for learning searches.
 */
export interface LearningQuery {
  readonly query: string;
  readonly limit?: number;
  readonly minScore?: number;
  readonly category?: string;
  readonly sourceType?: LearningSourceType;
}

/**
 * Result of context retrieval for a task.
 */
export interface ContextResult {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly learnings: readonly LearningWithScore[];
  readonly searchQuery: string;
  readonly searchDuration: number;
}

/**
 * Result of a learning search operation.
 */
export interface LearningSearchResult {
  readonly learnings: readonly Learning[];
  readonly query: string;
  readonly searchDuration: number;
}

/**
 * Database row type for learnings (snake_case from SQLite).
 */
export interface LearningRow {
  id: number;
  content: string;
  source_type: string;
  source_ref: string | null;
  created_at: string;
  keywords: string | null;
  category: string | null;
  usage_count: number;
  last_used_at: string | null;
  outcome_score: number | null;
  embedding: Buffer | null;
}

/**
 * Learning row with BM25 score from FTS5 query.
 */
export interface LearningRowWithBM25 extends LearningRow {
  bm25_score: number;
}
