import { Context, Effect, Layer, Option } from "effect"
import { LearningRepository, type BM25Result } from "../repo/learning-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { QueryExpansionService } from "./query-expansion-service.js"
import { RerankerService } from "./reranker-service.js"
import { GraphExpansionService, type SeedLearning } from "./graph-expansion.js"
import { RetrievalError, DatabaseError } from "../errors.js"
import type { Learning, LearningWithScore, LearningId, RetrievalOptions } from "@tx/types"
import { cosineSimilarity } from "../utils/math.js"

/** RRF constant - standard value from the original paper */
const RRF_K = 60

/** Default weights for recency (used as boost on top of RRF) */
const DEFAULT_RECENCY_WEIGHT = 0.1
const MAX_AGE_DAYS = 30

/** Boost weights for outcome and frequency */
const OUTCOME_BOOST = 0.05
const FREQUENCY_BOOST = 0.02

/** Position-aware bonuses for items ranking highly in any retrieval system */
const TOP_1_BONUS = 0.05  // Bonus for #1 rank in any system
const TOP_3_BONUS = 0.02  // Bonus for top 3 in any system

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
    ) => Effect.Effect<readonly LearningWithScore[], RetrievalError | DatabaseError>
    /** Check if retrieval functionality is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Calculate recency score (0-1) based on age in days.
 * Newer learnings get higher scores.
 */
const calculateRecencyScore = (createdAt: Date): number => {
  const ageMs = Date.now() - createdAt.getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.max(0, 1 - ageDays / MAX_AGE_DAYS)
}

/**
 * Compute vector similarity scores and return ranked results.
 * Rank is 1-indexed (1 = best match).
 */
const computeVectorRanking = (
  learnings: readonly Learning[],
  queryEmbedding: Float32Array | null
): { learning: Learning; score: number; rank: number }[] => {
  if (!queryEmbedding) {
    return []
  }

  const withScores = learnings
    .filter(l => l.embedding !== null)
    .map(learning => {
      const similarity = cosineSimilarity(queryEmbedding, learning.embedding!)
      // Normalize cosine similarity from [-1, 1] to [0, 1]
      const score = (similarity + 1) / 2
      return { learning, score }
    })
    .sort((a, b) => b.score - a.score)

  // Add 1-indexed ranks
  return withScores.map((item, idx) => ({
    ...item,
    rank: idx + 1
  }))
}

/**
 * Reciprocal Rank Fusion (RRF) score calculation.
 * Formula: RRF(d) = Σ 1/(k + rank_i(d))
 *
 * k is a constant (typically 60) that determines how much to weight
 * items that appear in multiple lists vs items that rank highly in one list.
 *
 * @param k - RRF constant (default 60)
 * @param ranks - Array of ranks (1-indexed, 0 means not present in that list)
 */
const rrfScore = (k: number, ...ranks: number[]): number => {
  return ranks.reduce((sum, rank) => {
    if (rank === 0) return sum // Not present in this list
    return sum + 1 / (k + rank)
  }, 0)
}

/**
 * Interface for intermediate RRF computation results.
 */
interface RRFCandidate {
  learning: Learning
  bm25Score: number
  bm25Rank: number
  vectorScore: number
  vectorRank: number
  rrfScore: number
  recencyScore: number
}

/**
 * Combine BM25 and vector search results using Reciprocal Rank Fusion (RRF).
 *
 * RRF is a robust method for combining ranked lists that:
 * 1. Does not require score normalization
 * 2. Works well when combining different retrieval systems
 * 3. Is robust to outliers and different score distributions
 *
 * The final relevance score combines:
 * - RRF score from BM25 and vector rankings
 * - Recency boost for newer learnings
 * - Outcome boost for learnings marked as helpful
 * - Frequency boost for frequently retrieved learnings
 */
const computeRRFScoring = (
  bm25Results: readonly BM25Result[],
  vectorRanking: { learning: Learning; score: number; rank: number }[]
): RRFCandidate[] => {
  // Build lookup maps for quick access
  const bm25Map = new Map<number, { score: number; rank: number }>()
  bm25Results.forEach((result, idx) => {
    bm25Map.set(result.learning.id, { score: result.score, rank: idx + 1 })
  })

  const vectorMap = new Map<number, { score: number; rank: number }>()
  vectorRanking.forEach(item => {
    vectorMap.set(item.learning.id, { score: item.score, rank: item.rank })
  })

  // Collect all unique learnings from both sources
  const allLearnings = new Map<number, Learning>()
  for (const result of bm25Results) {
    allLearnings.set(result.learning.id, result.learning)
  }
  for (const item of vectorRanking) {
    allLearnings.set(item.learning.id, item.learning)
  }

  // Compute RRF scores for all candidates
  const candidates: RRFCandidate[] = []
  for (const [id, learning] of allLearnings) {
    const bm25Info = bm25Map.get(id)
    const vectorInfo = vectorMap.get(id)

    const bm25Rank = bm25Info?.rank ?? 0
    const vectorRank = vectorInfo?.rank ?? 0
    const bm25Score = bm25Info?.score ?? 0
    const vectorScore = vectorInfo?.score ?? 0
    const recencyScore = calculateRecencyScore(learning.createdAt)

    const rrf = rrfScore(RRF_K, bm25Rank, vectorRank)

    candidates.push({
      learning,
      bm25Score,
      bm25Rank,
      vectorScore,
      vectorRank,
      rrfScore: rrf,
      recencyScore
    })
  }

  // Sort by RRF score (descending)
  return candidates.sort((a, b) => b.rrfScore - a.rrfScore)
}

/**
 * Calculate position-aware bonus based on best rank across retrieval systems.
 * Items ranking #1 in any system get a larger bonus; top 3 get a smaller one.
 *
 * @param ranks - Array of ranks (1-indexed, 0 means not present in that system)
 * @returns Position bonus to add to the score
 */
const calculatePositionBonus = (...ranks: number[]): number => {
  // Filter out zeros (not present in that ranking)
  const validRanks = ranks.filter(r => r > 0)
  if (validRanks.length === 0) return 0

  const bestRank = Math.min(...validRanks)

  if (bestRank === 1) return TOP_1_BONUS     // #1 in any system
  if (bestRank <= 3) return TOP_3_BONUS      // Top 3 in any system
  return 0
}

/**
 * Convert RRF candidates to final LearningWithScore results.
 * Applies additional boosts for recency, outcome, frequency, and position.
 */
const applyFinalScoring = (
  candidates: RRFCandidate[],
  recencyWeight: number
): LearningWithScore[] => {
  return candidates.map(candidate => {
    const { learning, bm25Score, bm25Rank, vectorScore, vectorRank, rrfScore: rrf, recencyScore } = candidate

    // Outcome boost: if learning has been marked helpful, boost it
    const outcomeBoost = learning.outcomeScore !== null
      ? OUTCOME_BOOST * learning.outcomeScore
      : 0

    // Frequency boost: learnings that have been retrieved more get a small boost
    const frequencyBoost = FREQUENCY_BOOST * Math.log(1 + learning.usageCount)

    // Position-aware bonus: reward items that rank highly in any retrieval system
    const positionBonus = calculatePositionBonus(bm25Rank, vectorRank)

    // Final relevance score: RRF as base + boosts
    // RRF score range is [0, 2/k] for two lists, normalize to [0, 1] range
    // Max possible RRF = 2 * 1/(k+1) ≈ 0.0328 for k=60
    // Normalize: multiply by (k+1)/2 to get ~[0, 1]
    const normalizedRRF = rrf * (RRF_K + 1) / 2

    const relevanceScore = normalizedRRF +
                           recencyWeight * recencyScore +
                           outcomeBoost +
                           frequencyBoost +
                           positionBonus

    return {
      ...learning,
      relevanceScore,
      bm25Score,
      vectorScore,
      recencyScore,
      rrfScore: rrf,
      bm25Rank,
      vectorRank
    }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)
}

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

          // Get all learnings that have embeddings for vector ranking
          const learningsWithEmbeddings = yield* learningRepo.findWithEmbeddings(limit * 3)

          // Compute vector ranking (ranked list 2)
          const vectorRanking = computeVectorRanking(learningsWithEmbeddings, queryEmbeddingValue)

          // Combine using RRF
          const candidates = computeRRFScoring(bm25Results, vectorRanking)

          // Apply final scoring with boosts
          const scored = applyFinalScoring(candidates, recencyWeight)

          // Apply graph expansion if enabled (after initial RRF scoring)
          const withGraphExpansion = yield* applyGraphExpansion(scored, options ?? {})

          // Apply LLM re-ranking to top candidates for improved precision
          // Only re-rank a reasonable number of candidates to balance quality vs latency
          const topCandidates = withGraphExpansion.slice(0, Math.min(limit * 2, 20))
          const reranked = yield* applyReranking(query, topCandidates)

          // Filter by minimum score and limit
          return reranked
            .filter(r => r.relevanceScore >= minScore)
            .slice(0, limit)
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)

/**
 * Auto-detecting layer that always uses Live since BM25 is always available.
 * The Live implementation gracefully degrades vector search when embeddings
 * are unavailable, so Auto just delegates to Live.
 */
export const RetrieverServiceAuto = RetrieverServiceLive
