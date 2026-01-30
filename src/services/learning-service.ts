import { Context, Effect, Layer, Option } from "effect"
import { LearningRepository, type BM25Result } from "../repo/learning-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { AutoSyncService } from "./auto-sync-service.js"
import { LearningNotFoundError, TaskNotFoundError, ValidationError, DatabaseError } from "../errors.js"
import {
  type Learning,
  type LearningWithScore,
  type CreateLearningInput,
  type LearningQuery,
  type ContextResult
} from "../schemas/learning.js"

/** Default weights for hybrid scoring */
const DEFAULT_BM25_WEIGHT = 0.4
const DEFAULT_VECTOR_WEIGHT = 0.3
const DEFAULT_RECENCY_WEIGHT = 0.2
const MAX_AGE_DAYS = 30

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

/** Boost weights for outcome and frequency */
const OUTCOME_BOOST = 0.1
const FREQUENCY_BOOST = 0.05

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
 * Calculate vector scores for learnings that have embeddings.
 * Returns a Map from learning ID to cosine similarity score (0-1 normalized).
 */
const calculateVectorScores = (
  learnings: readonly Learning[],
  queryEmbedding: Float32Array | null
): Map<number, number> => {
  const scores = new Map<number, number>()

  if (!queryEmbedding) {
    return scores
  }

  for (const learning of learnings) {
    if (learning.embedding) {
      // Cosine similarity is [-1, 1], normalize to [0, 1]
      const similarity = cosineSimilarity(queryEmbedding, learning.embedding)
      scores.set(learning.id, (similarity + 1) / 2)
    }
  }

  return scores
}

/**
 * Combine BM25 results with vector similarity, recency, outcome, and frequency scoring.
 * Formula: score = bm25_weight * bm25_score + vector_weight * vector_score + recency_weight * recency_score
 *                + outcome_boost * outcome_score + frequency_boost * log(1 + usage_count)
 */
const applyHybridScoring = (
  bm25Results: readonly BM25Result[],
  vectorScores: Map<number, number>,
  bm25Weight: number,
  vectorWeight: number,
  recencyWeight: number
): LearningWithScore[] => {
  return bm25Results.map(({ learning, score: bm25Score }) => {
    const recencyScore = calculateRecencyScore(learning.createdAt)
    const vectorScore = vectorScores.get(learning.id) ?? 0

    // Outcome boost: if learning has been marked helpful, boost it
    const outcomeBoost = learning.outcomeScore !== null
      ? OUTCOME_BOOST * learning.outcomeScore
      : 0

    // Frequency boost: learnings that have been retrieved more get a small boost
    const frequencyBoost = FREQUENCY_BOOST * Math.log(1 + learning.usageCount)

    const relevanceScore = bm25Weight * bm25Score +
                           vectorWeight * vectorScore +
                           recencyWeight * recencyScore +
                           outcomeBoost +
                           frequencyBoost

    return {
      ...learning,
      relevanceScore,
      bm25Score,
      vectorScore,
      recencyScore
    }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)
}

export const LearningServiceLive = Layer.effect(
  LearningService,
  Effect.gen(function* () {
    const learningRepo = yield* LearningRepository
    const taskRepo = yield* TaskRepository
    const embeddingService = yield* EmbeddingService
    const autoSync = yield* AutoSyncService

    // Load weights from config (with defaults)
    const bm25WeightStr = yield* learningRepo.getConfig("bm25_weight")
    const vectorWeightStr = yield* learningRepo.getConfig("vector_weight")
    const recencyWeightStr = yield* learningRepo.getConfig("recency_weight")
    const bm25Weight = bm25WeightStr ? parseFloat(bm25WeightStr) : DEFAULT_BM25_WEIGHT
    const vectorWeight = vectorWeightStr ? parseFloat(vectorWeightStr) : DEFAULT_VECTOR_WEIGHT
    const recencyWeight = recencyWeightStr ? parseFloat(recencyWeightStr) : DEFAULT_RECENCY_WEIGHT

    return {
      create: (input) =>
        Effect.gen(function* () {
          if (!input.content || input.content.trim().length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "Content is required" }))
          }
          const learning = yield* learningRepo.insert({
            ...input,
            content: input.content.trim()
          })

          // Try to compute embedding (graceful degradation if model unavailable)
          const embeddingResult = yield* Effect.either(embeddingService.embed(learning.content))
          if (embeddingResult._tag === "Right") {
            yield* learningRepo.updateEmbedding(learning.id, embeddingResult.right)
          }

          yield* autoSync.afterLearningMutation()
          return embeddingResult._tag === "Right"
            ? { ...learning, embedding: embeddingResult.right }
            : learning
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
          yield* autoSync.afterLearningMutation()
        }),

      search: (query) =>
        Effect.gen(function* () {
          const { query: searchQuery, limit = 10, minScore = 0.3 } = query

          // BM25 search
          const bm25Results = yield* learningRepo.bm25Search(searchQuery, limit * 3)

          // Try to get query embedding for vector search (graceful degradation)
          const queryEmbedding = yield* Effect.option(embeddingService.embed(searchQuery))
          const queryEmbeddingValue = Option.getOrNull(queryEmbedding)

          // Calculate vector scores for learnings that have embeddings
          const learnings = bm25Results.map(r => r.learning)
          const vectorScores = calculateVectorScores(learnings, queryEmbeddingValue)

          // Apply hybrid scoring (BM25 + vector + recency)
          // If no embeddings available, vectorWeight contribution is 0
          const scored = applyHybridScoring(bm25Results, vectorScores, bm25Weight, vectorWeight, recencyWeight)

          // Filter by minimum score and limit
          return scored
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

          // Search for relevant learnings
          const bm25Results = yield* learningRepo.bm25Search(searchQuery, 30)

          // Try to get query embedding for vector search (graceful degradation)
          const queryEmbedding = yield* Effect.option(embeddingService.embed(searchQuery))
          const queryEmbeddingValue = Option.getOrNull(queryEmbedding)

          // Calculate vector scores
          const resultLearnings = bm25Results.map(r => r.learning)
          const vectorScores = calculateVectorScores(resultLearnings, queryEmbeddingValue)

          // Apply hybrid scoring
          const scored = applyHybridScoring(bm25Results, vectorScores, bm25Weight, vectorWeight, recencyWeight)

          // Filter and limit
          const learnings = scored
            .filter(r => r.relevanceScore >= 0.2)
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

      count: () => learningRepo.count()
    }
  })
)
