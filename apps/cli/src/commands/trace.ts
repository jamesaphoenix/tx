/**
 * Trace commands: list, show, transcript, stderr, errors
 *
 * CLI commands for execution tracing (PRD-019).
 */

import { Effect } from "effect"
import { RunRepository, SqliteClient, type DatabaseError } from "@jamesaphoenix/tx-core"
import type { Run } from "@jamesaphoenix/tx-types"
import { toJson, truncate } from "../output.js"
import { commandHelp } from "../help.js"

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
 * Calculate relative time string (e.g., "2h ago", "3d ago").
 */
function relativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}

/**
 * Get span counts for multiple runs in a single query.
 */
const getSpanCountsForRuns = (
  db: { prepare: (sql: string) => { all: (...params: unknown[]) => Array<{ run_id: string; count: number }> } },
  runIds: string[]
): Map<string, number> => {
  if (runIds.length === 0) return new Map()

  const placeholders = runIds.map(() => "?").join(",")
  const rows = db.prepare(`
    SELECT run_id, COUNT(*) as count
    FROM events
    WHERE run_id IN (${placeholders}) AND event_type = 'span'
    GROUP BY run_id
  `).all(...runIds)

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.run_id, row.count)
  }
  return counts
}

/**
 * Interface for run with span count.
 */
interface RunWithSpanCount extends Run {
  spanCount: number
}

/**
 * tx trace list - Show recent runs with event counts.
 */
export const traceList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const runRepo = yield* RunRepository
    const db = yield* SqliteClient

    // Parse options
    const limitOpt = opt(flags, "limit", "n")
    const limit = limitOpt ? parseInt(limitOpt, 10) : 20
    const hoursOpt = opt(flags, "hours")
    const hours = hoursOpt ? parseInt(hoursOpt, 10) : 24

    // Get recent runs - for now we'll get more than needed and filter by time
    // A more efficient approach would be to add a time-filtered query to RunRepository
    const allRuns = yield* runRepo.findRecent(limit * 2) // Get extra to account for time filtering

    // Filter to runs within the specified hours
    const cutoff = Date.now() - hours * 60 * 60 * 1000
    const recentRuns = allRuns
      .filter(r => r.startedAt.getTime() >= cutoff)
      .slice(0, limit)

    // Get span counts for all runs
    const runIds = recentRuns.map(r => r.id)
    const spanCounts = getSpanCountsForRuns(db, runIds)

    // Build runs with span counts
    const runsWithCounts: RunWithSpanCount[] = recentRuns.map(r => ({
      ...r,
      spanCount: spanCounts.get(r.id) ?? 0
    }))

    if (flag(flags, "json")) {
      console.log(toJson(runsWithCounts))
    } else {
      if (runsWithCounts.length === 0) {
        console.log(`No runs found in the last ${hours} hours`)
        return
      }

      console.log(`Recent Runs (last ${hours}h)`)
      console.log("─".repeat(75))

      // Print header
      const header = [
        "ID".padEnd(14),
        "Agent".padEnd(16),
        "Task".padEnd(14),
        "Status".padEnd(10),
        "Spans".padStart(6),
        "Time".padStart(8)
      ].join("  ")
      console.log(header)

      // Print runs
      for (const run of runsWithCounts) {
        const line = [
          truncate(run.id, 14).padEnd(14),
          truncate(run.agent, 16).padEnd(16),
          (run.taskId ? truncate(run.taskId, 14) : "-").padEnd(14),
          run.status.padEnd(10),
          String(run.spanCount).padStart(6),
          relativeTime(run.startedAt).padStart(8)
        ].join("  ")
        console.log(line)
      }

      console.log("")
      console.log(`${runsWithCounts.length} run(s)`)
    }
  }) as Effect.Effect<void, DatabaseError, RunRepository | SqliteClient>

/**
 * Main trace command dispatcher.
 */
export const trace = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]

    if (!subcommand || subcommand === "help") {
      console.log(commandHelp["trace"] ?? `
Usage: tx trace <subcommand> [options]

Subcommands:
  list                        Show recent runs with event counts
  show <run-id>               Show metrics events for a run
  transcript <run-id>         Display raw transcript content
  stderr <run-id>             Display stderr content
  errors                      Show recent errors across all runs

Options:
  --json                      Output as JSON
  --hours <n>                 Time window in hours (default: 24)
  --limit <n>                 Maximum number of results (default: 20)
  --help, -h                  Show this help message
`)
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `trace ${subcommand}`
      if (commandHelp[helpKey]) {
        console.log(commandHelp[helpKey])
        return
      }
    }

    if (subcommand === "list") {
      yield* traceList(pos.slice(1), flags)
    } else {
      console.error(`Unknown trace subcommand: ${subcommand}`)
      console.error(`Run 'tx trace --help' for usage information`)
      process.exit(1)
    }
  }) as Effect.Effect<void, DatabaseError, RunRepository | SqliteClient>
