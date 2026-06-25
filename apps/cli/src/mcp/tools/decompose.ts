import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { DecomposeService } from "@jamesaphoenix/tx"
import {
  AGENT_RUNTIMES,
  assertTaskId,
  serializeDecomposeResult,
} from "@jamesaphoenix/tx/types"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { registerEffectTool, z } from "./effect-schema-tool.js"

export const handleDecompose = async (args: {
  docRef: string
  parentTaskId?: string | null
  runtime?: "claude" | "codex" | "auto"
  model?: string | null
  maxTasks?: number
  rootTitle?: string | null
  rootScore?: number | null
  dryRun?: boolean
}, runner: typeof runEffect = runEffect): Promise<McpToolResult> => {
  try {
    const request = {
      ...args,
      parentTaskId: args.parentTaskId != null ? assertTaskId(args.parentTaskId) : null,
    }
    const result = await runner(
      Effect.gen(function* () {
        const svc = yield* DecomposeService
        return yield* svc.run(request)
      })
    )
    const serialized = serializeDecomposeResult(result)
    return {
      content: [
        {
          type: "text",
          text: serialized.dryRun
            ? `Prepared decomposition plan for ${serialized.doc.name}`
            : `Created task graph for ${serialized.doc.name}`,
        },
        { type: "text", text: JSON.stringify(serialized) },
      ],
      isError: false,
    }
  } catch (error) {
    return handleToolError("tx_decompose", args, error)
  }
}

export const registerDecomposeTools = (server: McpServer): void => {
  registerEffectTool(
    server,
    "tx_decompose",
    "Turn a design doc into an explicit tx task graph or preview the validated graph with dryRun.",
    {
      docRef: z.string(),
      parentTaskId: z.string().nullable().optional(),
      runtime: z.enum(AGENT_RUNTIMES).optional(),
      model: z.string().nullable().optional(),
      maxTasks: z.number().int().positive().optional(),
      rootTitle: z.string().nullable().optional(),
      rootScore: z.number().int().nullable().optional(),
      dryRun: z.boolean().optional(),
    },
    (args) => handleDecompose(args),
  )
}
