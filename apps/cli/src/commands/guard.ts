/**
 * Guard commands: set, show, clear
 *
 * Bounded autonomy — limits on task creation to prevent agent proliferation.
 */

import { Effect } from "effect"
import { GuardService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, opt, parseIntOpt } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

export const guard = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]
    if (!sub || sub === "show") {
      return yield* guardShow(pos.slice(1), flags)
    }
    if (sub === "set") return yield* guardSet(pos.slice(1), flags)
    if (sub === "clear") return yield* guardClear(pos.slice(1), flags)

    console.error(`Unknown guard subcommand: ${sub}`)
    console.error("Usage: tx guard [set|show|clear]")
    throw new CliExitError(1)
  })

const guardSet = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* GuardService

    const maxPending = parseIntOpt(flags, "max-pending", "max-pending")
    const maxChildren = parseIntOpt(flags, "max-children", "max-children")
    const maxDepth = parseIntOpt(flags, "max-depth", "max-depth")
    const enforceFlag = flag(flags, "enforce") ? true : flag(flags, "advisory") ? false : undefined

    // Must provide at least one limit or a mode change
    if (maxPending === undefined && maxChildren === undefined && maxDepth === undefined && enforceFlag === undefined) {
      console.error("Error: tx guard set requires at least one option.")
      console.error("  --max-pending <n>    Maximum pending tasks (>= 1)")
      console.error("  --max-children <n>   Maximum children per parent (>= 1)")
      console.error("  --max-depth <n>      Maximum hierarchy depth (>= 1)")
      console.error("  --enforce / --advisory   Guard mode")
      console.error("  --scope <scope>      Target scope (default: global)")
      throw new CliExitError(1)
    }

    // Validate positive values
    for (const [name, val] of [["max-pending", maxPending], ["max-children", maxChildren], ["max-depth", maxDepth]] as const) {
      if (val !== undefined && val < 1) {
        console.error(`Error: --${name} must be >= 1 (got ${val})`)
        throw new CliExitError(1)
      }
    }

    const result = yield* svc.set({
      scope: opt(flags, "scope") ?? "global",
      maxPending,
      maxChildren,
      maxDepth,
      enforce: enforceFlag,
    })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Guard updated (scope: ${result.scope})`)
      if (result.maxPending !== null) console.log(`  max_pending: ${result.maxPending}`)
      if (result.maxChildren !== null) console.log(`  max_children: ${result.maxChildren}`)
      if (result.maxDepth !== null) console.log(`  max_depth: ${result.maxDepth}`)
      console.log(`  mode: ${result.enforce ? "enforce" : "advisory"}`)
    }
  })

const guardShow = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* GuardService
    const guards = yield* svc.show()

    if (flag(flags, "json")) {
      console.log(toJson(guards))
    } else {
      if (guards.length === 0) {
        console.log("No guards configured. Use `tx guard set` to add limits.")
      } else {
        for (const g of guards) {
          console.log(`[${g.scope}] ${g.enforce ? "(enforce)" : "(advisory)"}`)
          if (g.maxPending !== null) console.log(`  max_pending:  ${g.maxPending}`)
          if (g.maxChildren !== null) console.log(`  max_children: ${g.maxChildren}`)
          if (g.maxDepth !== null) console.log(`  max_depth:    ${g.maxDepth}`)
        }
      }
    }
  })

const guardClear = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* GuardService
    const scope = opt(flags, "scope")
    const removed = yield* svc.clear(scope)

    if (flag(flags, "json")) {
      console.log(toJson({ removed, scope: scope ?? "all" }))
    } else {
      if (removed) {
        console.log(`Guard${scope ? ` (scope: ${scope})` : "s"} cleared`)
      } else {
        console.log("No guards to clear")
      }
    }
  })
