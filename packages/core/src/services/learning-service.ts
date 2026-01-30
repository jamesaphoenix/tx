import { Context, Effect, Layer, Option } from "effect"
import { LearningRepository, type BM25Result } from "../repo/learning-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { QueryExpansionService } from "./query-expansion-service.js"
import { RerankerService } from "./reranker-service.js"
import { LearningNotFoundError, TaskNotFoundError, ValidationError, DatabaseError } from "../errors.js"
import type { Learning, LearningWithScore, CreateLearningInput, LearningQuery, ContextResult } from "@tx/types"

/** Result of embedding operation */
export interface EmbedResult {
  processed: number
  skipped: number
  failed: number
  total: number
}

/** Embedding coverage status */
export interface EmbedStatus {
  total: number
  withEmbeddings: number
  withoutEmbeddings: number
  coveragePercent: number
}

/** RRF constant - standard value from the original paper */
const RRF_K = 60

/** Default weights for recency (used as boost on top of RRF) */
const DEFAULT_RECENCY_WEIGHT = 0.1
const MAX_AGE_DAYS = 30

/** Boost weights for outcome and frequency */
const OUTCOME_BOOST = 0.05
const FREQUENCY_BOOST = 0.02

export class LearningService extends Context.Tag("LearningService")<
  LearningService,
  {
    readonly create: (input: CreateLearningInput) => Effect.Effect<Learning, ValidationError | DatabaseError>
    readonly get: (id: number) => Effect.Effect<Learning, LearningNotFoundError | DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, LearningNotFoundError | DatabaseError>
    readonly search: (query: LearningQuery) => Effect.Effect<readonly LearningWithScore[], DatabaseError>
    readonly getRecent: (limit?: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly recordUsage: (id: number) => Effect.Effect<void, LearningNotFoundError | DatabaseError>
    readonly updateOutcome: (id: number, score: number) => Effect.Effect<void, LearningNotFoundError | ValidationError | DatabaseError>
    readonly getContextForTask: (taskId: string) => Effect.Effect<ContextResult, TaskNotFoundError | DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
    readonly embedAll: (forceAll?: boolean) => Effect.Effect<EmbedResult, DatabaseError>
    readonly embeddingStatus: () => Effect.Effect<EmbedStatus, DatabaseError>
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
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
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
 * Convert RRF candidates to final LearningWithScore results.
 * Applies additional boosts for recency, outcome, and frequency.
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

    // Final relevance score: RRF as base + boosts
    // RRF score range is [0, 2/k] for two lists, normalize to [0, 1] range
    // Max possible RRF = 2 * 1/(k+1) ≈ 0.0328 for k=60
    // Normalize: multiply by (k+1)/2 to get ~[0, 1]
    const normalizedRRF = rrf * (RRF_K + 1) / 2

    const relevanceScore = normalizedRRF +
                           recencyWeight * recencyScore +
                           outcomeBoost +
                           frequencyBoost

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

export const LearningServiceLive = Layer.effect(
  LearningService,
  Effect.gen(function* () {
    const learningRepo = yield* LearningRepository
    const taskRepo = yield* TaskRepository
    const embeddingService = yield* EmbeddingService
    const queryExpansionService = yield* QueryExpansionService
    const rerankerService = yield* RerankerService

    // Load recency weight from config (RRF doesn't need BM25/vector weights)
    const recencyWeightStr = yield* learningRepo.getConfig("recency_weight")
    const recencyWeight = recencyWeightStr ? parseFloat(recencyWeightStr) : DEFAULT_RECENCY_WEIGHT

    /**
     * Apply LLM re-ranking to scored learnings.
     * Re-ranking uses a specialized model to improve precision.
     * Gracefully degrades if reranker is unavailable.
     *
     * @param query The search query
     * @param learnings The pre-scored learnings to re-rank
     * @param rerankerWeight How much to weight the reranker score (0-1)
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

        // Create a map of content to reranker score
        const rerankerScores = new Map<string, number>()
        reranked.forEach(result => {
          rerankerScores.set(result.document, result.score)
        })

        // Blend reranker scores with existing relevance scores
        // Formula: final = (1 - weight) * existing + weight * reranker
        return learnings.map(learning => {
          const rerankerScore = rerankerScores.get(learning.content) ?? 0
          const blendedScore = (1 - rerankerWeight) * learning.relevanceScore + rerankerWeight * rerankerScore

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

    return {
      create: (input) =>
        Effect.gen(function* () {
          if (!input.content || input.content.trim().length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "Content is required" }))
          }
          return yield* learningRepo.insert({
            ...input,
            content: input.content.trim()
          })
        }),

      get: (id) =>
        Effect.gen(function* () {
          const learning = yield* learningRepo.findById(id)
          if (!learning) {
            return yield* Effect.fail(new LearningNotFoundError({ id }))
          }
          return learning
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const learning = yield* learningRepo.findById(id)
          if (!learning) {
            return yield* Effect.fail(new LearningNotFoundError({ id }))
          }
          yield* learningRepo.remove(id)
        }),

      search: (query) =>
        Effect.gen(function* () {
          const { query: searchQuery, limit = 10, minScore = 0.1 } = query

          // Expand query using LLM (graceful degradation - returns original if unavailable)
          const expansionResult = yield* Effect.catchAll(
            queryExpansionService.expand(searchQuery),
            () => Effect.succeed({ original: searchQuery, expanded: [searchQuery], wasExpanded: false })
          )

          // Get BM25 search results across all expanded queries (ranked list 1)
          const bm25Results = yield* multiQueryBM25Search(expansionResult.expanded, limit * 3)

          // Try to get query embedding for vector search (graceful degradation)
          // Use original query for embedding since expanded queries may be noisier
          const queryEmbedding = yield* Effect.option(embeddingService.embed(searchQuery))
          const queryEmbeddingValue = Option.getOrNull(queryEmbedding)

          // Get all learnings that have embeddings for vector ranking
          const learningsWithEmbeddings = yield* learningRepo.findWithEmbeddings(limit * 3)

          // Compute vector ranking (ranked list 2)
          const vectorRanking = computeVectorRanking(learningsWithEmbeddings, queryEmbeddingValue)

          // Combine using RRF
          const candidates = computeRRFScoring(bm25Results, vectorRanking)

          // Apply final scoring with boosts
          const scored = applyFinalScoring(candidates, recencyWeight)

          // Apply LLM re-ranking to top candidates for improved precision
          // Only re-rank a reasonable number of candidates to balance quality vs latency
          const topCandidates = scored.slice(0, Math.min(limit * 2, 20))
          const reranked = yield* applyReranking(searchQuery, topCandidates)

          // Filter by minimum score and limit
          return reranked
            .filter(r => r.relevanceScore >= minScore)
            .slice(0, limit)
        }),

      getRecent: (limit = 10) => learningRepo.findRecent(limit),

      recordUsage: (id) =>
        Effect.gen(function* () {
          const learning = yield* learningRepo.findById(id)
          if (!learning) {
            return yield* Effect.fail(new LearningNotFoundError({ id }))
          }
          yield* learningRepo.incrementUsage(id)
        }),

      updateOutcome: (id, score) =>
        Effect.gen(function* () {
          if (score < 0 || score > 1) {
            return yield* Effect.fail(new ValidationError({ reason: "Outcome score must be between 0 and 1" }))
          }
          const learning = yield* learningRepo.findById(id)
          if (!learning) {
            return yield* Effect.fail(new LearningNotFoundError({ id }))
          }
          yield* learningRepo.updateOutcomeScore(id, score)
        }),

      getContextForTask: (taskId) =>
        Effect.gen(function* () {
          const startTime = Date.now()

          // Get task to build search query from title/description
          const task = yield* taskRepo.findById(taskId)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
          }

          // Build search query from task content
          const searchQuery = `${task.title} ${task.description}`.trim()

          // Expand query using LLM (graceful degradation - returns original if unavailable)
          const expansionResult = yield* Effect.catchAll(
            queryExpansionService.expand(searchQuery),
            () => Effect.succeed({ original: searchQuery, expanded: [searchQuery], wasExpanded: false })
          )

          // Get BM25 results across all expanded queries
          const bm25Results = yield* multiQueryBM25Search(expansionResult.expanded, 30)

          // Try to get query embedding for vector search (graceful degradation)
          const queryEmbedding = yield* Effect.option(embeddingService.embed(searchQuery))
          const queryEmbeddingValue = Option.getOrNull(queryEmbedding)

          // Get learnings with embeddings for vector ranking
          const learningsWithEmbeddings = yield* learningRepo.findWithEmbeddings(30)

          // Compute vector ranking
          const vectorRanking = computeVectorRanking(learningsWithEmbeddings, queryEmbeddingValue)

          // Combine using RRF
          const candidates = computeRRFScoring(bm25Results, vectorRanking)

          // Apply final scoring with boosts
          const scored = applyFinalScoring(candidates, recencyWeight)

          // Apply LLM re-ranking to top candidates for improved precision
          const topCandidates = scored.slice(0, 20)
          const reranked = yield* applyReranking(searchQuery, topCandidates)

          // Filter and limit
          const learnings = reranked
            .filter(r => r.relevanceScore >= 0.05)
            .slice(0, 10)

          // Record usage for returned learnings
          for (const learning of learnings) {
            yield* learningRepo.incrementUsage(learning.id)
          }

          return {
            taskId,
            taskTitle: task.title,
            learnings,
            searchQuery,
            searchDuration: Date.now() - startTime
          }
        }),

      count: () => learningRepo.count(),

      embedAll: (forceAll = false) =>
        Effect.gen(function* () {
          // Get learnings to embed
          const allLearnings = yield* learningRepo.findAll()
          const toEmbed = forceAll
            ? allLearnings
            : allLearnings.filter(l => !l.embedding)

          let processed = 0
          let skipped = 0
          let failed = 0

          for (const learning of toEmbed) {
            const result = yield* Effect.either(embeddingService.embed(learning.content))
            if (result._tag === "Right") {
              yield* learningRepo.updateEmbedding(learning.id, result.right)
              processed++
            } else {
              failed++
            }
          }

          skipped = allLearnings.length - toEmbed.length

          return {
            processed,
            skipped,
            failed,
            total: allLearnings.length
          }
        }),

      embeddingStatus: () =>
        Effect.gen(function* () {
          const total = yield* learningRepo.count()
          const withEmbeddings = yield* learningRepo.countWithEmbeddings()
          const withoutEmbeddings = total - withEmbeddings
          const coveragePercent = total > 0 ? (withEmbeddings / total) * 100 : 0

          return {
            total,
            withEmbeddings,
            withoutEmbeddings,
            coveragePercent
          }
        })
    }
  })
)
