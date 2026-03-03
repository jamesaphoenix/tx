/**
 * Reflect-related MCP Tools
 *
 * Provides MCP tools for macro-level session retrospective (bounded autonomy).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import z from "zod"
import { ReflectService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleReflect = async (args: {
  sessions?: number
  hours?: number
  analyze?: boolean
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* ReflectService
        return yield* svc.reflect({
          sessions: args.sessions,
          hours: args.hours,
          analyze: args.analyze,
        })
      })
    )

    // Build human-readable summary
    const lines: string[] = []
    lines.push(`Sessions: ${result.sessions.total} total, ${result.sessions.completed} completed, ${result.sessions.failed} failed`)
    lines.push(`Throughput: ${result.throughput.created} created, ${result.throughput.completed} completed (${Math.round(result.throughput.completionRate * 100)}% rate)`)
    lines.push(`Proliferation: avg ${result.proliferation.avgCreatedPerSession}/session, max depth ${result.proliferation.maxDepth}, orphan chains ${result.proliferation.orphanChains}`)

    if (result.stuckTasks.length > 0) {
      lines.push(`Stuck tasks: ${result.stuckTasks.map(t => `${t.id} (${t.failedAttempts} failed)`).join(", ")}`)
    }

    if (result.signals.length > 0) {
      lines.push(`Signals: ${result.signals.map(s => `[${s.severity}] ${s.type}: ${s.message}`).join("; ")}`)
    }

    if (result.analysis) {
      lines.push(`\nAnalysis:\n${result.analysis}`)
    } else if (args.analyze) {
      lines.push(`\nNote: LLM analysis was requested but unavailable. Ensure ANTHROPIC_API_KEY is set.`)
    }

    return {
      content: [
        { type: "text", text: lines.join("\n") },
        { type: "text", text: JSON.stringify(result) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_reflect", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerReflectTools = (server: McpServer): void => {
  server.tool(
    "tx_reflect",
    "Run a session retrospective to analyze recent agent sessions. Returns structured metrics on throughput, proliferation, stuck tasks, and signals. Use to detect problems and tune approach.",
    {
      sessions: z.number().int().positive().optional().describe("Number of recent sessions to analyze (default: 10)"),
      hours: z.number().positive().optional().describe("Time window in hours (e.g., 1 for last hour)"),
      analyze: z.boolean().optional().describe("Enable LLM-powered analysis (requires ANTHROPIC_API_KEY or Claude Agent SDK)")
    },
    async (args) => handleReflect(args as { sessions?: number; hours?: number; analyze?: boolean })
  )
}
