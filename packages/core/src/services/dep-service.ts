import { Context, Effect, Layer } from "effect"
import { DependencyRepository } from "../repo/dep-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { ValidationError, CircularDependencyError, TaskNotFoundError, DatabaseError } from "../errors.js"
import type { TaskId } from "@tx/types"

export class DependencyService extends Context.Tag("DependencyService")<
  DependencyService,
  {
    readonly addBlocker: (taskId: TaskId, blockerId: TaskId) => Effect.Effect<void, ValidationError | CircularDependencyError | TaskNotFoundError | DatabaseError>
    readonly removeBlocker: (taskId: TaskId, blockerId: TaskId) => Effect.Effect<void, DatabaseError>
  }
>() {}

export const DependencyServiceLive = Layer.effect(
  DependencyService,
  Effect.gen(function* () {
    const depRepo = yield* DependencyRepository
    const taskRepo = yield* TaskRepository

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

          // Cycle detection: check if there's already a path from taskId to blockerId
          // (i.e., blockerId is transitively blocked by taskId)
          const wouldCycle = yield* depRepo.hasPath(blockerId, taskId)
          if (wouldCycle) {
            return yield* Effect.fail(new CircularDependencyError({ taskId, blockerId }))
          }

          yield* depRepo.insert(blockerId, taskId)
        }),

      removeBlocker: (taskId, blockerId) =>
        depRepo.remove(blockerId, taskId)
    }
  })
)
