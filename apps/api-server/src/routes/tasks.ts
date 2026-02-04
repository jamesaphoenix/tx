/**
 * Task Route Handlers
 *
 * Implements task endpoint handlers using Effect HttpApiBuilder.
 * All responses return TaskWithDeps per Doctrine Rule 1.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import type { TaskId, TaskWithDeps, TaskCursor, TaskStatus } from "@jamesaphoenix/tx-types"
import { isValidTaskStatus, TASK_STATUSES, serializeTask } from "@jamesaphoenix/tx-types"
import { TaskService, ReadyService, DependencyService, HierarchyService } from "@jamesaphoenix/tx-core"
import { TxApi, BadRequest, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Cursor Pagination Helpers
// -----------------------------------------------------------------------------

interface ParsedCursor {
  score: number
  id: string
}

const parseCursor = (cursor: string): ParsedCursor | null => {
  const colonIndex = cursor.lastIndexOf(":")
  if (colonIndex === -1) return null
  const score = parseInt(cursor.slice(0, colonIndex), 10)
  const id = cursor.slice(colonIndex + 1)
  if (isNaN(score)) return null
  return { score, id }
}

const buildCursor = (task: TaskWithDeps): string => {
  return `${task.score}:${task.id}`
}

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const TasksLive = HttpApiBuilder.group(TxApi, "tasks", (handlers) =>
  handlers
    .handle("listTasks", ({ urlParams }) =>
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const limit = urlParams.limit ?? 20

        // Validate status filter
        let statusFilter: TaskStatus[] | undefined
        if (urlParams.status) {
          const statuses = urlParams.status.split(",").filter(Boolean)
          const invalidStatuses = statuses.filter(s => !isValidTaskStatus(s))
          if (invalidStatuses.length > 0) {
            return yield* Effect.fail(
              new BadRequest({ message: `Invalid status values: ${invalidStatuses.join(", ")}. Valid: ${TASK_STATUSES.join(", ")}` })
            )
          }
          statusFilter = statuses as TaskStatus[]
        }

        // Parse cursor for keyset pagination
        let cursorObj: TaskCursor | undefined
        if (urlParams.cursor) {
          const parsed = parseCursor(urlParams.cursor)
          if (parsed) {
            cursorObj = { score: parsed.score, id: parsed.id }
          }
        }

        const filter = {
          status: statusFilter,
          search: urlParams.search,
          cursor: cursorObj,
          limit: limit + 1,
        }

        const total = yield* taskService.count({
          status: statusFilter,
          search: urlParams.search,
        })

        const tasks = yield* taskService.listWithDeps(filter)
        const hasMore = tasks.length > limit
        const resultTasks = hasMore ? tasks.slice(0, limit) : tasks

        return {
          tasks: resultTasks.map(serializeTask),
          nextCursor: hasMore && resultTasks.length > 0
            ? buildCursor(resultTasks[resultTasks.length - 1] as TaskWithDeps)
            : null,
          hasMore,
          total,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("readyTasks", ({ urlParams }) =>
      Effect.gen(function* () {
        const readyService = yield* ReadyService
        const limit = urlParams.limit ?? 100
        const tasks = yield* readyService.getReady(limit)
        return { tasks: tasks.map(serializeTask) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getTask", ({ path }) =>
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const task = yield* taskService.getWithDeps(path.id as TaskId)
        const blockedByTasks = yield* taskService.getWithDepsBatch(task.blockedBy)
        const blocksTasks = yield* taskService.getWithDepsBatch(task.blocks)
        const childTasks = yield* taskService.getWithDepsBatch(task.children)

        return {
          task: serializeTask(task),
          blockedByTasks: blockedByTasks.map(serializeTask),
          blocksTasks: blocksTasks.map(serializeTask),
          childTasks: childTasks.map(serializeTask),
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("createTask", ({ payload }) =>
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const created = yield* taskService.create({
          title: payload.title,
          description: payload.description,
          parentId: payload.parentId,
          score: payload.score,
          metadata: payload.metadata,
        })
        const task = yield* taskService.getWithDeps(created.id)
        return serializeTask(task)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("updateTask", ({ path, payload }) =>
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.update(path.id as TaskId, {
          title: payload.title,
          description: payload.description,
          status: payload.status,
          parentId: payload.parentId,
          score: payload.score,
          metadata: payload.metadata,
        })
        const task = yield* taskService.getWithDeps(path.id as TaskId)
        return serializeTask(task)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("completeTask", ({ path }) =>
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const readyService = yield* ReadyService

        const blocking = yield* readyService.getBlocking(path.id as TaskId)
        yield* taskService.update(path.id as TaskId, { status: "done" })
        const completedTask = yield* taskService.getWithDeps(path.id as TaskId)

        const candidateIds = blocking
          .filter(t => ["backlog", "ready", "planning"].includes(t.status))
          .map(t => t.id)
        const candidatesWithDeps = yield* taskService.getWithDepsBatch(candidateIds)
        const nowReady = candidatesWithDeps.filter(t => t.isReady)

        return {
          task: serializeTask(completedTask),
          nowReady: nowReady.map(serializeTask),
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("deleteTask", ({ path }) =>
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.remove(path.id as TaskId)
        return { success: true as const, id: path.id }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("blockTask", ({ path, payload }) =>
      Effect.gen(function* () {
        const depService = yield* DependencyService
        const taskService = yield* TaskService
        yield* depService.addBlocker(path.id as TaskId, payload.blockerId as TaskId)
        const task = yield* taskService.getWithDeps(path.id as TaskId)
        return serializeTask(task)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("unblockTask", ({ path }) =>
      Effect.gen(function* () {
        const depService = yield* DependencyService
        const taskService = yield* TaskService
        yield* depService.removeBlocker(path.id as TaskId, path.blockerId as TaskId)
        const task = yield* taskService.getWithDeps(path.id as TaskId)
        return serializeTask(task)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getTaskTree", ({ path }) =>
      Effect.gen(function* () {
        const hierarchyService = yield* HierarchyService
        const taskService = yield* TaskService
        const tree = yield* hierarchyService.getTree(path.id as TaskId)

        type TreeNode = { task: { id: TaskId }; children: readonly TreeNode[] }
        const flattenTree = (node: TreeNode): TaskId[] => {
          const ids: TaskId[] = [node.task.id]
          for (const child of node.children) {
            ids.push(...flattenTree(child))
          }
          return ids
        }

        const allIds = flattenTree(tree)
        const tasks = yield* taskService.getWithDepsBatch(allIds)
        return { tasks: tasks.map(serializeTask) }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
