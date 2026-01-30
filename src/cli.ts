#!/usr/bin/env node
import { Effect } from "effect"
import { resolve } from "path"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { makeAppLayer, SyncService, LearningService, FileLearningService, MigrationService, AttemptService } from "./layer.js"
import { TaskService } from "./services/task-service.js"
import { DependencyService } from "./services/dep-service.js"
import { ReadyService } from "./services/ready-service.js"
import { startMcpServer } from "./mcp/server.js"
import type { TaskId, TaskStatus, TaskWithDeps } from "./schema.js"
import type { LearningWithScore } from "./schemas/learning.js"

// --- Help text constant ---

const HELP_TEXT = `tx v0.1.0 - Task management for AI agents and humans

Usage: tx <command> [arguments] [options]

Commands:
  init                    Initialize task database
  add <title>             Create a new task
  list                    List tasks
  ready                   List ready tasks (no blockers)
  show <id>               Show task details
  update <id>             Update task
  done <id>               Mark task complete
  delete <id>             Delete task
  block <id> <blocker>    Add blocking dependency
  unblock <id> <blocker>  Remove blocking dependency
  children <id>           List child tasks
  tree <id>               Show task subtree
  try <id> <approach>     Record an attempt on a task
  sync export             Export tasks to JSONL file
  sync import             Import tasks from JSONL file
  sync status             Show sync status
  migrate status          Show database migration status
  learning:add            Add a learning
  learning:search         Search learnings
  learning:recent         List recent learnings
  learning:helpful        Record learning helpfulness
  context                 Get contextual learnings for a task
  learn                   Attach a learning to file/glob pattern
  recall                  Query learnings for a path
  mcp-server              Start MCP server (JSON-RPC over stdio)

Global Options:
  --json                  Output as JSON
  --db <path>             Database path (default: .tx/tasks.db)
  --help                  Show help
  --version               Show version

Run 'tx help <command>' or 'tx <command> --help' for command-specific help.

Examples:
  tx init
  tx add "Implement auth" --score 800
  tx add "Login page" --parent tx-a1b2c3d4 --score 600
  tx list --status backlog,ready
  tx ready --json
  tx block <task-id> <blocker-id>
  tx done <task-id>`

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

function opt(flags: Record<string, string | boolean>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === "string") return v
  }
  return undefined
}

// --- Formatters ---

function formatTaskWithDeps(t: TaskWithDeps): string {
  const lines = [
    `Task: ${t.id}`,
    `  Title: ${t.title}`,
    `  Status: ${t.status}`,
    `  Score: ${t.score}`,
    `  Ready: ${t.isReady ? "yes" : "no"}`,
  ]
  if (t.description) lines.push(`  Description: ${t.description}`)
  if (t.parentId) lines.push(`  Parent: ${t.parentId}`)
  lines.push(`  Blocked by: ${t.blockedBy.length > 0 ? t.blockedBy.join(", ") : "(none)"}`)
  lines.push(`  Blocks: ${t.blocks.length > 0 ? t.blocks.join(", ") : "(none)"}`)
  lines.push(`  Children: ${t.children.length > 0 ? t.children.join(", ") : "(none)"}`)
  lines.push(`  Created: ${t.createdAt.toISOString()}`)
  lines.push(`  Updated: ${t.updatedAt.toISOString()}`)
  if (t.completedAt) lines.push(`  Completed: ${t.completedAt.toISOString()}`)
  return lines.join("\n")
}

// --- JSON serializer (handles Date objects) ---

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

function toJson(data: unknown): string {
  return JSON.stringify(data, jsonReplacer, 2)
}

// --- Command Help ---

const commandHelp: Record<string, string> = {
  init: `tx init - Initialize task database

Usage: tx init [--db <path>]

Initializes the tx database and required tables. Creates .tx/tasks.db
by default. Safe to run multiple times (idempotent).

Options:
  --db <path>   Database path (default: .tx/tasks.db)
  --help        Show this help

Examples:
  tx init                     # Initialize in .tx/tasks.db
  tx init --db ~/my-tasks.db  # Use custom path`,

  add: `tx add - Create a new task

Usage: tx add <title> [options]

Creates a new task with the given title. Tasks start with status "backlog"
and default score 500.

Arguments:
  <title>         Required. The task title (use quotes for multi-word titles)

Options:
  --parent, -p <id>       Parent task ID (for subtasks)
  --score, -s <n>         Priority score 0-1000 (default: 500, higher = more important)
  --description, -d <text> Task description
  --json                  Output as JSON
  --help                  Show this help

Examples:
  tx add "Implement auth"
  tx add "Login page" --parent tx-a1b2c3d4 --score 600
  tx add "Fix bug" -s 800 -d "Urgent fix for login"`,

  list: `tx list - List tasks

Usage: tx list [options]

Lists all tasks, optionally filtered by status. Shows task ID, status,
score, title, and ready indicator (+).

Options:
  --status <s>     Filter by status (comma-separated: backlog,ready,active,done)
  --limit, -n <n>  Maximum tasks to show
  --json           Output as JSON
  --help           Show this help

Examples:
  tx list                          # List all tasks
  tx list --status backlog,ready   # Only backlog and ready tasks
  tx list -n 10 --json             # Top 10 as JSON`,

  ready: `tx ready - List ready tasks

Usage: tx ready [options]

Lists tasks that are ready to work on (status is workable and all blockers
are done). Sorted by score, highest first.

Options:
  --limit, -n <n>  Maximum tasks to show (default: 10)
  --json           Output as JSON
  --help           Show this help

Examples:
  tx ready             # Top 10 ready tasks
  tx ready -n 5        # Top 5 ready tasks
  tx ready --json      # Output as JSON for scripting`,

  show: `tx show - Show task details

Usage: tx show <id> [options]

Shows full details for a single task including title, status, score,
description, parent, blockers, blocks, children, and timestamps.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx show tx-a1b2c3d4
  tx show tx-a1b2c3d4 --json`,

  update: `tx update - Update a task

Usage: tx update <id> [options]

Updates one or more fields on an existing task.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --status <s>          New status (backlog|ready|planning|active|blocked|review|human_needs_to_review|done)
  --title <t>           New title
  --score <n>           New score (0-1000)
  --description, -d <text>  New description
  --parent, -p <id>     New parent task ID
  --json                Output as JSON
  --help                Show this help

Examples:
  tx update tx-a1b2c3d4 --status active
  tx update tx-a1b2c3d4 --score 900 --title "High priority bug"`,

  done: `tx done - Mark task complete

Usage: tx done <id> [options]

Marks a task as complete (status = done). Also reports any tasks
that become unblocked as a result.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON (includes task and newly unblocked task IDs)
  --help  Show this help

Examples:
  tx done tx-a1b2c3d4
  tx done tx-a1b2c3d4 --json`,

  delete: `tx delete - Delete a task

Usage: tx delete <id> [options]

Permanently deletes a task. Also removes any dependencies involving
this task.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx delete tx-a1b2c3d4`,

  block: `tx block - Add blocking dependency

Usage: tx block <task-id> <blocker-id> [options]

Makes one task block another. The blocked task cannot be ready until
the blocker is marked done. Circular dependencies are not allowed.

Arguments:
  <task-id>     Required. The task that will be blocked
  <blocker-id>  Required. The task that blocks it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx block tx-abc123 tx-def456   # tx-def456 blocks tx-abc123`,

  unblock: `tx unblock - Remove blocking dependency

Usage: tx unblock <task-id> <blocker-id> [options]

Removes a blocking dependency between two tasks.

Arguments:
  <task-id>     Required. The task that was blocked
  <blocker-id>  Required. The task that was blocking it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx unblock tx-abc123 tx-def456`,

  children: `tx children - List child tasks

Usage: tx children <id> [options]

Lists all direct children of a task (tasks with this task as parent).
Shows task ID, status, score, title, and ready indicator (+).

Arguments:
  <id>    Required. Parent task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx children tx-a1b2c3d4
  tx children tx-a1b2c3d4 --json`,

  tree: `tx tree - Show task subtree

Usage: tx tree <id> [options]

Shows a task and all its descendants in a tree view. Useful for
visualizing task hierarchy.

Arguments:
  <id>    Required. Root task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON (nested structure with childTasks array)
  --help  Show this help

Examples:
  tx tree tx-a1b2c3d4
  tx tree tx-a1b2c3d4 --json`,

  try: `tx try - Record an attempt on a task

Usage: tx try <task-id> <approach> --failed|--succeeded [reason]

Records an attempt made on a task. Useful for tracking what approaches
have been tried and their outcomes. Helps agents avoid repeating
failed approaches.

Arguments:
  <task-id>    Required. Task ID (e.g., tx-a1b2c3d4)
  <approach>   Required. Description of the approach tried

Flags (mutually exclusive, one required):
  --failed     Mark the attempt as failed
  --succeeded  Mark the attempt as succeeded

Options:
  [reason]     Optional reason/explanation after the flag
  --json       Output as JSON
  --help       Show this help

Examples:
  tx try tx-abc123 "Used Redux" --failed "Too complex for this use case"
  tx try tx-abc123 "Used Zustand" --succeeded
  tx try tx-abc123 "Direct state prop drilling" --failed --json`,

  "mcp-server": `tx mcp-server - Start MCP server

Usage: tx mcp-server [options]

Starts the Model Context Protocol (MCP) server for integration with
AI agents. Communicates via JSON-RPC over stdio.

Options:
  --db <path>  Database path (default: .tx/tasks.db)
  --help       Show this help

Examples:
  tx mcp-server
  tx mcp-server --db ~/project/.tx/tasks.db`,

  sync: `tx sync - Manage JSONL sync for git-based task sharing

Usage: tx sync <subcommand> [options]

Subcommands:
  export    Export all tasks and dependencies to JSONL file
  import    Import tasks from JSONL file (timestamp-based merge)
  status    Show sync status and whether database has unexported changes
  auto      Enable or disable automatic sync on mutations
  compact   Compact JSONL file by deduplicating operations

Run 'tx sync <subcommand> --help' for subcommand-specific help.

Examples:
  tx sync export               # Export to .tx/tasks.jsonl
  tx sync import               # Import from .tx/tasks.jsonl
  tx sync status               # Show sync status
  tx sync auto --enable        # Enable auto-sync
  tx sync compact              # Compact JSONL file`,

  "sync export": `tx sync export - Export tasks to JSONL

Usage: tx sync export [--path <path>] [--json]

Exports all tasks and dependencies from the database to a JSONL file.
The file can be committed to git for sharing tasks across machines.

Options:
  --path <p>  Output file path (default: .tx/tasks.jsonl)
  --json      Output result as JSON
  --help      Show this help

Examples:
  tx sync export                           # Export to default path
  tx sync export --path ~/backup.jsonl     # Export to custom path
  tx sync export --json                    # JSON output for scripting`,

  "sync import": `tx sync import - Import tasks from JSONL

Usage: tx sync import [--path <path>] [--json]

Imports tasks from a JSONL file into the database. Uses timestamp-based
conflict resolution: newer records win. Safe to run multiple times.

Options:
  --path <p>  Input file path (default: .tx/tasks.jsonl)
  --json      Output result as JSON
  --help      Show this help

Examples:
  tx sync import                           # Import from default path
  tx sync import --path ~/shared.jsonl     # Import from custom path
  tx sync import --json                    # JSON output for scripting`,

  "sync status": `tx sync status - Show sync status

Usage: tx sync status [--json]

Shows the current sync status including:
- Number of tasks in database
- Number of operations in JSONL file
- Whether database has unexported changes (dirty)
- Auto-sync enabled status

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx sync status
  tx sync status --json`,

  "sync auto": `tx sync auto - Manage automatic sync

Usage: tx sync auto [--enable | --disable] [--json]

Controls whether mutations automatically trigger JSONL export.
When auto-sync is enabled, any task create/update/delete will
automatically export to the JSONL file.

Options:
  --enable   Enable auto-sync
  --disable  Disable auto-sync
  --json     Output as JSON
  --help     Show this help

Without flags, shows current auto-sync status.

Examples:
  tx sync auto              # Show current status
  tx sync auto --enable     # Enable auto-sync
  tx sync auto --disable    # Disable auto-sync`,

  "sync compact": `tx sync compact - Compact JSONL file

Usage: tx sync compact [--path <path>] [--json]

Compacts the JSONL file by:
- Keeping only the latest state for each entity
- Removing deleted tasks (tombstones)
- Removing removed dependencies

This reduces file size and improves import performance.

Options:
  --path <p>  JSONL file path (default: .tx/tasks.jsonl)
  --json      Output as JSON
  --help      Show this help

Examples:
  tx sync compact                       # Compact default file
  tx sync compact --path ~/shared.jsonl # Compact specific file`,

  migrate: `tx migrate - Manage database schema migrations

Usage: tx migrate <subcommand> [options]

Subcommands:
  status    Show current schema version and pending migrations

Run 'tx migrate <subcommand> --help' for subcommand-specific help.

Examples:
  tx migrate status               # Show migration status`,

  "migrate status": `tx migrate status - Show migration status

Usage: tx migrate status [--json]

Shows the current schema version, latest available version, applied
migrations, and any pending migrations that will be applied on next
database open.

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx migrate status
  tx migrate status --json`,

  "learning:add": `tx learning:add - Add a learning

Usage: tx learning:add <content> [options]

Creates a new learning entry. Learnings are pieces of knowledge that can
be retrieved based on task context.

Arguments:
  <content>  Required. The learning content/insight to store

Options:
  -c, --category <cat>     Category tag (e.g., database, auth, api)
  --source-ref <ref>       Reference to source (e.g., task ID, file path)
  --source-type <type>     Source type: manual, compaction, run, claude_md (default: manual)
  --json                   Output as JSON
  --help                   Show this help

Examples:
  tx learning:add "Always use transactions for multi-step DB operations"
  tx learning:add "Rate limit is 100 req/min" -c api
  tx learning:add "Migration requires downtime" --source-ref tx-abc123`,

  "learning:search": `tx learning:search - Search learnings

Usage: tx learning:search <query> [options]

Searches learnings using BM25 full-text search. Returns results ranked by
relevance (BM25 score) and recency.

Arguments:
  <query>  Required. Search query (keywords or phrase)

Options:
  -n, --limit <n>      Maximum results (default: 10)
  --min-score <n>      Minimum relevance score 0-1 (default: 0.3)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx learning:search "database transactions"
  tx learning:search "authentication" -n 5 --json`,

  "learning:recent": `tx learning:recent - List recent learnings

Usage: tx learning:recent [options]

Lists the most recently created learnings.

Options:
  -n, --limit <n>  Maximum results (default: 10)
  --json           Output as JSON
  --help           Show this help

Examples:
  tx learning:recent
  tx learning:recent -n 5 --json`,

  "learning:helpful": `tx learning:helpful - Record learning helpfulness

Usage: tx learning:helpful <id> [options]

Records whether a learning was helpful (outcome feedback). This improves
future retrieval by boosting helpful learnings in search results.

Arguments:
  <id>  Required. Learning ID (number)

Options:
  --score <n>  Helpfulness score 0-1 (default: 1.0)
  --json       Output as JSON
  --help       Show this help

Examples:
  tx learning:helpful 42
  tx learning:helpful 42 --score 0.8`,

  context: `tx context - Get contextual learnings for a task

Usage: tx context <task-id> [options]

Retrieves learnings relevant to a specific task based on its title and
description. Uses hybrid BM25 + recency scoring.

Arguments:
  <task-id>  Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json     Output as JSON
  --inject   Write to .tx/context.md for injection
  --help     Show this help

Examples:
  tx context tx-a1b2c3d4
  tx context tx-a1b2c3d4 --json
  tx context tx-a1b2c3d4 --inject`,

  learn: `tx learn - Attach a learning to a file path or glob pattern

Usage: tx learn <path> <note> [options]

Stores a file-specific note that can be recalled when working on matching files.
Supports glob patterns for matching multiple files.

Arguments:
  <path>    Required. File path or glob pattern (e.g., src/services/*.ts)
  <note>    Required. The note/learning to attach

Options:
  --task <id>   Associate with a task ID
  --json        Output as JSON
  --help        Show this help

Examples:
  tx learn "src/db.ts" "Always run migrations in a transaction"
  tx learn "src/services/*.ts" "Services must use Effect-TS patterns"
  tx learn "*.test.ts" "Use vitest describe/it syntax" --task tx-abc123`,

  recall: `tx recall - Query file learnings by path

Usage: tx recall [path] [options]

Retrieves file-specific learnings. If a path is provided, returns learnings
matching that path (using glob patterns). Without a path, returns all learnings.

Arguments:
  [path]    Optional. File path to match against stored patterns

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx recall                           # List all file learnings
  tx recall "src/db.ts"               # Learnings for specific file
  tx recall "src/services/task.ts"    # Matches patterns like src/services/*.ts
  tx recall --json`,

  help: `tx help - Show help

Usage: tx help [command]
       tx --help
       tx <command> --help

Shows general help or help for a specific command.

Examples:
  tx help           # General help
  tx help add       # Help for 'add' command
  tx add --help     # Same as above`
}

// --- Commands ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const commands: Record<string, (positional: string[], flags: Record<string, string | boolean>) => Effect.Effect<void, any, any>> = {

  init: (_pos, _flags) =>
    Effect.gen(function* () {
      // Layer construction already creates db + runs migrations
      // Just confirm it exists
      console.log("Initialized tx database")
      console.log("  Tables: tasks, task_dependencies, compaction_log, schema_version")
    }),

  add: (pos, flags) =>
    Effect.gen(function* () {
      const title = pos[0]
      if (!title) {
        console.error("Usage: tx add <title> [--parent/-p <id>] [--score/-s <n>] [--description/-d <text>] [--json]")
        process.exit(1)
      }

      const svc = yield* TaskService
      const task = yield* svc.create({
        title,
        description: opt(flags, "description", "d"),
        parentId: opt(flags, "parent", "p"),
        score: opt(flags, "score", "s") ? parseInt(opt(flags, "score", "s")!, 10) : undefined,
        metadata: {}
      })

      if (flag(flags, "json")) {
        const full = yield* svc.getWithDeps(task.id)
        console.log(toJson(full))
      } else {
        console.log(`Created task: ${task.id}`)
        console.log(`  Title: ${task.title}`)
        console.log(`  Score: ${task.score}`)
        if (task.parentId) console.log(`  Parent: ${task.parentId}`)
      }
    }),

  list: (_pos, flags) =>
    Effect.gen(function* () {
      const svc = yield* TaskService
      const statusFilter = opt(flags, "status")
      const limit = opt(flags, "limit", "n") ? parseInt(opt(flags, "limit", "n")!, 10) : undefined
      const tasks = yield* svc.listWithDeps({
        status: statusFilter ? statusFilter.split(",") as TaskStatus[] : undefined,
        limit
      })

      if (flag(flags, "json")) {
        console.log(toJson(tasks))
      } else {
        if (tasks.length === 0) {
          console.log("No tasks found")
        } else {
          console.log(`${tasks.length} task(s):`)
          for (const t of tasks) {
            const readyMark = t.isReady ? "+" : " "
            console.log(`  ${readyMark} ${t.id} [${t.status}] [${t.score}] ${t.title}`)
          }
        }
      }
    }),

  ready: (_pos, flags) =>
    Effect.gen(function* () {
      const svc = yield* ReadyService
      const limit = opt(flags, "limit", "n") ? parseInt(opt(flags, "limit", "n")!, 10) : 10
      const tasks = yield* svc.getReady(limit)

      if (flag(flags, "json")) {
        console.log(toJson(tasks))
      } else {
        if (tasks.length === 0) {
          console.log("No ready tasks")
        } else {
          console.log(`${tasks.length} ready task(s):`)
          for (const t of tasks) {
            const blocksInfo = t.blocks.length > 0 ? ` (unblocks ${t.blocks.length})` : ""
            console.log(`  ${t.id} [${t.score}] ${t.title}${blocksInfo}`)
          }
        }
      }
    }),

  show: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      if (!id) {
        console.error("Usage: tx show <id> [--json]")
        process.exit(1)
      }

      const svc = yield* TaskService
      const task = yield* svc.getWithDeps(id as TaskId)

      if (flag(flags, "json")) {
        console.log(toJson(task))
      } else {
        console.log(formatTaskWithDeps(task))
      }
    }),

  update: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      if (!id) {
        console.error("Usage: tx update <id> [--status <s>] [--title <t>] [--score <n>] [--description <d>] [--parent <p>] [--json]")
        process.exit(1)
      }

      const svc = yield* TaskService
      const input: Record<string, unknown> = {}
      if (opt(flags, "status")) input.status = opt(flags, "status")
      if (opt(flags, "title")) input.title = opt(flags, "title")
      if (opt(flags, "score")) input.score = parseInt(opt(flags, "score")!, 10)
      if (opt(flags, "description", "d")) input.description = opt(flags, "description", "d")
      if (opt(flags, "parent", "p")) input.parentId = opt(flags, "parent", "p")

      yield* svc.update(id as TaskId, input)
      const task = yield* svc.getWithDeps(id as TaskId)

      if (flag(flags, "json")) {
        console.log(toJson(task))
      } else {
        console.log(`Updated: ${task.id}`)
        console.log(`  Status: ${task.status}`)
        console.log(`  Score: ${task.score}`)
      }
    }),

  done: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      if (!id) {
        console.error("Usage: tx done <id> [--json]")
        process.exit(1)
      }

      const taskSvc = yield* TaskService
      const readySvc = yield* ReadyService

      // Get tasks blocked by this one BEFORE marking complete
      const blocking = yield* readySvc.getBlocking(id as TaskId)

      yield* taskSvc.update(id as TaskId, { status: "done" })
      const task = yield* taskSvc.getWithDeps(id as TaskId)

      // Find newly unblocked tasks using batch query
      // Filter to workable statuses and get their full deps info in one batch
      const candidateIds = blocking
        .filter(t => ["backlog", "ready", "planning"].includes(t.status))
        .map(t => t.id)
      const candidatesWithDeps = yield* taskSvc.getWithDepsBatch(candidateIds)
      const nowReady = candidatesWithDeps.filter(t => t.isReady).map(t => t.id)

      if (flag(flags, "json")) {
        console.log(toJson({ task, nowReady }))
      } else {
        console.log(`Completed: ${task.id} - ${task.title}`)
        if (nowReady.length > 0) {
          console.log(`Now unblocked: ${nowReady.join(", ")}`)
        }
      }
    }),

  delete: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      if (!id) {
        console.error("Usage: tx delete <id> [--json]")
        process.exit(1)
      }

      const svc = yield* TaskService
      const task = yield* svc.get(id as TaskId)
      yield* svc.remove(id as TaskId)

      if (flag(flags, "json")) {
        console.log(toJson({ deleted: true, id: task.id, title: task.title }))
      } else {
        console.log(`Deleted: ${task.id} - ${task.title}`)
      }
    }),

  block: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      const blocker = pos[1]
      if (!id || !blocker) {
        console.error("Usage: tx block <task-id> <blocker-id> [--json]")
        process.exit(1)
      }

      const depSvc = yield* DependencyService
      const taskSvc = yield* TaskService

      yield* depSvc.addBlocker(id as TaskId, blocker as TaskId)
      const task = yield* taskSvc.getWithDeps(id as TaskId)

      if (flag(flags, "json")) {
        console.log(toJson({ success: true, task }))
      } else {
        console.log(`${blocker} now blocks ${id}`)
        console.log(`  ${id} blocked by: ${task.blockedBy.join(", ")}`)
      }
    }),

  unblock: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      const blocker = pos[1]
      if (!id || !blocker) {
        console.error("Usage: tx unblock <task-id> <blocker-id> [--json]")
        process.exit(1)
      }

      const depSvc = yield* DependencyService
      const taskSvc = yield* TaskService

      yield* depSvc.removeBlocker(id as TaskId, blocker as TaskId)
      const task = yield* taskSvc.getWithDeps(id as TaskId)

      if (flag(flags, "json")) {
        console.log(toJson({ success: true, task }))
      } else {
        console.log(`${blocker} no longer blocks ${id}`)
        console.log(`  ${id} blocked by: ${task.blockedBy.length > 0 ? task.blockedBy.join(", ") : "(none)"}`)
      }
    }),

  children: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      if (!id) {
        console.error("Usage: tx children <id> [--json]")
        process.exit(1)
      }

      const svc = yield* TaskService
      const parent = yield* svc.getWithDeps(id as TaskId)
      const children = yield* svc.listWithDeps({ parentId: id })

      if (flag(flags, "json")) {
        console.log(toJson(children))
      } else {
        if (children.length === 0) {
          console.log(`No children for ${parent.id} - ${parent.title}`)
        } else {
          console.log(`${children.length} child(ren) of ${parent.id} - ${parent.title}:`)
          for (const c of children) {
            const readyMark = c.isReady ? "+" : " "
            console.log(`  ${readyMark} ${c.id} [${c.status}] [${c.score}] ${c.title}`)
          }
        }
      }
    }),

  tree: (pos, flags) =>
    Effect.gen(function* () {
      const id = pos[0]
      if (!id) {
        console.error("Usage: tx tree <id> [--json]")
        process.exit(1)
      }

      const svc = yield* TaskService

      // Recursive tree builder
      const buildTree = (taskId: string, depth: number): Effect.Effect<void, unknown, TaskService> =>
        Effect.gen(function* () {
          const task = yield* svc.getWithDeps(taskId as TaskId)
          const indent = "  ".repeat(depth)
          const readyMark = task.isReady ? "+" : " "

          if (flag(flags, "json") && depth === 0) {
            // For JSON, collect the full tree
            const collectTree = (t: TaskWithDeps): Effect.Effect<unknown, unknown, TaskService> =>
              Effect.gen(function* () {
                const childTasks = yield* svc.listWithDeps({ parentId: t.id })
                const childTrees = []
                for (const c of childTasks) {
                  childTrees.push(yield* collectTree(c))
                }
                return { ...t, childTasks: childTrees }
              })
            const tree = yield* collectTree(task)
            console.log(toJson(tree))
            return
          }

          console.log(`${indent}${readyMark} ${task.id} [${task.status}] [${task.score}] ${task.title}`)

          const children = yield* svc.listWithDeps({ parentId: taskId })
          for (const child of children) {
            yield* buildTree(child.id, depth + 1)
          }
        })

      yield* buildTree(id, 0)
    }),

  try: (pos, flags) =>
    Effect.gen(function* () {
      const taskId = pos[0]
      const approach = pos[1]

      if (!taskId || !approach) {
        console.error("Usage: tx try <task-id> <approach> --failed|--succeeded [reason]")
        process.exit(1)
      }

      // Check for --failed and --succeeded flags
      // The parser treats `--failed "reason"` as flags["failed"] = "reason"
      // and `--failed` alone as flags["failed"] = true
      const failedVal = flags["failed"]
      const succeededVal = flags["succeeded"]

      const hasFailedFlag = failedVal !== undefined
      const hasSucceededFlag = succeededVal !== undefined

      // Validate mutually exclusive flags
      if (hasFailedFlag && hasSucceededFlag) {
        console.error("Error: --failed and --succeeded are mutually exclusive")
        process.exit(1)
      }

      if (!hasFailedFlag && !hasSucceededFlag) {
        console.error("Error: Must specify either --failed or --succeeded")
        process.exit(1)
      }

      const outcome = hasFailedFlag ? "failed" : "succeeded"

      // Reason can be the value of the flag (if string) or positional arg
      let reason: string | null = null
      if (hasFailedFlag && typeof failedVal === "string") {
        reason = failedVal
      } else if (hasSucceededFlag && typeof succeededVal === "string") {
        reason = succeededVal
      } else if (pos[2]) {
        reason = pos[2]
      }

      const attemptSvc = yield* AttemptService
      const attempt = yield* attemptSvc.create(taskId, approach, outcome, reason)

      if (flag(flags, "json")) {
        console.log(toJson(attempt))
      } else {
        const outcomeSymbol = outcome === "succeeded" ? "✓" : "✗"
        console.log(`Recorded attempt: ${attempt.id}`)
        console.log(`  Task: ${attempt.taskId}`)
        console.log(`  Approach: ${attempt.approach}`)
        console.log(`  Outcome: ${outcomeSymbol} ${outcome}`)
        if (attempt.reason) {
          console.log(`  Reason: ${attempt.reason}`)
        }
      }
    }),

  help: (pos) =>
    Effect.sync(() => {
      const subcommand = pos[0]
      if (subcommand && commandHelp[subcommand]) {
        console.log(commandHelp[subcommand])
        return
      }
      console.log(HELP_TEXT)
    }),

  sync: (pos, flags) =>
    Effect.gen(function* () {
      const subcommand = pos[0]

      if (!subcommand || subcommand === "help") {
        console.log(commandHelp["sync"])
        return
      }

      // Check for --help on subcommand
      if (flag(flags, "help", "h")) {
        const helpKey = `sync ${subcommand}`
        if (commandHelp[helpKey]) {
          console.log(commandHelp[helpKey])
          return
        }
      }

      const syncSvc = yield* SyncService

      if (subcommand === "export") {
        const path = opt(flags, "path")
        const result = yield* syncSvc.export(path)

        if (flag(flags, "json")) {
          console.log(toJson(result))
        } else {
          console.log(`Exported ${result.opCount} operation(s) to ${result.path}`)
        }
      } else if (subcommand === "import") {
        const path = opt(flags, "path")
        const result = yield* syncSvc.import(path)

        if (flag(flags, "json")) {
          console.log(toJson(result))
        } else {
          console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}, Conflicts: ${result.conflicts}`)
        }
      } else if (subcommand === "status") {
        const status = yield* syncSvc.status()

        if (flag(flags, "json")) {
          console.log(toJson(status))
        } else {
          console.log(`Sync Status:`)
          console.log(`  Tasks in database: ${status.dbTaskCount}`)
          console.log(`  Operations in JSONL: ${status.jsonlOpCount}`)
          console.log(`  Last export: ${status.lastExport ? status.lastExport.toISOString() : "(never)"}`)
          console.log(`  Last import: ${status.lastImport ? status.lastImport.toISOString() : "(never)"}`)
          console.log(`  Dirty (unexported changes): ${status.isDirty ? "yes" : "no"}`)
          console.log(`  Auto-sync: ${status.autoSyncEnabled ? "enabled" : "disabled"}`)
        }
      } else if (subcommand === "auto") {
        const enableFlag = flag(flags, "enable")
        const disableFlag = flag(flags, "disable")

        if (enableFlag && disableFlag) {
          console.error("Cannot specify both --enable and --disable")
          process.exit(1)
        }

        if (enableFlag) {
          yield* syncSvc.enableAutoSync()
          if (flag(flags, "json")) {
            console.log(toJson({ autoSync: true }))
          } else {
            console.log("Auto-sync enabled")
          }
        } else if (disableFlag) {
          yield* syncSvc.disableAutoSync()
          if (flag(flags, "json")) {
            console.log(toJson({ autoSync: false }))
          } else {
            console.log("Auto-sync disabled")
          }
        } else {
          const enabled = yield* syncSvc.isAutoSyncEnabled()
          if (flag(flags, "json")) {
            console.log(toJson({ autoSync: enabled }))
          } else {
            console.log(`Auto-sync: ${enabled ? "enabled" : "disabled"}`)
          }
        }
      } else if (subcommand === "compact") {
        const path = opt(flags, "path")
        const result = yield* syncSvc.compact(path)

        if (flag(flags, "json")) {
          console.log(toJson(result))
        } else {
          console.log(`Compacted: ${result.before} → ${result.after} operations`)
        }
      } else {
        console.error(`Unknown sync subcommand: ${subcommand}`)
        console.error(`Run 'tx sync --help' for usage information`)
        process.exit(1)
      }
    }),

  migrate: (pos, flags) =>
    Effect.gen(function* () {
      const subcommand = pos[0]

      if (!subcommand || subcommand === "help") {
        console.log(commandHelp["migrate"])
        return
      }

      // Check for --help on subcommand
      if (flag(flags, "help", "h")) {
        const helpKey = `migrate ${subcommand}`
        if (commandHelp[helpKey]) {
          console.log(commandHelp[helpKey])
          return
        }
      }

      const migrationSvc = yield* MigrationService

      if (subcommand === "status") {
        const status = yield* migrationSvc.getStatus()

        if (flag(flags, "json")) {
          console.log(toJson(status))
        } else {
          console.log(`Migration Status:`)
          console.log(`  Current version: ${status.currentVersion}`)
          console.log(`  Latest version: ${status.latestVersion}`)
          console.log(`  Pending migrations: ${status.pendingCount}`)
          if (status.appliedMigrations.length > 0) {
            console.log(`\nApplied migrations:`)
            for (const m of status.appliedMigrations) {
              console.log(`  v${m.version} - applied ${m.appliedAt.toISOString()}`)
            }
          }
          if (status.pendingMigrations.length > 0) {
            console.log(`\nPending migrations:`)
            for (const m of status.pendingMigrations) {
              console.log(`  v${m.version} - ${m.description}`)
            }
          }
        }
      } else {
        console.error(`Unknown migrate subcommand: ${subcommand}`)
        console.error(`Run 'tx migrate --help' for usage information`)
        process.exit(1)
      }
    }),

  "learning:add": (pos, flags) =>
    Effect.gen(function* () {
      const content = pos[0]
      if (!content) {
        console.error("Usage: tx learning:add <content> [-c category] [--source-ref ref] [--json]")
        process.exit(1)
      }

      const svc = yield* LearningService
      const learning = yield* svc.create({
        content,
        category: opt(flags, "category", "c") ?? undefined,
        sourceRef: opt(flags, "source-ref") ?? undefined,
        sourceType: (opt(flags, "source-type") as "manual" | "compaction" | "run" | "claude_md") ?? "manual"
      })

      if (flag(flags, "json")) {
        console.log(toJson(learning))
      } else {
        console.log(`Created learning: #${learning.id}`)
        console.log(`  Content: ${learning.content.slice(0, 80)}${learning.content.length > 80 ? "..." : ""}`)
        if (learning.category) console.log(`  Category: ${learning.category}`)
        if (learning.sourceRef) console.log(`  Source: ${learning.sourceRef}`)
      }
    }),

  "learning:search": (pos, flags) =>
    Effect.gen(function* () {
      const query = pos[0]
      if (!query) {
        console.error("Usage: tx learning:search <query> [-n limit] [--json]")
        process.exit(1)
      }

      const svc = yield* LearningService
      const limit = opt(flags, "limit", "n") ? parseInt(opt(flags, "limit", "n")!, 10) : 10
      const minScore = opt(flags, "min-score") ? parseFloat(opt(flags, "min-score")!) : 0.3

      const results = yield* svc.search({ query, limit, minScore })

      if (flag(flags, "json")) {
        console.log(toJson(results))
      } else {
        if (results.length === 0) {
          console.log("No learnings found")
        } else {
          console.log(`${results.length} learning(s) found:`)
          for (const r of results) {
            const score = (r.relevanceScore * 100).toFixed(0)
            const category = r.category ? ` [${r.category}]` : ""
            console.log(`  #${r.id} (${score}%)${category} ${r.content.slice(0, 60)}${r.content.length > 60 ? "..." : ""}`)
          }
        }
      }
    }),

  "learning:recent": (_pos, flags) =>
    Effect.gen(function* () {
      const svc = yield* LearningService
      const limit = opt(flags, "limit", "n") ? parseInt(opt(flags, "limit", "n")!, 10) : 10

      const learnings = yield* svc.getRecent(limit)

      if (flag(flags, "json")) {
        console.log(toJson(learnings))
      } else {
        if (learnings.length === 0) {
          console.log("No learnings found")
        } else {
          console.log(`${learnings.length} recent learning(s):`)
          for (const l of learnings) {
            const category = l.category ? ` [${l.category}]` : ""
            const source = l.sourceType !== "manual" ? ` (${l.sourceType})` : ""
            console.log(`  #${l.id}${category}${source} ${l.content.slice(0, 60)}${l.content.length > 60 ? "..." : ""}`)
          }
        }
      }
    }),

  "learning:helpful": (pos, flags) =>
    Effect.gen(function* () {
      const idStr = pos[0]
      if (!idStr) {
        console.error("Usage: tx learning:helpful <id> [--score 0.8] [--json]")
        process.exit(1)
      }

      const id = parseInt(idStr, 10)
      if (isNaN(id)) {
        console.error("Error: Learning ID must be a number")
        process.exit(1)
      }

      const svc = yield* LearningService
      const score = opt(flags, "score") ? parseFloat(opt(flags, "score")!) : 1.0

      yield* svc.updateOutcome(id, score)
      const learning = yield* svc.get(id)

      if (flag(flags, "json")) {
        console.log(toJson({ success: true, learning }))
      } else {
        console.log(`Recorded helpfulness for learning #${id}`)
        console.log(`  Score: ${(score * 100).toFixed(0)}%`)
        console.log(`  Content: ${learning.content.slice(0, 60)}${learning.content.length > 60 ? "..." : ""}`)
      }
    }),

  context: (pos, flags) =>
    Effect.gen(function* () {
      const taskId = pos[0]
      if (!taskId) {
        console.error("Usage: tx context <task-id> [--json] [--inject]")
        process.exit(1)
      }

      const svc = yield* LearningService
      const result = yield* svc.getContextForTask(taskId)

      if (flag(flags, "inject")) {
        // Write to .tx/context.md for injection
        const contextMd = formatContextMarkdown(result)
        const contextPath = resolve(process.cwd(), ".tx", "context.md")
        writeFileSync(contextPath, contextMd)
        console.log(`Wrote ${result.learnings.length} learning(s) to ${contextPath}`)
      } else if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Context for: ${result.taskId} - ${result.taskTitle}`)
        console.log(`  Search query: ${result.searchQuery.slice(0, 50)}...`)
        console.log(`  Search duration: ${result.searchDuration}ms`)
        console.log(`  ${result.learnings.length} relevant learning(s):`)
        for (const l of result.learnings) {
          const score = (l.relevanceScore * 100).toFixed(0)
          console.log(`    #${l.id} (${score}%) ${l.content.slice(0, 50)}${l.content.length > 50 ? "..." : ""}`)
        }
      }
    }),

  learn: (pos, flags) =>
    Effect.gen(function* () {
      const pattern = pos[0]
      const note = pos[1]
      if (!pattern || !note) {
        console.error("Usage: tx learn <path> <note> [--task <id>] [--json]")
        process.exit(1)
      }

      const svc = yield* FileLearningService
      const learning = yield* svc.create({
        filePattern: pattern,
        note,
        taskId: opt(flags, "task") ?? undefined
      })

      if (flag(flags, "json")) {
        console.log(toJson(learning))
      } else {
        console.log(`Created file learning: #${learning.id}`)
        console.log(`  Pattern: ${learning.filePattern}`)
        console.log(`  Note: ${learning.note.slice(0, 80)}${learning.note.length > 80 ? "..." : ""}`)
        if (learning.taskId) console.log(`  Task: ${learning.taskId}`)
      }
    }),

  recall: (pos, flags) =>
    Effect.gen(function* () {
      const path = pos[0]
      const svc = yield* FileLearningService

      if (path) {
        // Recall learnings for specific path
        const learnings = yield* svc.recall(path)

        if (flag(flags, "json")) {
          console.log(toJson(learnings))
        } else {
          if (learnings.length === 0) {
            console.log(`No learnings found for: ${path}`)
          } else {
            console.log(`${learnings.length} learning(s) for ${path}:`)
            for (const l of learnings) {
              const taskInfo = l.taskId ? ` [${l.taskId}]` : ""
              console.log(`  #${l.id}${taskInfo} (${l.filePattern})`)
              console.log(`    ${l.note}`)
            }
          }
        }
      } else {
        // List all learnings
        const learnings = yield* svc.getAll()

        if (flag(flags, "json")) {
          console.log(toJson(learnings))
        } else {
          if (learnings.length === 0) {
            console.log("No file learnings found")
          } else {
            console.log(`${learnings.length} file learning(s):`)
            for (const l of learnings) {
              const taskInfo = l.taskId ? ` [${l.taskId}]` : ""
              console.log(`  #${l.id}${taskInfo} ${l.filePattern}`)
              console.log(`    ${l.note.slice(0, 60)}${l.note.length > 60 ? "..." : ""}`)
            }
          }
        }
      }
    })
}

// --- Context Formatter ---

function formatContextMarkdown(result: { taskId: string; taskTitle: string; learnings: readonly LearningWithScore[] }): string {
  const lines = [
    `## Contextual Learnings for ${result.taskId}`,
    ``,
    `Task: ${result.taskTitle}`,
    ``,
    `### Relevant Learnings`,
    ``
  ]

  if (result.learnings.length === 0) {
    lines.push("_No relevant learnings found._")
  } else {
    for (const l of result.learnings) {
      const score = (l.relevanceScore * 100).toFixed(0)
      const category = l.category ? ` [${l.category}]` : ""
      lines.push(`- **${score}%**${category} ${l.content}`)
    }
  }

  lines.push("")
  return lines.join("\n")
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
  // Check for subcommand help (e.g., tx sync export --help)
  if (command === "sync" && positional[0]) {
    const subcommandKey = `sync ${positional[0]}`
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
  if (subcommand === "sync" && positional[1]) {
    const subcommandKey = `sync ${positional[1]}`
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

// Handle mcp-server separately (it manages its own runtime)
if (command === "mcp-server") {
  const dbPath = typeof parsedFlags.db === "string"
    ? resolve(parsedFlags.db)
    : resolve(process.cwd(), ".tx", "tasks.db")

  startMcpServer(dbPath).catch((err: unknown) => {
    console.error(`MCP server error: ${err}`)
    process.exit(1)
  })
} else {

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
}
