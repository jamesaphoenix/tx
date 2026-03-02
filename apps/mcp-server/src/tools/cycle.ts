/**
 * Cycle-related MCP Tools
 *
 * Provides MCP tools for querying cycle scan data.
 * Uses raw SQL via SqliteClient (same pattern as the REST cycle route).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import z from "zod"
import { SqliteClient } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// -----------------------------------------------------------------------------
// Raw row types from SQLite
// -----------------------------------------------------------------------------

interface CycleRunRow {
  id: string
  agent: string
  started_at: string
  ended_at: string | null
  status: string
  summary: string | null
  metadata: string
}

interface EventRow {
  metadata: string
}

interface IssueRow {
  id: string
  title: string
  description: string
  metadata: string
}

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleCycleList = async (): Promise<McpToolResult> => {
  try {
    const cycles = await runEffect(
      Effect.gen(function* () {
        const db = yield* SqliteClient
        const rows = db
          .prepare(
            `SELECT id, agent, started_at, ended_at, status, summary, metadata
             FROM runs
             WHERE agent = 'cycle-scanner'
             ORDER BY started_at DESC`
          )
          .all() as CycleRunRow[]

        return rows.map((row) => {
          const meta = JSON.parse(row.metadata || "{}") as Record<string, unknown>
          return {
            id: row.id,
            cycle: (meta.cycle as number) ?? 0,
            name: (meta.name as string) ?? "",
            description: (meta.description as string) ?? "",
            startedAt: row.started_at,
            endedAt: row.ended_at ?? null,
            status: row.status,
            rounds: (meta.rounds as number) ?? 0,
            totalNewIssues: (meta.totalNewIssues as number) ?? 0,
            existingIssues: (meta.existingIssues as number) ?? 0,
            finalLoss: (meta.finalLoss as number) ?? 0,
            converged: (meta.converged as boolean) ?? false,
          }
        })
      })
    )
    return {
      content: [
        { type: "text", text: `${cycles.length} cycle run(s)` },
        { type: "text", text: JSON.stringify({ cycles }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_cycle_list", {}, error)
  }
}

const handleCycleGet = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const db = yield* SqliteClient

        // Get the cycle run
        const runRow = db
          .prepare(
            `SELECT id, agent, started_at, ended_at, status, summary, metadata
             FROM runs WHERE id = ?`
          )
          .get(args.id) as CycleRunRow | undefined

        if (!runRow) {
          return null
        }

        const meta = JSON.parse(runRow.metadata || "{}") as Record<string, unknown>
        const cycle = {
          id: runRow.id,
          cycle: (meta.cycle as number) ?? 0,
          name: (meta.name as string) ?? "",
          description: (meta.description as string) ?? "",
          startedAt: runRow.started_at,
          endedAt: runRow.ended_at ?? null,
          status: runRow.status,
          rounds: (meta.rounds as number) ?? 0,
          totalNewIssues: (meta.totalNewIssues as number) ?? 0,
          existingIssues: (meta.existingIssues as number) ?? 0,
          finalLoss: (meta.finalLoss as number) ?? 0,
          converged: (meta.converged as boolean) ?? false,
        }

        // Get round metrics from events table
        const eventRows = db
          .prepare(
            `SELECT metadata FROM events
             WHERE run_id = ? AND event_type = 'metric' AND content = 'cycle.round.loss'
             ORDER BY timestamp ASC`
          )
          .all(args.id) as EventRow[]

        const roundMetrics = eventRows.map((row) => {
          const m = JSON.parse(row.metadata || "{}") as Record<string, unknown>
          return {
            cycle: (m.cycle as number) ?? 0,
            round: (m.round as number) ?? 0,
            loss: (m.loss as number) ?? 0,
            newIssues: (m.newIssues as number) ?? 0,
            existingIssues: (m.existingIssues as number) ?? 0,
            duplicates: (m.duplicates as number) ?? 0,
            high: (m.high as number) ?? 0,
            medium: (m.medium as number) ?? 0,
            low: (m.low as number) ?? 0,
          }
        })

        // Get issues (tasks) created by this cycle
        const issueRows = db
          .prepare(
            `SELECT id, title, description, metadata FROM tasks
             WHERE json_extract(metadata, '$.foundByScan') = 1
               AND json_extract(metadata, '$.cycleId') = ?
             ORDER BY json_extract(metadata, '$.round') ASC,
                      CASE json_extract(metadata, '$.severity')
                        WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3
                      END ASC`
          )
          .all(args.id) as IssueRow[]

        const issues = issueRows.map((row) => {
          const m = JSON.parse(row.metadata || "{}") as Record<string, unknown>
          return {
            id: row.id,
            title: row.title,
            description: row.description,
            severity: (m.severity as string) ?? "low",
            issueType: (m.issueType as string) ?? "",
            file: (m.file as string) ?? "",
            line: (m.line as number) ?? 0,
            cycle: (m.cycle as number) ?? 0,
            round: (m.round as number) ?? 0,
          }
        })

        return { cycle, roundMetrics, issues }
      })
    )
    if (!result) {
      return {
        content: [{ type: "text", text: `Cycle run not found: ${args.id}` }],
        isError: true,
      }
    }
    return {
      content: [
        { type: "text", text: `Cycle ${result.cycle.id}: ${result.roundMetrics.length} round(s), ${result.issues.length} issue(s)` },
        { type: "text", text: JSON.stringify(result) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_cycle_get", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerCycleTools = (server: McpServer): void => {
  server.tool(
    "tx_cycle_list",
    "List all cycle scan runs. Cycles are automated issue discovery runs performed by sub-agent swarms.",
    {},
    async () => handleCycleList()
  )

  server.tool(
    "tx_cycle_get",
    "Get detailed information about a specific cycle run, including round metrics and discovered issues.",
    {
      id: z.string().describe("Cycle run ID")
    },
    async (args) => handleCycleGet(args as { id: string })
  )
}
