/**
 * Task commands: add, list, show, update, done, delete
 */

import { Effect } from "effect"
import { TaskService, ReadyService } from "@tx/core"
import type { TaskId, TaskStatus } from "@tx/types"
import { toJson, formatTaskWithDeps, formatTaskLine, formatReadyTaskLine } from "../output.js"

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

export const add = (pos: string[], flags: Flags) =>
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
  })

export const list = (_pos: string[], flags: Flags) =>
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
          console.log(formatTaskLine(t))
        }
      }
    }
  })

export const ready = (_pos: string[], flags: Flags) =>
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
          console.log(formatReadyTaskLine(t))
        }
      }
    }
  })

export const show = (pos: string[], flags: Flags) =>
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
  })

export const update = (pos: string[], flags: Flags) =>
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
  })

export const done = (pos: string[], flags: Flags) =>
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
  })

export const deleteTask = (pos: string[], flags: Flags) =>
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
  })
