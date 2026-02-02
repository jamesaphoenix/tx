/**
 * Graph commands: graph:verify, graph:invalidate, graph:restore, graph:prune, graph:status, graph:pin, graph:unpin
 */

import { Effect } from "effect"
import { AnchorService } from "@tx/core"
import { toJson } from "../output.js"

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

/**
 * tx graph:verify [--file <path>] [--all] [--json]
 * Verify anchors for a specific file or all anchors
 */
export const graphVerify = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* AnchorService
    const filePath = pos[0] ?? opt(flags, "file")

    if (filePath) {
      // Verify anchors for specific file
      const result = yield* svc.verifyAnchorsForFile(filePath)

      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Verification complete for: ${filePath}`)
        console.log(`  Total: ${result.total}`)
        console.log(`  Valid: ${result.verified}`)
        console.log(`  Drifted: ${result.drifted}`)
        console.log(`  Invalid: ${result.invalid}`)
      }
    } else {
      // Verify all anchors
      const result = yield* svc.verifyAll()

      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log("Verification complete for all anchors")
        console.log(`  Total: ${result.total}`)
        console.log(`  Valid: ${result.verified}`)
        console.log(`  Drifted: ${result.drifted}`)
        console.log(`  Invalid: ${result.invalid}`)
      }
    }
  })

/**
 * tx graph:invalidate <anchor-id> --reason <reason> [--json]
 * Manually invalidate an anchor
 */
export const graphInvalidate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:invalidate <anchor-id> --reason <reason> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const reason = opt(flags, "reason") ?? "Manual invalidation"

    const svc = yield* AnchorService
    const anchor = yield* svc.invalidate(anchorId, reason)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Invalidated anchor #${anchor.id}`)
      console.log(`  Status: ${anchor.status}`)
      console.log(`  Reason: ${reason}`)
      console.log(`  File: ${anchor.filePath}`)
    }
  })

/**
 * tx graph:restore <anchor-id> [--json]
 * Restore a soft-deleted (invalid) anchor
 */
export const graphRestore = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:restore <anchor-id> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const svc = yield* AnchorService
    const anchor = yield* svc.restore(anchorId)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Restored anchor #${anchor.id}`)
      console.log(`  Status: ${anchor.status}`)
      console.log(`  File: ${anchor.filePath}`)
    }
  })

/**
 * tx graph:prune [--older-than <days>] [--json]
 * Hard delete old invalid anchors
 */
export const graphPrune = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const olderThanStr = opt(flags, "older-than") ?? "90"

    // Parse days from string like "90d" or "90"
    let olderThanDays = parseInt(olderThanStr.replace(/d$/, ""), 10)
    if (isNaN(olderThanDays) || olderThanDays < 1) {
      olderThanDays = 90
    }

    const svc = yield* AnchorService
    const result = yield* svc.prune(olderThanDays)

    if (flag(flags, "json")) {
      console.log(toJson({ deleted: result.deleted, olderThanDays }))
    } else {
      console.log(`Pruned invalid anchors older than ${olderThanDays} days`)
      console.log(`  Deleted: ${result.deleted}`)
    }
  })

/**
 * tx graph:status [--json]
 * Show graph health metrics
 */
export const graphStatus = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* AnchorService
    const status = yield* svc.getStatus()

    if (flag(flags, "json")) {
      console.log(toJson(status))
    } else {
      console.log("Graph Status")
      console.log(`  Total anchors: ${status.total}`)
      console.log(`  Valid: ${status.valid}`)
      console.log(`  Drifted: ${status.drifted}`)
      console.log(`  Invalid: ${status.invalid}`)
      console.log(`  Pinned: ${status.pinned}`)

      if (status.recentInvalidations.length > 0) {
        console.log("\nRecent Invalidations:")
        for (const log of status.recentInvalidations.slice(0, 5)) {
          const date = log.invalidatedAt.toISOString().split("T")[0]
          console.log(`  #${log.anchorId} ${log.oldStatus} → ${log.newStatus} (${log.detectedBy}) ${date}`)
          console.log(`    Reason: ${log.reason}`)
        }
      }
    }
  })

/**
 * tx graph:pin <anchor-id> [--json]
 * Pin an anchor to prevent auto-invalidation
 */
export const graphPin = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:pin <anchor-id> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const svc = yield* AnchorService
    const anchor = yield* svc.pin(anchorId)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Pinned anchor #${anchor.id}`)
      console.log(`  File: ${anchor.filePath}`)
      console.log(`  Type: ${anchor.anchorType}`)
      console.log(`  Pinned: ${anchor.pinned}`)
    }
  })

/**
 * tx graph:unpin <anchor-id> [--json]
 * Unpin an anchor to allow auto-invalidation
 */
export const graphUnpin = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:unpin <anchor-id> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const svc = yield* AnchorService
    const anchor = yield* svc.unpin(anchorId)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Unpinned anchor #${anchor.id}`)
      console.log(`  File: ${anchor.filePath}`)
      console.log(`  Type: ${anchor.anchorType}`)
      console.log(`  Pinned: ${anchor.pinned}`)
    }
  })
