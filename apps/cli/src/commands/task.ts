/**
 * Task commands: add, list, show, update, done, delete, reset
 */

import { Effect } from "effect"
import { TaskService, ReadyService, AttemptService } from "@jamesaphoenix/tx-core"
import { assertTaskStatus, TASK_STATUSES } from "@jamesaphoenix/tx-types"
import { toJson, formatTaskWithDeps, formatTaskLine, formatReadyTaskLine } from "../output.js"
import { type Flags, flag, opt, parseIntOpt, parseTaskId } from "../utils/parse.js"

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
      score: parseIntOpt(flags, "score", "score", "s"),
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
    const limit = parseIntOpt(flags, "limit", "limit", "n")

    // Validate status values if provided
    let validatedStatuses: ReturnType<typeof assertTaskStatus>[] | undefined
    if (statusFilter) {
      try {
        validatedStatuses = statusFilter.split(",").map(s => assertTaskStatus(s.trim()))
      } catch {
        console.error(`Invalid status filter. Valid statuses: ${TASK_STATUSES.join(", ")}`)
        process.exit(1)
      }
    }

    const tasks = yield* svc.listWithDeps({
      status: validatedStatuses,
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
    const attemptSvc = yield* AttemptService
    const limit = parseIntOpt(flags, "limit", "limit", "n") ?? 10
    const tasks = yield* svc.getReady(limit)

    // Get failed attempt counts for all tasks in a single query
    const taskIds = tasks.map(t => t.id)
    const failedCounts = yield* attemptSvc.getFailedCountsForTasks(taskIds)

    if (flag(flags, "json")) {
      // Add failedAttemptCount to each task in JSON output
      const tasksWithCounts = tasks.map(t => ({
        ...t,
        failedAttemptCount: failedCounts.get(t.id) ?? 0
      }))
      console.log(toJson(tasksWithCounts))
    } else {
      if (tasks.length === 0) {
        console.log("No ready tasks")
      } else {
        console.log(`${tasks.length} ready task(s):`)
        for (const t of tasks) {
          const failedCount = failedCounts.get(t.id) ?? 0
          const failedWarning = failedCount >= 2 ? ` \u26A0 ${failedCount} failed attempts` : ""
          console.log(formatReadyTaskLine(t) + failedWarning)
        }
      }
    }
  })

export const show = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const raw = pos[0]
    if (!raw) {
      console.error("Usage: tx show <id> [--json]")
      process.exit(1)
    }
    const id = parseTaskId(raw)

    const svc = yield* TaskService
    const attemptSvc = yield* AttemptService
    const task = yield* svc.getWithDeps(id)

    // Get up to 10 most recent attempts
    const allAttempts = yield* attemptSvc.listForTask(id)
    const attempts = allAttempts.slice(0, 10)

    if (flag(flags, "json")) {
      console.log(toJson({ ...task, attempts }))
    } else {
      console.log(formatTaskWithDeps(task))
      // Show attempt history if there are any
      if (attempts.length > 0) {
        console.log("")
        console.log("Previous Attempts:")
        for (const a of attempts) {
          const outcomeSymbol = a.outcome === "succeeded" ? "\u2713" : "\u2717"
          console.log(`  ${outcomeSymbol} ${a.approach}`)
          if (a.reason) {
            console.log(`      Reason: ${a.reason}`)
          }
          console.log(`      ${a.createdAt.toISOString()}`)
        }
      }
    }
  })

export const update = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const raw = pos[0]
    if (!raw) {
      console.error("Usage: tx update <id> [--status <s>] [--title <t>] [--score <n>] [--description <d>] [--parent <p>] [--json]")
      process.exit(1)
    }
    const id = parseTaskId(raw)

    const svc = yield* TaskService
    const input: Record<string, unknown> = {}
    if (opt(flags, "status")) input.status = opt(flags, "status")
    if (opt(flags, "title")) input.title = opt(flags, "title")
    const scoreVal = parseIntOpt(flags, "score", "score")
    if (scoreVal !== undefined) input.score = scoreVal
    if (opt(flags, "description", "d")) input.description = opt(flags, "description", "d")
    if (opt(flags, "parent", "p")) input.parentId = opt(flags, "parent", "p")

    yield* svc.update(id, input)
    const task = yield* svc.getWithDeps(id)

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
    const raw = pos[0]
    if (!raw) {
      console.error("Usage: tx done <id> [--json]")
      process.exit(1)
    }
    const id = parseTaskId(raw)

    const taskSvc = yield* TaskService
    const readySvc = yield* ReadyService

    // Get tasks blocked by this one BEFORE marking complete
    const blocking = yield* readySvc.getBlocking(id)

    yield* taskSvc.update(id, { status: "done" })
    const task = yield* taskSvc.getWithDeps(id)

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
    const raw = pos[0]
    if (!raw) {
      console.error("Usage: tx delete <id> [--cascade] [--json]")
      process.exit(1)
    }
    const id = parseTaskId(raw)
    const cascade = flag(flags, "cascade")

    const svc = yield* TaskService
    const task = yield* svc.getWithDeps(id)
    yield* svc.remove(id, { cascade })

    if (flag(flags, "json")) {
      console.log(toJson({ success: true, message: `Deleted task ${task.id}`, data: { id: task.id, title: task.title, cascade } }))
    } else {
      console.log(`Deleted: ${task.id} - ${task.title}${cascade ? " (with children)" : ""}`)
    }
  })

export const reset = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const raw = pos[0]
    if (!raw) {
      console.error("Usage: tx reset <id> [--json]")
      process.exit(1)
    }
    const id = parseTaskId(raw)

    const taskSvc = yield* TaskService

    // Get current task to show what we're resetting from
    const before = yield* taskSvc.getWithDeps(id)
    const oldStatus = before.status

    // Force update to ready status (bypass normal validation)
    yield* taskSvc.forceStatus(id, "ready")
    const task = yield* taskSvc.getWithDeps(id)

    if (flag(flags, "json")) {
      console.log(toJson({ task, oldStatus }))
    } else {
      console.log(`Reset: ${task.id} - ${task.title}`)
      console.log(`  ${oldStatus} -> ready`)
    }
  })
