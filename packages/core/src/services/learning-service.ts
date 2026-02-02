import { Context, Effect, Layer } from "effect"
import { LearningRepository } from "../repo/learning-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { RetrieverService } from "./retriever-service.js"
import { LearningNotFoundError, TaskNotFoundError, ValidationError, DatabaseError, RetrievalError } from "../errors.js"
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

export class LearningService extends Context.Tag("LearningService")<
  LearningService,
  {
    readonly create: (input: CreateLearningInput) => Effect.Effect<Learning, ValidationError | DatabaseError>
    readonly get: (id: number) => Effect.Effect<Learning, LearningNotFoundError | DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, LearningNotFoundError | DatabaseError>
    readonly search: (query: LearningQuery) => Effect.Effect<readonly LearningWithScore[], RetrievalError | DatabaseError>
    readonly getRecent: (limit?: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly recordUsage: (id: number) => Effect.Effect<void, LearningNotFoundError | DatabaseError>
    readonly updateOutcome: (id: number, score: number) => Effect.Effect<void, LearningNotFoundError | ValidationError | DatabaseError>
    readonly getContextForTask: (taskId: string) => Effect.Effect<ContextResult, TaskNotFoundError | RetrievalError | DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
    readonly embedAll: (forceAll?: boolean) => Effect.Effect<EmbedResult, DatabaseError>
    readonly embeddingStatus: () => Effect.Effect<EmbedStatus, DatabaseError>
  }
>() {}

export const LearningServiceLive = Layer.effect(
  LearningService,
  Effect.gen(function* () {
    const learningRepo = yield* LearningRepository
    const taskRepo = yield* TaskRepository
    const embeddingService = yield* EmbeddingService
    const retrieverService = yield* RetrieverService

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

          // Delegate to RetrieverService for the actual search
          return yield* retrieverService.search(searchQuery, {
            limit,
            minScore
          })
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

          // Delegate to RetrieverService for the actual search
          const learnings = yield* retrieverService.search(searchQuery, {
            limit: 10,
            minScore: 0.05
          })

          // Record usage for returned learnings (batch update to avoid N+1)
          if (learnings.length > 0) {
            yield* learningRepo.incrementUsageMany(learnings.map(l => l.id))
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
