import { Effect } from "effect"
import { TaskService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, parseTaskId } from "../utils/parse.js"

/**
 * Group-context dispatcher: routes `tx group-context <subcommand>` to the appropriate handler.
 */
export const groupContext = (pos: string[], flags: Flags) => {
  const sub = pos[0]
  switch (sub) {
    case "set": return groupContextSet(pos.slice(1), flags)
    case "clear": return groupContextClear(pos.slice(1), flags)
    default: return Effect.sync(() => {
      console.log("Group context commands:")
      console.log("  tx group-context set <task-id> <context>   Set task-group context")
      console.log("  tx group-context clear <task-id>           Clear task-group context")
      console.log("")
      console.log("Run 'tx group-context <command> --help' for command-specific help.")
    })
  }
}

export const groupContextSet = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    const context = pos.slice(1).join(" ").trim()
    if (!rawId || context.length === 0) {
      console.error("Usage: tx group-context set <task-id> <context> [--json]")
      process.exit(1)
    }

    const taskId = parseTaskId(rawId)
    const taskService = yield* TaskService
    const task = yield* taskService.setGroupContext(taskId, context)

    if (flag(flags, "json")) {
      console.log(toJson(task))
    } else {
      console.log(`Updated group context: ${task.id}`)
      console.log(`  Source: ${task.effectiveGroupContextSourceTaskId ?? "(none)"}`)
      console.log(`  Effective: ${task.effectiveGroupContext ?? "(none)"}`)
    }
  })

export const groupContextClear = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    if (!rawId) {
      console.error("Usage: tx group-context clear <task-id> [--json]")
      process.exit(1)
    }

    const taskId = parseTaskId(rawId)
    const taskService = yield* TaskService
    const task = yield* taskService.clearGroupContext(taskId)

    if (flag(flags, "json")) {
      console.log(toJson(task))
    } else {
      console.log(`Cleared group context: ${task.id}`)
      console.log(`  Effective: ${task.effectiveGroupContext ?? "(none)"}`)
      console.log(`  Source: ${task.effectiveGroupContextSourceTaskId ?? "(none)"}`)
    }
  })
