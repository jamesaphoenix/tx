import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import { GuardRepository } from "../repo/guard-repo.js"
import { PinRepository } from "../repo/pin-repo.js"
import { TaskNotFoundError, ValidationError, DatabaseError, GuardExceededError, StaleDataError, HasChildrenError } from "../errors.js"
import { generateTaskId, isUniqueConstraintError } from "../id.js"
import { isValidTransition, isValidStatus } from "../mappers/task.js"
import { readTxConfig } from "../utils/toml-config.js"
import { CASCADE_MAX_DEPTH, autoCompleteParent, checkGuards, enrichWithDeps, enrichWithDepsBatch, listGateTaskLinks } from "./task-service/internals.js"
import type { Task, TaskId, TaskStatus, TaskWithDeps, TaskFilter, CreateTaskInput, UpdateTaskInput, TaskAssigneeType } from "@jamesaphoenix/tx-types"

export class TaskService extends Context.Tag("TaskService")<
  TaskService,
  {
    readonly create: (input: CreateTaskInput) => Effect.Effect<Task, ValidationError | DatabaseError | GuardExceededError>
    readonly get: (id: TaskId) => Effect.Effect<Task, TaskNotFoundError | DatabaseError>
    readonly getWithDeps: (id: TaskId) => Effect.Effect<TaskWithDeps, TaskNotFoundError | DatabaseError>
    readonly getWithDepsBatch: (ids: readonly TaskId[]) => Effect.Effect<readonly TaskWithDeps[], DatabaseError>
    readonly update: (
      id: TaskId,
      input: UpdateTaskInput,
      options?: { actor?: "agent" | "human" }
    ) => Effect.Effect<Task, TaskNotFoundError | ValidationError | DatabaseError | StaleDataError>
    readonly setGroupContext: (
      id: TaskId,
      context: string
    ) => Effect.Effect<TaskWithDeps, TaskNotFoundError | ValidationError | DatabaseError>
    readonly clearGroupContext: (id: TaskId) => Effect.Effect<TaskWithDeps, TaskNotFoundError | DatabaseError>
    readonly forceStatus: (id: TaskId, status: TaskStatus) => Effect.Effect<Task, TaskNotFoundError | ValidationError | DatabaseError | StaleDataError>
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

/** Strips null bytes (\0) which cause C API truncation, JSON issues, and terminal corruption. */
const stripNullBytes = (s: string): string => s.replace(/\0/g, "")

const isValidAssigneeType = (
  assigneeType: TaskAssigneeType | null | undefined
): assigneeType is TaskAssigneeType | null =>
  assigneeType === undefined || assigneeType === null || assigneeType === "human" || assigneeType === "agent"

const GROUP_CONTEXT_MAX_CHARS = 20_000

export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository
    const depRepo = yield* DependencyRepository
    const guardRepo = yield* GuardRepository
    const pinRepo = yield* PinRepository
    const config = readTxConfig()

    return {
      create: (input) =>
        Effect.gen(function* () {
          const title = stripNullBytes(input.title)
          const description = input.description !== undefined ? stripNullBytes(input.description) : undefined

          if (!title || !hasVisibleContent(title)) {
            return yield* Effect.fail(new ValidationError({ reason: "Title is required" }))
          }

          if (input.score !== undefined && !Number.isFinite(input.score)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Score must be a finite number, got: ${input.score}`
            }))
          }

          if (!isValidAssigneeType(input.assigneeType)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Invalid assigneeType: ${String(input.assigneeType)}`
            }))
          }

          if (input.parentId) {
            const parent = yield* taskRepo.findById(input.parentId)
            if (!parent) {
              return yield* Effect.fail(new ValidationError({ reason: `Parent ${input.parentId} not found` }))
            }
          }

          // Guard check: enforce task creation limits, collect advisory warnings
          const guardWarnings = yield* checkGuards(guardRepo, config, input.parentId ?? null)

          const assigneeType = input.assigneeType ?? null
          const assigneeId = assigneeType === null ? null : (input.assigneeId ?? null)
          const assignedAt = assigneeType === null ? null : (input.assignedAt ?? null)
          const assignedBy = assigneeType === null ? null : (input.assignedBy ?? null)

          const now = new Date()
          const makeTask = (id: string): Task => ({
            id: id as TaskId,
            title: trimVisible(title),
            description: description ?? "",
            status: "backlog",
            parentId: (input.parentId as TaskId) ?? null,
            score: input.score ?? 0,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            assigneeType,
            assigneeId,
            assignedAt,
            assignedBy,
            metadata: guardWarnings.length > 0
              ? { ...(input.metadata ?? {}), _guardWarnings: guardWarnings }
              : input.metadata ?? {}
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
          return yield* enrichWithDeps({ taskRepo, depRepo }, task)
        }),

      getWithDepsBatch: (ids) =>
        Effect.gen(function* () {
          if (ids.length === 0) return []
          const tasks = yield* taskRepo.findByIds(ids)
          return yield* enrichWithDepsBatch({ taskRepo, depRepo }, tasks)
        }),

      update: (id, input, options) =>
        Effect.gen(function* () {
          const existing = yield* taskRepo.findById(id)
          if (!existing) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }

          const title = input.title !== undefined ? stripNullBytes(input.title) : undefined
          const description = input.description !== undefined ? stripNullBytes(input.description) : undefined

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

          if (title !== undefined && !hasVisibleContent(title)) {
            return yield* Effect.fail(new ValidationError({ reason: "Title is required" }))
          }

          if (input.score !== undefined && !Number.isFinite(input.score)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Score must be a finite number, got: ${input.score}`
            }))
          }

          if (!isValidAssigneeType(input.assigneeType)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Invalid assigneeType: ${String(input.assigneeType)}`
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
          const actor = options?.actor ?? "agent"
          const isDone = input.status === "done" && existing.status !== "done"
          const shouldBlockAgentDoneForPinnedTasks =
            isDone &&
            actor === "agent" &&
            config.pins.blockAgentDoneWhenTaskIdPresent
          const linkedGatePins = shouldBlockAgentDoneForPinnedTasks
            ? yield* listGateTaskLinks(pinRepo)
            : new Map<TaskId, readonly string[]>()

          if (isDone && actor === "agent") {
            const childIds = yield* taskRepo.getChildIds(id)
            if (childIds.length > 0) {
              const children = yield* taskRepo.findByIds(childIds)
              const incompleteChildIds = children
                .filter((child) => child.status !== "done")
                .map((child) => child.id)

              if (incompleteChildIds.length > 0) {
                return yield* Effect.fail(new ValidationError({
                  reason: `Agent cannot mark parent task ${id} done while children are incomplete: ${incompleteChildIds.join(", ")}`
                }))
              }
            }
          }

          if (shouldBlockAgentDoneForPinnedTasks) {
            const blockingGateIds = linkedGatePins.get(id)
            if (blockingGateIds && blockingGateIds.length > 0) {
              return yield* Effect.fail(new ValidationError({
                reason: `Agent cannot mark task ${id} done because it is linked by gate pin(s): ${blockingGateIds.join(", ")}`
              }))
            }
          }

          const assigneeTypeChanged =
            input.assigneeType !== undefined && input.assigneeType !== existing.assigneeType
          const assigneeIdChanged =
            input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId

          let nextAssigneeType = input.assigneeType !== undefined ? input.assigneeType : existing.assigneeType
          let nextAssigneeId = input.assigneeId !== undefined ? input.assigneeId : existing.assigneeId
          let nextAssignedAt = input.assignedAt !== undefined ? input.assignedAt : existing.assignedAt
          let nextAssignedBy = input.assignedBy !== undefined ? input.assignedBy : existing.assignedBy

          if (nextAssigneeType === null) {
            nextAssigneeId = null
            nextAssignedAt = null
            nextAssignedBy = null
          } else if ((assigneeTypeChanged || assigneeIdChanged) && input.assignedAt === undefined) {
            nextAssignedAt = now
          }

          const updated: Task = {
            ...existing,
            title: title !== undefined ? trimVisible(title) : existing.title,
            description: description ?? existing.description,
            status: input.status ?? existing.status,
            parentId: input.parentId !== undefined ? (input.parentId as TaskId | null) : existing.parentId,
            score: input.score ?? existing.score,
            updatedAt: now,
            completedAt: isDone ? now : existing.completedAt,
            assigneeType: nextAssigneeType,
            assigneeId: nextAssigneeId,
            assignedAt: nextAssignedAt,
            assignedBy: nextAssignedBy,
            metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata
          }

          yield* taskRepo.update(updated, existing.updatedAt)

          // Auto-complete parent if all children are done
          if (isDone && updated.parentId) {
            yield* autoCompleteParent(taskRepo, updated.parentId, now, {
              blockedTaskIds: shouldBlockAgentDoneForPinnedTasks
                ? new Set(linkedGatePins.keys())
                : undefined
            })
          }

          return updated
        }),

      setGroupContext: (id, context) =>
        Effect.gen(function* () {
          const sanitized = stripNullBytes(context)
          const normalized = trimVisible(sanitized)
          if (!hasVisibleContent(sanitized)) {
            return yield* Effect.fail(new ValidationError({
              reason: "Group context is required"
            }))
          }
          if (normalized.length > GROUP_CONTEXT_MAX_CHARS) {
            return yield* Effect.fail(new ValidationError({
              reason: `Group context must be at most ${GROUP_CONTEXT_MAX_CHARS} characters`
            }))
          }

          yield* taskRepo.setGroupContext(id, normalized)
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          return yield* enrichWithDeps({ taskRepo, depRepo }, task)
        }),

      clearGroupContext: (id) =>
        Effect.gen(function* () {
          yield* taskRepo.clearGroupContext(id)
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          return yield* enrichWithDeps({ taskRepo, depRepo }, task)
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

          yield* taskRepo.update(updated, existing.updatedAt)
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
          return yield* enrichWithDepsBatch({ taskRepo, depRepo }, tasks)
        }),

      count: (filter) => taskRepo.count(filter)
    }
  })
)
