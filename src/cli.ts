#!/usr/bin/env node
import { Effect } from "effect"
import { resolve } from "path"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { makeAppLayer } from "./layer.js"
import { TaskService } from "./services/task-service.js"
import { DependencyService } from "./services/dep-service.js"
import { ReadyService } from "./services/ready-service.js"
import { startMcpServer } from "./mcp/server.js"
import type { TaskId, TaskWithDeps } from "./schema.js"

// --- Argv parsing helpers ---

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const args = argv.slice(2)
  const command = args[0] ?? "help"
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith("--")) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1)
      const next = args[i + 1]
      if (next && !next.startsWith("-")) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
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
        status: statusFilter ? statusFilter.split(",") as any : undefined,
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

  help: () =>
    Effect.sync(() => {
      console.log(`tx v0.1.0 - Task management for AI agents and humans

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
  mcp-server              Start MCP server (JSON-RPC over stdio)

Global Options:
  --json                  Output as JSON
  --db <path>             Database path (default: .tx/tasks.db)
  --help                  Show help

Examples:
  tx init
  tx add "Implement auth" --score 800
  tx add "Login page" --parent tx-a1b2c3d4 --score 600
  tx list --status backlog,ready
  tx ready --json
  tx block <task-id> <blocker-id>
  tx done <task-id>`)
    })
}

// --- Main ---

const { command, positional, flags: parsedFlags } = parseArgs(process.argv)

if (flag(parsedFlags, "help") || flag(parsedFlags, "h") || command === "help") {
  console.log(`tx v0.1.0 - Task management for AI agents and humans

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
  mcp-server              Start MCP server (JSON-RPC over stdio)

Global Options:
  --json                  Output as JSON
  --db <path>             Database path (default: .tx/tasks.db)
  --help                  Show help
  --version               Show version

Examples:
  tx init
  tx add "Implement auth" --score 800
  tx add "Login page" --parent tx-a1b2c3d4 --score 600
  tx list --status backlog,ready
  tx ready --json
  tx block <task-id> <blocker-id>
  tx done <task-id>`)
  process.exit(0)
}

if (flag(parsedFlags, "version") || flag(parsedFlags, "v")) {
  console.log("tx v0.1.0")
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
