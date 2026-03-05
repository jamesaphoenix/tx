import { Effect } from "effect"
import type { BM25Result } from "../repo/learning-repo.js"
import { EmbeddingDimensionMismatchError, ZeroMagnitudeVectorError } from "../errors.js"
import type { Learning, LearningWithScore } from "@jamesaphoenix/tx-types"
import { cosineSimilarity } from "../utils/math.js"

/** RRF constant - standard value from the original paper */
const RRF_K = 60

/** Default weights for recency (used as boost on top of RRF) */
export const DEFAULT_RECENCY_WEIGHT = 0.1
const MAX_AGE_DAYS = 30

/** Hard cap on embeddings fetched for vector similarity scan. */
export const MAX_VECTOR_CANDIDATES = 500

/** Boost weights for outcome and frequency */
const OUTCOME_BOOST = 0.05
const FREQUENCY_BOOST = 0.02

/** Position-aware bonuses for items ranking highly in any retrieval system */
const TOP_1_BONUS = 0.05
const TOP_3_BONUS = 0.02

/** Feedback boost weight - scales the 0-1 feedback score */
const FEEDBACK_BOOST = 0.05

/**
 * Interface for intermediate RRF computation results.
 */
type RRFCandidate = {
  learning: Learning
  bm25Score: number
  bm25Rank: number
  vectorScore: number
  vectorRank: number
  rrfScore: number
  recencyScore: number
}

/**
 * Calculate recency score (0-1) based on age in days.
 * Newer learnings get higher scores.
 */
export const calculateRecencyScore = (createdAt: Date): number => {
  const ageMs = Date.now() - createdAt.getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.max(0, 1 - ageDays / MAX_AGE_DAYS)
}

/**
 * Compute vector similarity scores and return ranked results.
 * Rank is 1-indexed (1 = best match).
 */
export const computeVectorRanking = (
  learnings: readonly Learning[],
  queryEmbedding: Float32Array | null
): Effect.Effect<{ learning: Learning; score: number; rank: number }[], EmbeddingDimensionMismatchError | ZeroMagnitudeVectorError> => {
  if (!queryEmbedding) {
    return Effect.succeed([])
  }

  const learningsWithEmbeddings = learnings.filter(
    (l): l is Learning & { embedding: Float32Array } => l.embedding !== null
  )

  return Effect.forEach(learningsWithEmbeddings, learning =>
    cosineSimilarity(queryEmbedding, learning.embedding).pipe(
      Effect.map(similarity => {
        const score = (similarity + 1) / 2
        return { learning, score }
      })
    )
  ).pipe(
    Effect.map(withScores => {
      const sorted = [...withScores].sort((a, b) => b.score - a.score)
      return sorted.map((item, idx) => ({
        ...item,
        rank: idx + 1
      }))
    })
  )
}

/**
 * Reciprocal Rank Fusion (RRF) score calculation.
 * Formula: RRF(d) = Σ 1/(k + rank_i(d))
 */
const rrfScore = (k: number, ...ranks: number[]): number => {
  return ranks.reduce((sum, rank) => {
    if (rank === 0) return sum
    return sum + 1 / (k + rank)
  }, 0)
}

/**
 * Combine BM25 and vector search results using Reciprocal Rank Fusion (RRF).
 */
export const computeRRFScoring = (
  bm25Results: readonly BM25Result[],
  vectorRanking: { learning: Learning; score: number; rank: number }[]
): RRFCandidate[] => {
  const bm25Map = new Map<number, { score: number; rank: number }>()
  bm25Results.forEach((result, idx) => {
    bm25Map.set(result.learning.id, { score: result.score, rank: idx + 1 })
  })

  const vectorMap = new Map<number, { score: number; rank: number }>()
  vectorRanking.forEach(item => {
    vectorMap.set(item.learning.id, { score: item.score, rank: item.rank })
  })

  const allLearnings = new Map<number, Learning>()
  for (const result of bm25Results) {
    allLearnings.set(result.learning.id, result.learning)
  }
  for (const item of vectorRanking) {
    allLearnings.set(item.learning.id, item.learning)
  }

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

  return candidates.sort((a, b) => b.rrfScore - a.rrfScore)
}

/**
 * Calculate position-aware bonus based on best rank across retrieval systems.
 */
export const calculatePositionBonus = (...ranks: number[]): number => {
  const validRanks = ranks.filter(r => r > 0)
  if (validRanks.length === 0) return 0

  const bestRank = Math.min(...validRanks)

  if (bestRank === 1) return TOP_1_BONUS
  if (bestRank <= 3) return TOP_3_BONUS
  return 0
}

/**
 * Convert RRF candidates to final LearningWithScore results.
 */
export const applyFinalScoring = (
  candidates: RRFCandidate[],
  recencyWeight: number,
  feedbackScores?: ReadonlyMap<number, number>
): LearningWithScore[] => {
  return candidates.map(candidate => {
    const { learning, bm25Score, bm25Rank, vectorScore, vectorRank, rrfScore: rrf, recencyScore } = candidate

    const outcomeBoost = learning.outcomeScore !== null
      ? OUTCOME_BOOST * learning.outcomeScore
      : 0

    const frequencyBoost = FREQUENCY_BOOST * Math.log(1 + learning.usageCount)
    const positionBonus = calculatePositionBonus(bm25Rank, vectorRank)
    const feedbackScore = feedbackScores?.get(learning.id) ?? 0.5
    const feedbackBoost = FEEDBACK_BOOST * feedbackScore
    const normalizedRRF = rrf * (RRF_K + 1) / 2

    const relevanceScore = normalizedRRF +
                           recencyWeight * recencyScore +
                           outcomeBoost +
                           frequencyBoost +
                           positionBonus +
                           feedbackBoost

    return {
      ...learning,
      relevanceScore,
      bm25Score,
      vectorScore,
      recencyScore,
      rrfScore: rrf,
      bm25Rank,
      vectorRank,
      feedbackScore
    }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)
}
