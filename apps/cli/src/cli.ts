#!/usr/bin/env bun
/**
 * TX CLI - Task management for AI agents and humans
 *
 * Main entry point for the tx command line tool.
 */

import { Effect, Cause, Option, Layer } from "effect"
import { resolve } from "node:path"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { makeAppLayer, AgentServiceLive, CycleScanServiceLive, SqliteClient, resolveWorkspaceContext } from "@jamesaphoenix/tx"
import { HELP_TEXT, commandHelp } from "./help.js"
import { CliExitError } from "./cli-exit.js"
import { CliUserError, emitCliError, movedCommandError, unknownCommandError, usageError } from "./cli-errors.js"
import { buildCommandCatalog, buildHelpPayload, buildSchemaPayload, deprecatedCommandMap, resolveCommandKey } from "./help-registry.js"
import { toJson } from "./output.js"
import { CLI_VERSION } from "./version.js"

// Command imports
import { add, list, ready, show, update, done, deleteTask, reset } from "./commands/task.js"
import { dep } from "./commands/dep-compound.js"
import { sync } from "./commands/sync.js"
import { cycle } from "./commands/cycle.js"
import { trace } from "./commands/trace.js"
import { claim } from "./commands/claim.js"
import { bulk } from "./commands/bulk.js"
import { msg } from "./commands/msg.js"
import { doc } from "./commands/doc.js"
import { invariant } from "./commands/invariant.js"
import { spec } from "./commands/spec.js"
import { decision } from "./commands/decision.js"
import { triangle } from "./commands/triangle.js"
import { groupContext } from "./commands/group-context.js"
import { scaffoldClaude, scaffoldCodex, scaffoldWatchdog, parseWatchdogRuntimeMode, interactiveScaffold } from "./commands/scaffold.js"
import { scaffoldConfigToml } from "@jamesaphoenix/tx"
import { memory } from "./commands/memory.js"
import { pin } from "./commands/pin.js"
import { mdExport } from "./commands/md-export.js"
import { utils } from "./commands/utils.js"
import { diag } from "./commands/diag.js"
import { auto } from "./commands/auto.js"
import { skills } from "./commands/skills.js"
import { decompose } from "./commands/decompose.js"
import { schema } from "./commands/schema.js"
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
      console.warn(`[deprecated] Use "tx ${newCmd}" instead.`)
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
      const projectDir = typeof initFlags["content-root"] === "string"
        ? initFlags["content-root"]
        : process.cwd()

      p.intro("tx init")
      p.log.success(`Database ready (${tables.length} tables, SQLite WAL mode)`)
      p.log.info(`${projectDir}/.tx/tasks.db`)

      // Non-interactive mode: explicit init flags skip prompts
      const forceClaude = flag(initFlags, "claude")
      const forceCodex = flag(initFlags, "codex")
      const forceWatchdog = flag(initFlags, "watchdog")

      if (initFlags["watchdog-runtime"] !== undefined && !forceWatchdog) {
        return yield* Effect.fail(usageError({
          code: "cli/missing-flag",
          command: "init",
          message: "--watchdog-runtime requires --watchdog.",
          hint: "Pass --watchdog or remove --watchdog-runtime.",
          usage: "tx init [--watchdog] [--watchdog-runtime <auto|codex|claude|both>]",
          examples: [
            "tx init --watchdog",
            "tx init --watchdog --watchdog-runtime both",
          ],
        }))
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
        p.outro('Done! Start with: tx add "First task" && tx ready')
        return
      }

      // Interactive mode
      yield* Effect.tryPromise(() => interactiveScaffold(projectDir, { watchdogRuntimeMode }))
      p.outro('Done! Start with: tx add "First task" && tx ready')
    }),

  add,
  list,
  ready,
  show,
  update,
  done,
  reset,
  delete: deleteTask,
  // New compound commands
  dep,
  msg,
  diag,
  auto,
  skills,

  // Legacy top-level commands (deprecated aliases → compound commands)
  block: deprecatedAlias("dep block", (pos, flags) => dep(["block", ...pos], flags)),
  unblock: deprecatedAlias("dep unblock", (pos, flags) => dep(["unblock", ...pos], flags)),
  children: deprecatedAlias("dep children", (pos, flags) => dep(["children", ...pos], flags)),
  tree: deprecatedAlias("dep tree", (pos, flags) => dep(["tree", ...pos], flags)),
  send: deprecatedAlias("msg send", (pos, flags) => msg(["send", ...pos], flags)),
  inbox: deprecatedAlias("msg inbox", (pos, flags) => msg(["inbox", ...pos], flags)),
  ack: deprecatedAlias("msg ack", (pos, flags) => msg(["ack", ...pos], flags)),
  outbox: deprecatedAlias("msg pending|gc", (pos, flags) => {
    // Route outbox subcommands through msg
    const sub = pos[0]
    if (sub === "pending") return msg(["pending", ...pos.slice(1)], flags)
    if (sub === "gc") return msg(["gc", ...pos.slice(1)], flags)
    // No subcommand or unknown → show msg help
    return msg([], flags)
  }),
  stats: deprecatedAlias("diag stats", (pos, flags) => diag(["stats", ...pos], flags)),
  doctor: deprecatedAlias("diag doctor", (pos, flags) => diag(["doctor", ...pos], flags)),
  validate: deprecatedAlias("diag doctor", (pos, flags) => diag(["doctor", ...pos], flags)),
  dashboard: deprecatedAlias("diag dashboard", (pos, flags) => diag(["dashboard", ...pos], flags)),
  compact: deprecatedAlias("sync compact", (pos, flags) => sync(["compact", ...pos], flags)),
  history: deprecatedAlias("sync history", (pos, flags) => sync(["history", ...pos], flags)),
  guard: deprecatedAlias("auto guard", (pos, flags) => auto(["guard", ...pos], flags)),
  gate: deprecatedAlias("auto gate", (pos, flags) => auto(["gate", ...pos], flags)),
  verify: deprecatedAlias("auto verify", (pos, flags) => auto(["verify", ...pos], flags)),
  label: deprecatedAlias("auto label", (pos, flags) => auto(["label", ...pos], flags)),
  reflect: deprecatedAlias("auto reflect", (pos, flags) => auto(["reflect", ...pos], flags)),

  sync,
  migrate: deprecatedAlias("sync migrate", (pos, flags) => sync(["migrate", ...pos], flags)),
  "group-context": groupContext,

  // Cycle scan (PRD-023)
  cycle,

  // Claim commands (PRD-018) — claim dispatches release/renew subcommands
  claim,

  // Trace command (with subcommands)
  trace,

  // Bulk operations
  bulk,

  // Doc commands (DD-023 docs-as-primitives)
  doc,
  invariant: deprecatedAlias("spec", invariant),
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

  // Spec-driven task graph creation
  decompose,

  // Utility commands (no DB required)
  utils,
  schema,

  // --- Deprecated colon-style aliases (emit warning, delegate to new syntax) ---
  "claim:release": deprecatedAlias("claim release", (pos, flags) => claim(["release", ...pos], flags)),
  "claim:renew": deprecatedAlias("claim renew", (pos, flags) => claim(["renew", ...pos], flags)),
  "group-context:set": deprecatedAlias("group-context set", (pos, flags) => groupContext(["set", ...pos], flags)),
  "group-context:clear": deprecatedAlias("group-context clear", (pos, flags) => groupContext(["clear", ...pos], flags)),
  "ack:all": deprecatedAlias("msg ack all", (pos, flags) => msg(["ack", "all", ...pos], flags)),
  "outbox:pending": deprecatedAlias("msg pending", (pos, flags) => msg(["pending", ...pos], flags)),
  "outbox:gc": deprecatedAlias("msg gc", (pos, flags) => msg(["gc", ...pos], flags)),

  // Help command
  help: (pos) =>
    Effect.sync(() => {
      printHelpOutput(pos, false)
    }),
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0))
  )

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1
      dp[row][col] = Math.min(
        dp[row - 1][col] + 1,
        dp[row][col - 1] + 1,
        dp[row - 1][col - 1] + cost
      )
    }
  }

  return dp[a.length][b.length]
}

function suggestCommands(input: string, candidates: string[], limit = 3): string[] {
  const normalized = input.toLowerCase()
  return candidates
    .filter(candidate => candidate !== "help")
    .map(candidate => {
      const candidateNormalized = candidate.toLowerCase()
      const prefixBoost = candidateNormalized.startsWith(normalized) ? -2 : 0
      const includeBoost = candidateNormalized.includes(normalized) ? -1 : 0
      return {
        candidate,
        score: editDistance(normalized, candidateNormalized) + prefixBoost + includeBoost,
      }
    })
    .sort((left, right) => left.score - right.score || left.candidate.localeCompare(right.candidate))
    .slice(0, limit)
    .map(entry => entry.candidate)
}

function printHelpOutput(parts: string[], jsonMode: boolean): void {
  if (jsonMode) {
    console.log(toJson(buildHelpPayload(parts)))
    return
  }

  if (parts.length === 0) {
    console.log(HELP_TEXT)
    return
  }

  const key = resolveCommandKey(parts)
  if (!key) {
    const suggestions = suggestCommands(parts.join(" "), buildCommandCatalog().map((entry) => entry.key))
    throw new CliUserError({
      code: "cli/unknown-command",
      command: parts.join(" "),
      message: `Unknown command: ${parts.join(" ")}`,
      hint: suggestions.length > 0
        ? `Closest matches: ${suggestions.join(", ")}.`
        : "Run `tx help --json` to inspect the available command catalog.",
      usage: "tx help [command] [subcommand]",
      details: {
        suggestions,
      },
    })
  }

  console.log(commandHelp[key])
}

function printSchemaOutput(parts: string[]): void {
  console.log(toJson(buildSchemaPayload(parts)))
}

// --- Main ---

const { command, positional, flags: parsedFlags } = parseArgs(process.argv)
const jsonMode = flag(parsedFlags, "json")

function exitCliUserError(error: unknown): never {
  if (error instanceof CliUserError) {
    emitCliError(error, jsonMode)
    process.exit(error.exitCode)
  }

  const message = error instanceof Error
    ? error.stack ?? error.message
    : String(error)
  console.error(message)
  process.exit(1)
}

// Handle --version early, before any command processing
if (flag(parsedFlags, "version") || flag(parsedFlags, "v")) {
  console.log(`tx v${CLI_VERSION}`)
  process.exit(0)
}

// Handle --help for specific command (tx add --help) or help command (tx help / tx help add)
if (flag(parsedFlags, "help") || flag(parsedFlags, "h")) {
  if (command in deprecatedCommandMap) {
    console.warn(`[deprecated] Use "tx ${deprecatedCommandMap[command]}" instead.`)
  }
  try {
    const helpParts = command === "help" ? positional : [command, ...positional]
    printHelpOutput(helpParts, jsonMode)
    process.exit(0)
  } catch (error) {
    exitCliUserError(error)
  }
}

// Handle 'tx help' and 'tx help <command>'
if (command === "help") {
  try {
    printHelpOutput(positional, jsonMode)
    process.exit(0)
  } catch (error) {
    exitCliUserError(error)
  }
}

if (command === "schema") {
  try {
    printSchemaOutput(positional)
    process.exit(0)
  } catch (error) {
    exitCliUserError(error)
  }
}

// Handle mcp-server separately (will be moved to apps/mcp)
if (command === "mcp-server") {
  emitCliError(movedCommandError({
    command,
    message: "MCP server has been moved to a separate package.",
    hint: "Use the @tx/mcp package or run the MCP server from the monorepo root.",
  }), jsonMode)
  process.exit(1)
}

const handler = commands[command]
if (!handler) {
  emitCliError(unknownCommandError({
    command,
    suggestions: suggestCommands(command, Object.keys(commands)),
  }), jsonMode)
  process.exit(1)
}

const workspace = resolveWorkspaceContext({
  cwd: process.cwd(),
  stateRoot: typeof parsedFlags["state-root"] === "string"
    ? parsedFlags["state-root"]
    : undefined,
  contentRoot: typeof parsedFlags["content-root"] === "string"
    ? parsedFlags["content-root"]
    : undefined,
  dbPath: typeof parsedFlags.db === "string" ? parsedFlags.db : undefined,
})
const dbPath = workspace.dbPath
parsedFlags.db = workspace.dbPath
parsedFlags["state-root"] = workspace.stateRoot
parsedFlags["content-root"] = workspace.contentRoot
parsedFlags["projection-key"] = workspace.projectionKey

// For init, ensure directory exists
if (command === "init") {
  const dir = resolve(workspace.stateRoot, ".tx")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  // Create .gitignore for .tx directory
  const gitignorePath = resolve(dir, ".gitignore")
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "tasks.db\ntasks.db-wal\ntasks.db-shm\n")
  }
  // Scaffold default config.toml with annotated defaults (no-op if exists)
  scaffoldConfigToml(workspace.contentRoot)
}

const layer = makeAppLayer(dbPath, {
  contentRoot: workspace.contentRoot,
  projection: workspace,
})
const program = handler(positional, parsedFlags)

// Runtime-backed commands that are not part of the default app layer need overlays.
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
    if (error instanceof CliUserError) {
      emitCliError(error, jsonMode)
      _exitCode = error.exitCode
      return Effect.void
    }

    if (error instanceof CliExitError) {
      _exitCode = error.code
      return Effect.void
    }

    const err = error as { _tag?: string; message?: string }
    const tag = err._tag ?? ""

    if (tag in errorExitCodes) {
      emitCliError(new CliUserError({
        code: `service/${tag.replace(/Error$/, "").replace(/[A-Z]/g, (char, index) => index === 0 ? char.toLowerCase() : `-${char.toLowerCase()}`)}`,
        message: err.message ?? tag.replace(/Error$/, " error"),
        hint: tag === "HasChildrenError"
          ? "Use --cascade to delete with all children, or delete/move children first."
          : undefined,
        exitCode: errorExitCodes[tag] ?? 1,
      }), jsonMode)
      _exitCode = errorExitCodes[tag] ?? 1
      return Effect.void
    }

    emitCliError(new CliUserError({
      code: "cli/unexpected-error",
      message: err.message ?? String(error),
      exitCode: 1,
    }), jsonMode)
    _exitCode = 1
    return Effect.void
  }),
  // Handle defects (from throw CliExitError in commands/parse utils)
  Effect.catchAllCause((cause) => {
    const dieOption = Cause.dieOption(cause)
    if (Option.isSome(dieOption)) {
      if (dieOption.value instanceof CliUserError) {
        emitCliError(dieOption.value, jsonMode)
        _exitCode = dieOption.value.exitCode
        return Effect.void
      }
      if (dieOption.value instanceof CliExitError) {
        _exitCode = dieOption.value.code
        return Effect.void
      }
    }
    // Unexpected defect — print and exit
    emitCliError(new CliUserError({
      code: "cli/fatal",
      message: Cause.pretty(cause),
      exitCode: 1,
    }), jsonMode)
    _exitCode = 1
    return Effect.void
  })
)

// Effect.runPromise resolves AFTER scope finalizers (db.close()) run
Effect.runPromise(handled).then(() => {
  if (_exitCode !== 0) process.exit(_exitCode)
}).catch((err: unknown) => {
  // Should not reach here — catchAllCause handles everything
  emitCliError(new CliUserError({
    code: "cli/fatal",
    message: String(err),
    exitCode: 1,
  }), jsonMode)
  process.exit(1)
})
