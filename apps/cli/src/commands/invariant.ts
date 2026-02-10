/**
 * Invariant commands: invariant list, invariant show, invariant record, invariant sync
 */

import { Effect } from "effect"
import { DocService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

/** Dispatch invariant subcommands. */
export const invariant = (pos: string[], flags: Flags) => {
  const sub = pos[0]
  const rest = pos.slice(1)
  switch (sub) {
    case "list": return invariantList(rest, flags)
    case "show": return invariantShow(rest, flags)
    case "record": return invariantRecord(rest, flags)
    case "sync": return invariantSync(rest, flags)
    default:
      return Effect.sync(() => {
        console.error(`Unknown invariant subcommand: ${sub ?? "(none)"}`)
        console.error("Run 'tx invariant --help' for usage information")
        throw new CliExitError(1)
      })
  }
}

const invariantList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subsystem = opt(flags, "subsystem", "s") ?? undefined
    const enforcement = opt(flags, "enforcement", "e") ?? undefined

    const svc = yield* DocService
    const invariants = yield* svc.listInvariants({ subsystem, enforcement })

    if (flag(flags, "json")) {
      console.log(toJson(invariants))
    } else {
      if (invariants.length === 0) {
        console.log("No invariants found")
      } else {
        console.log(`${invariants.length} invariant(s):`)
        for (const inv of invariants) {
          const sub = inv.subsystem ? ` [${inv.subsystem}]` : " [system]"
          const statusIcon = inv.status === "active" ? "●" : "○"
          console.log(`  ${statusIcon} ${inv.id}${sub} (${inv.enforcement})`)
          console.log(`    ${inv.rule}`)
        }
      }
    }
  })

const invariantShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx invariant show <id>")
      throw new CliExitError(1)
    }

    const svc = yield* DocService
    const all = yield* svc.listInvariants()
    const inv = all.find(i => i.id === id)
    if (!inv) {
      console.error(`Invariant not found: ${id}`)
      throw new CliExitError(1)
    }

    if (flag(flags, "json")) {
      console.log(toJson(inv))
    } else {
      console.log(`Invariant: ${inv.id}`)
      console.log(`  Rule: ${inv.rule}`)
      console.log(`  Enforcement: ${inv.enforcement}`)
      console.log(`  Status: ${inv.status}`)
      console.log(`  Subsystem: ${inv.subsystem ?? "system"}`)
      if (inv.testRef) console.log(`  Test ref: ${inv.testRef}`)
      if (inv.lintRule) console.log(`  Lint rule: ${inv.lintRule}`)
      if (inv.promptRef) console.log(`  Prompt ref: ${inv.promptRef}`)
      console.log(`  Created: ${inv.createdAt.toISOString()}`)
    }
  })

const invariantRecord = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx invariant record <id> --passed|--failed [--details <text>]")
      throw new CliExitError(1)
    }

    const passed = flag(flags, "passed")
    const failed = flag(flags, "failed")
    if (!passed && !failed) {
      console.error("Must specify --passed or --failed")
      throw new CliExitError(1)
    }

    const details = opt(flags, "details", "d") ?? undefined
    const svc = yield* DocService
    const check = yield* svc.recordInvariantCheck(id, passed, details)

    if (flag(flags, "json")) {
      console.log(toJson(check))
    } else {
      const icon = check.passed ? "✓" : "✗"
      console.log(`${icon} Recorded check for ${id}: ${check.passed ? "PASSED" : "FAILED"}`)
      if (check.details) console.log(`  Details: ${check.details}`)
      console.log(`  Checked at: ${check.checkedAt.toISOString()}`)
    }
  })

const invariantSync = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const docName = opt(flags, "doc") ?? undefined

    const svc = yield* DocService
    const synced = yield* svc.syncInvariants(docName)

    if (flag(flags, "json")) {
      console.log(toJson({ synced: synced.length, invariants: synced }))
    } else {
      if (synced.length === 0) {
        console.log("No invariants found in doc YAML files")
      } else {
        console.log(`Synced ${synced.length} invariant(s):`)
        for (const inv of synced) {
          const sub = inv.subsystem ? ` [${inv.subsystem}]` : " [system]"
          console.log(`  ${inv.id}${sub} (${inv.enforcement}) ${inv.rule.slice(0, 60)}`)
        }
      }
    }
  })
