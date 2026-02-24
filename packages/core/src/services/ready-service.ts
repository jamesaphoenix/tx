import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import { DatabaseError } from "../errors.js"
import type { Task, TaskId, TaskWithDeps } from "@jamesaphoenix/tx-types"

/**
 * Result of checking whether a task is ready to be worked on.
 * Replaces silent `false` with an explicit reason for not-ready states.
 */
export type ReadyCheckResult =
  | { readonly _tag: "Ready" }
  | { readonly _tag: "TaskNotFound"; readonly id: TaskId }
  | { readonly _tag: "WrongStatus"; readonly id: TaskId; readonly status: string }
  | { readonly _tag: "Blocked"; readonly id: TaskId; readonly pendingBlockerIds: readonly string[] }

/** Helper to check if a ReadyCheckResult indicates the task is ready. */
export const isReadyResult = (result: ReadyCheckResult): boolean => result._tag === "Ready"

export class ReadyService extends Context.Tag("ReadyService")<
  ReadyService,
  {
    readonly getReady: (limit?: number) => Effect.Effect<readonly TaskWithDeps[], DatabaseError>
    readonly isReady: (id: TaskId) => Effect.Effect<ReadyCheckResult, DatabaseError>
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
          const safeLimit = Math.max(0, Math.floor(limit))
          if (safeLimit === 0) {
            return [] as TaskWithDeps[]
          }

          // Page through candidates ordered by score/id to avoid loading the
          // entire backlog when only a small ready set is requested.
          const ready: TaskWithDeps[] = []
          let cursor: { score: number; id: string } | undefined

          while (ready.length < safeLimit) {
            const remaining = safeLimit - ready.length
            const pageSize = Math.min(Math.max(remaining * 4, 200), 1000)

            const candidates = yield* taskRepo.findAll({
              status: ["backlog", "ready", "planning"],
              excludeClaimed: true,
              cursor,
              limit: pageSize
            })

            if (candidates.length === 0) {
              break
            }

            const candidateIds = candidates.map(t => t.id)

            // Batch dependency lookups for each page.
            const blockerIdsMap = yield* depRepo.getBlockerIdsForMany(candidateIds)
            const blockingIdsMap = yield* depRepo.getBlockingIdsForMany(candidateIds)
            const childIdsMap = yield* taskRepo.getChildIdsForMany(candidateIds)

            const allBlockerIds = new Set<string>()
            for (const blockerIds of blockerIdsMap.values()) {
              for (const id of blockerIds) {
                allBlockerIds.add(id)
              }
            }

            const blockerTasks = allBlockerIds.size > 0
              ? yield* taskRepo.findByIds([...allBlockerIds])
              : []
            const blockerStatusMap = new Map(blockerTasks.map(t => [t.id, t.status]))

            for (const task of candidates) {
              const blockerIds = blockerIdsMap.get(task.id) ?? []
              const blockingIds = blockingIdsMap.get(task.id) ?? []
              const childIds = childIdsMap.get(task.id) ?? []

              const allDone = blockerIds.length === 0 ||
                blockerIds.every(id => blockerStatusMap.get(id) === "done")

              if (allDone) {
                ready.push({
                  ...task,
                  blockedBy: blockerIds as TaskId[],
                  blocks: blockingIds as TaskId[],
                  children: childIds as TaskId[],
                  isReady: true,
                  groupContext: null,
                  effectiveGroupContext: null,
                  effectiveGroupContextSourceTaskId: null
                })
              }
            }

            const lastCandidate = candidates[candidates.length - 1]
            if (!lastCandidate) {
              break
            }
            cursor = { score: lastCandidate.score, id: lastCandidate.id }

            if (candidates.length < pageSize) {
              break
            }
          }

          ready.sort((a, b) => b.score - a.score)
          const limited = ready.slice(0, safeLimit)
          if (limited.length === 0) {
            return limited
          }

          // Resolve context only for the final response set to avoid expensive
          // graph traversal across the full candidate backlog.
          const limitedIds = limited.map(task => task.id)
          const directContextMap = yield* taskRepo.getGroupContextForMany(limitedIds)
          const effectiveContextMap = yield* taskRepo.resolveEffectiveGroupContextForMany(limitedIds)

          return limited.map((task) => {
            const effective = effectiveContextMap.get(task.id)
            return {
              ...task,
              groupContext: directContextMap.get(task.id) ?? null,
              effectiveGroupContext: effective?.context ?? null,
              effectiveGroupContextSourceTaskId: effective?.sourceTaskId ?? null
            }
          })
        }),

      isReady: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) return { _tag: "TaskNotFound" as const, id }
          if (!["backlog", "ready", "planning"].includes(task.status)) {
            return { _tag: "WrongStatus" as const, id, status: task.status }
          }

          const blockerIds = yield* depRepo.getBlockerIds(id)
          if (blockerIds.length === 0) return { _tag: "Ready" as const }

          const blockers = yield* taskRepo.findByIds(blockerIds)
          const pendingBlockerIds = blockers
            .filter(b => b.status !== "done")
            .map(b => b.id)

          if (pendingBlockerIds.length === 0) return { _tag: "Ready" as const }
          return { _tag: "Blocked" as const, id, pendingBlockerIds }
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
