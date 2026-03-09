import { Context, Effect, Layer } from "effect"
import { DependencyRepository } from "../repo/dep-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { ValidationError, CircularDependencyError, TaskNotFoundError, DatabaseError, DependencyNotFoundError } from "../errors.js"
import type { TaskId } from "@jamesaphoenix/tx-types"

export class DependencyService extends Context.Tag("DependencyService")<
  DependencyService,
  {
    readonly addBlocker: (taskId: TaskId, blockerId: TaskId) => Effect.Effect<void, ValidationError | CircularDependencyError | TaskNotFoundError | DatabaseError>
    readonly removeBlocker: (taskId: TaskId, blockerId: TaskId) => Effect.Effect<void, DatabaseError | DependencyNotFoundError>
  }
>() {}

export const DependencyServiceLive = Layer.effect(
  DependencyService,
  Effect.gen(function* () {
    const depRepo = yield* DependencyRepository
    const taskRepo = yield* TaskRepository

    const reconcileBlockedStatus = (taskId: TaskId) =>
      Effect.gen(function* () {
        // Keep stored status consistent with dependency graph for workable states.
        // This prevents status='ready' while effective readiness is false.
        for (const expectedStatus of ["ready", "backlog", "planning", "blocked"] as const) {
          yield* taskRepo.recoverTaskStatus(taskId, expectedStatus)
        }
      })

    return {
      addBlocker: (taskId, blockerId) =>
        Effect.gen(function* () {
          if (taskId === blockerId) {
            return yield* Effect.fail(new ValidationError({ reason: "A task cannot block itself" }))
          }

          const task = yield* taskRepo.findById(taskId)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
          }

          const blocker = yield* taskRepo.findById(blockerId)
          if (!blocker) {
            return yield* Effect.fail(new TaskNotFoundError({ id: blockerId }))
          }

          // Atomically check for cycles and insert dependency in a single transaction.
          // This prevents race conditions where two concurrent addBlocker calls could
          // both pass cycle detection before either inserts (DOCTRINE RULE 4).
          const result = yield* depRepo.insertWithCycleCheck(blockerId, taskId)
          if (result._tag === "wouldCycle") {
            return yield* Effect.fail(new CircularDependencyError({ taskId, blockerId }))
          }
          // Idempotent: dependency already exists, nothing to do
          if (result._tag === "alreadyExists") {
            return
          }

          // Synchronize persisted status with dependency graph after mutation.
          yield* reconcileBlockedStatus(taskId)
        }),

      removeBlocker: (taskId, blockerId) =>
        Effect.gen(function* () {
          yield* depRepo.remove(blockerId, taskId)
          // Task may become ready when last blocker is removed.
          yield* reconcileBlockedStatus(taskId)
        })
    }
  })
)
