import { Effect } from "effect"
import { add, list, ready, show, update, done, reset, deleteTask } from "./task.js"
import { dep } from "./dep-compound.js"
import { bulk } from "./bulk.js"
import { label } from "./label.js"
import { commandHelp } from "../help.js"
import { unknownSubcommandError } from "../cli-errors.js"
import type { Flags } from "../utils/parse.js"
const handlers = { add, list, ready, show, update, done, reset, delete: deleteTask, dep, bulk, label }
export const taskCommand = (pos: string[], flags: Flags) => Effect.gen(function* () {
  const sub = pos[0]
  if (!sub || sub === "help") { console.log(commandHelp.task); return }
  const handler = handlers[sub as keyof typeof handlers]
  if (!handler) return yield* Effect.fail(unknownSubcommandError({ command: "task", subcommand: sub, usage: "tx task <command>" }))
  yield* handler(pos.slice(1), flags)
})
