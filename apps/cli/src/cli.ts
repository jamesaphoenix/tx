#!/usr/bin/env bun
/**
 * TX CLI - Task management for AI agents and humans
 *
 * Main entry point for the tx command line tool.
 */

import { Effect, Cause, Option, Layer } from "effect"
import { resolve } from "node:path"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { makeAppLayer, AgentServiceLive, CycleScanServiceLive, SqliteClient } from "@jamesaphoenix/tx-core"
import { HELP_TEXT, commandHelp } from "./help.js"
import { CliExitError } from "./cli-exit.js"
import { CLI_VERSION } from "./version.js"

// Command imports
import { add, list, ready, show, update, done, deleteTask, reset } from "./commands/task.js"
import { block, unblock } from "./commands/dep.js"
import { children, tree } from "./commands/hierarchy.js"
import { sync } from "./commands/sync.js"
import { learning, context, learn, recall } from "./commands/learning.js"
import { tryAttempt, attempts } from "./commands/attempt.js"
import { migrate } from "./commands/migrate.js"
import { cycle } from "./commands/cycle.js"
import { trace } from "./commands/trace.js"
import { claim } from "./commands/claim.js"
import { compact, history } from "./commands/compact.js"
import { validate } from "./commands/validate.js"
import { doctor } from "./commands/doctor.js"
import { stats } from "./commands/stats.js"
import { bulk } from "./commands/bulk.js"
import { dashboard } from "./commands/dashboard.js"
import { send, inbox, ack, outbox } from "./commands/outbox.js"
import { doc } from "./commands/doc.js"
import { invariant } from "./commands/invariant.js"
import { spec } from "./commands/spec.js"
import { decision } from "./commands/decision.js"
import { triangle } from "./commands/triangle.js"
import { groupContext } from "./commands/group-context.js"
import { scaffoldClaude, scaffoldCodex, scaffoldWatchdog, parseWatchdogRuntimeMode, interactiveScaffold } from "./commands/scaffold.js"
import { scaffoldConfigToml } from "@jamesaphoenix/tx-core"
import { memory } from "./commands/memory.js"
import { pin } from "./commands/pin.js"
import { mdExport } from "./commands/md-export.js"
import { utils } from "./commands/utils.js"
import { guard } from "./commands/guard.js"
import { verify } from "./commands/verify.js"
import { label } from "./commands/label.js"
import { reflect } from "./commands/reflect.js"
import { gate } from "./commands/gate.js"
import * as p from "@clack/prompts"

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
      // Accumulate repeated flags with comma (e.g., --prop a=1 --prop b=2 → "a=1,b=2")
      const existing = flags[key]
      flags[key] = typeof existing === "string" ? `${existing},${next}` : next
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

// --- Deprecation helper ---

type CommandFn = (positional: string[], flags: Record<string, string | boolean>) => Effect.Effect<void, unknown, unknown>

/** Wrap a handler so it emits a stderr deprecation warning before delegating. */
function deprecatedAlias(newCmd: string, handler: CommandFn): CommandFn {
  return (pos, flags) =>
    Effect.gen(function* () {
      console.error(`[deprecated] Use "tx ${newCmd}" instead.`)
      yield* handler(pos, flags)
    })
}

// --- Commands registry ---

const commands: Record<string, (positional: string[], flags: Record<string, string | boolean>) => Effect.Effect<void, unknown, unknown>> = {
  init: (_pos, initFlags) =>
    Effect.gen(function* () {
      const db = yield* SqliteClient
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name"
      ).all() as Array<{ name: string }>
      const projectDir = process.cwd()

      p.intro("tx init")
      p.log.success(`Database ready (${tables.length} tables, SQLite WAL mode)`)
      p.log.info(`${projectDir}/.tx/tasks.db`)

      // Non-interactive mode: explicit init flags skip prompts
      const forceClaude = flag(initFlags, "claude")
      const forceCodex = flag(initFlags, "codex")
      const forceWatchdog = flag(initFlags, "watchdog")

      if (initFlags["watchdog-runtime"] !== undefined && !forceWatchdog) {
        console.error("--watchdog-runtime requires --watchdog.")
        return yield* Effect.fail(new CliExitError(1))
      }
      const watchdogRuntimeMode = parseWatchdogRuntimeMode(initFlags["watchdog-runtime"])

      if (forceClaude || forceCodex || forceWatchdog) {
        const results: string[] = []
        if (forceClaude) {
          const r = scaffoldClaude(projectDir)
          results.push(...r.copied.map(f => `+ ${f}`), ...r.skipped.map(f => `~ ${f} (exists)`))
        }
        if (forceCodex) {
          const r = scaffoldCodex(projectDir)
          results.push(...r.copied.map(f => `+ ${f}`), ...r.skipped.map(f => `~ ${f} (exists)`))
        }
        if (forceWatchdog) {
          const r = scaffoldWatchdog(projectDir, { runtimeMode: watchdogRuntimeMode })
          results.push(...r.copied.map(f => `+ ${f}`), ...r.skipped.map(f => `~ ${f} (exists)`))
          for (const warning of r.warnings) {
            p.log.warn(warning)
          }
        }
        if (results.length > 0) p.note(results.join("\n"), "Files")
        p.outro("Done! Run tx ready to get started.")
        return
      }

      // Interactive mode
      yield* Effect.tryPromise(() => interactiveScaffold(projectDir, { watchdogRuntimeMode }))
      p.outro("Done! Run tx ready to get started.")
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
  "group-context": groupContext,

  // Attempt commands
  try: tryAttempt,
  attempts,

  // Learning commands (space-dispatched)
  learning,

  // Cycle scan (PRD-023)
  cycle,

  // Claim commands (PRD-018) — claim dispatches release/renew subcommands
  claim,

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
  // ack dispatches "all" subcommand; outbox dispatches "pending"/"gc"
  send,
  inbox,
  ack,
  outbox,

  // Doc commands (DD-023 docs-as-primitives)
  doc,
  invariant,
  spec,

  // Decision commands
  decision,
  triangle: deprecatedAlias("spec health", triangle),

  // Memory commands (filesystem-backed memory)
  memory,

  // Pin commands (context pins for agent memory injection)
  pin,

  // Markdown export (file-based agent loops)
  "md-export": mdExport,

  // Utility commands (no DB required)
  utils,

  // Bounded autonomy primitives
  guard,
  gate,
  verify,
  label,
  reflect,

  // --- Deprecated colon-style aliases (emit warning, delegate to new syntax) ---
  "learning:add": deprecatedAlias("learning add", (pos, flags) => learning(["add", ...pos], flags)),
  "learning:search": deprecatedAlias("learning search", (pos, flags) => learning(["search", ...pos], flags)),
  "learning:recent": deprecatedAlias("learning recent", (pos, flags) => learning(["recent", ...pos], flags)),
  "learning:helpful": deprecatedAlias("learning helpful", (pos, flags) => learning(["helpful", ...pos], flags)),
  "learning:embed": deprecatedAlias("learning embed", (pos, flags) => learning(["embed", ...pos], flags)),
  "claim:release": deprecatedAlias("claim release", (pos, flags) => claim(["release", ...pos], flags)),
  "claim:renew": deprecatedAlias("claim renew", (pos, flags) => claim(["renew", ...pos], flags)),
  "group-context:set": deprecatedAlias("group-context set", (pos, flags) => groupContext(["set", ...pos], flags)),
  "group-context:clear": deprecatedAlias("group-context clear", (pos, flags) => groupContext(["clear", ...pos], flags)),
  "ack:all": deprecatedAlias("ack all", (pos, flags) => ack(["all", ...pos], flags)),
  "outbox:pending": deprecatedAlias("outbox pending", (pos, flags) => outbox(["pending", ...pos], flags)),
  "outbox:gc": deprecatedAlias("outbox gc", (pos, flags) => outbox(["gc", ...pos], flags)),

  // Help command
  help: (pos) =>
    Effect.sync(() => {
      const subcommand = pos[0]
      if (subcommand && commandHelp[subcommand]) {
        console.log(commandHelp[subcommand])
        return
      }
      // Check for compound command help (e.g., tx help sync export)
      const compoundParents = [
        "sync", "utils", "pin", "guard", "gate", "verify", "label", "spec",
        "learning", "claim", "outbox", "group-context", "ack"
      ]
      if (pos[1] && compoundParents.includes(subcommand ?? "")) {
        const subcommandKey = `${subcommand} ${pos[1]}`
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

// Commands that support compound help (e.g., tx sync export --help, tx help learning add)
const compoundHelpParents = [
  "sync", "trace", "bulk", "doc", "invariant", "spec", "memory", "utils", "pin",
  "guard", "gate", "verify", "label", "learning", "claim", "outbox", "group-context", "ack"
]

// Handle --help for specific command (tx add --help) or help command (tx help / tx help add)
if (flag(parsedFlags, "help") || flag(parsedFlags, "h")) {
  // Check for subcommand help (e.g., tx sync export --help)
  if (positional[0] && compoundHelpParents.includes(command)) {
    const subcommandKey = `${command} ${positional[0]}`
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
  // Check for compound command help (e.g., tx help sync export)
  if (subcommand && positional[1] && compoundHelpParents.includes(subcommand)) {
    const subcommandKey = `${subcommand} ${positional[1]}`
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
  // Scaffold default config.toml with annotated defaults (no-op if exists)
  scaffoldConfigToml(process.cwd())
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
  DecisionNotFoundError: 2,
  DecisionAlreadyReviewedError: 1,
  MemoryDocumentNotFoundError: 2,
  MemorySourceNotFoundError: 2,
  RetrievalError: 1,
  EmbeddingDimensionMismatchError: 1,
  GuardExceededError: 1,
  VerifyError: 1,
  LabelNotFoundError: 2,
  HasChildrenError: 1,
}

const handled = runnable.pipe(
  // Handle expected Effect errors (from Effect.fail in services)
  Effect.catchAll((error: unknown) => {
    if (error instanceof CliExitError) {
      _exitCode = error.code
      return Effect.void
    }

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
