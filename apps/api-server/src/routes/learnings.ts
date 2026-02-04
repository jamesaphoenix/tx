/**
 * Learning Route Handlers
 *
 * Implements learning and file learning endpoint handlers.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import type { Learning, LearningWithScore, LearningSourceType } from "@jamesaphoenix/tx-types"
import { serializeLearning, serializeLearningWithScore, serializeFileLearning } from "@jamesaphoenix/tx-types"
import { LearningService, FileLearningService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const LearningsLive = HttpApiBuilder.group(TxApi, "learnings", (handlers) =>
  handlers
    .handle("searchLearnings", ({ urlParams }) =>
      Effect.gen(function* () {
        const learningService = yield* LearningService
        const limit = urlParams.limit ?? 10

        let learnings: readonly (Learning | LearningWithScore)[]

        if (!urlParams.query) {
          learnings = yield* learningService.getRecent(limit)
        } else {
          learnings = yield* learningService.search({
            query: urlParams.query,
            limit,
            minScore: urlParams.minScore ?? undefined,
            category: urlParams.category ?? undefined,
          })
        }

        // Ensure all results have score fields
        const isWithScore = (l: Learning | LearningWithScore): l is LearningWithScore =>
          "relevanceScore" in l

        return {
          learnings: learnings.map(l =>
            isWithScore(l) ? serializeLearningWithScore(l) : serializeLearningWithScore({
              ...l,
              relevanceScore: 1,
              bm25Score: 0,
              vectorScore: 0,
              recencyScore: 0,
              rrfScore: 0,
              bm25Rank: 0,
              vectorRank: 0,
            } as LearningWithScore)
          ),
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getLearning", ({ path }) =>
      Effect.gen(function* () {
        const learningService = yield* LearningService
        const learning = yield* learningService.get(path.id)
        return serializeLearning(learning)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("createLearning", ({ payload }) =>
      Effect.gen(function* () {
        const learningService = yield* LearningService
        const learning = yield* learningService.create({
          content: payload.content,
          sourceType: (payload.sourceType as LearningSourceType) ?? "manual",
          sourceRef: payload.sourceRef ?? undefined,
          category: payload.category ?? undefined,
          keywords: payload.keywords ?? undefined,
        })
        return serializeLearning(learning)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("updateHelpfulness", ({ path, payload }) =>
      Effect.gen(function* () {
        const learningService = yield* LearningService
        yield* learningService.updateOutcome(path.id, payload.score)
        return { success: true as const, id: path.id, score: payload.score }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getContext", ({ path }) =>
      Effect.gen(function* () {
        const learningService = yield* LearningService
        const result = yield* learningService.getContextForTask(path.taskId)
        return {
          taskId: result.taskId,
          taskTitle: result.taskTitle,
          learnings: result.learnings.map(serializeLearningWithScore),
          searchQuery: result.searchQuery,
          searchDuration: result.searchDuration,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listFileLearnings", ({ urlParams }) =>
      Effect.gen(function* () {
        const fileLearningService = yield* FileLearningService
        const learnings = urlParams.path
          ? yield* fileLearningService.recall(urlParams.path)
          : yield* fileLearningService.getAll()
        return { learnings: learnings.map(serializeFileLearning) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("createFileLearning", ({ payload }) =>
      Effect.gen(function* () {
        const fileLearningService = yield* FileLearningService
        const learning = yield* fileLearningService.create({
          filePattern: payload.filePattern,
          note: payload.note,
          taskId: payload.taskId ?? undefined,
        })
        return serializeFileLearning(learning)
      }).pipe(Effect.mapError(mapCoreError))
    )
)
