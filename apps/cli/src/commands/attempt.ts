/**
 * Attempt commands: try, attempts
 */

import { Effect } from "effect"
import { AttemptService, TaskService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, parseTaskId } from "../utils/parse.js"

export const tryAttempt = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawTaskId = pos[0]
    const approach = pos[1]

    if (!rawTaskId || !approach) {
      console.error("Usage: tx try <task-id> <approach> --failed|--succeeded [reason]")
      process.exit(1)
    }
    const taskId = parseTaskId(rawTaskId)

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
      const outcomeSymbol = outcome === "succeeded" ? "\u2713" : "\u2717"
      console.log(`Recorded attempt: ${attempt.id}`)
      console.log(`  Task: ${attempt.taskId}`)
      console.log(`  Approach: ${attempt.approach}`)
      console.log(`  Outcome: ${outcomeSymbol} ${outcome}`)
      if (attempt.reason) {
        console.log(`  Reason: ${attempt.reason}`)
      }
    }
  })

export const attempts = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawTaskId = pos[0]

    if (!rawTaskId) {
      console.error("Usage: tx attempts <task-id> [--json]")
      process.exit(1)
    }
    const taskId = parseTaskId(rawTaskId)

    const attemptSvc = yield* AttemptService
    const taskSvc = yield* TaskService

    // Verify task exists (will throw TaskNotFoundError if not)
    yield* taskSvc.get(taskId)

    const attemptList = yield* attemptSvc.listForTask(taskId)

    if (flag(flags, "json")) {
      console.log(toJson(attemptList))
    } else {
      if (attemptList.length === 0) {
        console.log(`No attempts recorded for ${taskId}`)
      } else {
        console.log(`${attemptList.length} attempt(s) for ${taskId}:`)
        for (const a of attemptList) {
          const outcomeSymbol = a.outcome === "succeeded" ? "\u2713" : "\u2717"
          const timestamp = a.createdAt.toISOString()
          console.log(`  ${outcomeSymbol} ${a.approach}`)
          if (a.reason) {
            console.log(`      Reason: ${a.reason}`)
          }
          console.log(`      ${timestamp}`)
        }
      }
    }
  })
