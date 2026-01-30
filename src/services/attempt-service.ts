import { Context, Effect, Layer } from "effect"
import { AttemptRepository } from "../repo/attempt-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { AttemptNotFoundError, TaskNotFoundError, ValidationError, DatabaseError } from "../errors.js"
import {
  type Attempt,
  type AttemptId,
  type AttemptOutcome,
  isValidOutcome
} from "../schemas/attempt.js"

export class AttemptService extends Context.Tag("AttemptService")<
  AttemptService,
  {
    /** Create a new attempt for a task (validates task exists) */
    readonly create: (
      taskId: string,
      approach: string,
      outcome: AttemptOutcome,
      reason?: string | null
    ) => Effect.Effect<Attempt, TaskNotFoundError | ValidationError | DatabaseError>

    /** Get an attempt by ID */
    readonly get: (id: AttemptId) => Effect.Effect<Attempt, AttemptNotFoundError | DatabaseError>

    /** List all attempts for a task */
    readonly listForTask: (taskId: string) => Effect.Effect<readonly Attempt[], DatabaseError>

    /** Remove an attempt by ID */
    readonly remove: (id: AttemptId) => Effect.Effect<void, AttemptNotFoundError | DatabaseError>

    /** Get count of failed attempts for a task */
    readonly getFailedCount: (taskId: string) => Effect.Effect<number, DatabaseError>
  }
>() {}

export const AttemptServiceLive = Layer.effect(
  AttemptService,
  Effect.gen(function* () {
    const attemptRepo = yield* AttemptRepository
    const taskRepo = yield* TaskRepository

    return {
      create: (taskId, approach, outcome, reason) =>
        Effect.gen(function* () {
          // Validate task exists
          const task = yield* taskRepo.findById(taskId)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
          }

          // Validate approach is not empty
          if (!approach || approach.trim().length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "Approach is required" }))
          }

          // Validate outcome
          if (!isValidOutcome(outcome)) {
            return yield* Effect.fail(new ValidationError({ reason: `Invalid outcome: ${outcome}` }))
          }

          return yield* attemptRepo.insert({
            taskId,
            approach: approach.trim(),
            outcome,
            reason: reason ?? null
          })
        }),

      get: (id) =>
        Effect.gen(function* () {
          const attempt = yield* attemptRepo.findById(id)
          if (!attempt) {
            return yield* Effect.fail(new AttemptNotFoundError({ id }))
          }
          return attempt
        }),

      listForTask: (taskId) => attemptRepo.findByTaskId(taskId),

      remove: (id) =>
        Effect.gen(function* () {
          const attempt = yield* attemptRepo.findById(id)
          if (!attempt) {
            return yield* Effect.fail(new AttemptNotFoundError({ id }))
          }
          yield* attemptRepo.remove(id)
        }),

      getFailedCount: (taskId) =>
        Effect.gen(function* () {
          const attempts = yield* attemptRepo.findByTaskId(taskId)
          return attempts.filter(a => a.outcome === "failed").length
        })
    }
  })
)
