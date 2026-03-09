/**
 * Claim commands: claim, claim release, claim renew
 *
 * PRD-018: Worker Orchestration System
 *
 * Lease-based task claims for worker coordination.
 */

import { Effect } from "effect"
import * as os from "node:os"
import { ClaimService, WorkerRepository } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, parseIntOpt, parseTaskId } from "../utils/parse.js"

/**
 * Claim dispatcher: routes `tx claim <subcommand>` or acts as direct claim.
 *
 * - `tx claim release <task-id> <worker-id>` → claimRelease
 * - `tx claim renew <task-id> <worker-id>` → claimRenew
 * - `tx claim <task-id> <worker-id>` → direct claim
 */
export const claim = (pos: string[], flags: Flags) => {
  if (pos[0] === "release") return claimRelease(pos.slice(1), flags)
  if (pos[0] === "renew") return claimRenew(pos.slice(1), flags)
  return claimDirect(pos, flags)
}

/**
 * Claim a task for a worker with a lease.
 *
 * Usage: tx claim <task-id> <worker-id> [--lease <minutes>] [--json]
 *
 * Examples:
 *   tx claim tx-abc123 worker-def456
 *   tx claim tx-abc123 worker-def456 --lease 60
 */
const claimDirect = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawTaskId = pos[0]
    const workerId = pos[1]

    if (!rawTaskId || !workerId) {
      console.error("Usage: tx claim <task-id> <worker-id> [--lease <minutes>] [--json]")
      console.error("")
      console.error("Options:")
      console.error("  --lease <m>  Lease duration in minutes (default: 30)")
      console.error("  --json       Output in JSON format")
      process.exit(1)
    }
    const taskId = parseTaskId(rawTaskId)

    const leaseMinutes = parseIntOpt(flags, "lease", "lease")

    // Ensure worker exists for FK integrity when claiming manually via CLI.
    const workerRepo = yield* WorkerRepository
    const existingWorker = yield* workerRepo.findById(workerId)
    if (!existingWorker) {
      const now = new Date()
      yield* workerRepo.insert({
        id: workerId,
        name: workerId,
        hostname: os.hostname(),
        pid: process.pid,
        status: "idle",
        registeredAt: now,
        lastHeartbeatAt: now,
        currentTaskId: null,
        capabilities: ["tx-cli"],
        metadata: { source: "tx claim" },
      })
    }

    const svc = yield* ClaimService
    const claim = yield* svc.claim(taskId, workerId, leaseMinutes)

    if (flag(flags, "json")) {
      console.log(toJson(claim))
    } else {
      console.log(`Task ${claim.taskId} claimed by ${claim.workerId}`)
      console.log(`  Lease expires: ${claim.leaseExpiresAt.toISOString()}`)
    }
  })

/**
 * Release a claim on a task.
 *
 * Usage: tx claim release <task-id> <worker-id> [--json]
 *
 * Examples:
 *   tx claim release tx-abc123 worker-def456
 */
export const claimRelease = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawTaskId = pos[0]
    const workerId = pos[1]

    if (!rawTaskId || !workerId) {
      console.error("Usage: tx claim release <task-id> <worker-id> [--json]")
      process.exit(1)
    }
    const taskId = parseTaskId(rawTaskId)

    const svc = yield* ClaimService
    yield* svc.release(taskId, workerId)

    if (flag(flags, "json")) {
      console.log(toJson({ released: true, taskId, workerId }))
    } else {
      console.log(`Claim on task ${taskId} released by ${workerId}`)
    }
  })

/**
 * Renew the lease on an existing claim.
 *
 * Usage: tx claim renew <task-id> <worker-id> [--json]
 *
 * Examples:
 *   tx claim renew tx-abc123 worker-def456
 */
export const claimRenew = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawTaskId = pos[0]
    const workerId = pos[1]

    if (!rawTaskId || !workerId) {
      console.error("Usage: tx claim renew <task-id> <worker-id> [--json]")
      process.exit(1)
    }
    const taskId = parseTaskId(rawTaskId)

    const svc = yield* ClaimService
    const renewed = yield* svc.renew(taskId, workerId)

    if (flag(flags, "json")) {
      console.log(toJson(renewed))
    } else {
      console.log(`Lease on task ${renewed.taskId} renewed`)
      console.log(`  New expiry: ${renewed.leaseExpiresAt.toISOString()}`)
      console.log(`  Renewals: ${renewed.renewedCount}/10`)
    }
  })
