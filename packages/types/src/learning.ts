/**
 * Learning types for tx
 *
 * Type definitions for the contextual learnings system.
 * See PRD-010 and DD-010 for specification.
 * Zero runtime dependencies - pure TypeScript types only.
 */

import type { EdgeType } from "./edge.js"

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
  /** LLM reranker score (0-1, optional - only present when reranking is applied) */
  readonly rerankerScore?: number;
  /** Number of hops from seed (0 = direct match from RRF, 1+ = expanded via graph) */
  readonly expansionHops?: number;
  /** Path of learning IDs from seed to this learning (only for expanded results) */
  readonly expansionPath?: readonly LearningId[];
  /** Edge type that led to this learning (null for direct matches) */
  readonly sourceEdge?: EdgeType | null;
  /** Feedback score from historical usage (0-1, 0.5 = neutral, optional) */
  readonly feedbackScore?: number;
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
 * Options for graph expansion during search.
 * See PRD-016 for specification.
 */
export interface GraphExpansionQueryOptions {
  /** Enable graph expansion (default: false) */
  readonly enabled: boolean;
  /** Maximum traversal depth (default: 2) */
  readonly depth?: number;
  /** Score decay factor per hop (default: 0.7) */
  readonly decayFactor?: number;
  /** Maximum nodes to return from expansion (default: 100) */
  readonly maxNodes?: number;
  /** Filter by specific edge types (default: all types) */
  readonly edgeTypes?: readonly EdgeType[];
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
  /** Graph expansion options for traversing related learnings */
  readonly graphExpansion?: GraphExpansionQueryOptions;
}

/**
 * Options for context retrieval.
 */
export interface ContextOptions {
  /** Enable graph expansion (default: false) */
  readonly useGraph?: boolean;
  /** Graph expansion depth (default: 2 per PRD-016) */
  readonly expansionDepth?: number;
  /** Edge types to include in expansion */
  readonly edgeTypes?: readonly EdgeType[];
  /** Maximum number of learnings to return (default: 10) */
  readonly maxTokens?: number;
}

/**
 * Statistics about graph expansion during context retrieval.
 */
export interface GraphExpansionStats {
  readonly enabled: boolean;
  readonly seedCount: number;
  readonly expandedCount: number;
  readonly maxDepthReached: number;
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
  /** Graph expansion statistics (only present when useGraph=true) */
  readonly graphExpansion?: GraphExpansionStats;
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
 * Options for MMR (Maximal Marginal Relevance) diversification.
 * Balances relevance with diversity to avoid redundant results.
 * See PRD-017 for specification.
 */
export interface DiversificationOptions {
  /** Enable MMR diversification (default: false) */
  readonly enabled?: boolean;
  /** Trade-off between relevance (1.0) and diversity (0.0) (default: 0.7) */
  readonly lambda?: number;
  /** Maximum results per category for top 5 results (default: 2) */
  readonly maxPerCategory?: number;
}

/**
 * Options for retrieval operations.
 * Used by RetrieverService.search() and custom retrievers.
 */
export interface RetrievalOptions {
  /** Maximum number of results to return (default: 10) */
  readonly limit?: number;
  /** Minimum relevance score threshold (default: 0.1) */
  readonly minScore?: number;
  /** Optional category filter */
  readonly category?: string;
  /** Optional source type filter */
  readonly sourceType?: LearningSourceType;
  /** Graph expansion options for traversing related learnings */
  readonly graphExpansion?: GraphExpansionQueryOptions;
  /** MMR diversification options for result variety */
  readonly diversification?: DiversificationOptions;
}

/**
 * Learning row with BM25 score from FTS5 query.
 */
export interface LearningRowWithBM25 extends LearningRow {
  bm25_score: number;
}
