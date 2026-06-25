/**
 * Decision-related MCP Tools
 *
 * Provides MCP tools for decision lifecycle management.
 * Part of the spec-driven development triangle.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import { DecisionService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { serializeDecision } from "@jamesaphoenix/tx-types"

export { serializeDecision }

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleDecisionAdd = async (args: {
  content: string
  question?: string
  source?: string
  taskId?: string
  docId?: number
  commitSha?: string
}): Promise<McpToolResult> => {
  try {
    const decision = await runEffect(
      Effect.gen(function* () {
        const svc = yield* DecisionService
        return yield* svc.add({
          content: args.content,
          question: args.question ?? null,
          source: (args.source as "manual" | "diff" | "transcript" | "agent") ?? "manual",
          taskId: args.taskId ?? null,
          docId: args.docId ?? null,
          commitSha: args.commitSha ?? null,
        })
      })
    )
    return {
      content: [
        { type: "text", text: `Created decision: ${decision.id} (${decision.status})` },
        { type: "text", text: JSON.stringify(serializeDecision(decision)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decision_add", args, error)
  }
}

const handleDecisionList = async (args: {
  status?: string
  source?: string
  limit?: number
}): Promise<McpToolResult> => {
  try {
    const decisions = await runEffect(
      Effect.gen(function* () {
        const svc = yield* DecisionService
        return yield* svc.list({
          status: args.status,
          source: args.source,
          limit: args.limit,
        })
      })
    )
    return {
      content: [
        { type: "text", text: `${decisions.length} decision(s)` },
        { type: "text", text: JSON.stringify(decisions.map(serializeDecision)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decision_list", args, error)
  }
}

const handleDecisionShow = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const decision = await runEffect(
      Effect.gen(function* () {
        const svc = yield* DecisionService
        return yield* svc.show(args.id)
      })
    )
    return {
      content: [
        { type: "text", text: `Decision ${decision.id}: ${decision.status}` },
        { type: "text", text: JSON.stringify(serializeDecision(decision)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decision_show", args, error)
  }
}

const handleDecisionApprove = async (args: {
  id: string
  reviewer?: string
  note?: string
}): Promise<McpToolResult> => {
  try {
    const decision = await runEffect(
      Effect.gen(function* () {
        const svc = yield* DecisionService
        return yield* svc.approve(args.id, args.reviewer, args.note)
      })
    )
    return {
      content: [
        { type: "text", text: `Approved: ${decision.id}` },
        { type: "text", text: JSON.stringify(serializeDecision(decision)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decision_approve", args, error)
  }
}

const handleDecisionReject = async (args: {
  id: string
  reviewer?: string
  reason: string
}): Promise<McpToolResult> => {
  try {
    const decision = await runEffect(
      Effect.gen(function* () {
        const svc = yield* DecisionService
        return yield* svc.reject(args.id, args.reviewer, args.reason)
      })
    )
    return {
      content: [
        { type: "text", text: `Rejected: ${decision.id}` },
        { type: "text", text: JSON.stringify(serializeDecision(decision)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decision_reject", args, error)
  }
}

const handleDecisionEdit = async (args: {
  id: string
  content: string
  reviewer?: string
}): Promise<McpToolResult> => {
  try {
    const decision = await runEffect(
      Effect.gen(function* () {
        const svc = yield* DecisionService
        return yield* svc.edit(args.id, args.content, args.reviewer)
      })
    )
    return {
      content: [
        { type: "text", text: `Edited: ${decision.id}` },
        { type: "text", text: JSON.stringify(serializeDecision(decision)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decision_edit", args, error)
  }
}

const handleDecisionPending = async (): Promise<McpToolResult> => {
  try {
    const decisions = await runEffect(
      Effect.gen(function* () {
        const svc = yield* DecisionService
        return yield* svc.pending()
      })
    )
    return {
      content: [
        { type: "text", text: `${decisions.length} pending decision(s)` },
        { type: "text", text: JSON.stringify(decisions.map(serializeDecision)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decision_pending", {}, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerDecisionTools = (server: McpServer): void => {
  registerEffectTool(server,
    "tx_decision_add",
    "Record a decision. Decisions capture implementation choices made by agents or developers. Auto-deduplicates by content hash.",
    {
      content: z.string().describe("The decision text"),
      question: z.string().optional().describe("The question this decision answers"),
      source: z.enum(["manual", "diff", "transcript", "agent"]).optional().describe("How this decision was captured (default: manual)"),
      taskId: z.string().optional().describe("Related task ID"),
      docId: z.number().optional().describe("Related doc ID"),
      commitSha: z.string().optional().describe("Git commit SHA"),
    },
    async (args) => handleDecisionAdd(args as Parameters<typeof handleDecisionAdd>[0])
  )

  registerEffectTool(server,
    "tx_decision_list",
    "List decisions with optional filters.",
    {
      status: z.enum(["pending", "approved", "rejected", "edited", "superseded"]).optional().describe("Filter by status"),
      source: z.enum(["manual", "diff", "transcript", "agent"]).optional().describe("Filter by source"),
      limit: z.number().optional().describe("Max results (default: 100)"),
    },
    async (args) => handleDecisionList(args as Parameters<typeof handleDecisionList>[0])
  )

  registerEffectTool(server,
    "tx_decision_show",
    "Show a decision by ID.",
    {
      id: z.string().describe("Decision ID (dec-<12 hex chars>)"),
    },
    async (args) => handleDecisionShow(args as { id: string })
  )

  registerEffectTool(server,
    "tx_decision_approve",
    "Approve a pending decision. Only pending decisions can be approved.",
    {
      id: z.string().describe("Decision ID to approve"),
      reviewer: z.string().optional().describe("Who approved"),
      note: z.string().optional().describe("Approval note"),
    },
    async (args) => handleDecisionApprove(args as Parameters<typeof handleDecisionApprove>[0])
  )

  registerEffectTool(server,
    "tx_decision_reject",
    "Reject a pending decision. Requires a reason.",
    {
      id: z.string().describe("Decision ID to reject"),
      reason: z.string().describe("Rejection reason (required)"),
      reviewer: z.string().optional().describe("Who rejected"),
    },
    async (args) => handleDecisionReject(args as Parameters<typeof handleDecisionReject>[0])
  )

  registerEffectTool(server,
    "tx_decision_edit",
    "Edit a pending decision's content and mark as reviewed.",
    {
      id: z.string().describe("Decision ID to edit"),
      content: z.string().describe("New decision content"),
      reviewer: z.string().optional().describe("Who edited"),
    },
    async (args) => handleDecisionEdit(args as Parameters<typeof handleDecisionEdit>[0])
  )

  registerEffectTool(server,
    "tx_decision_pending",
    "List all pending decisions awaiting review.",
    {},
    async () => handleDecisionPending()
  )
}
