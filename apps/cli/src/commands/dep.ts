import { CliExitError } from "../cli-exit.js"
/**
 * Dependency commands: block, unblock
 */

import { Effect } from "effect"
import { TaskService, DependencyService } from "@jamesaphoenix/tx"
import { toJson } from "../output.js"
import { type Flags, flag, parseTaskId } from "../utils/parse.js"

export const block = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    const rawBlocker = pos[1]
    if (!rawId || !rawBlocker) {
      console.error("Usage: tx dep block <task-id> <blocker-id> [--json]")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)
    const blocker = parseTaskId(rawBlocker)

    const depSvc = yield* DependencyService
    const taskSvc = yield* TaskService

    yield* depSvc.addBlocker(id, blocker)
    const task = yield* taskSvc.getWithDeps(id)

    if (flag(flags, "json")) {
      console.log(toJson({ success: true, task }))
    } else {
      console.log(`${blocker} now blocks ${id}`)
      console.log(`  ${id} blocked by: ${task.blockedBy.join(", ")}`)
    }
  })

export const unblock = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    const rawBlocker = pos[1]
    if (!rawId || !rawBlocker) {
      console.error("Usage: tx dep unblock <task-id> <blocker-id> [--json]")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)
    const blocker = parseTaskId(rawBlocker)

    const depSvc = yield* DependencyService
    const taskSvc = yield* TaskService

    yield* depSvc.removeBlocker(id, blocker)
    const task = yield* taskSvc.getWithDeps(id)

    if (flag(flags, "json")) {
      console.log(toJson({ success: true, task }))
    } else {
      console.log(`${blocker} no longer blocks ${id}`)
      console.log(`  ${id} blocked by: ${task.blockedBy.length > 0 ? task.blockedBy.join(", ") : "(none)"}`)
    }
  })
