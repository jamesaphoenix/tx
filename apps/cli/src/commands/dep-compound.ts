/**
 * Dependency compound command: tx dep <block|unblock|children|tree>
 *
 * Groups dependency and hierarchy commands under a single namespace.
 */

import { Effect } from "effect"
import { block, unblock } from "./dep.js"
import { children, tree } from "./hierarchy.js"
import { commandHelp } from "../help.js"
import { type Flags, flag } from "../utils/parse.js"
import { unknownSubcommandError } from "../cli-errors.js"

export const dep = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["dep"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `dep ${sub}`
      console.log(commandHelp[helpKey] ?? commandHelp["dep"])
      return
    }

    if (sub === "block") return yield* block(pos.slice(1), flags)
    if (sub === "unblock") return yield* unblock(pos.slice(1), flags)
    if (sub === "children") return yield* children(pos.slice(1), flags)
    if (sub === "tree") return yield* tree(pos.slice(1), flags)

    return yield* Effect.fail(unknownSubcommandError({
      command: "dep",
      subcommand: sub,
      usage: "tx dep <block|unblock|children|tree>",
      examples: [
        "tx dep block tx-abc123 tx-def456",
        "tx dep tree tx-abc123",
      ],
    }))
  })
