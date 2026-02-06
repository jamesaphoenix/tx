/**
 * Hierarchy commands: children, tree
 */

import { Effect } from "effect"
import { TaskService } from "@jamesaphoenix/tx-core"
import type { TaskWithDeps } from "@jamesaphoenix/tx-types"
import { toJson, formatTaskLine } from "../output.js"
import { type Flags, flag, parseTaskId } from "../utils/parse.js"

export const children = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const raw = pos[0]
    if (!raw) {
      console.error("Usage: tx children <id> [--json]")
      process.exit(1)
    }
    const id = parseTaskId(raw)

    const svc = yield* TaskService
    const parent = yield* svc.getWithDeps(id)
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
    const raw = pos[0]
    if (!raw) {
      console.error("Usage: tx tree <id> [--json]")
      process.exit(1)
    }
    const id = parseTaskId(raw)

    const svc = yield* TaskService

    // Recursive tree builder
    const buildTree = (taskId: string, depth: number): Effect.Effect<void, unknown, TaskService> =>
      Effect.gen(function* () {
        const task = yield* svc.getWithDeps(parseTaskId(taskId))
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
