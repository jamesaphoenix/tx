import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import { TaskNotFoundError, ValidationError, DatabaseError } from "../errors.js"
import { generateTaskId } from "../id.js"
import {
  type Task, type TaskId, type TaskWithDeps, type TaskFilter,
  type CreateTaskInput, type UpdateTaskInput,
  isValidTransition, isValidStatus
} from "../schema.js"

export class TaskService extends Context.Tag("TaskService")<
  TaskService,
  {
    readonly create: (input: CreateTaskInput) => Effect.Effect<Task, ValidationError | DatabaseError>
    readonly get: (id: TaskId) => Effect.Effect<Task, TaskNotFoundError | DatabaseError>
    readonly getWithDeps: (id: TaskId) => Effect.Effect<TaskWithDeps, TaskNotFoundError | DatabaseError>
    readonly getWithDepsBatch: (ids: readonly TaskId[]) => Effect.Effect<readonly TaskWithDeps[], DatabaseError>
    readonly update: (id: TaskId, input: UpdateTaskInput) => Effect.Effect<Task, TaskNotFoundError | ValidationError | DatabaseError>
    readonly remove: (id: TaskId) => Effect.Effect<void, TaskNotFoundError | DatabaseError>
    readonly list: (filter?: TaskFilter) => Effect.Effect<readonly Task[], DatabaseError>
    readonly listWithDeps: (filter?: TaskFilter) => Effect.Effect<readonly TaskWithDeps[], DatabaseError>
  }
>() {}

export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository
    const depRepo = yield* DependencyRepository

    const enrichWithDeps = (task: Task): Effect.Effect<TaskWithDeps, DatabaseError> =>
      Effect.gen(function* () {
        const blockerIds = yield* depRepo.getBlockerIds(task.id)
        const blockingIds = yield* depRepo.getBlockingIds(task.id)
        const childIds = yield* taskRepo.getChildIds(task.id)

        let isReady = ["backlog", "ready", "planning"].includes(task.status)
        if (isReady && blockerIds.length > 0) {
          const blockers = yield* taskRepo.findByIds(blockerIds)
          isReady = blockers.every(b => b.status === "done")
        }

        return {
          ...task,
          blockedBy: blockerIds as TaskId[],
          blocks: blockingIds as TaskId[],
          children: childIds as TaskId[],
          isReady
        }
      })

    return {
      create: (input) =>
        Effect.gen(function* () {
          if (!input.title || input.title.trim().length === 0) {
            return yield* Effect.fail(new ValidationError({ reason: "Title is required" }))
          }

          if (input.parentId) {
            const parent = yield* taskRepo.findById(input.parentId)
            if (!parent) {
              return yield* Effect.fail(new ValidationError({ reason: `Parent ${input.parentId} not found` }))
            }
          }

          const id = yield* generateTaskId()
          const now = new Date()
          const task: Task = {
            id: id as TaskId,
            title: input.title.trim(),
            description: input.description ?? "",
            status: "backlog",
            parentId: (input.parentId as TaskId) ?? null,
            score: input.score ?? 0,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            metadata: input.metadata ?? {}
          }

          yield* taskRepo.insert(task)
          return task
        }),

      get: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          return task
        }),

      getWithDeps: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          return yield* enrichWithDeps(task)
        }),

      getWithDepsBatch: (ids) =>
        Effect.gen(function* () {
          if (ids.length === 0) return []

          // Fetch all tasks in one query
          const tasks = yield* taskRepo.findByIds(ids)
          if (tasks.length === 0) return []

          const taskIds = tasks.map(t => t.id)

          // Batch fetch all dependency info
          const blockerIdsMap = yield* depRepo.getBlockerIdsForMany(taskIds)
          const blockingIdsMap = yield* depRepo.getBlockingIdsForMany(taskIds)
          const childIdsMap = yield* taskRepo.getChildIdsForMany(taskIds)

          // Collect all unique blocker IDs to fetch their status
          const allBlockerIds = new Set<TaskId>()
          for (const blockerIds of blockerIdsMap.values()) {
            for (const id of blockerIds) {
              allBlockerIds.add(id)
            }
          }

          // Fetch all blocker tasks to check their status
          const blockerTasks = allBlockerIds.size > 0
            ? yield* taskRepo.findByIds([...allBlockerIds])
            : []
          const blockerStatusMap = new Map<string, string>()
          for (const t of blockerTasks) {
            blockerStatusMap.set(t.id, t.status)
          }

          // Build TaskWithDeps for each task
          const results: TaskWithDeps[] = []
          for (const task of tasks) {
            const blockerIds = blockerIdsMap.get(task.id) ?? []
            const blockingIds = blockingIdsMap.get(task.id) ?? []
            const childIds = childIdsMap.get(task.id) ?? []

            // Compute isReady
            let isReady = ["backlog", "ready", "planning"].includes(task.status)
            if (isReady && blockerIds.length > 0) {
              isReady = blockerIds.every(bid => blockerStatusMap.get(bid) === "done")
            }

            results.push({
              ...task,
              blockedBy: blockerIds as TaskId[],
              blocks: blockingIds as TaskId[],
              children: childIds as TaskId[],
              isReady
            })
          }

          return results
        }),

      update: (id, input) =>
        Effect.gen(function* () {
          const existing = yield* taskRepo.findById(id)
          if (!existing) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }

          if (input.status && !isValidStatus(input.status)) {
            return yield* Effect.fail(new ValidationError({ reason: `Invalid status: ${input.status}` }))
          }

          if (input.status && input.status !== existing.status) {
            if (!isValidTransition(existing.status, input.status)) {
              return yield* Effect.fail(new ValidationError({
                reason: `Invalid transition: ${existing.status} -> ${input.status}`
              }))
            }
          }

          if (input.parentId) {
            const parent = yield* taskRepo.findById(input.parentId)
            if (!parent) {
              return yield* Effect.fail(new ValidationError({ reason: `Parent ${input.parentId} not found` }))
            }
          }

          const now = new Date()
          const isDone = input.status === "done" && existing.status !== "done"
          const updated: Task = {
            ...existing,
            title: input.title ?? existing.title,
            description: input.description ?? existing.description,
            status: input.status ?? existing.status,
            parentId: input.parentId !== undefined ? (input.parentId as TaskId | null) : existing.parentId,
            score: input.score ?? existing.score,
            updatedAt: now,
            completedAt: isDone ? now : existing.completedAt,
            metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata
          }

          yield* taskRepo.update(updated)
          return updated
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          yield* taskRepo.remove(id)
        }),

      list: (filter) => taskRepo.findAll(filter),

      listWithDeps: (filter) =>
        Effect.gen(function* () {
          const tasks = yield* taskRepo.findAll(filter)
          const results: TaskWithDeps[] = []
          for (const task of tasks) {
            results.push(yield* enrichWithDeps(task))
          }
          return results
        })
    }
  })
)
