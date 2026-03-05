import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, TaskNotFoundError, StaleDataError } from "../errors.js"
import { createTaskRepository } from "./task-repo/factory.js"
import type { Task, TaskId, TaskFilter } from "@jamesaphoenix/tx-types"

export type EffectiveGroupContext = {
  readonly sourceTaskId: TaskId
  readonly context: string
}

export type TaskRepositoryService = {
  readonly findById: (id: string) => Effect.Effect<Task | null, DatabaseError>
  readonly findByIds: (ids: readonly string[]) => Effect.Effect<readonly Task[], DatabaseError>
  readonly findAll: (filter?: TaskFilter) => Effect.Effect<readonly Task[], DatabaseError>
  readonly findByParent: (parentId: string | null) => Effect.Effect<readonly Task[], DatabaseError>
  readonly getChildIds: (id: string) => Effect.Effect<readonly TaskId[], DatabaseError>
  readonly getChildIdsForMany: (ids: readonly string[]) => Effect.Effect<Map<string, readonly TaskId[]>, DatabaseError>
  readonly getAncestorChain: (id: string) => Effect.Effect<readonly Task[], DatabaseError>
  readonly getDescendants: (id: string, maxDepth?: number) => Effect.Effect<readonly Task[], DatabaseError>
  readonly getGroupContextForMany: (ids: readonly string[]) => Effect.Effect<Map<string, string>, DatabaseError>
  readonly resolveEffectiveGroupContextForMany: (
    ids: readonly string[]
  ) => Effect.Effect<Map<string, EffectiveGroupContext>, DatabaseError>
  readonly insert: (task: Task) => Effect.Effect<void, DatabaseError>
  readonly update: (task: Task, expectedUpdatedAt?: Date) => Effect.Effect<void, DatabaseError | TaskNotFoundError | StaleDataError>
  readonly updateMany: (tasks: readonly Task[]) => Effect.Effect<void, DatabaseError | TaskNotFoundError | StaleDataError>
  readonly setGroupContext: (taskId: string, context: string) => Effect.Effect<void, DatabaseError | TaskNotFoundError>
  readonly clearGroupContext: (taskId: string) => Effect.Effect<void, DatabaseError | TaskNotFoundError>
  readonly remove: (id: string) => Effect.Effect<void, DatabaseError | TaskNotFoundError>
  readonly count: (filter?: TaskFilter) => Effect.Effect<number, DatabaseError>
  /**
   * Atomically recover a task's status based on blocker states.
   * Uses a single UPDATE with subquery to eliminate TOCTOU races.
   * Sets status to 'ready' if all blockers are done, 'blocked' otherwise.
   * Only updates if the task's current status matches expectedStatus.
   * Returns true if a row was updated, false if no matching row found.
   */
  readonly recoverTaskStatus: (
    taskId: string,
    expectedStatus: string
  ) => Effect.Effect<boolean, DatabaseError>
  readonly updateVerifyCmd: (
    taskId: string,
    cmd: string | null,
    schema: string | null
  ) => Effect.Effect<void, DatabaseError | TaskNotFoundError>
  readonly getVerifyCmd: (
    taskId: string
  ) => Effect.Effect<{ cmd: string | null; schema: string | null }, DatabaseError>
}

export class TaskRepository extends Context.Tag("TaskRepository")<
  TaskRepository,
  TaskRepositoryService
>() {}

export const TaskRepositoryLive = Layer.effect(
  TaskRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    return createTaskRepository(db)
  })
)
