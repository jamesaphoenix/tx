/**
 * Pin-related MCP Tools
 *
 * Provides MCP tools for context pin management.
 * CRUD for named content blocks synced to agent context files.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import { PinService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handlePinSet = async (args: {
  id: string
  content: string
}): Promise<McpToolResult> => {
  try {
    const pin = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        return yield* svc.set(args.id, args.content)
      })
    )
    return {
      content: [
        { type: "text", text: `Pin "${pin.id}" set (${pin.content.length} chars)` },
        { type: "text", text: JSON.stringify(pin) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_pin_set", args, error)
  }
}

const handlePinGet = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const pin = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        return yield* svc.get(args.id)
      })
    )
    if (!pin) {
      return {
        content: [{ type: "text", text: `Pin not found: ${args.id}` }],
        isError: true
      }
    }
    return {
      content: [
        { type: "text", text: JSON.stringify(pin) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_pin_get", args, error)
  }
}

const handlePinRm = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const deleted = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        return yield* svc.remove(args.id)
      })
    )
    if (!deleted) {
      return {
        content: [{ type: "text", text: `Pin already removed (not found): ${args.id}` }],
        isError: false
      }
    }
    return {
      content: [{ type: "text", text: `Pin "${args.id}" removed` }],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_pin_rm", args, error)
  }
}

const handlePinList = async (): Promise<McpToolResult> => {
  try {
    const pins = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        return yield* svc.list()
      })
    )
    return {
      content: [
        { type: "text", text: `${pins.length} pin(s)` },
        { type: "text", text: JSON.stringify(pins) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_pin_list", {}, error)
  }
}

const handlePinSync = async (): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        return yield* svc.sync()
      })
    )
    return {
      content: [
        { type: "text", text: result.synced.length > 0
            ? `Synced to: ${result.synced.join(", ")}`
            : "No target files configured — use tx_pin_targets_set to add files" },
        { type: "text", text: JSON.stringify(result) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_pin_sync", {}, error)
  }
}

const handlePinTargetsGet = async (): Promise<McpToolResult> => {
  try {
    const files = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        return yield* svc.getTargetFiles()
      })
    )
    return {
      content: [
        { type: "text", text: files.length > 0
            ? `Target files: ${files.join(", ")}`
            : "No target files configured" },
        { type: "text", text: JSON.stringify({ files }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_pin_targets_get", {}, error)
  }
}

const handlePinTargetsSet = async (args: {
  files: string[]
}): Promise<McpToolResult> => {
  try {
    const persisted = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        yield* svc.setTargetFiles(args.files)
        return yield* svc.getTargetFiles()
      })
    )
    return {
      content: [
        { type: "text", text: `Target files set: ${[...persisted].join(", ")}` },
        { type: "text", text: JSON.stringify({ files: [...persisted] }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_pin_targets_set", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerPinTools = (server: McpServer): void => {
  registerEffectTool(server,
    "tx_pin_set",
    "Create or update a context pin. Pins are named content blocks that sync to agent context files (CLAUDE.md, AGENTS.md) as <tx-pin> XML tags.",
    {
      id: z.string().describe("Pin ID (kebab-case, e.g. 'auth-patterns')"),
      content: z.string().describe("Markdown content for the pin"),
    },
    async (args) => handlePinSet(args as { id: string; content: string })
  )

  registerEffectTool(server,
    "tx_pin_get",
    "Read a context pin by ID.",
    {
      id: z.string().describe("Pin ID to read"),
    },
    async (args) => handlePinGet(args as { id: string })
  )

  registerEffectTool(server,
    "tx_pin_rm",
    "Remove a context pin from the database and all target files.",
    {
      id: z.string().describe("Pin ID to remove"),
    },
    async (args) => handlePinRm(args as { id: string })
  )

  registerEffectTool(server,
    "tx_pin_list",
    "List all context pins.",
    {},
    async () => handlePinList()
  )

  registerEffectTool(server,
    "tx_pin_sync",
    "Re-sync all context pins to target files. Adds missing, updates changed, removes stale pins.",
    {},
    async () => handlePinSync()
  )

  registerEffectTool(server,
    "tx_pin_targets_get",
    "Get the list of target files that pins sync to (e.g. CLAUDE.md, AGENTS.md).",
    {},
    async () => handlePinTargetsGet()
  )

  registerEffectTool(server,
    "tx_pin_targets_set",
    "Set the target files that pins sync to. Replaces the current list.",
    {
      files: z.array(z.string()).describe("List of target file paths (e.g. ['CLAUDE.md', 'AGENTS.md'])"),
    },
    async (args) => handlePinTargetsSet(args as { files: string[] })
  )
}
