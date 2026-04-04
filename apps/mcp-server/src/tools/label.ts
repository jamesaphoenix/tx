/**
 * Label-related MCP Tools
 *
 * Provides MCP tools for label management (ready queue scoping).
 * Agents can create, delete, assign, unassign, and list labels.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import { LabelRepository } from "@jamesaphoenix/tx-core"
import { assertTaskId } from "@jamesaphoenix/tx-types"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// Serialize a label object for JSON output
const serializeLabel = (label: {
  id: number
  name: string
  color: string
  createdAt: string
  updatedAt: string
}) => ({
  id: label.id,
  name: label.name,
  color: label.color,
  createdAt: label.createdAt,
  updatedAt: label.updatedAt,
})

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleLabelAdd = async (args: {
  name: string
  color?: string
}): Promise<McpToolResult> => {
  try {
    const color = args.color ?? "#6b7280"
    const label = await runEffect(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.create(args.name, color)
      })
    )
    return {
      content: [
        { type: "text", text: `Label created: ${label.name} (${label.color})` },
        { type: "text", text: JSON.stringify(serializeLabel(label)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_auto_label_add", args, error)
  }
}

const handleLabelDelete = async (args: {
  name: string
}): Promise<McpToolResult> => {
  try {
    const removed = await runEffect(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.remove(args.name)
      })
    )
    return {
      content: [
        {
          type: "text",
          text: removed
            ? `Label removed: ${args.name}`
            : `Label not found: ${args.name}`,
        },
        { type: "text", text: JSON.stringify({ removed, name: args.name }) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_auto_label_delete", args, error)
  }
}

const handleLabelAssign = async (args: {
  taskId: string
  labelName: string
}): Promise<McpToolResult> => {
  try {
    const id = assertTaskId(args.taskId)
    await runEffect(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.assign(id, args.labelName)
      })
    )
    return {
      content: [
        { type: "text", text: `Label "${args.labelName}" assigned to ${id}` },
        {
          type: "text",
          text: JSON.stringify({ taskId: id, label: args.labelName }),
        },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_auto_label_assign", args, error)
  }
}

const handleLabelUnassign = async (args: {
  taskId: string
  labelName: string
}): Promise<McpToolResult> => {
  try {
    const id = assertTaskId(args.taskId)
    const result = await runEffect(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.unassign(id, args.labelName)
      })
    )
    let text: string
    if (result === "removed") {
      text = `Label "${args.labelName}" removed from ${id}`
    } else if (result === "label_not_found") {
      text = `Label "${args.labelName}" not found. Use tx_auto_label_list to see available labels.`
    } else {
      text = `Label "${args.labelName}" was not assigned to ${id}`
    }
    return {
      content: [
        { type: "text", text },
        {
          type: "text",
          text: JSON.stringify({
            taskId: id,
            label: args.labelName,
            removed: result === "removed",
            reason: result,
          }),
        },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_auto_label_unassign", args, error)
  }
}

const handleLabelList = async (
  _args: Record<string, unknown>
): Promise<McpToolResult> => {
  try {
    const labels = await runEffect(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.findAll()
      })
    )
    return {
      content: [
        {
          type: "text",
          text:
            labels.length === 0
              ? "No labels defined. Use tx_auto_label_add to create one."
              : `${labels.length} label(s)`,
        },
        { type: "text", text: JSON.stringify(labels.map(serializeLabel)) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_auto_label_list", {}, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerLabelTools = (server: McpServer): void => {
  registerEffectTool(
    server,
    "tx_auto_label_add",
    "Create a new label for ready queue scoping. Labels can be assigned to tasks to filter tx_ready and tx_list results.",
    {
      name: z.string().describe("Label name (case-insensitive, must be unique)"),
      color: z
        .string()
        .optional()
        .describe("Hex color code (default: #6b7280)"),
    },
    async (args) =>
      handleLabelAdd(args as { name: string; color?: string })
  )

  registerEffectTool(
    server,
    "tx_auto_label_delete",
    "Delete a label. Also removes all task assignments for this label.",
    {
      name: z.string().describe("Label name to delete"),
    },
    async (args) => handleLabelDelete(args as { name: string })
  )

  registerEffectTool(
    server,
    "tx_auto_label_assign",
    "Assign a label to a task. The label must already exist (create with tx_auto_label_add first). Use labels to scope ready queue filtering.",
    {
      taskId: z.string().describe("Task ID to assign the label to"),
      labelName: z.string().describe("Name of the label to assign"),
    },
    async (args) =>
      handleLabelAssign(args as { taskId: string; labelName: string })
  )

  registerEffectTool(
    server,
    "tx_auto_label_unassign",
    "Remove a label from a task. Returns whether the label was actually assigned.",
    {
      taskId: z.string().describe("Task ID to remove the label from"),
      labelName: z.string().describe("Name of the label to remove"),
    },
    async (args) =>
      handleLabelUnassign(args as { taskId: string; labelName: string })
  )

  registerEffectTool(
    server,
    "tx_auto_label_list",
    "List all defined labels. Returns label names, colors, and metadata.",
    {},
    async (args) => handleLabelList(args as Record<string, unknown>)
  )
}
