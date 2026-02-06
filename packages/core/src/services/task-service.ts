import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import { TaskNotFoundError, ValidationError, DatabaseError, StaleDataError, HasChildrenError } from "../errors.js"
import { generateTaskId, isUniqueConstraintError } from "../id.js"
import { isValidTransition, isValidStatus } from "../mappers/task.js"
import type { Task, TaskId, TaskStatus, TaskWithDeps, TaskFilter, CreateTaskInput, UpdateTaskInput } from "@jamesaphoenix/tx-types"

export class TaskService extends Context.Tag("TaskService")<
  TaskService,
  {
    readonly create: (input: CreateTaskInput) => Effect.Effect<Task, ValidationError | DatabaseError>
    readonly get: (id: TaskId) => Effect.Effect<Task, TaskNotFoundError | DatabaseError>
    readonly getWithDeps: (id: TaskId) => Effect.Effect<TaskWithDeps, TaskNotFoundError | DatabaseError>
    readonly getWithDepsBatch: (ids: readonly TaskId[]) => Effect.Effect<readonly TaskWithDeps[], DatabaseError>
    readonly update: (id: TaskId, input: UpdateTaskInput) => Effect.Effect<Task, TaskNotFoundError | ValidationError | DatabaseError | StaleDataError>
    readonly forceStatus: (id: TaskId, status: TaskStatus) => Effect.Effect<Task, TaskNotFoundError | ValidationError | DatabaseError>
    readonly remove: (id: TaskId, options?: { cascade?: boolean }) => Effect.Effect<void, TaskNotFoundError | HasChildrenError | DatabaseError>
    readonly list: (filter?: TaskFilter) => Effect.Effect<readonly Task[], DatabaseError>
    readonly listWithDeps: (filter?: TaskFilter) => Effect.Effect<readonly TaskWithDeps[], DatabaseError>
    readonly count: (filter?: TaskFilter) => Effect.Effect<number, DatabaseError>
  }
>() {}

/**
 * Regex matching all Unicode whitespace (\s) and invisible format characters
 * (\p{Cf} — zero-width spaces, directional marks, joiners, soft hyphens, etc.).
 * Used to detect titles that appear empty despite containing invisible chars.
 */
const INVISIBLE_RE = /[\s\p{Cf}]/gu

/** Returns true if the string contains at least one visible character. */
const hasVisibleContent = (s: string): boolean =>
  s.replace(INVISIBLE_RE, "").length > 0

/** Strips leading/trailing whitespace AND invisible format characters. */
const trimVisible = (s: string): string =>
  s.replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, "")

/** Max recursion depth for destructive operations that must find ALL descendants.
 *  Bounded to avoid unbounded CTE recursion in SQLite while being deep enough
 *  for any realistic task hierarchy (display default is 10). */
const CASCADE_MAX_DEPTH = 1000

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

    // Batch version of enrichWithDeps - avoids N+1 queries
    const enrichWithDepsBatch = (tasks: readonly Task[]): Effect.Effect<readonly TaskWithDeps[], DatabaseError> =>
      Effect.gen(function* () {
        if (tasks.length === 0) return []

        const taskIds = tasks.map(t => t.id)

        // Batch fetch all dependency info (3 queries total instead of 3N)
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

        // Fetch all blocker tasks to check their status (1 query instead of N)
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
      })

    // Auto-complete parent task when all children are done
    // Optimized to use batch queries instead of N+1 recursive queries
    // Old implementation: 3-4 queries per hierarchy level (40+ for deep trees)
    // New implementation: 3 queries total + 1 batch update
    const autoCompleteParent = (parentId: TaskId, now: Date): Effect.Effect<void, DatabaseError | TaskNotFoundError | StaleDataError> =>
      Effect.gen(function* () {
        // 1. Get all ancestors in one query (recursive CTE)
        const ancestors = yield* taskRepo.getAncestorChain(parentId)
        if (ancestors.length === 0) return

        // Filter out already-done ancestors (nothing to auto-complete)
        const pendingAncestors = ancestors.filter(a => a.status !== "done")
        if (pendingAncestors.length === 0) return

        // 2. Batch get all children for all pending ancestors (1 query)
        const ancestorIds = pendingAncestors.map(a => a.id)
        const childIdsMap = yield* taskRepo.getChildIdsForMany(ancestorIds)

        // 3. Collect all unique child IDs and batch fetch them (1 query)
        const allChildIds = new Set<string>()
        for (const childIds of childIdsMap.values()) {
          for (const id of childIds) {
            allChildIds.add(id)
          }
        }

        const childTasks = allChildIds.size > 0
          ? yield* taskRepo.findByIds([...allChildIds])
          : []

        // Build status map for quick lookups
        const childStatusMap = new Map<string, string>()
        for (const child of childTasks) {
          childStatusMap.set(child.id, child.status)
        }

        // 4. Process ancestors in order (parent -> grandparent -> ...)
        // Track which ones should be auto-completed
        const toComplete: Task[] = []
        const nowCompletedIds = new Set<string>()

        for (const ancestor of pendingAncestors) {
          const childIds = childIdsMap.get(ancestor.id) ?? []
          if (childIds.length === 0) continue

          // Check if all children are done
          // Include children we're about to mark as done in this pass
          const allChildrenDone = childIds.every(childId => {
            if (nowCompletedIds.has(childId)) return true
            return childStatusMap.get(childId) === "done"
          })

          if (allChildrenDone) {
            // Mark for completion
            toComplete.push({
              ...ancestor,
              status: "done",
              updatedAt: now,
              completedAt: now
            })
            // Track so parent levels can see this ancestor is now done
            nowCompletedIds.add(ancestor.id)
          } else {
            // If this ancestor can't be completed, neither can its ancestors
            break
          }
        }

        // 5. Batch update all auto-completed ancestors (1 transaction)
        if (toComplete.length > 0) {
          yield* taskRepo.updateMany(toComplete)
        }
      })

    return {
      create: (input) =>
        Effect.gen(function* () {
          if (!input.title || !hasVisibleContent(input.title)) {
            return yield* Effect.fail(new ValidationError({ reason: "Title is required" }))
          }

          if (input.score !== undefined && !Number.isFinite(input.score)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Score must be a finite number, got: ${input.score}`
            }))
          }

          if (input.parentId) {
            const parent = yield* taskRepo.findById(input.parentId)
            if (!parent) {
              return yield* Effect.fail(new ValidationError({ reason: `Parent ${input.parentId} not found` }))
            }
          }

          const now = new Date()
          const makeTask = (id: string): Task => ({
            id: id as TaskId,
            title: trimVisible(input.title),
            description: input.description ?? "",
            status: "backlog",
            parentId: (input.parentId as TaskId) ?? null,
            score: input.score ?? 0,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            metadata: input.metadata ?? {}
          })

          // Retry up to 3 times on ID collision (UNIQUE constraint)
          const MAX_ID_RETRIES = 3
          for (let attempt = 0; attempt <= MAX_ID_RETRIES; attempt++) {
            const id = yield* generateTaskId()
            const task = makeTask(id)
            const result = yield* taskRepo.insert(task).pipe(
              Effect.map(() => task as Task | null),
              Effect.catchTag("DatabaseError", (e) => {
                if (attempt < MAX_ID_RETRIES && isUniqueConstraintError(e.cause)) {
                  return Effect.succeed(null as Task | null)
                }
                return Effect.fail(e)
              })
            )
            if (result !== null) return result
          }
          // Should not reach here — last attempt throws on failure
          return yield* Effect.fail(new DatabaseError({ cause: new Error("Task ID collision after max retries") }))
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
          const tasks = yield* taskRepo.findByIds(ids)
          return yield* enrichWithDepsBatch(tasks)
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

          if (input.title !== undefined && !hasVisibleContent(input.title)) {
            return yield* Effect.fail(new ValidationError({ reason: "Title is required" }))
          }

          if (input.score !== undefined && !Number.isFinite(input.score)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Score must be a finite number, got: ${input.score}`
            }))
          }

          if (input.parentId) {
            if (input.parentId === id) {
              return yield* Effect.fail(new ValidationError({ reason: "Task cannot be its own parent" }))
            }

            const parent = yield* taskRepo.findById(input.parentId)
            if (!parent) {
              return yield* Effect.fail(new ValidationError({ reason: `Parent ${input.parentId} not found` }))
            }

            // Cycle detection: walk up from the proposed parent's ancestors.
            // If the task being updated appears in that chain, setting parentId
            // would create a cycle (e.g. A->B->C->A).
            const ancestors = yield* taskRepo.getAncestorChain(input.parentId)
            if (ancestors.some(a => a.id === id)) {
              return yield* Effect.fail(new ValidationError({
                reason: `Setting parent to ${input.parentId} would create a parent-child cycle`
              }))
            }
          }

          const now = new Date()
          const isDone = input.status === "done" && existing.status !== "done"
          const updated: Task = {
            ...existing,
            title: input.title !== undefined ? trimVisible(input.title) : existing.title,
            description: input.description ?? existing.description,
            status: input.status ?? existing.status,
            parentId: input.parentId !== undefined ? (input.parentId as TaskId | null) : existing.parentId,
            score: input.score ?? existing.score,
            updatedAt: now,
            completedAt: isDone ? now : existing.completedAt,
            metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata
          }

          yield* taskRepo.update(updated)

          // Auto-complete parent if all children are done
          if (isDone && updated.parentId) {
            yield* autoCompleteParent(updated.parentId, now)
          }

          return updated
        }),

      forceStatus: (id, status) =>
        Effect.gen(function* () {
          const existing = yield* taskRepo.findById(id)
          if (!existing) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }

          if (!isValidStatus(status)) {
            return yield* Effect.fail(new ValidationError({ reason: `Invalid status: ${status}` }))
          }

          const now = new Date()
          const isDone = status === "done" && existing.status !== "done"
          const updated: Task = {
            ...existing,
            status,
            updatedAt: now,
            completedAt: isDone ? now : (status !== "done" ? null : existing.completedAt)
          }

          yield* taskRepo.update(updated)
          return updated
        }),

      remove: (id, options) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }

          const childIds = yield* taskRepo.getChildIds(id)

          if (childIds.length > 0 && !options?.cascade) {
            return yield* Effect.fail(new HasChildrenError({ id, childIds }))
          }

          if (childIds.length > 0 && options?.cascade) {
            // Delete all descendants depth-first, excluding the root (deleted below)
            const descendants = yield* taskRepo.getDescendants(id, CASCADE_MAX_DEPTH)
            const descendantIds = [...descendants]
              .filter(t => t.id !== id)
              .reverse()
              .map(t => t.id)

            // Explicitly clean up dependency edges for all tasks being deleted
            // (root + descendants). While FK ON DELETE CASCADE would handle this,
            // explicit cleanup is defense-in-depth and makes the intent clear.
            const allIdsToDelete = [...descendantIds, id]
            yield* depRepo.removeByTaskIds(allIdsToDelete)

            for (const descId of descendantIds) {
              yield* taskRepo.remove(descId)
            }
          } else {
            // Non-cascade: clean up edges for just the root task
            yield* depRepo.removeByTaskIds([id])
          }

          yield* taskRepo.remove(id)
        }),

      list: (filter) => taskRepo.findAll(filter),

      listWithDeps: (filter) =>
        Effect.gen(function* () {
          const tasks = yield* taskRepo.findAll(filter)
          return yield* enrichWithDepsBatch(tasks)
        }),

      count: (filter) => taskRepo.count(filter)
    }
  })
)
