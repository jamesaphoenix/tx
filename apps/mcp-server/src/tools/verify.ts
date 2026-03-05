/**
 * Verify-related MCP Tools
 *
 * Provides MCP tools for machine-checkable done criteria (bounded autonomy).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import { VerifyService } from "@jamesaphoenix/tx-core"
import { assertTaskId } from "@jamesaphoenix/tx-types"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleVerifySet = async (args: {
  taskId: string
  cmd: string
  schema?: string
}): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* VerifyService
        return yield* svc.set(taskId, args.cmd, args.schema)
      })
    )
    return {
      content: [
        { type: "text", text: `Verify command set for task ${args.taskId}: ${args.cmd}${args.schema ? ` (schema: ${args.schema})` : ""}` }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_verify_set", args, error)
  }
}

const handleVerifyShow = async (args: {
  taskId: string
}): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* VerifyService
        return yield* svc.show(taskId)
      })
    )
    return {
      content: [
        { type: "text", text: result.cmd ? `Verify: ${result.cmd}${result.schema ? ` (schema: ${result.schema})` : ""}` : "No verify command set" },
        { type: "text", text: JSON.stringify(result) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_verify_show", args, error)
  }
}

const handleVerifyRun = async (args: {
  taskId: string
  timeout?: number
}): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* VerifyService
        return yield* svc.run(taskId, args.timeout ? { timeout: args.timeout } : undefined)
      })
    )
    const status = result.passed ? "PASSED" : "FAILED"
    return {
      content: [
        { type: "text", text: `Verify ${status} (exit code ${result.exitCode}, ${result.durationMs}ms)${result.schemaValid !== undefined ? `, schema: ${result.schemaValid ? "valid" : "invalid"}` : ""}` },
        { type: "text", text: JSON.stringify(result) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_verify_run", args, error)
  }
}

const handleVerifyClear = async (args: {
  taskId: string
}): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* VerifyService
        return yield* svc.clear(taskId)
      })
    )
    return {
      content: [
        { type: "text", text: `Verify command cleared for task ${args.taskId}` }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_verify_clear", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerVerifyTools = (server: McpServer): void => {
  registerEffectTool(server,
    "tx_verify_set",
    "Attach a shell verification command to a task. The command is run by tx_verify_run to determine if a task is truly done. Exit code 0 = pass.",
    {
      taskId: z.string().describe("Task ID to attach verification command to"),
      cmd: z.string().describe("Shell command to run for verification (e.g., 'bun run test:auth')"),
      schema: z.string().optional().describe("Path to JSON Schema file for structured output validation")
    },
    async (args) => handleVerifySet(args as { taskId: string; cmd: string; schema?: string })
  )

  registerEffectTool(server,
    "tx_verify_show",
    "Show the verification command and schema attached to a task.",
    {
      taskId: z.string().describe("Task ID to check")
    },
    async (args) => handleVerifyShow(args as { taskId: string })
  )

  registerEffectTool(server,
    "tx_verify_run",
    "Execute the verification command for a task. Returns exit code, stdout, stderr, duration, and optional schema validation result. Use to gate task completion: tx_verify_run then tx_done.",
    {
      taskId: z.string().describe("Task ID to verify"),
      timeout: z.number().int().positive().optional().describe("Timeout in seconds (default: from config, typically 300)")
    },
    async (args) => handleVerifyRun(args as { taskId: string; timeout?: number })
  )

  registerEffectTool(server,
    "tx_verify_clear",
    "Remove the verification command from a task.",
    {
      taskId: z.string().describe("Task ID to clear verification from")
    },
    async (args) => handleVerifyClear(args as { taskId: string })
  )
}
