import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { TaskNotFoundError, DatabaseError } from "../errors.js"
import type { Task, TaskId, TaskTree } from "@jamesaphoenix/tx-types"

export class HierarchyService extends Context.Tag("HierarchyService")<
  HierarchyService,
  {
    readonly getChildren: (id: TaskId) => Effect.Effect<readonly Task[], TaskNotFoundError | DatabaseError>
    readonly getAncestors: (id: TaskId) => Effect.Effect<readonly Task[], TaskNotFoundError | DatabaseError>
    readonly getTree: (id: TaskId, maxDepth?: number) => Effect.Effect<TaskTree, TaskNotFoundError | DatabaseError>
    readonly getDepth: (id: TaskId) => Effect.Effect<number, TaskNotFoundError | DatabaseError>
    readonly getRoots: () => Effect.Effect<readonly Task[], DatabaseError>
  }
>() {}

export const HierarchyServiceLive = Layer.effect(
  HierarchyService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository

    // Build tree from a flat list of tasks (root task first, then descendants)
    // This is O(n) in-memory after a single O(1) query
    // maxDepth limits in-memory recursion as defense-in-depth
    const buildTreeFromTasks = (tasks: readonly Task[], maxDepth: number): TaskTree | null => {
      if (tasks.length === 0) return null

      const rootTask = tasks[0]

      // Group tasks by parent_id
      const childrenByParent = new Map<string, Task[]>()
      for (const task of tasks) {
        if (task.parentId) {
          const siblings = childrenByParent.get(task.parentId) ?? []
          siblings.push(task)
          childrenByParent.set(task.parentId, siblings)
        }
      }

      // Recursively build tree nodes (in-memory, no DB queries)
      // Uses visited set to prevent infinite recursion from self-referencing tasks
      // currentDepth tracks recursion depth to enforce maxDepth limit
      const visited = new Set<string>()
      const buildNode = (task: Task, currentDepth: number): TaskTree => {
        if (visited.has(task.id) || currentDepth >= maxDepth) return { task, children: [] }
        visited.add(task.id)
        const childTasks = childrenByParent.get(task.id) ?? []
        return {
          task,
          children: childTasks.map((child) => buildNode(child, currentDepth + 1))
        }
      }

      return buildNode(rootTask, 0)
    }

    const buildTree = (task: Task, maxDepth: number): Effect.Effect<TaskTree, DatabaseError> =>
      Effect.gen(function* () {
        // Single query to get task and all descendants, limited by maxDepth
        const allTasks = yield* taskRepo.getDescendants(task.id, maxDepth)
        const tree = buildTreeFromTasks(allTasks, maxDepth)
        // This should always succeed since we start with a valid task
        return tree ?? { task, children: [] }
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
          // Use recursive CTE-based query (single query, not N+1)
          const chain = yield* taskRepo.getAncestorChain(id)
          if (chain.length === 0) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          // getAncestorChain returns [task, parent, grandparent, ...]
          // getAncestors should return [parent, grandparent, ...] (excluding the task itself)
          return chain.slice(1)
        }),

      getTree: (id, maxDepth = 10) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          return yield* buildTree(task, maxDepth)
        }),

      getDepth: (id) =>
        Effect.gen(function* () {
          // Use recursive CTE-based query (single query, not N+1)
          const chain = yield* taskRepo.getAncestorChain(id)
          if (chain.length === 0) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          // chain is [task, parent, grandparent, ...], so depth = chain.length - 1
          return chain.length - 1
        }),

      getRoots: () => taskRepo.findByParent(null)
    }
  })
)
