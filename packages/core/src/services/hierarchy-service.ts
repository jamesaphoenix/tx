import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { TaskNotFoundError, DatabaseError } from "../errors.js"
import type { Task, TaskId, TaskTree } from "@jamesaphoenix/tx-types"

export class HierarchyService extends Context.Tag("HierarchyService")<
  HierarchyService,
  {
    readonly getChildren: (id: TaskId) => Effect.Effect<readonly Task[], TaskNotFoundError | DatabaseError>
    readonly getAncestors: (id: TaskId) => Effect.Effect<readonly Task[], TaskNotFoundError | DatabaseError>
    readonly getTree: (id: TaskId) => Effect.Effect<TaskTree, TaskNotFoundError | DatabaseError>
    readonly getDepth: (id: TaskId) => Effect.Effect<number, TaskNotFoundError | DatabaseError>
    readonly getRoots: () => Effect.Effect<readonly Task[], DatabaseError>
  }
>() {}

export const HierarchyServiceLive = Layer.effect(
  HierarchyService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository

    const buildTree = (task: Task): Effect.Effect<TaskTree, DatabaseError> =>
      Effect.gen(function* () {
        const childTasks = yield* taskRepo.findByParent(task.id)
        const childTrees: TaskTree[] = []
        for (const child of childTasks) {
          childTrees.push(yield* buildTree(child))
        }
        return { task, children: childTrees }
      })

    return {
      getChildren: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          return yield* taskRepo.findByParent(id)
        }),

      getAncestors: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }

          const ancestors: Task[] = []
          let currentId = task.parentId
          while (currentId !== null) {
            const parent = yield* taskRepo.findById(currentId)
            if (!parent) break
            ancestors.push(parent)
            currentId = parent.parentId
          }
          return ancestors
        }),

      getTree: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          return yield* buildTree(task)
        }),

      getDepth: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }

          let depth = 0
          let currentId = task.parentId
          while (currentId !== null) {
            const parent = yield* taskRepo.findById(currentId)
            if (!parent) break
            depth++
            currentId = parent.parentId
          }
          return depth
        }),

      getRoots: () => taskRepo.findByParent(null)
    }
  })
)
