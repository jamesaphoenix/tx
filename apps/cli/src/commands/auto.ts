/**
 * Autonomy compound command: tx auto <guard|gate|verify|label|reflect>
 *
 * Groups bounded autonomy commands under a single namespace.
 */

import { Effect } from "effect"
import { guard } from "./guard.js"
import { gate } from "./gate.js"
import { verify } from "./verify.js"
import { label } from "./label.js"
import { reflect } from "./reflect.js"
import { commandHelp } from "../help.js"
import { type Flags, flag } from "../utils/parse.js"
import { unknownSubcommandError } from "../cli-errors.js"

export const auto = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["auto"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `auto ${sub}`
      console.log(commandHelp[helpKey] ?? commandHelp["auto"])
      return
    }

    if (sub === "guard") return yield* guard(pos.slice(1), flags)
    if (sub === "gate") return yield* gate(pos.slice(1), flags)
    if (sub === "verify") return yield* verify(pos.slice(1), flags)
    if (sub === "label") return yield* label(pos.slice(1), flags)
    if (sub === "reflect") return yield* reflect(pos.slice(1), flags)

    return yield* Effect.fail(unknownSubcommandError({
      command: "auto",
      subcommand: sub,
      usage: "tx auto <guard|gate|verify|label|reflect>",
      examples: [
        "tx auto guard show",
        "tx auto gate list",
      ],
    }))
  })
