import { Context, Effect, Layer, Option } from "effect"
import { LearningRepository, type BM25Result } from "../repo/learning-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { QueryExpansionService } from "./query-expansion-service.js"
import { RerankerService } from "./reranker-service.js"
import { GraphExpansionService, type SeedLearning } from "./graph-expansion.js"
import { FeedbackTrackerService } from "./feedback-tracker.js"
import { DiversifierService } from "./diversifier-service.js"
import { RetrievalError, DatabaseError, EmbeddingDimensionMismatchError, ZeroMagnitudeVectorError } from "../errors.js"
import type { Learning, LearningWithScore, LearningId, RetrievalOptions } from "@jamesaphoenix/tx-types"
import {
  DEFAULT_RECENCY_WEIGHT,
  MAX_VECTOR_CANDIDATES,
  applyFinalScoring,
  calculatePositionBonus,
  calculateRecencyScore,
  computeRRFScoring,
  computeVectorRanking,
} from "./retriever-scoring.js"

/**
 * RetrieverService provides pluggable retrieval for learnings.
 *
 * Design: PRD-015 specifies retrieval should be pluggable with good defaults.
 * Users can swap out the default BM25+vector+RRF pipeline for their own
 * implementation (Pinecone, Weaviate, Chroma, etc.).
 */
export class RetrieverService extends Context.Tag("RetrieverService")<
  RetrieverService,
  {
    /**
     * Search for learnings matching a query.
     * Returns scored results sorted by relevance (highest first).
     */
    readonly search: (
      query: string,
      options?: RetrievalOptions
    ) => Effect.Effect<readonly LearningWithScore[], RetrievalError | DatabaseError | EmbeddingDimensionMismatchError | ZeroMagnitudeVectorError>
    /** Check if retrieval functionality is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}


/**
 * Noop fallback - returns empty results.
 * Used when retrieval is disabled or for testing without full pipeline.
 */
export const RetrieverServiceNoop = Layer.succeed(
  RetrieverService,
  {
    search: (_query, _options) => Effect.succeed([]),
    isAvailable: () => Effect.succeed(false)
  }
)

/**
 * Live implementation with BM25 + vector + RRF pipeline.
 * Uses the default hybrid search with:
 * - Query expansion via LLM
 * - BM25 full-text search
 * - Vector similarity (when embeddings available)
 * - RRF fusion
 * - Optional LLM re-ranking
 * - Recency/outcome/frequency boosts
 */
export const RetrieverServiceLive = Layer.effect(
  RetrieverService,
  Effect.gen(function* () {
    const learningRepo = yield* LearningRepository
    const embeddingService = yield* EmbeddingService
    const queryExpansionService = yield* QueryExpansionService
    const rerankerService = yield* RerankerService
    // GraphExpansionService is optional - graceful degradation when not available
    const graphExpansionServiceOption = yield* Effect.serviceOption(GraphExpansionService)
    const graphExpansionService = Option.getOrNull(graphExpansionServiceOption)
    // FeedbackTrackerService is optional - graceful degradation when not available
    const feedbackTrackerServiceOption = yield* Effect.serviceOption(FeedbackTrackerService)
    const feedbackTrackerService = Option.getOrNull(feedbackTrackerServiceOption)
    // DiversifierService is optional - graceful degradation when not available
    const diversifierServiceOption = yield* Effect.serviceOption(DiversifierService)
    const diversifierService = Option.getOrNull(diversifierServiceOption)

    // Load recency weight from config
    const recencyWeightStr = yield* learningRepo.getConfig("recency_weight")
    const recencyWeight = recencyWeightStr ? parseFloat(recencyWeightStr) : DEFAULT_RECENCY_WEIGHT

    /**
     * Apply LLM re-ranking to scored learnings with position-aware blending.
     * Re-ranking uses a specialized model to improve precision.
     * Position-aware blending gives bonuses to items that rank highly
     * across multiple retrieval systems (BM25, vector, AND reranker).
     * Gracefully degrades if reranker is unavailable.
     */
    const applyReranking = (
      query: string,
      learnings: LearningWithScore[],
      rerankerWeight = 0.3
    ) =>
      Effect.gen(function* () {
        // Check if reranker is available
        const isAvailable = yield* rerankerService.isAvailable()
        if (!isAvailable || learnings.length === 0) {
          return learnings
        }

        // Extract document contents for reranking
        const documents = learnings.map(l => l.content)

        // Get reranker scores (graceful degradation on error)
        const reranked = yield* Effect.catchAll(
          rerankerService.rerank(query, documents),
          () => Effect.succeed(null)
        )

        if (!reranked) {
          return learnings
        }

        // Create maps of content to reranker score and rank
        const rerankerScores = new Map<string, number>()
        const rerankerRanks = new Map<string, number>()
        reranked.forEach((result, idx) => {
          rerankerScores.set(result.document, result.score)
          rerankerRanks.set(result.document, idx + 1) // 1-indexed rank
        })

        // Blend reranker scores with existing relevance scores using position-aware bonuses
        // Formula: final = (1 - weight) * existing + weight * reranker + positionBonus
        return learnings.map(learning => {
          const rerankerScore = rerankerScores.get(learning.content) ?? 0
          const rerankerRank = rerankerRanks.get(learning.content) ?? 0

          // Calculate position bonus across all three systems (BM25, vector, reranker)
          const positionBonus = calculatePositionBonus(
            learning.bm25Rank,
            learning.vectorRank,
            rerankerRank
          )

          // Weighted blend plus position-aware bonus
          const blendedScore = (1 - rerankerWeight) * learning.relevanceScore +
                               rerankerWeight * rerankerScore +
                               positionBonus

          return {
            ...learning,
            relevanceScore: blendedScore,
            rerankerScore // Add reranker score to output
          }
        }).sort((a, b) => b.relevanceScore - a.relevanceScore)
      })

    /**
     * Perform BM25 search across multiple queries and merge results.
     * Uses RRF to combine rankings from each query.
     */
    const multiQueryBM25Search = (queries: readonly string[], limit: number) =>
      Effect.gen(function* () {
        // Search for each query
        const allResults: BM25Result[][] = []
        for (const query of queries) {
          const results = yield* learningRepo.bm25Search(query, limit)
          allResults.push([...results])
        }

        // Merge results using best rank across all queries
        const learningRanks = new Map<number, { learning: Learning; bestRank: number; bestScore: number }>()

        for (const results of allResults) {
          results.forEach((result, idx) => {
            const rank = idx + 1
            const existing = learningRanks.get(result.learning.id)
            if (!existing || rank < existing.bestRank) {
              learningRanks.set(result.learning.id, {
                learning: result.learning,
                bestRank: rank,
                bestScore: result.score
              })
            }
          })
        }

        // Convert to BM25Result format, sorted by best rank
        const merged = [...learningRanks.values()]
          .sort((a, b) => a.bestRank - b.bestRank)
          .map(item => ({ learning: item.learning, score: item.bestScore }))

        return merged
      })

    /**
     * Apply graph expansion to seed learnings and merge with existing results.
     * Gracefully degrades if expansion fails or GraphExpansionService is unavailable.
     */
    const applyGraphExpansion = (
      seeds: LearningWithScore[],
      options: RetrievalOptions
    ) =>
      Effect.gen(function* () {
        const graphOpts = options.graphExpansion
        // Skip if not enabled, no seeds, or GraphExpansionService unavailable
        if (!graphOpts?.enabled || seeds.length === 0 || !graphExpansionService) {
          return seeds
        }

        // Convert top-k seeds to SeedLearning format for expansion
        const seedCount = Math.min(seeds.length, 10) // Default top-k seeds
        const seedLearnings: SeedLearning[] = seeds.slice(0, seedCount).map(s => ({
          learning: s,
          score: s.relevanceScore
        }))

        // Perform graph expansion (graceful degradation on error)
        const expansionResult = yield* Effect.catchAll(
          graphExpansionService.expand(seedLearnings, {
            depth: graphOpts.depth ?? 2,
            decayFactor: graphOpts.decayFactor ?? 0.7,
            maxNodes: graphOpts.maxNodes ?? 100,
            edgeTypes: graphOpts.edgeTypes
          }),
          () => Effect.succeed(null)
        )

        if (!expansionResult) {
          // Graph expansion failed, return original seeds with hops=0
          return seeds.map(s => ({
            ...s,
            expansionHops: 0,
            expansionPath: [s.id],
            sourceEdge: null
          }))
        }

        // Create a set of seed IDs to track which learnings are direct matches
        const seedIds = new Set(seeds.map(s => s.id))

        // Mark seed learnings with expansion metadata (hops=0)
        const seedsWithMeta: LearningWithScore[] = seeds.map(s => ({
          ...s,
          expansionHops: 0,
          expansionPath: [s.id],
          sourceEdge: null
        }))

        // Convert expanded learnings to LearningWithScore format
        // Only include learnings that aren't already in the seed set (avoid duplicates)
        const expandedWithScores: LearningWithScore[] = expansionResult.expanded
          .filter(e => !seedIds.has(e.learning.id))
          .map(e => ({
            ...e.learning,
            relevanceScore: e.decayedScore,
            bm25Score: 0,
            vectorScore: 0,
            recencyScore: calculateRecencyScore(e.learning.createdAt),
            rrfScore: 0,
            bm25Rank: 0,
            vectorRank: 0,
            expansionHops: e.hops,
            expansionPath: e.path as readonly LearningId[],
            sourceEdge: e.sourceEdge
          }))

        // Merge seeds and expanded, sort by relevance score
        const merged = [...seedsWithMeta, ...expandedWithScores]
          .sort((a, b) => b.relevanceScore - a.relevanceScore)

        return merged
      })

    return {
      search: (query, options) =>
        Effect.gen(function* () {
          const { limit = 10, minScore = 0.1 } = options ?? {}

          // Expand query using LLM (graceful degradation - returns original if unavailable)
          const expansionResult = yield* Effect.catchAll(
            queryExpansionService.expand(query),
            () => Effect.succeed({ original: query, expanded: [query], wasExpanded: false })
          )

          // Get BM25 search results across all expanded queries (ranked list 1)
          const bm25Results = yield* multiQueryBM25Search(expansionResult.expanded, limit * 3)

          // Try to get query embedding for vector search (graceful degradation)
          // Use original query for embedding since expanded queries may be noisier
          const queryEmbedding = yield* Effect.option(embeddingService.embed(query))
          const queryEmbeddingValue = Option.getOrNull(queryEmbedding)

          // Get learnings with embeddings for vector ranking, capped to prevent linear scan
          const vectorCandidateLimit = Math.min(limit * 3, MAX_VECTOR_CANDIDATES)
          const learningsWithEmbeddings = yield* learningRepo.findWithEmbeddings(vectorCandidateLimit)

          // Compute vector ranking (ranked list 2)
          // Dimension mismatches fail fast - indicates misconfigured embedding provider
          const vectorRanking = yield* computeVectorRanking(learningsWithEmbeddings, queryEmbeddingValue)

          // Combine using RRF
          const candidates = computeRRFScoring(bm25Results, vectorRanking)

          // Fetch feedback scores for all candidates in a single batch (graceful degradation)
          let feedbackScores: ReadonlyMap<number, number> | undefined
          if (feedbackTrackerService && candidates.length > 0) {
            const learningIds = candidates.map(c => c.learning.id)
            feedbackScores = yield* Effect.catchAll(
              feedbackTrackerService.getFeedbackScores(learningIds),
              () => Effect.succeed(new Map(learningIds.map(id => [id, 0.5])) as ReadonlyMap<number, number>)
            )
          }

          // Apply final scoring with boosts (including feedback)
          const scored = applyFinalScoring(candidates, recencyWeight, feedbackScores)

          // Apply graph expansion if enabled (after initial RRF scoring)
          const withGraphExpansion = yield* applyGraphExpansion(scored, options ?? {})

          // Apply LLM re-ranking to top candidates for improved precision
          // Only re-rank a reasonable number of candidates to balance quality vs latency
          const topCandidates = withGraphExpansion.slice(0, Math.min(limit * 2, 20))
          const reranked = yield* applyReranking(query, topCandidates)

          // Apply MMR diversification if enabled (after reranking, before final filtering)
          // Pipeline: query expansion → BM25 → vector → RRF → graph expansion → reranking → DIVERSIFICATION → filter+limit
          const diversifyOpts = options?.diversification
          const diversified = (diversifyOpts?.enabled && diversifierService)
            ? yield* Effect.catchAll(
                diversifierService.mmrDiversify(reranked, limit * 2, diversifyOpts.lambda ?? 0.7),
                () => Effect.succeed(reranked)
              )
            : reranked

          // Filter by minimum score and limit
          return diversified
            .filter(r => r.relevanceScore >= minScore)
            .slice(0, limit)
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)

/**
 * Auto-detecting layer that always uses Live since BM25 is always available.
 * The Live implementation gracefully degrades:
 * - Vector search skips when EmbeddingService unavailable
 * - Query expansion skips when QueryExpansionService unavailable
 * - Reranking skips when RerankerService unavailable
 * - Graph expansion skips when GraphExpansionService unavailable
 */
export const RetrieverServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    // Always use Live since BM25 is always available.
    // The Live implementation gracefully degrades when optional services
    // (embeddings, query expansion, reranking, graph expansion) are unavailable.
    yield* Effect.logDebug("RetrieverService: Using Live (BM25 always available, other features gracefully degrade)")
    return RetrieverServiceLive
  })
)
