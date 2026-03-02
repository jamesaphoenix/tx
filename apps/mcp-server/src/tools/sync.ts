/**
 * Sync-related MCP Tools
 *
 * Provides MCP tools for JSONL-based git-tracked sync operations.
 * See DD-009 for specification.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { resolve, sep } from "node:path"
import z from "zod"
import type { ExportResult, ExportAllResult, ImportResult, ImportAllResult, EntityImportResult, SyncStatus, CompactResult } from "@jamesaphoenix/tx-core"
import { SyncService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// -----------------------------------------------------------------------------
// Path validation
// -----------------------------------------------------------------------------

/**
 * Validate that a user-provided sync file path does not escape the project
 * directory via path traversal (e.g. "../../etc/passwd" or absolute paths
 * outside the project root).
 *
 * Returns the original path string unchanged when valid; throws when the
 * resolved path would land outside process.cwd().
 */
export const validateSyncPath = (userPath: string | undefined): string | undefined => {
  if (userPath === undefined) return undefined

  const projectRoot = process.cwd()
  const resolved = resolve(projectRoot, userPath)

  // The resolved path must be strictly inside the project directory.
  // We append sep to avoid prefix false-positives (e.g. /foo/bar vs /foo/barbaz).
  if (!resolved.startsWith(projectRoot + sep)) {
    throw new Error(
      "Path traversal rejected: sync file path must be within the project directory"
    )
  }

  return userPath
}

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

/**
 * Serialize an ExportResult for JSON output.
 */
export const serializeExportResult = (result: ExportResult): Record<string, unknown> => ({
  opCount: result.opCount,
  path: result.path
})

/**
 * Serialize an ImportResult for JSON output.
 */
export const serializeImportResult = (result: ImportResult): Record<string, unknown> => ({
  imported: result.imported,
  skipped: result.skipped,
  conflicts: result.conflicts,
  dependencies: {
    added: result.dependencies.added,
    removed: result.dependencies.removed,
    skipped: result.dependencies.skipped,
    failures: result.dependencies.failures
  }
})

/**
 * Serialize a SyncStatus for JSON output.
 */
export const serializeSyncStatus = (status: SyncStatus): Record<string, unknown> => ({
  dbTaskCount: status.dbTaskCount,
  jsonlOpCount: status.jsonlOpCount,
  lastExport: status.lastExport?.toISOString() ?? null,
  lastImport: status.lastImport?.toISOString() ?? null,
  isDirty: status.isDirty,
  autoSyncEnabled: status.autoSyncEnabled
})

/**
 * Serialize a CompactResult for JSON output.
 */
export const serializeCompactResult = (result: CompactResult): Record<string, unknown> => ({
  before: result.before,
  after: result.after
})

/**
 * Serialize an ExportAllResult for JSON output.
 */
export const serializeExportAllResult = (result: ExportAllResult): Record<string, unknown> => ({
  tasks: serializeExportResult(result.tasks),
  learnings: result.learnings ? serializeExportResult(result.learnings) : undefined,
  fileLearnings: result.fileLearnings ? serializeExportResult(result.fileLearnings) : undefined,
  attempts: result.attempts ? serializeExportResult(result.attempts) : undefined,
  pins: result.pins ? serializeExportResult(result.pins) : undefined,
  anchors: result.anchors ? serializeExportResult(result.anchors) : undefined,
  edges: result.edges ? serializeExportResult(result.edges) : undefined,
  docs: result.docs ? serializeExportResult(result.docs) : undefined,
  labels: result.labels ? serializeExportResult(result.labels) : undefined
})

/**
 * Serialize an EntityImportResult for JSON output.
 */
const serializeEntityImportResult = (result: EntityImportResult): Record<string, unknown> => ({
  imported: result.imported,
  skipped: result.skipped
})

/**
 * Serialize an ImportAllResult for JSON output.
 */
export const serializeImportAllResult = (result: ImportAllResult): Record<string, unknown> => ({
  tasks: serializeImportResult(result.tasks),
  learnings: result.learnings ? serializeEntityImportResult(result.learnings) : undefined,
  fileLearnings: result.fileLearnings ? serializeEntityImportResult(result.fileLearnings) : undefined,
  attempts: result.attempts ? serializeEntityImportResult(result.attempts) : undefined,
  pins: result.pins ? serializeEntityImportResult(result.pins) : undefined,
  anchors: result.anchors ? serializeEntityImportResult(result.anchors) : undefined,
  edges: result.edges ? serializeEntityImportResult(result.edges) : undefined,
  docs: result.docs ? serializeEntityImportResult(result.docs) : undefined,
  labels: result.labels ? serializeEntityImportResult(result.labels) : undefined
})

// -----------------------------------------------------------------------------
// Tool Handlers (extracted to avoid deep type inference issues with MCP SDK)
// -----------------------------------------------------------------------------

const handleExport = async (args: { path?: string }): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.exportAll()
      })
    )
    const lines: string[] = [`Tasks: ${result.tasks.opCount} op(s) → ${result.tasks.path}`]
    if (result.learnings) lines.push(`Learnings: ${result.learnings.opCount} op(s) → ${result.learnings.path}`)
    if (result.fileLearnings) lines.push(`File learnings: ${result.fileLearnings.opCount} op(s) → ${result.fileLearnings.path}`)
    if (result.attempts) lines.push(`Attempts: ${result.attempts.opCount} op(s) → ${result.attempts.path}`)
    if (result.pins) lines.push(`Pins: ${result.pins.opCount} op(s) → ${result.pins.path}`)
    if (result.anchors) lines.push(`Anchors: ${result.anchors.opCount} op(s) → ${result.anchors.path}`)
    if (result.edges) lines.push(`Edges: ${result.edges.opCount} op(s) → ${result.edges.path}`)
    if (result.docs) lines.push(`Docs: ${result.docs.opCount} op(s) → ${result.docs.path}`)
    if (result.labels) lines.push(`Labels: ${result.labels.opCount} op(s) → ${result.labels.path}`)
    return {
      content: [
        { type: "text", text: lines.join("\n") },
        { type: "text", text: JSON.stringify(serializeExportAllResult(result)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_export", args, error)
  }
}

const handleImport = async (args: { path?: string }): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.importAll()
      })
    )
    const lines: string[] = [
      `Tasks: imported=${result.tasks.imported}, skipped=${result.tasks.skipped}, conflicts=${result.tasks.conflicts}`
    ]
    if (result.learnings) lines.push(`Learnings: imported=${result.learnings.imported}, skipped=${result.learnings.skipped}`)
    if (result.fileLearnings) lines.push(`File learnings: imported=${result.fileLearnings.imported}, skipped=${result.fileLearnings.skipped}`)
    if (result.attempts) lines.push(`Attempts: imported=${result.attempts.imported}, skipped=${result.attempts.skipped}`)
    if (result.pins) lines.push(`Pins: imported=${result.pins.imported}, skipped=${result.pins.skipped}`)
    if (result.anchors) lines.push(`Anchors: imported=${result.anchors.imported}, skipped=${result.anchors.skipped}`)
    if (result.edges) lines.push(`Edges: imported=${result.edges.imported}, skipped=${result.edges.skipped}`)
    if (result.docs) lines.push(`Docs: imported=${result.docs.imported}, skipped=${result.docs.skipped}`)
    if (result.labels) lines.push(`Labels: imported=${result.labels.imported}, skipped=${result.labels.skipped}`)
    return {
      content: [
        { type: "text", text: lines.join("\n") },
        { type: "text", text: JSON.stringify(serializeImportAllResult(result)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_import", args, error)
  }
}

const handleStatus = async (): Promise<McpToolResult> => {
  try {
    const status = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.status()
      })
    )
    const serialized = serializeSyncStatus(status)
    const dirtyStatus = status.isDirty ? " (dirty)" : ""
    const autoSync = status.autoSyncEnabled ? ", auto-sync on" : ""
    return {
      content: [
        { type: "text", text: `Sync status: ${status.dbTaskCount} tasks in DB, ${status.jsonlOpCount} ops in JSONL${dirtyStatus}${autoSync}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_status", {}, error)
  }
}

const handleCompact = async (args: { path?: string }): Promise<McpToolResult> => {
  try {
    const safePath = validateSyncPath(args.path)
    const result = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.compact(safePath ?? undefined)
      })
    )
    const serialized = serializeCompactResult(result)
    const reduction = result.before > 0
      ? ` (${Math.round((1 - result.after / result.before) * 100)}% reduction)`
      : ""
    return {
      content: [
        { type: "text", text: `Compacted ${result.before} → ${result.after} operations${reduction}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_compact", args, error)
  }
}

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

/**
 * Register all sync-related MCP tools on the server.
 */
export const registerSyncTools = (server: McpServer): void => {
  // tx_sync_export - Export tasks and dependencies to JSONL
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_export",
    "Export all tasks and dependencies to a JSONL file for git-based synchronization. Uses atomic writes for safety.",
    { path: z.string().optional().describe("Path to JSONL file (default: .tx/tasks.jsonl)") },
    handleExport as Parameters<typeof server.tool>[3]
  )

  // tx_sync_import - Import tasks and dependencies from JSONL
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_import",
    "Import tasks and dependencies from a JSONL file. Uses timestamp-based conflict resolution (later wins).",
    { path: z.string().optional().describe("Path to JSONL file (default: .tx/tasks.jsonl)") },
    handleImport as Parameters<typeof server.tool>[3]
  )

  // tx_sync_status - Get current sync status
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_status",
    "Get current synchronization status including task counts, last export/import times, and dirty state.",
    {},
    handleStatus as Parameters<typeof server.tool>[3]
  )

  // tx_sync_compact - Compact the JSONL file
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_compact",
    "Compact the JSONL file by deduplicating operations. Keeps only the latest state per entity, removing tombstones.",
    { path: z.string().optional().describe("Path to JSONL file (default: .tx/tasks.jsonl)") },
    handleCompact as Parameters<typeof server.tool>[3]
  )
}
