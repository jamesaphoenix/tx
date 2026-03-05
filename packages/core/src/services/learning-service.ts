import { Context, Effect, Layer } from "effect"
import { LearningRepository } from "../repo/learning-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { RetrieverService } from "./retriever-service.js"
import { LearningNotFoundError, TaskNotFoundError, ValidationError, DatabaseError, RetrievalError, EmbeddingDimensionMismatchError, EmbeddingUnavailableError } from "../errors.js"
import type { ZeroMagnitudeVectorError } from "../errors.js"
import type { Learning, LearningWithScore, CreateLearningInput, LearningQuery, ContextOptions, ContextResult } from "@jamesaphoenix/tx-types"

/** Strips null bytes (\0) which cause C API truncation, JSON issues, and terminal corruption. */
const stripNullBytes = (s: string): string => s.replace(/\0/g, "")

const EMBEDDING_CHUNK_MAX_CHARS = 1200
const EMBEDDING_CHUNK_OVERLAP_CHARS = 120

const isContextSizeEmbeddingError = (error: EmbeddingUnavailableError): boolean => {
  const reason = error.reason.toLowerCase()
  return (
    reason.includes("input is longer than the context size") ||
    (reason.includes("context size") && reason.includes("longer"))
  )
}

const splitEmbeddingChunks = (
  content: string,
  maxChars: number = EMBEDDING_CHUNK_MAX_CHARS,
  overlapChars: number = EMBEDDING_CHUNK_OVERLAP_CHARS
): readonly string[] => {
  const normalized = content.trim()
  if (normalized.length <= maxChars) {
    return [normalized]
  }

  const chunks: string[] = []
  let cursor = 0

  while (cursor < normalized.length) {
    const maxEnd = Math.min(cursor + maxChars, normalized.length)

    if (maxEnd === normalized.length) {
      const tail = normalized.slice(cursor).trim()
      if (tail.length > 0) {
        chunks.push(tail)
      }
      break
    }

    const minBreak = cursor + Math.floor(maxChars * 0.6)
    const newlineBreak = normalized.lastIndexOf("\n", maxEnd)
    const spaceBreak = normalized.lastIndexOf(" ", maxEnd)
    const breakAt = [newlineBreak, spaceBreak].find((index) => index >= minBreak) ?? maxEnd

    const chunk = normalized.slice(cursor, breakAt).trim()
    if (chunk.length > 0) {
      chunks.push(chunk)
    }

    const nextCursor = Math.max(breakAt - overlapChars, cursor + 1)
    if (nextCursor <= cursor) {
      cursor = breakAt
    } else {
      cursor = nextCursor
    }
  }

  return chunks.length > 0 ? chunks : [normalized.slice(0, maxChars)]
}

const averageEmbeddings = (
  embeddings: readonly Float32Array[]
): Effect.Effect<Float32Array, EmbeddingUnavailableError> =>
  Effect.gen(function* () {
    if (embeddings.length === 0) {
      return yield* Effect.fail(
        new EmbeddingUnavailableError({
          reason: "Chunked embedding produced no vectors",
        })
      )
    }

    const dimensions = embeddings[0]!.length
    const out = new Float32Array(dimensions)

    for (const vector of embeddings) {
      if (vector.length !== dimensions) {
        return yield* Effect.fail(
          new EmbeddingUnavailableError({
            reason:
              `Chunked embedding dimension mismatch: expected ${dimensions}, got ${vector.length}`,
          })
        )
      }
      for (let i = 0; i < dimensions; i++) {
        out[i] = out[i]! + vector[i]!
      }
    }

    for (let i = 0; i < dimensions; i++) {
      out[i] = out[i]! / embeddings.length
    }

    let magnitude = 0
    for (let i = 0; i < dimensions; i++) {
      magnitude += out[i]! * out[i]!
    }

    if (magnitude > 0) {
      const norm = Math.sqrt(magnitude)
      for (let i = 0; i < dimensions; i++) {
        out[i] = out[i]! / norm
      }
    }

    return out
  })

/** Result of embedding operation */
export type EmbedResult = {
  processed: number
  skipped: number
  failed: number
  total: number};

/** Embedding coverage status */
export type EmbedStatus = {
  total: number
  withEmbeddings: number
  withoutEmbeddings: number
  coveragePercent: number};

export class LearningService extends Context.Tag("LearningService")<
  LearningService,
  {
    readonly create: (input: CreateLearningInput) => Effect.Effect<Learning, ValidationError | DatabaseError>
    readonly get: (id: number) => Effect.Effect<Learning, LearningNotFoundError | DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, LearningNotFoundError | DatabaseError>
    readonly search: (query: LearningQuery) => Effect.Effect<readonly LearningWithScore[], RetrievalError | DatabaseError | EmbeddingDimensionMismatchError | ZeroMagnitudeVectorError>
    readonly getRecent: (limit?: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly recordUsage: (id: number) => Effect.Effect<void, LearningNotFoundError | DatabaseError>
    readonly updateOutcome: (id: number, score: number) => Effect.Effect<void, LearningNotFoundError | ValidationError | DatabaseError>
    readonly getContextForTask: (taskId: string, options?: ContextOptions) => Effect.Effect<ContextResult, TaskNotFoundError | RetrievalError | DatabaseError | EmbeddingDimensionMismatchError | ZeroMagnitudeVectorError>
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

    const embedLearningContent = (
      learningId: number,
      content: string
    ): Effect.Effect<Float32Array, EmbeddingUnavailableError> =>
      embeddingService.embed(content).pipe(
        Effect.catchTag("EmbeddingUnavailableError", (error) => {
          if (!isContextSizeEmbeddingError(error)) {
            return Effect.fail(error)
          }

          return Effect.gen(function* () {
            const chunks = splitEmbeddingChunks(content)
            if (chunks.length <= 1) {
              return yield* Effect.fail(error)
            }

            yield* Effect.logWarning(
              `Learning ${learningId} exceeded embedder context size; retrying with ${chunks.length} chunks`
            )

            const vectors = yield* Effect.forEach(
              chunks,
              (chunk) => embeddingService.embed(chunk),
              { concurrency: 1 }
            )

            return yield* averageEmbeddings(vectors)
          }).pipe(
            Effect.catchTag("EmbeddingUnavailableError", () => Effect.fail(error))
          )
        })
      )

    return {
      create: (input) =>
        Effect.gen(function* () {
          const content = stripNullBytes(input.content)
          if (!content || content.trim().length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "Content is required" }))
          }
          return yield* learningRepo.insert({
            ...input,
            content: content.trim()
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

      getRecent: (limit = 10) => learningRepo.findRecentWithoutEmbedding(limit),

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

          // Record usage for returned learnings (best-effort, don't fail context retrieval)
          if (learnings.length > 0) {
            yield* learningRepo.incrementUsageMany(learnings.map(l => l.id)).pipe(
              Effect.catchTag("DatabaseError", (e) =>
                Effect.logWarning(`Failed to increment usage for ${learnings.length} learnings: ${String(e.cause)}`)
              )
            )
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
                const result = yield* Effect.either(embedLearningContent(learning.id, learning.content))
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
                const result = yield* Effect.either(embedLearningContent(learning.id, learning.content))
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
                yield* Effect.logError(`Batch embedding completely failed (0/${batch.length} succeeded), aborting to prevent infinite loop`)
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
