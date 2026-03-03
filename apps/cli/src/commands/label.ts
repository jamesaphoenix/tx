/**
 * Label commands: add, remove, assign, unassign, list
 *
 * Ready queue scoping — filter tasks by labels.
 */

import { Effect } from "effect"
import { LabelRepository } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, parseTaskId } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

export const label = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]
    if (!sub || sub === "list") {
      return yield* labelList(flags)
    }
    if (sub === "add") return yield* labelAdd(pos.slice(1), flags)
    if (sub === "remove" || sub === "delete") return yield* labelRemove(pos.slice(1), flags)
    if (sub === "assign") return yield* labelAssign(pos.slice(1), flags)
    if (sub === "unassign") return yield* labelUnassign(pos.slice(1), flags)

    console.error(`Unknown label subcommand: ${sub}`)
    console.error("Usage: tx label [add|delete|assign|unassign|list]")
    throw new CliExitError(1)
  })

const labelAdd = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx label add <name> [--color <hex>]")
      throw new CliExitError(1)
    }
    const color = (typeof flags.color === "string" ? flags.color : null) ?? "#6b7280"

    const repo = yield* LabelRepository
    const result = yield* repo.create(name, color)

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Label created: ${result.name} (${result.color})`)
    }
  })

const labelRemove = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx label delete <name>")
      throw new CliExitError(1)
    }

    const repo = yield* LabelRepository
    const removed = yield* repo.remove(name)

    if (flag(flags, "json")) {
      console.log(toJson({ removed, name }))
    } else {
      if (removed) {
        console.log(`Label removed: ${name}`)
      } else {
        console.log(`Label not found: ${name}`)
      }
    }
  })

const labelAssign = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    const name = pos[1]
    if (!rawId || !name) {
      console.error("Usage: tx label assign <task-id> <label-name>")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)

    const repo = yield* LabelRepository
    yield* repo.assign(id, name).pipe(
      Effect.catchTags({
        TaskNotFoundError: () => {
          console.error(`Error: Task ${id} not found`)
          return Effect.die(new CliExitError(1))
        },
        LabelNotFoundError: (e) => {
          console.error(`Error: ${e.message}. Create it first with: tx label add "${name}"`)
          return Effect.die(new CliExitError(1))
        },
      })
    )

    if (flag(flags, "json")) {
      console.log(toJson({ taskId: id, label: name }))
    } else {
      console.log(`Label "${name}" assigned to ${id}`)
    }
  })

const labelUnassign = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    const name = pos[1]
    if (!rawId || !name) {
      console.error("Usage: tx label unassign <task-id> <label-name>")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)

    const repo = yield* LabelRepository
    const result = yield* repo.unassign(id, name)

    if (flag(flags, "json")) {
      console.log(toJson({ taskId: id, label: name, removed: result === "removed", reason: result }))
    } else {
      if (result === "removed") {
        console.log(`Label "${name}" removed from ${id}`)
      } else if (result === "label_not_found") {
        console.error(`Label "${name}" not found. Use \`tx label list\` to see available labels.`)
        throw new CliExitError(1)
      } else {
        console.log(`Label "${name}" was not assigned to ${id}`)
      }
    }
  })

const labelList = (flags: Flags) =>
  Effect.gen(function* () {
    const repo = yield* LabelRepository
    const labels = yield* repo.findAll()

    if (flag(flags, "json")) {
      console.log(toJson(labels))
    } else {
      if (labels.length === 0) {
        console.log("No labels defined. Use `tx label add <name>` to create one.")
      } else {
        console.log(`${labels.length} label(s):`)
        for (const l of labels) {
          console.log(`  ${l.name} (${l.color})`)
        }
      }
    }
  })
