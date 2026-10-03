import { Context, Effect } from "effect"
import { TaskRepository } from "../../repo/task-repo.js"
import { DependencyRepository } from "../../repo/dep-repo.js"
import { DocRepository } from "../../repo/doc-repo.js"
import { DatabaseError, StaleDataError, TaskNotFoundError } from "../../errors.js"
import type { Task, TaskId, TaskWithDeps, TaskLinkedDocRef } from "../../types/index.js"



type InternalDeps = {
  readonly taskRepo: Context.Tag.Service<typeof TaskRepository>
  readonly depRepo: Context.Tag.Service<typeof DependencyRepository>
  readonly docRepo?: Context.Tag.Service<typeof DocRepository>
}

/**
 * Max recursion depth for destructive operations that must find ALL descendants.
 * Bounded to avoid unbounded CTE recursion in SQLite while being deep enough
 * for any realistic task hierarchy (display default is 10).
 */
export const CASCADE_MAX_DEPTH = 1000

const isWorkableStatus = (status: string): boolean =>
  ["backlog", "ready", "planning", "active"].includes(status)

export const enrichWithDeps = (
  deps: InternalDeps,
  task: Task
): Effect.Effect<TaskWithDeps, DatabaseError> =>
  Effect.gen(function* () {
    const blockerIds = yield* deps.depRepo.getBlockerIds(task.id)
    const blockingIds = yield* deps.depRepo.getBlockingIds(task.id)
    const childIds = yield* deps.taskRepo.getChildIds(task.id)

    let isReady = isWorkableStatus(task.status)
    if (isReady && blockerIds.length > 0) {
      const blockers = yield* deps.taskRepo.findByIds(blockerIds)
      isReady = blockers.every(b => b.status === "done")
    }


    const linkedDocs = deps.docRepo
      ? yield* deps.docRepo.getDocsForTask(task.id)
      : []

    return {
      ...task,
      blockedBy: blockerIds as TaskId[],
      blocks: blockingIds as TaskId[],
      children: childIds as TaskId[],
      isReady,
      linkedDocs,
    }
  })

export const enrichWithDepsBatch = (
  deps: InternalDeps,
  tasks: readonly Task[]
): Effect.Effect<readonly TaskWithDeps[], DatabaseError> =>
  Effect.gen(function* () {
    if (tasks.length === 0) return []

    const taskIds = tasks.map(t => t.id)

    // Batch fetch all dependency info (3 queries total instead of 3N)
    const blockerIdsMap = yield* deps.depRepo.getBlockerIdsForMany(taskIds)
    const blockingIdsMap = yield* deps.depRepo.getBlockingIdsForMany(taskIds)
    const childIdsMap = yield* deps.taskRepo.getChildIdsForMany(taskIds)

    // Collect all unique blocker IDs to fetch their status
    const allBlockerIds = new Set<TaskId>()
    for (const blockerIds of blockerIdsMap.values()) {
      for (const id of blockerIds) {
        allBlockerIds.add(id)
      }
    }

    // Fetch all blocker tasks to check their status (1 query instead of N)
    const blockerTasks = allBlockerIds.size > 0
      ? yield* deps.taskRepo.findByIds([...allBlockerIds])
      : []
    const blockerStatusMap = new Map<string, string>()
    for (const t of blockerTasks) {
      blockerStatusMap.set(t.id, t.status)
    }

    const linkedDocsMap = deps.docRepo
      ? yield* deps.docRepo.getDocsForManyTasks(taskIds)
      : new Map<string, readonly TaskLinkedDocRef[]>()

    // Build TaskWithDeps for each task
    const results: TaskWithDeps[] = []
    for (const task of tasks) {
      const blockerIds = blockerIdsMap.get(task.id) ?? []
      const blockingIds = blockingIdsMap.get(task.id) ?? []
      const childIds = childIdsMap.get(task.id) ?? []

      // Compute isReady
      let isReady = isWorkableStatus(task.status)
      if (isReady && blockerIds.length > 0) {
        isReady = blockerIds.every(bid => blockerStatusMap.get(bid) === "done")
      }

        results.push({
        ...task,
        blockedBy: blockerIds as TaskId[],
        blocks: blockingIds as TaskId[],
        children: childIds as TaskId[],
        isReady,
        linkedDocs: [...(linkedDocsMap.get(task.id) ?? [])],
      })
    }

    return results
  })

/**
 * Auto-complete parent task when all children are done.
 * Optimized to use batch queries instead of N+1 recursive queries.
 */
export const autoCompleteParent = (
  taskRepo: Context.Tag.Service<typeof TaskRepository>,
  parentId: TaskId,
  now: Date,
  options?: { readonly blockedTaskIds?: ReadonlySet<TaskId> }
): Effect.Effect<void, DatabaseError | TaskNotFoundError | StaleDataError> =>
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
    const blockedTaskIds = options?.blockedTaskIds

    for (const ancestor of pendingAncestors) {
      if (blockedTaskIds?.has(ancestor.id)) {
        break
      }

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
