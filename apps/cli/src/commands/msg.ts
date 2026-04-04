/**
 * Message compound command: tx msg <send|inbox|ack|pending|gc>
 *
 * Groups messaging commands under a single namespace.
 */

import { Effect } from "effect"
import { send, inbox, ack, outboxPending, outboxGc } from "./outbox.js"
import { commandHelp } from "../help.js"
import { type Flags, flag } from "../utils/parse.js"
import { unknownSubcommandError } from "../cli-errors.js"

export const msg = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["msg"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `msg ${sub}`
      console.log(commandHelp[helpKey] ?? commandHelp["msg"])
      return
    }

    if (sub === "send") return yield* send(pos.slice(1), flags)
    if (sub === "inbox") return yield* inbox(pos.slice(1), flags)
    if (sub === "ack") return yield* ack(pos.slice(1), flags)
    if (sub === "pending") return yield* outboxPending(pos.slice(1), flags)
    if (sub === "gc") return yield* outboxGc(pos.slice(1), flags)

    return yield* Effect.fail(unknownSubcommandError({
      command: "msg",
      subcommand: sub,
      usage: "tx msg <send|inbox|ack|pending|gc>",
      examples: [
        "tx msg send worker-1 \"hello\"",
        "tx msg inbox worker-1 --json",
      ],
    }))
  })
