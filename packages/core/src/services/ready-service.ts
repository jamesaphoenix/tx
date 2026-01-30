import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import { DatabaseError } from "../errors.js"
import type { Task, TaskId, TaskWithDeps } from "@tx/types"

export class ReadyService extends Context.Tag("ReadyService")<
  ReadyService,
  {
    readonly getReady: (limit?: number) => Effect.Effect<readonly TaskWithDeps[], DatabaseError>
    readonly isReady: (id: TaskId) => Effect.Effect<boolean, DatabaseError>
    readonly getBlockers: (id: TaskId) => Effect.Effect<readonly Task[], DatabaseError>
    readonly getBlocking: (id: TaskId) => Effect.Effect<readonly Task[], DatabaseError>
  }
>() {}

export const ReadyServiceLive = Layer.effect(
  ReadyService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository
    const depRepo = yield* DependencyRepository

    return {
      getReady: (limit = 100) =>
        Effect.gen(function* () {
          const candidates = yield* taskRepo.findAll({
            status: ["backlog", "ready", "planning"]
          })

          const ready: TaskWithDeps[] = []
          for (const task of candidates) {
            const blockerIds = yield* depRepo.getBlockerIds(task.id)
            const blockingIds = yield* depRepo.getBlockingIds(task.id)
            const childIds = yield* taskRepo.getChildIds(task.id)

            if (blockerIds.length === 0) {
              ready.push({
                ...task,
                blockedBy: [] as TaskId[],
                blocks: blockingIds as TaskId[],
                children: childIds as TaskId[],
                isReady: true
              })
              continue
            }

            const blockers = yield* taskRepo.findByIds(blockerIds)
            const allDone = blockers.every(b => b.status === "done")
            if (allDone) {
              ready.push({
                ...task,
                blockedBy: blockerIds as TaskId[],
                blocks: blockingIds as TaskId[],
                children: childIds as TaskId[],
                isReady: true
              })
            }
          }

          ready.sort((a, b) => b.score - a.score)
          return ready.slice(0, limit)
        }),

      isReady: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) return false
          if (!["backlog", "ready", "planning"].includes(task.status)) return false

          const blockerIds = yield* depRepo.getBlockerIds(id)
          if (blockerIds.length === 0) return true

          const blockers = yield* taskRepo.findByIds(blockerIds)
          return blockers.every(b => b.status === "done")
        }),

      getBlockers: (id) =>
        Effect.gen(function* () {
          const blockerIds = yield* depRepo.getBlockerIds(id)
          if (blockerIds.length === 0) return [] as Task[]
          return yield* taskRepo.findByIds(blockerIds)
        }),

      getBlocking: (id) =>
        Effect.gen(function* () {
          const blockingIds = yield* depRepo.getBlockingIds(id)
          if (blockingIds.length === 0) return [] as Task[]
          return yield* taskRepo.findByIds(blockingIds)
        })
    }
  })
)
