/**
 * Learning types for tx
 *
 * Type definitions for the contextual learnings system.
 * See PRD-010 and DD-010 for specification.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"
import { EdgeTypeSchema } from "./edge.js"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Valid learning source types.
 */
export const LEARNING_SOURCE_TYPES = [
  "compaction",
  "run",
  "manual",
  "claude_md",
] as const;

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Learning source type - where the learning came from. */
export const LearningSourceTypeSchema = Schema.Literal(...LEARNING_SOURCE_TYPES)
export type LearningSourceType = typeof LearningSourceTypeSchema.Type

/** Learning ID - branded integer. */
export const LearningIdSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("LearningId")
)
export type LearningId = typeof LearningIdSchema.Type

/** Core learning entity. */
export const LearningSchema = Schema.Struct({
  id: LearningIdSchema,
  content: Schema.String,
  sourceType: LearningSourceTypeSchema,
  sourceRef: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf,
  keywords: Schema.Array(Schema.String),
  category: Schema.NullOr(Schema.String),
  usageCount: Schema.Number.pipe(Schema.int()),
  lastUsedAt: Schema.NullOr(Schema.DateFromSelf),
  outcomeScore: Schema.NullOr(Schema.Number),
  embedding: Schema.NullOr(Schema.instanceOf(Float32Array)),
})
export type Learning = typeof LearningSchema.Type

/** Learning with relevance scoring from search results. */
export const LearningWithScoreSchema = Schema.Struct({
  ...LearningSchema.fields,
  relevanceScore: Schema.Number,
  bm25Score: Schema.Number,
  vectorScore: Schema.Number,
  recencyScore: Schema.Number,
  /** RRF (Reciprocal Rank Fusion) score from combining BM25 and vector rankings */
  rrfScore: Schema.Number,
  /** Rank in BM25 results (1-indexed, 0 if not in BM25 results) */
  bm25Rank: Schema.Number.pipe(Schema.int()),
  /** Rank in vector similarity results (1-indexed, 0 if not in vector results) */
  vectorRank: Schema.Number.pipe(Schema.int()),
  /** LLM reranker score (0-1, optional - only present when reranking is applied) */
  rerankerScore: Schema.optional(Schema.Number),
  /** Number of hops from seed (0 = direct match from RRF, 1+ = expanded via graph) */
  expansionHops: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Path of learning IDs from seed to this learning (only for expanded results) */
  expansionPath: Schema.optional(Schema.Array(LearningIdSchema)),
  /** Edge type that led to this learning (null for direct matches) */
  sourceEdge: Schema.optional(Schema.NullOr(EdgeTypeSchema)),
  /** Feedback score from historical usage (0-1, 0.5 = neutral, optional) */
  feedbackScore: Schema.optional(Schema.Number),
})
export type LearningWithScore = typeof LearningWithScoreSchema.Type

/** Input for creating a new learning. */
export const CreateLearningInputSchema = Schema.Struct({
  content: Schema.String,
  sourceType: Schema.optional(LearningSourceTypeSchema),
  sourceRef: Schema.optional(Schema.NullOr(Schema.String)),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  category: Schema.optional(Schema.NullOr(Schema.String)),
})
export type CreateLearningInput = typeof CreateLearningInputSchema.Type

/** Input for updating an existing learning. */
export const UpdateLearningInputSchema = Schema.Struct({
  usageCount: Schema.optional(Schema.Number.pipe(Schema.int())),
  lastUsedAt: Schema.optional(Schema.DateFromSelf),
  outcomeScore: Schema.optional(Schema.Number),
  embedding: Schema.optional(Schema.instanceOf(Float32Array)),
})
export type UpdateLearningInput = typeof UpdateLearningInputSchema.Type

/** Options for graph expansion during search. See PRD-016. */
export const GraphExpansionQueryOptionsSchema = Schema.Struct({
  /** Enable graph expansion (default: false) */
  enabled: Schema.Boolean,
  /** Maximum traversal depth (default: 2) */
  depth: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Score decay factor per hop (default: 0.7) */
  decayFactor: Schema.optional(Schema.Number),
  /** Maximum nodes to return from expansion (default: 100) */
  maxNodes: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Filter by specific edge types (default: all types) */
  edgeTypes: Schema.optional(Schema.Array(EdgeTypeSchema)),
})
export type GraphExpansionQueryOptions = typeof GraphExpansionQueryOptionsSchema.Type

/** Query options for learning searches. */
export const LearningQuerySchema = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number.pipe(Schema.int())),
  minScore: Schema.optional(Schema.Number),
  category: Schema.optional(Schema.String),
  sourceType: Schema.optional(LearningSourceTypeSchema),
  /** Graph expansion options for traversing related learnings */
  graphExpansion: Schema.optional(GraphExpansionQueryOptionsSchema),
})
export type LearningQuery = typeof LearningQuerySchema.Type

/** Options for context retrieval. */
export const ContextOptionsSchema = Schema.Struct({
  /** Enable graph expansion (default: false) */
  useGraph: Schema.optional(Schema.Boolean),
  /** Graph expansion depth (default: 2 per PRD-016) */
  expansionDepth: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Edge types to include in expansion */
  edgeTypes: Schema.optional(Schema.Array(EdgeTypeSchema)),
  /** Maximum number of learnings to return (default: 10) */
  maxTokens: Schema.optional(Schema.Number.pipe(Schema.int())),
})
export type ContextOptions = typeof ContextOptionsSchema.Type

/** Statistics about graph expansion during context retrieval. */
export const GraphExpansionStatsSchema = Schema.Struct({
  enabled: Schema.Boolean,
  seedCount: Schema.Number.pipe(Schema.int()),
  expandedCount: Schema.Number.pipe(Schema.int()),
  maxDepthReached: Schema.Number.pipe(Schema.int()),
})
export type GraphExpansionStats = typeof GraphExpansionStatsSchema.Type

/** Result of context retrieval for a task. */
export const ContextResultSchema = Schema.Struct({
  taskId: Schema.String,
  taskTitle: Schema.String,
  learnings: Schema.Array(LearningWithScoreSchema),
  searchQuery: Schema.String,
  searchDuration: Schema.Number,
  /** Graph expansion statistics (only present when useGraph=true) */
  graphExpansion: Schema.optional(GraphExpansionStatsSchema),
})
export type ContextResult = typeof ContextResultSchema.Type

/** Result of a learning search operation. */
export const LearningSearchResultSchema = Schema.Struct({
  learnings: Schema.Array(LearningSchema),
  query: Schema.String,
  searchDuration: Schema.Number,
})
export type LearningSearchResult = typeof LearningSearchResultSchema.Type

/** Options for MMR (Maximal Marginal Relevance) diversification. See PRD-017. */
export const DiversificationOptionsSchema = Schema.Struct({
  /** Enable MMR diversification (default: false) */
  enabled: Schema.optional(Schema.Boolean),
  /** Trade-off between relevance (1.0) and diversity (0.0) (default: 0.7) */
  lambda: Schema.optional(Schema.Number),
  /** Maximum results per category for top 5 results (default: 2) */
  maxPerCategory: Schema.optional(Schema.Number.pipe(Schema.int())),
})
export type DiversificationOptions = typeof DiversificationOptionsSchema.Type

/** Options for retrieval operations. Used by RetrieverService.search(). */
export const RetrievalOptionsSchema = Schema.Struct({
  /** Maximum number of results to return (default: 10) */
  limit: Schema.optional(Schema.Number.pipe(Schema.int())),
  /** Minimum relevance score threshold (default: 0.1) */
  minScore: Schema.optional(Schema.Number),
  /** Optional category filter */
  category: Schema.optional(Schema.String),
  /** Optional source type filter */
  sourceType: Schema.optional(LearningSourceTypeSchema),
  /** Graph expansion options for traversing related learnings */
  graphExpansion: Schema.optional(GraphExpansionQueryOptionsSchema),
  /** MMR diversification options for result variety */
  diversification: Schema.optional(DiversificationOptionsSchema),
})
export type RetrievalOptions = typeof RetrievalOptionsSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for learnings (snake_case from SQLite). */
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

/** Learning row with BM25 score from FTS5 query. */
export interface LearningRowWithBM25 extends LearningRow {
  bm25_score: number;
}
