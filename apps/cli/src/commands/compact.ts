/**
 * Compaction commands: compact, history
 *
 * Implements PRD-006: Task Compaction & Learnings Export
 */

import { Effect } from "effect"
import { CompactionService } from "@jamesaphoenix/tx-core"
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
 * Parse a date string into a Date object.
 * Supports ISO dates (YYYY-MM-DD) and relative days (e.g., "7d" for 7 days ago).
 */
function parseDate(input: string): Date {
  // Check for relative format like "7d" (7 days ago)
  const relativeMatch = input.match(/^(\d+)d$/)
  if (relativeMatch) {
    const days = parseInt(relativeMatch[1]!, 10)
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date
  }

  // Otherwise, parse as ISO date
  const date = new Date(input)
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${input}. Use YYYY-MM-DD or Nd (e.g., 7d for 7 days ago).`)
  }
  return date
}

/**
 * tx compact - Compact completed tasks and export learnings
 */
export const compact = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* CompactionService

    // Check availability first
    const available = yield* svc.isAvailable()

    // Parse --before option (default: 7 days ago)
    const beforeStr = opt(flags, "before")
    let before: Date
    try {
      before = beforeStr ? parseDate(beforeStr) : (() => {
        const d = new Date()
        d.setDate(d.getDate() - 7)
        return d
      })()
    } catch (e) {
      console.error(String(e))
      process.exit(1)
    }

    const outputFile = opt(flags, "output", "o") ?? "CLAUDE.md"
    const dryRun = flag(flags, "dry-run", "preview")

    // If dry-run, we can proceed without API key
    if (dryRun) {
      const tasks = yield* svc.preview(before)

      if (flag(flags, "json")) {
        console.log(toJson({
          dryRun: true,
          before: before.toISOString(),
          taskCount: tasks.length,
          tasks: tasks.map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            completedAt: t.completedAt?.toISOString()
          }))
        }))
      } else {
        if (tasks.length === 0) {
          console.log("No tasks eligible for compaction.")
          console.log(`  Before: ${before.toISOString().split("T")[0]}`)
        } else {
          console.log(`Would compact ${tasks.length} task(s):`)
          console.log(`  Before: ${before.toISOString().split("T")[0]}`)
          console.log(`  Output: ${outputFile}`)
          console.log("")
          for (const t of tasks) {
            console.log(`  - ${t.id}: ${t.title} [${t.status}]`)
            if (t.completedAt) {
              console.log(`    Completed: ${t.completedAt.toISOString().split("T")[0]}`)
            }
          }
          console.log("")
          console.log("Run without --dry-run to execute compaction.")
        }
      }
      return
    }

    // For actual compaction, check API key
    if (!available) {
      console.error("Task compaction requires ANTHROPIC_API_KEY.")
      console.error("Set it as an environment variable to enable this feature:")
      console.error("  export ANTHROPIC_API_KEY=sk-ant-...")
      console.error("")
      console.error("Use --dry-run to preview tasks without an API key.")
      process.exit(1)
    }

    // Execute compaction
    const result = yield* svc.compact({
      before,
      outputFile,
      dryRun: false
    })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      if (result.compactedCount === 0) {
        console.log("No tasks to compact.")
      } else {
        console.log(`Compacted ${result.compactedCount} task(s)`)
        console.log("")
        console.log("Summary:")
        console.log(result.summary)
        console.log("")
        console.log("Learnings exported to:", result.learningsExportedTo ?? "(not exported)")
        if (result.learnings) {
          console.log("")
          console.log("Learnings:")
          console.log(result.learnings)
        }
      }
    }
  })

/**
 * tx history - View compaction history
 */
export const history = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* CompactionService
    const summaries = yield* svc.getSummaries()

    if (flag(flags, "json")) {
      console.log(toJson(summaries))
    } else {
      if (summaries.length === 0) {
        console.log("No compaction history.")
      } else {
        console.log("Compaction History:")
        console.log("")
        for (const s of summaries) {
          const date = s.compactedAt.toISOString().split("T")[0]
          const taskCount = s.taskCount
          // Get first line of summary for preview
          const summaryPreview = s.summary.split("\n")[0]?.slice(0, 60) || "(no summary)"
          console.log(`${date}: ${taskCount} task(s)`)
          console.log(`  ${summaryPreview}${s.summary.length > 60 ? "..." : ""}`)
          if (s.learningsExportedTo) {
            console.log(`  Learnings exported to: ${s.learningsExportedTo}`)
          }
          console.log("")
        }
      }
    }
  })
