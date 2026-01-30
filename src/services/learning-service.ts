import { Context, Effect, Layer } from "effect"
import { LearningRepository, type BM25Result } from "../repo/learning-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
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
const DEFAULT_RECENCY_WEIGHT = 0.2
const MAX_AGE_DAYS = 30

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
 * Combine BM25 results with recency, outcome, and frequency scoring.
 * Formula: score = bm25_weight * bm25_score + recency_weight * recency_score
 *                + outcome_boost * outcome_score + frequency_boost * log(1 + usage_count)
 */
const applyHybridScoring = (
  bm25Results: readonly BM25Result[],
  bm25Weight: number,
  recencyWeight: number
): LearningWithScore[] => {
  return bm25Results.map(({ learning, score: bm25Score }) => {
    const recencyScore = calculateRecencyScore(learning.createdAt)

    // Outcome boost: if learning has been marked helpful, boost it
    const outcomeBoost = learning.outcomeScore !== null
      ? OUTCOME_BOOST * learning.outcomeScore
      : 0

    // Frequency boost: learnings that have been retrieved more get a small boost
    const frequencyBoost = FREQUENCY_BOOST * Math.log(1 + learning.usageCount)

    const relevanceScore = bm25Weight * bm25Score +
                           recencyWeight * recencyScore +
                           outcomeBoost +
                           frequencyBoost

    return {
      ...learning,
      relevanceScore,
      bm25Score,
      vectorScore: 0, // Will be added when vector search is implemented
      recencyScore
    }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)
}

export const LearningServiceLive = Layer.effect(
  LearningService,
  Effect.gen(function* () {
    const learningRepo = yield* LearningRepository
    const taskRepo = yield* TaskRepository

    // Load weights from config (with defaults)
    const bm25WeightStr = yield* learningRepo.getConfig("bm25_weight")
    const recencyWeightStr = yield* learningRepo.getConfig("recency_weight")
    const bm25Weight = bm25WeightStr ? parseFloat(bm25WeightStr) : DEFAULT_BM25_WEIGHT
    const recencyWeight = recencyWeightStr ? parseFloat(recencyWeightStr) : DEFAULT_RECENCY_WEIGHT

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
          const { query: searchQuery, limit = 10, minScore = 0.3 } = query

          // BM25 search
          const bm25Results = yield* learningRepo.bm25Search(searchQuery, limit * 3)

          // Apply hybrid scoring (BM25 + recency)
          const scored = applyHybridScoring(bm25Results, bm25Weight, recencyWeight)

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
          const scored = applyHybridScoring(bm25Results, bm25Weight, recencyWeight)

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
