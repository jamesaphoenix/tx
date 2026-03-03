/**
 * Verify commands: set, show, run, clear
 *
 * Machine-checkable done criteria — attach shell commands to tasks.
 */

import { Effect } from "effect"
import { VerifyService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, opt, parseIntOpt, parseTaskId } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

export const verify = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]
    if (!sub) {
      console.error("Usage: tx verify [set|show|run|clear] <id> [options]")
      throw new CliExitError(1)
    }
    if (sub === "set") return yield* verifySet(pos.slice(1), flags)
    if (sub === "show") return yield* verifyShow(pos.slice(1), flags)
    if (sub === "run") return yield* verifyRun(pos.slice(1), flags)
    if (sub === "clear") return yield* verifyClear(pos.slice(1), flags)

    console.error(`Unknown verify subcommand: ${sub}`)
    console.error("Usage: tx verify [set|show|run|clear] <id>")
    throw new CliExitError(1)
  })

const verifySet = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    // Join all remaining positional args to support unquoted multi-word commands
    // e.g. tx verify set tx-abc123 bun run test:unit → cmd = "bun run test:unit"
    const cmd = pos.slice(1).join(" ")
    if (!rawId || !cmd) {
      console.error("Usage: tx verify set <id> <command> [--schema <path>]")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)
    const schema = opt(flags, "schema")

    const svc = yield* VerifyService
    yield* svc.set(id, cmd, schema)

    if (flag(flags, "json")) {
      console.log(toJson({ taskId: id, cmd, schema: schema ?? null }))
    } else {
      console.log(`Verify command set for ${id}`)
      console.log(`  cmd: ${cmd}`)
      if (schema) console.log(`  schema: ${schema}`)
    }
  })

const verifyShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    if (!rawId) {
      console.error("Usage: tx verify show <id>")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)
    const svc = yield* VerifyService
    const result = yield* svc.show(id)

    if (flag(flags, "json")) {
      console.log(toJson({ taskId: id, ...result }))
    } else {
      if (result.cmd) {
        console.log(`Verify for ${id}:`)
        console.log(`  cmd: ${result.cmd}`)
        if (result.schema) console.log(`  schema: ${result.schema}`)
      } else {
        console.log(`No verify command set for ${id}`)
      }
    }
  })

const verifyRun = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    if (!rawId) {
      console.error("Usage: tx verify run <id> [--timeout <seconds>] [--json]")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)
    const timeout = parseIntOpt(flags, "timeout", "timeout")

    const svc = yield* VerifyService
    const result = yield* svc.run(id, { timeout })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      const icon = result.passed ? "\u2713" : "\u2717"
      console.log(`${icon} Verify ${result.passed ? "PASSED" : "FAILED"} (exit ${result.exitCode}, ${result.durationMs}ms)`)
      if (result.stdout.trim()) {
        console.log(result.stdout.trim())
      }
      if (result.stderr.trim()) {
        console.error(result.stderr.trim())
      }
    }

    if (!result.passed) {
      throw new CliExitError(1)
    }
  })

const verifyClear = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]
    if (!rawId) {
      console.error("Usage: tx verify clear <id>")
      throw new CliExitError(1)
    }
    const id = parseTaskId(rawId)
    const svc = yield* VerifyService

    // Check if there was a command before clearing
    const existing = yield* svc.show(id)
    yield* svc.clear(id)

    const wasSet = existing.cmd !== null
    if (flag(flags, "json")) {
      console.log(toJson({ taskId: id, cleared: wasSet }))
    } else {
      if (wasSet) {
        console.log(`Verify command cleared for ${id}`)
      } else {
        console.log(`No verify command was set for ${id}`)
      }
    }
  })
