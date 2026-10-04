/**
 * Invariant commands: invariant list, invariant show, invariant record, invariant sync
 */

import { Effect } from "effect"
import { DocService } from "@jamesaphoenix/tx"
import { toJson } from "../output.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { CliUserError, unknownSubcommandError, usageError } from "../cli-errors.js"

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
      return Effect.fail(unknownSubcommandError({command:"spec invariant",subcommand:sub ?? "(none)",
        usage:"tx spec invariant <list|show|sync|record> [options]"}))
  }
}

const invariantList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subsystem = opt(flags, "subsystem", "s") ?? undefined
    const enforcement = opt(flags, "enforcement", "e") ?? undefined

    const svc = yield* DocService
    const invariants = yield* svc.listInvariants({ doc:opt(flags,"doc"), subsystem, enforcement })

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
      return yield* Effect.fail(usageError({message:"An invariant ID is required.",
        usage:"tx spec invariant show <id> [--json]"}))
    }

    const svc = yield* DocService
    const all = yield* svc.listInvariants()
    const inv = all.find(i => i.id === id)
    if (!inv) {
      return yield* Effect.fail(new CliUserError({code:"service/invariant-not-found",
        message:`Invariant not found: ${id}`,exitCode:2,
        hint:"Run `tx spec invariant list` to see available invariants."}))
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
      return yield* Effect.fail(usageError({message:"An invariant ID is required.",
        usage:"tx spec invariant record <id> --passed|--failed [--details <text>] [--json]"}))
    }

    const passed = flag(flags, "passed")
    const failed = flag(flags, "failed")
    if (passed === failed) {
      return yield* Effect.fail(usageError({message:"Specify exactly one of --passed or --failed",
        usage:"tx spec invariant record <id> --passed|--failed [--json]"}))
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
        console.log("No invariants found in document schema blocks")
      } else {
        console.log(`Synced ${synced.length} invariant(s):`)
        for (const inv of synced) {
          const sub = inv.subsystem ? ` [${inv.subsystem}]` : " [system]"
          console.log(`  ${inv.id}${sub} (${inv.enforcement}) ${inv.rule.slice(0, 60)}`)
        }
      }
    }
  })
