/**
 * Diagnostics compound command: tx diag <stats|doctor|dashboard>
 *
 * Groups diagnostic commands under a single namespace.
 */

import { Effect } from "effect"
import { stats } from "./stats.js"
import { doctor } from "./doctor.js"
import { dashboard } from "./dashboard.js"
import { commandHelp } from "../help.js"
import { type Flags, flag } from "../utils/parse.js"
import { unknownSubcommandError } from "../cli-errors.js"

export const diag = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["diag"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `diag ${sub}`
      console.log(commandHelp[helpKey] ?? commandHelp["diag"])
      return
    }

    if (sub === "stats") return yield* stats(pos.slice(1), flags)
    if (sub === "doctor") return yield* doctor(pos.slice(1), flags)
    if (sub === "dashboard") return yield* dashboard(pos.slice(1), flags)

    return yield* Effect.fail(unknownSubcommandError({
      command: "diag",
      subcommand: sub,
      usage: "tx diag <stats|doctor|dashboard>",
      examples: [
        "tx diag stats",
        "tx diag doctor --json",
      ],
    }))
  })
