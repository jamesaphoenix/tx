/**
 * Learning-related MCP Tools
 *
 * Provides MCP tools for learnings, file learnings, and context retrieval.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { z } from "zod"
import type { Learning, LearningWithScore, FileLearning, LearningSourceType } from "@jamesaphoenix/tx-types"
import { LEARNING_SOURCE_TYPES } from "@jamesaphoenix/tx-types"
import { LearningService, FileLearningService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError } from "../response.js"
import { normalizeLimit, MCP_MAX_LIMIT } from "./index.js"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type McpToolResult = { content: { type: "text"; text: string }[] }

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

/**
 * Serialize a Learning for JSON output.
 * Converts Date objects to ISO strings and Float32Array to number array.
 */
export const serializeLearning = (learning: Learning): Record<string, unknown> => ({
  id: learning.id,
  content: learning.content,
  sourceType: learning.sourceType,
  sourceRef: learning.sourceRef,
  createdAt: learning.createdAt.toISOString(),
  keywords: learning.keywords,
  category: learning.category,
  usageCount: learning.usageCount,
  lastUsedAt: learning.lastUsedAt?.toISOString() ?? null,
  outcomeScore: learning.outcomeScore,
  embedding: learning.embedding ? Array.from(learning.embedding) : null
})

/**
 * Serialize a LearningWithScore for JSON output.
 * Extends serializeLearning with score fields.
 */
export const serializeLearningWithScore = (learning: LearningWithScore): Record<string, unknown> => ({
  ...serializeLearning(learning),
  relevanceScore: learning.relevanceScore,
  bm25Score: learning.bm25Score,
  vectorScore: learning.vectorScore,
  recencyScore: learning.recencyScore
})

/**
 * Serialize a FileLearning for JSON output.
 */
export const serializeFileLearning = (learning: FileLearning): Record<string, unknown> => ({
  id: learning.id,
  filePattern: learning.filePattern,
  note: learning.note,
  taskId: learning.taskId,
  createdAt: learning.createdAt.toISOString()
})

// -----------------------------------------------------------------------------
// Tool Handlers (extracted to avoid deep type inference)
// -----------------------------------------------------------------------------

const handleLearn = async (args: { filePattern: string; note: string; taskId?: string }): Promise<McpToolResult> => {
  try {
    const learning = await runEffect(
      Effect.gen(function* () {
        const fileLearningService = yield* FileLearningService
        return yield* fileLearningService.create({
          filePattern: args.filePattern,
          note: args.note,
          taskId: args.taskId ?? undefined
        })
      })
    )
    const serialized = serializeFileLearning(learning)
    return {
      content: [
        { type: "text", text: `Created file learning: #${learning.id} for pattern "${learning.filePattern}"` },
        { type: "text", text: JSON.stringify(serialized) }
      ]
    }
  } catch (error) {
    return handleToolError("tx_learn", args, error)
  }
}

const handleRecall = async (args: { path?: string; limit?: number }): Promise<McpToolResult> => {
  try {
    const effectiveLimit = normalizeLimit(args.limit)
    const learnings = await runEffect(
      Effect.gen(function* () {
        const fileLearningService = yield* FileLearningService
        if (args.path) {
          return yield* fileLearningService.recall(args.path)
        }
        return yield* fileLearningService.getAll()
      })
    )
    // Apply limit at MCP layer to prevent memory exhaustion
    const limited = learnings.slice(0, effectiveLimit)
    const serialized = limited.map(serializeFileLearning)
    const pathInfo = args.path ? ` for "${args.path}"` : ""
    const truncatedInfo = learnings.length > effectiveLimit ? ` (truncated from ${learnings.length})` : ""
    return {
      content: [
        { type: "text", text: `Found ${limited.length} file learning(s)${pathInfo}${truncatedInfo}` },
        { type: "text", text: JSON.stringify(serialized) }
      ]
    }
  } catch (error) {
    return handleToolError("tx_recall", args, error)
  }
}

const handleContext = async (args: { taskId: string; maxTokens?: number }): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const learningService = yield* LearningService
        return yield* learningService.getContextForTask(args.taskId, {
          maxTokens: args.maxTokens
        })
      })
    )
    const serializedLearnings = result.learnings.map(serializeLearningWithScore)
    return {
      content: [
        { type: "text", text: `Found ${result.learnings.length} relevant learning(s) for task "${result.taskTitle}" (search: "${result.searchQuery}", ${result.searchDuration}ms)` },
        { type: "text", text: JSON.stringify({
          taskId: result.taskId,
          taskTitle: result.taskTitle,
          searchQuery: result.searchQuery,
          searchDuration: result.searchDuration,
          learnings: serializedLearnings
        }) }
      ]
    }
  } catch (error) {
    return handleToolError("tx_context", args, error)
  }
}

const handleLearningAdd = async (args: {
  content: string
  sourceType?: LearningSourceType
  sourceRef?: string
  category?: string
  keywords?: string[]
}): Promise<McpToolResult> => {
  try {
    const learning = await runEffect(
      Effect.gen(function* () {
        const learningService = yield* LearningService
        return yield* learningService.create({
          content: args.content,
          sourceType: args.sourceType ?? "manual",
          sourceRef: args.sourceRef ?? undefined,
          category: args.category ?? undefined,
          keywords: args.keywords ?? undefined
        })
      })
    )
    const serialized = serializeLearning(learning)
    return {
      content: [
        { type: "text", text: `Created learning: #${learning.id}` },
        { type: "text", text: JSON.stringify(serialized) }
      ]
    }
  } catch (error) {
    return handleToolError("tx_learning_add", args, error)
  }
}

const handleLearningSearch = async (args: {
  query: string
  limit?: number
  minScore?: number
  category?: string
}): Promise<McpToolResult> => {
  try {
    const effectiveLimit = normalizeLimit(args.limit)
    const learnings = await runEffect(
      Effect.gen(function* () {
        const learningService = yield* LearningService
        return yield* learningService.search({
          query: args.query,
          limit: effectiveLimit,
          minScore: args.minScore ?? undefined,
          category: args.category ?? undefined
        })
      })
    )
    const serialized = learnings.map(serializeLearningWithScore)
    return {
      content: [
        { type: "text", text: `Found ${learnings.length} learning(s) matching "${args.query}"` },
        { type: "text", text: JSON.stringify(serialized) }
      ]
    }
  } catch (error) {
    return handleToolError("tx_learning_search", args, error)
  }
}

const handleLearningHelpful = async (args: { id: number; score?: number }): Promise<McpToolResult> => {
  try {
    const effectiveScore = args.score ?? 1.0
    await runEffect(
      Effect.gen(function* () {
        const learningService = yield* LearningService
        yield* learningService.updateOutcome(args.id, effectiveScore)
      })
    )
    return {
      content: [
        { type: "text", text: `Updated learning #${args.id} with helpfulness score: ${effectiveScore}` },
        { type: "text", text: JSON.stringify({ success: true, id: args.id, score: effectiveScore }) }
      ]
    }
  } catch (error) {
    return handleToolError("tx_learning_helpful", args, error)
  }
}

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

/**
 * Register all learning-related MCP tools on the server.
 */
export const registerLearningTools = (server: McpServer): void => {
  // tx_learn - Attach a learning to a file path or glob pattern
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_learn",
    "Attach a learning/note to a file path or glob pattern. Agents can query this when working on files.",
    {
      filePattern: z.string().describe("File path or glob pattern (e.g., src/services/*.ts)"),
      note: z.string().describe("The learning/note to attach"),
      taskId: z.string().optional().describe("Optional task ID to associate with")
    },
    handleLearn as Parameters<typeof server.tool>[3]
  )

  // tx_recall - Query file learnings by path
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_recall",
    "Query file-specific learnings. If path is provided, returns learnings matching that path. Otherwise returns all file learnings.",
    {
      path: z.string().optional().describe("Optional file path to match against stored patterns"),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of learnings to return (default: 100, max: ${MCP_MAX_LIMIT})`)
    },
    handleRecall as Parameters<typeof server.tool>[3]
  )

  // tx_context - Get contextual learnings for a task
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_context",
    "Get contextual learnings relevant to a task. Searches learnings using the task's title and description, returns scored results with BM25, recency, and relevance scores.",
    {
      taskId: z.string().describe("Task ID to get context for"),
      maxTokens: z.number().int().positive().optional().describe("Maximum number of learnings to return (default: 10)")
    },
    handleContext as Parameters<typeof server.tool>[3]
  )

  // tx_learning_add - Add a new learning to the knowledge base
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_learning_add",
    "Add a new learning to the contextual learnings knowledge base. Learnings can be retrieved later based on relevance to tasks.",
    {
      content: z.string().describe("The learning content (required)"),
      sourceType: z.enum(LEARNING_SOURCE_TYPES).optional().describe(`Source type: ${LEARNING_SOURCE_TYPES.join(", ")}. Defaults to "manual"`),
      sourceRef: z.string().optional().describe("Optional reference (e.g., task ID, file path, URL)"),
      category: z.string().optional().describe("Optional category for organizing learnings"),
      keywords: z.array(z.string()).optional().describe("Optional keywords for improved search")
    },
    handleLearningAdd as Parameters<typeof server.tool>[3]
  )

  // tx_learning_search - Search learnings with BM25 scoring
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_learning_search",
    "Search learnings using BM25 text search. Returns scored results with relevance, BM25, and recency scores.",
    {
      query: z.string().describe("Search query text"),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of results to return (default: 10, max: ${MCP_MAX_LIMIT})`),
      minScore: z.number().min(0).max(1).optional().describe("Minimum relevance score filter (0-1)"),
      category: z.string().optional().describe("Filter by category")
    },
    handleLearningSearch as Parameters<typeof server.tool>[3]
  )

  // tx_learning_helpful - Record helpfulness score for a learning
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_learning_helpful",
    "Record helpfulness/outcome score for a learning. Use this to provide feedback on whether a learning was useful.",
    {
      id: z.number().int().positive().describe("Learning ID to update"),
      score: z.number().min(0).max(1).optional().describe("Helpfulness score between 0 and 1 (default: 1.0)")
    },
    handleLearningHelpful as Parameters<typeof server.tool>[3]
  )
}
