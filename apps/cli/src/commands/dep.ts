/**
 * Dependency commands: block, unblock
 */

import { Effect } from "effect"
import { TaskService, DependencyService } from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

export const block = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const blocker = pos[1]
    if (!id || !blocker) {
      console.error("Usage: tx block <task-id> <blocker-id> [--json]")
      process.exit(1)
    }

    const depSvc = yield* DependencyService
    const taskSvc = yield* TaskService

    yield* depSvc.addBlocker(id as TaskId, blocker as TaskId)
    const task = yield* taskSvc.getWithDeps(id as TaskId)

    if (flag(flags, "json")) {
      console.log(toJson({ success: true, task }))
    } else {
      console.log(`${blocker} now blocks ${id}`)
      console.log(`  ${id} blocked by: ${task.blockedBy.join(", ")}`)
    }
  })

export const unblock = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const blocker = pos[1]
    if (!id || !blocker) {
      console.error("Usage: tx unblock <task-id> <blocker-id> [--json]")
      process.exit(1)
    }

    const depSvc = yield* DependencyService
    const taskSvc = yield* TaskService

    yield* depSvc.removeBlocker(id as TaskId, blocker as TaskId)
    const task = yield* taskSvc.getWithDeps(id as TaskId)

    if (flag(flags, "json")) {
      console.log(toJson({ success: true, task }))
    } else {
      console.log(`${blocker} no longer blocks ${id}`)
      console.log(`  ${id} blocked by: ${task.blockedBy.length > 0 ? task.blockedBy.join(", ") : "(none)"}`)
    }
  })
