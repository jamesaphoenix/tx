/**
 * Trace commands: list, show, transcript, stderr, errors
 *
 * CLI commands for execution tracing (PRD-019).
 */

import { Effect } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  RunRepository,
  SqliteClient,
  type DatabaseError,
  getAdapter,
  type ToolCall
} from "@jamesaphoenix/tx-core"
import type { Run, RunId } from "@jamesaphoenix/tx-types"
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
 * Event row from database.
 */
interface EventRow {
  id: number
  timestamp: string
  event_type: string
  run_id: string | null
  task_id: string | null
  agent: string | null
  tool_name: string | null
  content: string | null
  metadata: string
  duration_ms: number | null
}

/**
 * Parsed event for display.
 */
interface ParsedEvent {
  timestamp: Date
  type: "span" | "metric" | "other"
  name: string
  durationMs: number | null
  status: "ok" | "error" | "unknown"
  error?: string
  attributes?: Record<string, unknown>
}

/**
 * Timeline entry for combined view.
 */
interface TimelineEntry {
  timestamp: Date
  entryType: "span" | "metric" | "tool"
  name: string
  detail?: string
  durationMs?: number
  status?: "ok" | "error" | "unknown"
}

/**
 * Get events for a run from the database.
 */
const getEventsForRun = (
  db: { prepare: (sql: string) => { all: (...params: unknown[]) => EventRow[] } },
  runId: string
): EventRow[] => {
  return db.prepare(`
    SELECT id, timestamp, event_type, run_id, task_id, agent, tool_name, content, metadata, duration_ms
    FROM events
    WHERE run_id = ?
    ORDER BY timestamp ASC, id ASC
  `).all(runId)
}

/**
 * Parse an event row into a structured event.
 */
const parseEvent = (row: EventRow): ParsedEvent => {
  let metadata: Record<string, unknown> = {}
  try {
    metadata = JSON.parse(row.metadata)
  } catch {
    // Ignore parse errors
  }

  const status = (metadata.status as string) === "ok" ? "ok"
    : (metadata.status as string) === "error" ? "error"
    : "unknown"

  return {
    timestamp: new Date(row.timestamp),
    type: row.event_type === "span" ? "span"
      : row.event_type === "metric" ? "metric"
      : "other",
    name: row.content ?? row.event_type,
    durationMs: row.duration_ms,
    status,
    error: metadata.error as string | undefined,
    attributes: metadata.attributes as Record<string, unknown> | undefined
  }
}

/**
 * Format time as HH:MM:SS.
 */
const formatTime = (date: Date): string => {
  return date.toTimeString().slice(0, 8)
}

/**
 * Format time as HH:MM:SS.mmm for detailed view.
 */
const formatTimeWithMs = (date: Date): string => {
  const time = date.toTimeString().slice(0, 8)
  const ms = String(date.getMilliseconds()).padStart(3, "0")
  return `${time}.${ms}`
}

/**
 * Read transcript file and parse tool calls.
 */
const readTranscriptToolCalls = (
  transcriptPath: string,
  agentType: string,
  txDir: string
): ToolCall[] => {
  // Resolve transcript path relative to .tx directory
  const fullPath = transcriptPath.startsWith("/")
    ? transcriptPath
    : resolve(txDir, transcriptPath)

  if (!existsSync(fullPath)) {
    return []
  }

  try {
    const content = readFileSync(fullPath, "utf-8")
    const lines = content.split("\n").filter(Boolean)
    const adapter = getAdapter(agentType)
    return [...adapter.parseToolCalls(lines)]
  } catch {
    return []
  }
}

/**
 * tx trace transcript <run-id> - Display raw transcript content.
 *
 * Outputs raw JSONL content from the transcript file.
 * Designed to be piped to jq for filtering tool calls.
 */
export const traceTranscript = (pos: string[], _flags: Flags) =>
  Effect.gen(function* () {
    const runId = pos[0]
    if (!runId) {
      console.error("Error: run-id is required")
      console.error("Usage: tx trace transcript <run-id>")
      process.exit(1)
    }

    const runRepo = yield* RunRepository

    // Get run details
    const run = yield* runRepo.findById(runId as RunId)
    if (!run) {
      console.error(`Error: Run not found: ${runId}`)
      process.exit(1)
    }

    // Check if transcript path exists
    if (!run.transcriptPath) {
      console.error(`Error: No transcript recorded for run: ${runId}`)
      process.exit(1)
    }

    // Resolve transcript path relative to .tx directory
    const txDir = process.cwd() + "/.tx"
    const fullPath = run.transcriptPath.startsWith("/")
      ? run.transcriptPath
      : resolve(txDir, run.transcriptPath)

    if (!existsSync(fullPath)) {
      console.error(`Error: Transcript file not found: ${fullPath}`)
      process.exit(1)
    }

    // Read and output raw content
    const content = readFileSync(fullPath, "utf-8")
    process.stdout.write(content)
  }) as Effect.Effect<void, DatabaseError, RunRepository>

/**
 * tx trace show <run-id> - Show metrics events for a run.
 */
export const traceShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const runId = pos[0]
    if (!runId) {
      console.error("Error: run-id is required")
      console.error("Usage: tx trace show <run-id> [--full] [--json]")
      process.exit(1)
    }

    const runRepo = yield* RunRepository
    const db = yield* SqliteClient

    // Get run details
    const run = yield* runRepo.findById(runId as RunId)
    if (!run) {
      console.error(`Error: Run not found: ${runId}`)
      process.exit(1)
    }

    // Get events for this run
    const eventRows = getEventsForRun(db, runId)
    const events = eventRows.map(parseEvent)

    // Filter to spans and metrics only (for basic view)
    const metricsEvents = events.filter(e => e.type === "span" || e.type === "metric")

    // Check for --full flag
    const showFull = flag(flags, "full")

    if (flag(flags, "json")) {
      // JSON output
      const output: Record<string, unknown> = {
        run: {
          id: run.id,
          agent: run.agent,
          taskId: run.taskId,
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          endedAt: run.endedAt?.toISOString() ?? null,
          transcriptPath: run.transcriptPath,
          stderrPath: run.stderrPath,
          stdoutPath: run.stdoutPath,
          exitCode: run.exitCode,
          errorMessage: run.errorMessage
        },
        events: metricsEvents.map(e => ({
          timestamp: e.timestamp.toISOString(),
          type: e.type,
          name: e.name,
          durationMs: e.durationMs,
          status: e.status,
          error: e.error,
          attributes: e.attributes
        }))
      }

      if (showFull && run.transcriptPath) {
        // Get .tx directory (parent of tasks.db)
        const txDir = process.cwd() + "/.tx"
        const toolCalls = readTranscriptToolCalls(run.transcriptPath, run.agent, txDir)
        output.toolCalls = toolCalls
      }

      console.log(toJson(output))
      return
    }

    // Human-readable output
    console.log(`Run: ${run.id}`)
    console.log(`Agent: ${run.agent}`)
    console.log(`Task: ${run.taskId ?? "-"}`)
    console.log(`Status: ${run.status}`)
    if (run.startedAt) {
      console.log(`Started: ${run.startedAt.toISOString()}`)
    }
    if (run.endedAt) {
      console.log(`Ended: ${run.endedAt.toISOString()}`)
    }
    if (run.exitCode !== null) {
      console.log(`Exit Code: ${run.exitCode}`)
    }
    if (run.errorMessage) {
      console.log(`Error: ${run.errorMessage}`)
    }
    if (run.transcriptPath) {
      console.log(`Transcript: ${run.transcriptPath}`)
    }
    if (run.stderrPath) {
      console.log(`Stderr: ${run.stderrPath}`)
    }
    if (run.stdoutPath) {
      console.log(`Stdout: ${run.stdoutPath}`)
    }
    console.log("")

    if (showFull && run.transcriptPath) {
      // Combined timeline view
      console.log("Combined Timeline:")
      console.log("─".repeat(75))

      // Get tool calls from transcript
      const txDir = process.cwd() + "/.tx"
      const toolCalls = readTranscriptToolCalls(run.transcriptPath, run.agent, txDir)

      // Build combined timeline
      const timeline: TimelineEntry[] = []

      // Add events
      for (const event of metricsEvents) {
        timeline.push({
          timestamp: event.timestamp,
          entryType: event.type === "metric" ? "metric" : "span",
          name: event.name,
          durationMs: event.durationMs ?? undefined,
          status: event.status
        })
      }

      // Add tool calls
      for (const toolCall of toolCalls) {
        const inputSummary = toolCall.input.command
          ?? toolCall.input.file_path
          ?? toolCall.input.pattern
          ?? ""
        timeline.push({
          timestamp: new Date(toolCall.timestamp),
          entryType: "tool",
          name: toolCall.name,
          detail: typeof inputSummary === "string" ? truncate(inputSummary, 40) : undefined
        })
      }

      // Sort by timestamp
      timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

      if (timeline.length === 0) {
        console.log("  No events or tool calls recorded")
      } else {
        for (const entry of timeline) {
          const time = formatTimeWithMs(entry.timestamp)
          const typeTag = `[${entry.entryType}]`.padEnd(8)

          if (entry.entryType === "tool") {
            const detail = entry.detail ? `: ${entry.detail}` : ""
            console.log(`${time}  ${typeTag}  ${entry.name}${detail}`)
          } else {
            const duration = entry.durationMs !== undefined ? `${entry.durationMs}ms` : "-"
            const status = entry.status ?? "unknown"
            const line = `${time}  ${typeTag}  ${entry.name.padEnd(30)}  ${duration.padStart(8)}  ${status}`
            console.log(line)

            // Show error on next line if present
            const event = metricsEvents.find(
              e => e.timestamp.getTime() === entry.timestamp.getTime() && e.name === entry.name
            )
            if (event?.error) {
              console.log(`          └─ ${truncate(event.error, 60)}`)
            }
          }
        }
      }
    } else {
      // Basic metrics events view
      console.log("Metrics Events:")
      console.log("─".repeat(75))

      if (metricsEvents.length === 0) {
        console.log("  No events recorded")
      } else {
        for (const event of metricsEvents) {
          const time = formatTime(event.timestamp)
          const typeTag = `[${event.type}]`
          const duration = event.durationMs !== null ? `${event.durationMs}ms` : "-"
          const line = `${time}  ${typeTag}  ${event.name.padEnd(30)}  ${duration.padStart(8)}  ${event.status}`
          console.log(line)

          // Show error on next line if present
          if (event.error) {
            console.log(`          └─ ${truncate(event.error, 60)}`)
          }
        }
      }
    }

    console.log("")
    console.log(`${metricsEvents.length} event(s)`)
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
    } else if (subcommand === "show") {
      yield* traceShow(pos.slice(1), flags)
    } else if (subcommand === "transcript") {
      yield* traceTranscript(pos.slice(1), flags)
    } else {
      console.error(`Unknown trace subcommand: ${subcommand}`)
      console.error(`Run 'tx trace --help' for usage information`)
      process.exit(1)
    }
  }) as Effect.Effect<void, DatabaseError, RunRepository | SqliteClient>
