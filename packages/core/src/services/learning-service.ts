import { Context, Effect, Layer } from "effect"
import { LearningRepository } from "../repo/learning-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { RetrieverService } from "./retriever-service.js"
import { LearningNotFoundError, TaskNotFoundError, ValidationError, DatabaseError, RetrievalError, EmbeddingDimensionMismatchError } from "../errors.js"
import type { Learning, LearningWithScore, CreateLearningInput, LearningQuery, ContextOptions, ContextResult } from "@jamesaphoenix/tx-types"

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
    readonly search: (query: LearningQuery) => Effect.Effect<readonly LearningWithScore[], RetrievalError | DatabaseError | EmbeddingDimensionMismatchError>
    readonly getRecent: (limit?: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly recordUsage: (id: number) => Effect.Effect<void, LearningNotFoundError | DatabaseError>
    readonly updateOutcome: (id: number, score: number) => Effect.Effect<void, LearningNotFoundError | ValidationError | DatabaseError>
    readonly getContextForTask: (taskId: string, options?: ContextOptions) => Effect.Effect<ContextResult, TaskNotFoundError | RetrievalError | DatabaseError | EmbeddingDimensionMismatchError>
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

      getContextForTask: (taskId, options) =>
        Effect.gen(function* () {
          const startTime = Date.now()

          // Get task to build search query from title/description
          const task = yield* taskRepo.findById(taskId)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
          }

          // Build search query from task content
          const searchQuery = `${task.title} ${task.description}`.trim()

          // Build retrieval options with optional graph expansion
          const retrievalOptions = {
            limit: options?.maxTokens ?? 10,
            minScore: 0.05,
            graphExpansion: options?.useGraph
              ? {
                  enabled: true,
                  depth: options.expansionDepth ?? 2, // Default depth=2 per PRD-016
                  edgeTypes: options.edgeTypes
                }
              : undefined
          }

          // Delegate to RetrieverService for the actual search
          const learnings = yield* retrieverService.search(searchQuery, retrievalOptions)

          // Record usage for returned learnings (batch update to avoid N+1)
          if (learnings.length > 0) {
            yield* learningRepo.incrementUsageMany(learnings.map(l => l.id))
          }

          // Calculate graph expansion stats if enabled
          const graphExpansion = options?.useGraph
            ? {
                enabled: true,
                seedCount: learnings.filter(l => l.expansionHops === 0 || l.expansionHops === undefined).length,
                expandedCount: learnings.filter(l => l.expansionHops !== undefined && l.expansionHops > 0).length,
                maxDepthReached: Math.max(0, ...learnings.map(l => l.expansionHops ?? 0))
              }
            : undefined

          return {
            taskId,
            taskTitle: task.title,
            learnings,
            searchQuery,
            searchDuration: Date.now() - startTime,
            graphExpansion
          }
        }),

      count: () => learningRepo.count(),

      embedAll: (forceAll = false) =>
        Effect.gen(function* () {
          const BATCH_SIZE = 100

          // Get total counts upfront for accurate reporting
          const total = yield* learningRepo.count()
          const withoutEmbeddings = yield* learningRepo.countWithoutEmbeddings()

          let processed = 0
          let failed = 0
          let lastId: number | undefined = undefined

          if (forceAll) {
            // Process ALL learnings in batches (re-embed everything)
            while (true) {
              const batch: readonly Learning[] = yield* learningRepo.findPaginated(BATCH_SIZE, lastId)
              if (batch.length === 0) break

              for (const learning of batch) {
                const result = yield* Effect.either(embeddingService.embed(learning.content))
                if (result._tag === "Right") {
                  yield* learningRepo.updateEmbedding(learning.id, result.right)
                  processed++
                } else {
                  failed++
                }
              }

              lastId = batch[batch.length - 1]!.id
              if (batch.length < BATCH_SIZE) break
            }
          } else {
            // Only process learnings without embeddings
            while (true) {
              // Always start from beginning since we're updating as we go
              const batch: readonly Learning[] = yield* learningRepo.findWithoutEmbeddingPaginated(BATCH_SIZE)
              if (batch.length === 0) break

              // Track per-batch progress to detect complete failures
              let batchProcessed = 0
              for (const learning of batch) {
                const result = yield* Effect.either(embeddingService.embed(learning.content))
                if (result._tag === "Right") {
                  yield* learningRepo.updateEmbedding(learning.id, result.right)
                  processed++
                  batchProcessed++
                } else {
                  failed++
                }
              }

              // If we didn't successfully process any in this batch, abort to prevent infinite loop
              // This handles cases like API rate limits or network errors affecting the entire batch
              if (batchProcessed === 0 && batch.length > 0) {
                console.error(`Batch embedding completely failed (0/${batch.length} succeeded), aborting to prevent infinite loop`)
                break
              }
            }
          }

          const skipped = forceAll ? 0 : (total - withoutEmbeddings)

          return {
            processed,
            skipped,
            failed,
            total
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
