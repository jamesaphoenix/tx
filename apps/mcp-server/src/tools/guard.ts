/**
 * Guard-related MCP Tools
 *
 * Provides MCP tools for task creation guard management (bounded autonomy).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import z from "zod"
import { GuardService } from "@jamesaphoenix/tx-core"
import { assertTaskId } from "@jamesaphoenix/tx-types"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// Serialize a guard object for JSON output
const serializeGuard = (guard: {
  id: number
  scope: string
  maxPending: number | null
  maxChildren: number | null
  maxDepth: number | null
  enforce: boolean
  createdAt: string
}) => ({
  id: guard.id,
  scope: guard.scope,
  maxPending: guard.maxPending,
  maxChildren: guard.maxChildren,
  maxDepth: guard.maxDepth,
  enforce: guard.enforce,
  createdAt: guard.createdAt,
})

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleGuardSet = async (args: {
  scope?: string
  maxPending?: number
  maxChildren?: number
  maxDepth?: number
  enforce?: boolean
}): Promise<McpToolResult> => {
  try {
    // Validate task ID in parent-scoped guards
    if (args.scope?.startsWith("parent:")) {
      assertTaskId(args.scope.slice("parent:".length))
    }
    const guard = await runEffect(
      Effect.gen(function* () {
        const svc = yield* GuardService
        return yield* svc.set({
          scope: args.scope,
          maxPending: args.maxPending,
          maxChildren: args.maxChildren,
          maxDepth: args.maxDepth,
          enforce: args.enforce,
        })
      })
    )
    return {
      content: [
        { type: "text", text: `Guard set for scope "${guard.scope}": maxPending=${guard.maxPending}, maxChildren=${guard.maxChildren}, maxDepth=${guard.maxDepth}, enforce=${guard.enforce}` },
        { type: "text", text: JSON.stringify(serializeGuard(guard)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_guard_set", args, error)
  }
}

const handleGuardShow = async (_args: Record<string, unknown>): Promise<McpToolResult> => {
  try {
    const guards = await runEffect(
      Effect.gen(function* () {
        const svc = yield* GuardService
        return yield* svc.show()
      })
    )
    return {
      content: [
        { type: "text", text: guards.length === 0 ? "No guards configured" : `${guards.length} guard(s) configured` },
        { type: "text", text: JSON.stringify(guards.map(serializeGuard)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_guard_show", {}, error)
  }
}

const handleGuardClear = async (args: {
  scope?: string
}): Promise<McpToolResult> => {
  try {
    // Validate task ID in parent-scoped guards
    if (args.scope?.startsWith("parent:")) {
      assertTaskId(args.scope.slice("parent:".length))
    }
    const removed = await runEffect(
      Effect.gen(function* () {
        const svc = yield* GuardService
        return yield* svc.clear(args.scope)
      })
    )
    return {
      content: [
        { type: "text", text: removed ? `Guard(s) cleared${args.scope ? ` for scope "${args.scope}"` : ""}` : "No guards found to clear" }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_guard_clear", args, error)
  }
}

const handleGuardCheck = async (args: {
  parentId?: string
}): Promise<McpToolResult> => {
  try {
    // Validate parentId as a task ID if provided
    const parentId = args.parentId ? assertTaskId(args.parentId) : null
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* GuardService
        return yield* svc.check(parentId)
      })
    )
    return {
      content: [
        { type: "text", text: result.passed ? "All guard checks passed" : `Guard warnings: ${result.warnings.join("; ")}` },
        { type: "text", text: JSON.stringify(result) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_guard_check", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerGuardTools = (server: McpServer): void => {
  server.tool(
    "tx_guard_set",
    "Set task creation limits (bounded autonomy). Limits can be global or scoped to a parent task. Advisory mode (default) emits warnings; enforce mode blocks task creation.",
    {
      scope: z.string().optional().describe("Guard scope: 'global' (default) or 'parent:<task-id>'"),
      maxPending: z.number().int().positive().optional().describe("Maximum non-done tasks allowed"),
      maxChildren: z.number().int().positive().optional().describe("Maximum direct children per parent task"),
      maxDepth: z.number().int().positive().optional().describe("Maximum task hierarchy nesting depth"),
      enforce: z.boolean().optional().describe("true = hard block on violation; false/omit = advisory warnings only")
    },
    async (args) => handleGuardSet(args as { scope?: string; maxPending?: number; maxChildren?: number; maxDepth?: number; enforce?: boolean })
  )

  server.tool(
    "tx_guard_show",
    "Show all configured task creation guards. Returns guard limits for all scopes.",
    {},
    async (args) => handleGuardShow(args as Record<string, unknown>)
  )

  server.tool(
    "tx_guard_clear",
    "Clear task creation guards. Clears all guards by default, or a specific scope.",
    {
      scope: z.string().optional().describe("Scope to clear (e.g., 'global' or 'parent:<task-id>'). Omit to clear all.")
    },
    async (args) => handleGuardClear(args as { scope?: string })
  )

  server.tool(
    "tx_guard_check",
    "Check if task creation would pass guard limits. Returns pass/fail status and any warnings without actually creating a task.",
    {
      parentId: z.string().optional().describe("Parent task ID (for checking child/depth limits)")
    },
    async (args) => handleGuardCheck(args as { parentId?: string })
  )
}
