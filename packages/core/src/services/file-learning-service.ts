import { Context, Effect, Layer } from "effect"
import { FileLearningRepository } from "../repo/file-learning-repo.js"
import { FileLearningNotFoundError, ValidationError, DatabaseError } from "../errors.js"
import type { FileLearning, CreateFileLearningInput } from "@jamesaphoenix/tx-types"

export class FileLearningService extends Context.Tag("FileLearningService")<
  FileLearningService,
  {
    readonly create: (input: CreateFileLearningInput) => Effect.Effect<FileLearning, ValidationError | DatabaseError>
    readonly get: (id: number) => Effect.Effect<FileLearning, FileLearningNotFoundError | DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, FileLearningNotFoundError | DatabaseError>
    readonly getAll: () => Effect.Effect<readonly FileLearning[], DatabaseError>
    readonly recall: (path: string) => Effect.Effect<readonly FileLearning[], DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
  }
>() {}

export const FileLearningServiceLive = Layer.effect(
  FileLearningService,
  Effect.gen(function* () {
    const repo = yield* FileLearningRepository

    return {
      create: (input) =>
        Effect.gen(function* () {
          const filePattern = input.filePattern.trim()
          const note = input.note.trim()

          if (filePattern.length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "File pattern is required" }))
          }
          if (note.length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "Note is required" }))
          }

          const taskId = input.taskId != null ? input.taskId.trim() || null : null
          return yield* repo.insert({ filePattern, note, taskId })
        }),

      get: (id) =>
        Effect.gen(function* () {
          const learning = yield* repo.findById(id)
          if (!learning) {
            return yield* Effect.fail(new FileLearningNotFoundError({ id }))
          }
          return learning
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const learning = yield* repo.findById(id)
          if (!learning) {
            return yield* Effect.fail(new FileLearningNotFoundError({ id }))
          }
          yield* repo.remove(id)
        }),

      getAll: () => repo.findAll(),

      recall: (path) => repo.findByPath(path),

      count: () => repo.count()
    }
  })
)
