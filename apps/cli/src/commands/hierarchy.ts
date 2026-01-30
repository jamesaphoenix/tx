/**
 * Hierarchy commands: children, tree
 */

import { Effect } from "effect"
import { TaskService } from "@tx/core"
import type { TaskId, TaskWithDeps } from "@tx/types"
import { toJson, formatTaskLine } from "../output.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

export const children = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx children <id> [--json]")
      process.exit(1)
    }

    const svc = yield* TaskService
    const parent = yield* svc.getWithDeps(id as TaskId)
    const childTasks = yield* svc.listWithDeps({ parentId: id })

    if (flag(flags, "json")) {
      console.log(toJson(childTasks))
    } else {
      if (childTasks.length === 0) {
        console.log(`No children for ${parent.id} - ${parent.title}`)
      } else {
        console.log(`${childTasks.length} child(ren) of ${parent.id} - ${parent.title}:`)
        for (const c of childTasks) {
          console.log(formatTaskLine(c))
        }
      }
    }
  })

export const tree = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx tree <id> [--json]")
      process.exit(1)
    }

    const svc = yield* TaskService

    // Recursive tree builder
    const buildTree = (taskId: string, depth: number): Effect.Effect<void, unknown, TaskService> =>
      Effect.gen(function* () {
        const task = yield* svc.getWithDeps(taskId as TaskId)
        const indent = "  ".repeat(depth)
        const readyMark = task.isReady ? "+" : " "

        if (flag(flags, "json") && depth === 0) {
          // For JSON, collect the full tree
          const collectTree = (t: TaskWithDeps): Effect.Effect<unknown, unknown, TaskService> =>
            Effect.gen(function* () {
              const childTasks = yield* svc.listWithDeps({ parentId: t.id })
              const childTrees = []
              for (const c of childTasks) {
                childTrees.push(yield* collectTree(c))
              }
              return { ...t, childTasks: childTrees }
            })
          const treeData = yield* collectTree(task)
          console.log(toJson(treeData))
          return
        }

        console.log(`${indent}${readyMark} ${task.id} [${task.status}] [${task.score}] ${task.title}`)

        const childTasks = yield* svc.listWithDeps({ parentId: taskId })
        for (const child of childTasks) {
          yield* buildTree(child.id, depth + 1)
        }
      })

    yield* buildTree(id, 0)
  })
