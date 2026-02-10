#!/usr/bin/env node
/**
 * TX CLI - Task management for AI agents and humans
 *
 * Main entry point for the tx command line tool.
 */

import { Effect, Cause, Option, Layer } from "effect"
import { resolve } from "node:path"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { makeAppLayer, AgentServiceLive, CycleScanServiceLive } from "@jamesaphoenix/tx-core"
import { HELP_TEXT, commandHelp } from "./help.js"
import { CliExitError } from "./cli-exit.js"
import { CLI_VERSION } from "./version.js"

// Command imports
import { add, list, ready, show, update, done, deleteTask, reset } from "./commands/task.js"
import { block, unblock } from "./commands/dep.js"
import { children, tree } from "./commands/hierarchy.js"
import { sync } from "./commands/sync.js"
import { learningAdd, learningSearch, learningRecent, learningHelpful, learningEmbed, context, learn, recall } from "./commands/learning.js"
import { tryAttempt, attempts } from "./commands/attempt.js"
import { migrate } from "./commands/migrate.js"
import { cycle } from "./commands/cycle.js"
import { trace } from "./commands/trace.js"
import { claim, claimRelease, claimRenew } from "./commands/claim.js"
import { compact, history } from "./commands/compact.js"
import { validate } from "./commands/validate.js"
import { doctor } from "./commands/doctor.js"
import { stats } from "./commands/stats.js"
import { bulk } from "./commands/bulk.js"
import { dashboard } from "./commands/dashboard.js"
import { send, inbox, ack, ackAll, outboxPending, outboxGc } from "./commands/outbox.js"
import { doc } from "./commands/doc.js"
import { invariant } from "./commands/invariant.js"

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

const commands: Record<string, (positional: string[], flags: Record<string, string | boolean>) => Effect.Effect<void, unknown, unknown>> = {
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

  // Cycle scan (PRD-023)
  cycle,

  // Claim commands (PRD-018)
  claim,
  "claim:release": claimRelease,
  "claim:renew": claimRenew,

  // Trace command (with subcommands)
  trace,

  // Compaction commands (PRD-006)
  compact,
  history,

  // Validation command
  validate,

  // Diagnostics command
  doctor,

  // Stats command
  stats,

  // Bulk operations
  bulk,

  // Dashboard command
  dashboard,

  // Outbox commands (PRD-024 agent messaging)
  send,
  inbox,
  ack,
  "ack:all": ackAll,
  "outbox:pending": outboxPending,
  "outbox:gc": outboxGc,

  // Doc commands (DD-023 docs-as-primitives)
  doc,
  invariant,

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
  console.log(`tx v${CLI_VERSION}`)
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
  if (command === "trace" && positional[0]) {
    const subcommandKey = `trace ${positional[0]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (command === "bulk" && positional[0]) {
    const subcommandKey = `bulk ${positional[0]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (command === "doc" && positional[0]) {
    const subcommandKey = `doc ${positional[0]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (command === "invariant" && positional[0]) {
    const subcommandKey = `invariant ${positional[0]}`
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
  if (subcommand === "trace" && positional[1]) {
    const subcommandKey = `trace ${positional[1]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (subcommand === "bulk" && positional[1]) {
    const subcommandKey = `bulk ${positional[1]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (subcommand === "doc" && positional[1]) {
    const subcommandKey = `doc ${positional[1]}`
    if (commandHelp[subcommandKey]) {
      console.log(commandHelp[subcommandKey])
      process.exit(0)
    }
  }
  if (subcommand === "invariant" && positional[1]) {
    const subcommandKey = `invariant ${positional[1]}`
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

// Cycle command needs AgentService + CycleScanService overlay
const fullLayer = command === "cycle"
  ? Layer.merge(layer, CycleScanServiceLive.pipe(Layer.provide(Layer.merge(layer, AgentServiceLive))))
  : layer

const runnable = Effect.provide(program, fullLayer) as Effect.Effect<void, unknown>

// Exit code set by error handlers; applied after Effect runtime cleanup completes
let _exitCode = 0

// Map error tags to exit codes (2 = not found, 1 = general error)
const errorExitCodes: Record<string, number> = {
  TaskNotFoundError: 2,
  LearningNotFoundError: 2,
  AnchorNotFoundError: 2,
  ClaimNotFoundError: 2,
  ValidationError: 1,
  CircularDependencyError: 1,
  DatabaseError: 1,
  AlreadyClaimedError: 1,
  LeaseExpiredError: 1,
  MaxRenewalsExceededError: 1,
  ExtractionUnavailableError: 1,
  MessageNotFoundError: 2,
  MessageAlreadyAckedError: 1,
  DocNotFoundError: 2,
  DocLockedError: 1,
  InvalidDocYamlError: 1,
  InvariantNotFoundError: 2,
}

const handled = runnable.pipe(
  // Handle expected Effect errors (from Effect.fail in services)
  Effect.catchAll((error: unknown) => {
    const err = error as { _tag?: string; message?: string }
    const tag = err._tag ?? ""

    if (tag in errorExitCodes) {
      console.error(err.message ?? tag.replace(/Error$/, " error"))
      if (tag === "HasChildrenError") {
        console.error("Hint: use --cascade to delete with all children, or delete/move children first.")
      }
      _exitCode = errorExitCodes[tag] ?? 1
      return Effect.void
    }

    if (tag === "HasChildrenError") {
      console.error(err.message ?? `Cannot delete task with children`)
      console.error("Hint: use --cascade to delete with all children, or delete/move children first.")
      _exitCode = 1
      return Effect.void
    }

    console.error(`Error: ${err.message ?? String(error)}`)
    _exitCode = 1
    return Effect.void
  }),
  // Handle defects (from throw CliExitError in commands/parse utils)
  Effect.catchAllCause((cause) => {
    const dieOption = Cause.dieOption(cause)
    if (Option.isSome(dieOption) && dieOption.value instanceof CliExitError) {
      _exitCode = dieOption.value.code
      return Effect.void
    }
    // Unexpected defect — print and exit
    console.error(`Fatal: ${Cause.pretty(cause)}`)
    _exitCode = 1
    return Effect.void
  })
)

// Effect.runPromise resolves AFTER scope finalizers (db.close()) run
Effect.runPromise(handled).then(() => {
  if (_exitCode !== 0) process.exit(_exitCode)
}).catch((err: unknown) => {
  // Should not reach here — catchAllCause handles everything
  console.error(`Fatal: ${err}`)
  process.exit(1)
})
