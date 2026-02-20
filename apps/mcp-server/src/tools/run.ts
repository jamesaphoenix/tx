/**
 * Run heartbeat MCP Tools
 *
 * Provides run-level heartbeat primitives for transcript/log progress tracking
 * and stalled run detection/reaping.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import z from "zod"
import type { RunId } from "@jamesaphoenix/tx-types"
import { RunHeartbeatService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

const RUN_ID_PATTERN = /^run-[a-z0-9]+$/i

const assertRunId = (id: string): RunId => {
  if (!RUN_ID_PATTERN.test(id)) {
    throw new Error(`Invalid run ID format: ${id}`)
  }
  return id as RunId
}

const parseIsoDate = (value: string | undefined, field: string): Date | undefined => {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${field}: must be an ISO timestamp`)
  }
  return parsed
}

const serializeRun = (run: {
  id: string
  taskId: string | null
  agent: string
  startedAt: Date
  endedAt: Date | null
  status: string
  exitCode: number | null
  pid: number | null
  transcriptPath: string | null
  stderrPath: string | null
  stdoutPath: string | null
  contextInjected: string | null
  summary: string | null
  errorMessage: string | null
  metadata: Record<string, unknown>
}) => ({
  id: run.id,
  taskId: run.taskId,
  agent: run.agent,
  startedAt: run.startedAt.toISOString(),
  endedAt: run.endedAt?.toISOString() ?? null,
  status: run.status,
  exitCode: run.exitCode,
  pid: run.pid,
  transcriptPath: run.transcriptPath,
  stderrPath: run.stderrPath,
  stdoutPath: run.stdoutPath,
  contextInjected: run.contextInjected,
  summary: run.summary,
  errorMessage: run.errorMessage,
  metadata: run.metadata,
})

const handleRunHeartbeat = async (args: {
  runId: string
  stdoutBytes?: number
  stderrBytes?: number
  transcriptBytes?: number
  deltaBytes?: number
  checkAt?: string
  activityAt?: string
}): Promise<McpToolResult> => {
  try {
    const runId = assertRunId(args.runId)
    const checkAt = parseIsoDate(args.checkAt, "checkAt")
    const activityAt = parseIsoDate(args.activityAt, "activityAt")

    await runEffect(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        yield* heartbeat.heartbeat({
          runId,
          checkAt,
          activityAt,
          stdoutBytes: args.stdoutBytes ?? 0,
          stderrBytes: args.stderrBytes ?? 0,
          transcriptBytes: args.transcriptBytes ?? 0,
          deltaBytes: args.deltaBytes,
        })
      })
    )

    return {
      content: [
        { type: "text", text: `Heartbeat updated for run: ${runId}` },
        {
          type: "text",
          text: JSON.stringify({
            runId,
            checkAt: (checkAt ?? new Date()).toISOString(),
            activityAt: activityAt?.toISOString() ?? null,
            stdoutBytes: args.stdoutBytes ?? 0,
            stderrBytes: args.stderrBytes ?? 0,
            transcriptBytes: args.transcriptBytes ?? 0,
            deltaBytes: args.deltaBytes ?? 0,
          }),
        },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_run_heartbeat", args, error)
  }
}

const handleRunStalled = async (args: {
  transcriptIdleSeconds?: number
  heartbeatLagSeconds?: number
}): Promise<McpToolResult> => {
  try {
    const runs = await runEffect(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        return yield* heartbeat.listStalled({
          transcriptIdleSeconds: args.transcriptIdleSeconds ?? 300,
          heartbeatLagSeconds: args.heartbeatLagSeconds,
        })
      })
    )

    const serialized = runs.map((item) => ({
      run: serializeRun(item.run),
      reason: item.reason,
      transcriptIdleSeconds: item.transcriptIdleSeconds,
      heartbeatLagSeconds: item.heartbeatLagSeconds,
      lastActivityAt: item.lastActivityAt?.toISOString() ?? null,
      lastCheckAt: item.lastCheckAt?.toISOString() ?? null,
      stdoutBytes: item.stdoutBytes,
      stderrBytes: item.stderrBytes,
      transcriptBytes: item.transcriptBytes,
    }))

    return {
      content: [
        { type: "text", text: `Found ${serialized.length} stalled run(s)` },
        { type: "text", text: JSON.stringify(serialized) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_run_stalled", args, error)
  }
}

const handleRunReap = async (args: {
  transcriptIdleSeconds?: number
  heartbeatLagSeconds?: number
  resetTask?: boolean
  dryRun?: boolean
}): Promise<McpToolResult> => {
  try {
    const runs = await runEffect(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        return yield* heartbeat.reapStalled({
          transcriptIdleSeconds: args.transcriptIdleSeconds ?? 300,
          heartbeatLagSeconds: args.heartbeatLagSeconds,
          resetTask: args.resetTask,
          dryRun: args.dryRun,
        })
      })
    )

    const serialized = runs.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      pid: item.pid,
      reason: item.reason,
      transcriptIdleSeconds: item.transcriptIdleSeconds,
      heartbeatLagSeconds: item.heartbeatLagSeconds,
      processTerminated: item.processTerminated,
      taskReset: item.taskReset,
    }))

    return {
      content: [
        { type: "text", text: `Reaped ${serialized.length} stalled run(s)` },
        { type: "text", text: JSON.stringify(serialized) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_run_reap", args, error)
  }
}

export const registerRunTools = (server: McpServer): void => {
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_run_heartbeat",
    "Record run heartbeat progress for transcript/log monitoring",
    {
      runId: z.string().describe("Run ID (e.g., run-abc12345)"),
      stdoutBytes: z.number().int().nonnegative().optional().describe("Current stdout byte count"),
      stderrBytes: z.number().int().nonnegative().optional().describe("Current stderr byte count"),
      transcriptBytes: z.number().int().nonnegative().optional().describe("Current transcript byte count"),
      deltaBytes: z.number().int().nonnegative().optional().describe("Bytes changed since last heartbeat"),
      checkAt: z.string().optional().describe("Optional ISO check timestamp"),
      activityAt: z.string().optional().describe("Optional ISO transcript activity timestamp"),
    },
    handleRunHeartbeat as Parameters<typeof server.tool>[3]
  )

  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_run_stalled",
    "List running runs that appear stalled by heartbeat/transcript inactivity",
    {
      transcriptIdleSeconds: z.number().int().positive().optional().describe("Transcript idle threshold in seconds (default: 300)"),
      heartbeatLagSeconds: z.number().int().positive().optional().describe("Optional heartbeat-lag threshold in seconds"),
    },
    handleRunStalled as Parameters<typeof server.tool>[3]
  )

  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_run_reap",
    "Reap stalled runs (kill process tree, cancel run, optionally reset task)",
    {
      transcriptIdleSeconds: z.number().int().positive().optional().describe("Transcript idle threshold in seconds (default: 300)"),
      heartbeatLagSeconds: z.number().int().positive().optional().describe("Optional heartbeat-lag threshold in seconds"),
      resetTask: z.boolean().optional().describe("Reset associated task to ready (default: true)"),
      dryRun: z.boolean().optional().describe("Preview actions without mutating state"),
    },
    handleRunReap as Parameters<typeof server.tool>[3]
  )
}
