#!/usr/bin/env node
/**
 * TX CLI - Task management for AI agents and humans
 *
 * Main entry point for the tx command line tool.
 */

import { Effect } from "effect"
import { resolve } from "node:path"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { makeAppLayer } from "@jamesaphoenix/tx-core"
import { HELP_TEXT, commandHelp } from "./help.js"

// Command imports
import { add, list, ready, show, update, done, deleteTask, reset } from "./commands/task.js"
import { block, unblock } from "./commands/dep.js"
import { children, tree } from "./commands/hierarchy.js"
import { sync } from "./commands/sync.js"
import { learningAdd, learningSearch, learningRecent, learningHelpful, learningEmbed, context, learn, recall } from "./commands/learning.js"
import { tryAttempt, attempts } from "./commands/attempt.js"
import { migrate } from "./commands/migrate.js"
import { graphVerify, graphInvalidate, graphRestore, graphPrune, graphStatus, graphPin, graphUnpin, graphLink, graphShow, graphNeighbors } from "./commands/graph.js"
import { hooksInstall, hooksUninstall, hooksStatus } from "./commands/hooks.js"
import { daemon } from "./commands/daemon.js"
import { orchestrator } from "./commands/orchestrator.js"
import { worker } from "./commands/worker.js"
import { testCacheStats, testClearCache } from "./commands/test.js"

// --- Argv parsing helpers ---

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const args = argv.slice(2)
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  // Parse a flag at index idx, using valueCheckPrefix to determine if next arg is a value
  // Returns number of args consumed (1 for boolean flag, 2 for flag with value)
  function consumeFlag(idx: number, valueCheckPrefix: string): number {
    const arg = args[idx]
    const key = arg.startsWith("--") ? arg.slice(2) : arg.slice(1)
    const next = args[idx + 1]
    if (next && !next.startsWith(valueCheckPrefix)) {
      flags[key] = next
      return 2
    }
    flags[key] = true
    return 1
  }

  // Find the command (first non-flag argument), parsing any leading flags
  let command = "help"
  let startIdx = 0
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      i += consumeFlag(i, "-") - 1
    } else {
      command = args[i]
      startIdx = i + 1
      break
    }
  }

  // Parse remaining args: positional arguments and flags after command
  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith("--")) {
      i += consumeFlag(i, "--") - 1
    } else if (arg.startsWith("-")) {
      i += consumeFlag(i, "-") - 1
    } else {
      positional.push(arg)
    }
  }

  return { command, positional, flags }
}

function flag(flags: Record<string, string | boolean>, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

// --- Commands registry ---

const commands: Record<string, (positional: string[], flags: Record<string, string | boolean>) => Effect.Effect<void, any, any>> = {
  init: (_pos, _flags) =>
    Effect.sync(() => {
      // Layer construction already creates db + runs migrations
      // Just confirm it exists
      console.log("Initialized tx database")
      console.log("  Tables: tasks, task_dependencies, compaction_log, schema_version")
    }),

  add,
  list,
  ready,
  show,
  update,
  done,
  reset,
  delete: deleteTask,
  block,
  unblock,
  children,
  tree,
  sync,
  migrate,
  context,
  learn,
  recall,

  // Attempt commands
  try: tryAttempt,
  attempts,

  // Learning commands (colon-prefixed)
  "learning:add": learningAdd,
  "learning:search": learningSearch,
  "learning:recent": learningRecent,
  "learning:helpful": learningHelpful,
  "learning:embed": learningEmbed,

  // Graph commands (colon-prefixed)
  "graph:verify": graphVerify,
  "graph:invalidate": graphInvalidate,
  "graph:restore": graphRestore,
  "graph:prune": graphPrune,
  "graph:status": graphStatus,
  "graph:pin": graphPin,
  "graph:unpin": graphUnpin,
  "graph:link": graphLink,
  "graph:show": graphShow,
  "graph:neighbors": graphNeighbors,

  // Hooks commands (colon-prefixed)
  "hooks:install": hooksInstall,
  "hooks:uninstall": hooksUninstall,
  "hooks:status": hooksStatus,

  // Test commands (colon-prefixed)
  "test:cache-stats": testCacheStats,
  "test:clear-cache": testClearCache,

  // Daemon command (with subcommands)
  daemon,

  // Orchestrator command (with subcommands)
  orchestrator,

  // Worker command (with subcommands)
  worker,

  // Help command
  help: (pos) =>
    Effect.sync(() => {
      const subcommand = pos[0]
      if (subcommand && commandHelp[subcommand]) {
        console.log(commandHelp[subcommand])
        return
      }
      // Check for compound command help (e.g., tx help sync export)
      if (subcommand === "sync" && pos[1]) {
        const subcommandKey = `sync ${pos[1]}`
        if (commandHelp[subcommandKey]) {
          console.log(commandHelp[subcommandKey])
          return
        }
      }
      console.log(HELP_TEXT)
    }),
}

// --- Main ---

const { command, positional, flags: parsedFlags } = parseArgs(process.argv)

// Handle --version early, before any command processing
if (flag(parsedFlags, "version") || flag(parsedFlags, "v")) {
  console.log("tx v0.1.0")
  process.exit(0)
}

// Handle --help for specific command (tx add --help) or help command (tx help / tx help add)
if (flag(parsedFlags, "help") || flag(parsedFlags, "h")) {
  // Check for subcommand help (e.g., tx sync export --help, tx daemon start --help)
  if (command === "sync" && positional[0]) {
    const subcommandKey = `sync ${positional[0]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (command === "daemon" && positional[0]) {
    const subcommandKey = `daemon ${positional[0]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (command === "orchestrator" && positional[0]) {
    const subcommandKey = `orchestrator ${positional[0]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (command === "worker" && positional[0]) {
    const subcommandKey = `worker ${positional[0]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  // Check if we have a command with specific help
  if (command !== "help" && commandHelp[command]) {
    console.log(commandHelp[command])
    process.exit(0)
  }
  // Fall through to general help
  console.log(HELP_TEXT)
  process.exit(0)
}

// Handle 'tx help' and 'tx help <command>'
if (command === "help") {
  const subcommand = positional[0]
  // Check for compound command help (e.g., tx help sync export, tx help daemon start)
  if (subcommand === "sync" && positional[1]) {
    const subcommandKey = `sync ${positional[1]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (subcommand === "daemon" && positional[1]) {
    const subcommandKey = `daemon ${positional[1]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (subcommand === "orchestrator" && positional[1]) {
    const subcommandKey = `orchestrator ${positional[1]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (subcommand === "worker" && positional[1]) {
    const subcommandKey = `worker ${positional[1]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (subcommand && commandHelp[subcommand]) {
    console.log(commandHelp[subcommand])
  } else {
    console.log(HELP_TEXT)
  }
  process.exit(0)
}

// Handle mcp-server separately (will be moved to apps/mcp)
if (command === "mcp-server") {
  console.error("MCP server has been moved to a separate package.")
  console.error("Please use the @tx/mcp package or run from the monorepo root.")
  process.exit(1)
}

const handler = commands[command]
if (!handler) {
  console.error(`Unknown command: ${command}`)
  console.error(`Run 'tx help' for usage information`)
  process.exit(1)
}

const dbPath = typeof parsedFlags.db === "string"
  ? resolve(parsedFlags.db)
  : resolve(process.cwd(), ".tx", "tasks.db")

// For init, ensure directory exists
if (command === "init") {
  const dir = resolve(process.cwd(), ".tx")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  // Create .gitignore for .tx directory
  const gitignorePath = resolve(dir, ".gitignore")
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "tasks.db\ntasks.db-wal\ntasks.db-shm\n")
  }
}

const layer = makeAppLayer(dbPath)
const program = handler(positional, parsedFlags)

const runnable = Effect.provide(program, layer) as Effect.Effect<void, unknown>

Effect.runPromise(
  Effect.catchAll(runnable, (error: unknown) => {
    const err = error as { _tag?: string; message?: string }
    if (err._tag === "TaskNotFoundError") {
      console.error(err.message ?? `Task not found`)
      process.exit(2)
    }
    if (err._tag === "LearningNotFoundError") {
      console.error(err.message ?? `Learning not found`)
      process.exit(2)
    }
    if (err._tag === "AnchorNotFoundError") {
      console.error(err.message ?? `Anchor not found`)
      process.exit(2)
    }
    if (err._tag === "ValidationError") {
      console.error(err.message ?? `Validation error`)
      process.exit(1)
    }
    if (err._tag === "CircularDependencyError") {
      console.error(err.message ?? `Circular dependency detected`)
      process.exit(1)
    }
    if (err._tag === "DatabaseError") {
      console.error(err.message ?? `Database error`)
      process.exit(1)
    }
    console.error(`Error: ${err.message ?? String(error)}`)
    return Effect.sync(() => process.exit(1))
  })
).catch((err: unknown) => {
  console.error(`Fatal: ${err}`)
  process.exit(1)
})
