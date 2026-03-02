/**
 * CLI commands for tx pin — Context Pins
 *
 * CRUD for named content blocks synced to agent context files.
 */

import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { PinService } from "@jamesaphoenix/tx-core"
import { commandHelp } from "../help.js"
import { CliExitError } from "../cli-exit.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

function opt(flags: Flags, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === "string") return v
  }
  return undefined
}

/** Read content from stdin if piped (not a TTY). */
const readStdin = (): string | null => {
  try {
    if (process.stdin.isTTY) return null
    // Use fd 0 directly instead of /dev/stdin path for cross-platform compatibility
    return readFileSync(0, "utf-8") || null
  } catch {
    return null
  }
}

// --- Subcommands ---

const pinSet = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* PinService
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx pin set <id> [content] [--file <path>]")
      throw new CliExitError(1)
    }

    // Determine content: positional > --file > stdin
    const filePath = opt(flags, "file", "f")
    let content: string | undefined

    if (pos.length > 1) {
      content = pos.slice(1).join(" ")
    } else if (filePath) {
      try {
        content = readFileSync(filePath, "utf-8")
      } catch {
        console.error(`Error reading file: ${filePath}`)
        throw new CliExitError(1)
      }
    } else {
      // Try stdin
      const stdin = readStdin()
      if (stdin) content = stdin.trim()
    }

    if (!content) {
      console.error("No content provided. Pass content as argument, --file <path>, or pipe via stdin.")
      throw new CliExitError(1)
    }

    const pin = yield* svc.set(id, content)

    if (flag(flags, "json")) {
      console.log(JSON.stringify(pin, null, 2))
    } else {
      console.log(`Pin "${pin.id}" set (${pin.content.length} chars)`)
    }
  })

const pinGet = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* PinService
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx pin get <id>")
      throw new CliExitError(1)
    }

    const pin = yield* svc.get(id)
    if (!pin) {
      console.error(`Pin not found: ${id}`)
      throw new CliExitError(1)
    }

    if (flag(flags, "json")) {
      console.log(JSON.stringify(pin, null, 2))
    } else {
      console.log(pin.content)
    }
  })

const pinRm = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* PinService
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx pin rm <id>")
      throw new CliExitError(1)
    }

    const deleted = yield* svc.remove(id)
    if (!deleted) {
      console.error(`Pin not found: ${id}`)
      throw new CliExitError(1)
    }

    if (flag(flags, "json")) {
      console.log(JSON.stringify({ deleted: true, id }))
    } else {
      console.log(`Pin "${id}" removed`)
    }
  })

const pinList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* PinService
    const pins = yield* svc.list()

    if (flag(flags, "json")) {
      console.log(JSON.stringify(pins, null, 2))
      return
    }

    if (pins.length === 0) {
      console.log("No pins. Use 'tx pin set <id> <content>' to create one.")
      return
    }

    for (const pin of pins) {
      const preview = pin.content.length > 60
        ? pin.content.slice(0, 60).replace(/\n/g, " ") + "..."
        : pin.content.replace(/\n/g, " ")
      console.log(`  ${pin.id}  ${preview}`)
    }
    console.log(`\n${pins.length} pin(s)`)
  })

const pinSync = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* PinService
    const result = yield* svc.sync()

    if (flag(flags, "json")) {
      console.log(JSON.stringify(result, null, 2))
    } else if (result.synced.length === 0) {
      console.log("No target files configured. Run: tx pin targets CLAUDE.md")
    } else {
      console.log(`Synced to: ${result.synced.join(", ")}`)
    }
  })

const pinTargets = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* PinService

    if (pos.length === 0) {
      // Show current targets
      const targets = yield* svc.getTargetFiles()
      if (flag(flags, "json")) {
        console.log(JSON.stringify({ files: targets }))
      } else {
        console.log(`Target files: ${targets.join(", ")}`)
      }
      return
    }

    // Set targets
    yield* svc.setTargetFiles(pos)
    if (flag(flags, "json")) {
      console.log(JSON.stringify({ files: pos }))
    } else {
      console.log(`Target files set: ${pos.join(", ")}`)
    }
  })

// --- Main dispatcher ---

export const pin = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["pin"] ?? "Usage: tx pin <set|get|rm|list|sync|targets>")
      return
    }

    switch (sub) {
      case "set": return yield* pinSet(pos.slice(1), flags)
      case "get": return yield* pinGet(pos.slice(1), flags)
      case "rm": return yield* pinRm(pos.slice(1), flags)
      case "remove": return yield* pinRm(pos.slice(1), flags)
      case "list": return yield* pinList(pos.slice(1), flags)
      case "sync": return yield* pinSync(pos.slice(1), flags)
      case "targets": return yield* pinTargets(pos.slice(1), flags)
      default:
        console.error(`Unknown pin subcommand: ${sub}`)
        console.log(commandHelp["pin"] ?? "Usage: tx pin <set|get|rm|list|sync|targets>")
        throw new CliExitError(1)
    }
  })
