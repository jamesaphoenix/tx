/**
 * Bulk commands: batch operations on multiple tasks
 */

import { Effect } from "effect"
import { TaskService, ReadyService } from "@jamesaphoenix/tx-core"
import { type Flags, flag, parseTaskId } from "../utils/parse.js"
import { toJson } from "../output.js"

interface BulkResult {
  readonly succeeded: string[]
  readonly failed: { id: string; error: string }[]
}

/** Extract error message safely without unsafe 'as' casts. */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

function printBulkResult(operation: string, result: BulkResult): void {
  if (result.succeeded.length > 0) {
    console.log(`${operation}: ${result.succeeded.join(", ")}`)
  }
  if (result.failed.length > 0) {
    for (const f of result.failed) {
      console.error(`  Failed ${f.id}: ${f.error}`)
    }
  }
  console.log(`Summary: ${result.succeeded.length} succeeded, ${result.failed.length} failed`)
}

export const bulk = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]
    if (!subcommand) {
      console.error("Usage: tx bulk <done|score|reset|delete> <id...> [options]")
      console.error("Run 'tx bulk --help' for more information")
      process.exit(1)
    }

    switch (subcommand) {
      case "done":
        return yield* bulkDone(pos.slice(1), flags)
      case "score":
        return yield* bulkScore(pos.slice(1), flags)
      case "reset":
        return yield* bulkReset(pos.slice(1), flags)
      case "delete":
        return yield* bulkDelete(pos.slice(1), flags)
      default:
        console.error(`Unknown bulk subcommand: ${subcommand}`)
        console.error("Valid subcommands: done, score, reset, delete")
        process.exit(1)
    }
  })

const bulkDone = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    if (pos.length === 0) {
      console.error("Usage: tx bulk done <id> [id...] [--json]")
      process.exit(1)
    }

    const taskSvc = yield* TaskService
    const readySvc = yield* ReadyService

    const result: BulkResult = { succeeded: [], failed: [] }
    const allUnblocked: string[] = []

    for (const raw of pos) {
      const id = parseTaskId(raw)
      const op = yield* Effect.either(
        Effect.gen(function* () {
          // Get tasks blocked by this one BEFORE marking complete
          const blocking = yield* readySvc.getBlocking(id)
          yield* taskSvc.update(id, { status: "done" })

          // Find newly unblocked tasks
          const candidateIds = blocking
            .filter(t => ["backlog", "ready", "planning"].includes(t.status))
            .map(t => t.id)
          const candidatesWithDeps = yield* taskSvc.getWithDepsBatch(candidateIds)
          return candidatesWithDeps.filter(t => t.isReady).map(t => t.id)
        })
      )

      if (op._tag === "Right") {
        result.succeeded.push(id)
        allUnblocked.push(...op.right)
      } else {
        result.failed.push({ id, error: extractErrorMessage(op.left) })
      }
    }

    if (flag(flags, "json")) {
      console.log(toJson({ ...result, nowReady: allUnblocked }))
    } else {
      printBulkResult("Completed", result)
      if (allUnblocked.length > 0) {
        console.log(`Now unblocked: ${allUnblocked.join(", ")}`)
      }
    }
  })

const bulkScore = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    if (pos.length < 2) {
      console.error("Usage: tx bulk score <score> <id> [id...] [--json]")
      process.exit(1)
    }

    const scoreVal = parseInt(pos[0], 10)
    if (Number.isNaN(scoreVal)) {
      console.error(`Invalid score: "${pos[0]}" is not a valid number`)
      process.exit(1)
    }

    const ids = pos.slice(1)
    const taskSvc = yield* TaskService

    const result: BulkResult = { succeeded: [], failed: [] }

    for (const raw of ids) {
      const id = parseTaskId(raw)
      const op = yield* Effect.either(taskSvc.update(id, { score: scoreVal }))

      if (op._tag === "Right") {
        result.succeeded.push(id)
      } else {
        result.failed.push({ id, error: extractErrorMessage(op.left) })
      }
    }

    if (flag(flags, "json")) {
      console.log(toJson({ ...result, score: scoreVal }))
    } else {
      printBulkResult(`Set score ${scoreVal}`, result)
    }
  })

const bulkReset = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    if (pos.length === 0) {
      console.error("Usage: tx bulk reset <id> [id...] [--json]")
      process.exit(1)
    }

    const taskSvc = yield* TaskService

    const result: BulkResult = { succeeded: [], failed: [] }

    for (const raw of pos) {
      const id = parseTaskId(raw)
      const op = yield* Effect.either(taskSvc.forceStatus(id, "ready"))

      if (op._tag === "Right") {
        result.succeeded.push(id)
      } else {
        result.failed.push({ id, error: extractErrorMessage(op.left) })
      }
    }

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      printBulkResult("Reset", result)
    }
  })

const bulkDelete = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    if (pos.length === 0) {
      console.error("Usage: tx bulk delete <id> [id...] [--json]")
      process.exit(1)
    }

    const taskSvc = yield* TaskService

    const result: BulkResult = { succeeded: [], failed: [] }

    for (const raw of pos) {
      const id = parseTaskId(raw)
      const op = yield* Effect.either(taskSvc.remove(id))

      if (op._tag === "Right") {
        result.succeeded.push(id)
      } else {
        result.failed.push({ id, error: extractErrorMessage(op.left) })
      }
    }

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      printBulkResult("Deleted", result)
    }
  })
