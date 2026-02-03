/**
 * Sync-related MCP Tools
 *
 * Provides MCP tools for JSONL-based git-tracked sync operations.
 * See DD-009 for specification.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { z } from "zod"
import type { ExportResult, ImportResult, SyncStatus, CompactResult } from "@jamesaphoenix/tx-core"
import { SyncService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"

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
  conflicts: result.conflicts
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

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

/**
 * Register all sync-related MCP tools on the server.
 */
export const registerSyncTools = (server: McpServer): void => {
  // ---------------------------------------------------------------------------
  // tx_sync_export - Export tasks and dependencies to JSONL
  // ---------------------------------------------------------------------------
  server.registerTool(
    "tx_sync_export",
    {
      description: "Export all tasks and dependencies to a JSONL file for git-based synchronization. Uses atomic writes for safety.",
      inputSchema: {
        path: z.string().optional().describe("Path to JSONL file (default: .tx/tasks.jsonl)")
      }
    },
    async ({ path }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const result = await runEffect(
          Effect.gen(function* () {
            const syncService = yield* SyncService
            return yield* syncService.export(path ?? undefined)
          })
        )
        const serialized = serializeExportResult(result)
        return {
          content: [
            { type: "text", text: `Exported ${result.opCount} operation(s) to ${result.path}` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_sync_import - Import tasks and dependencies from JSONL
  // ---------------------------------------------------------------------------
  server.registerTool(
    "tx_sync_import",
    {
      description: "Import tasks and dependencies from a JSONL file. Uses timestamp-based conflict resolution (later wins).",
      inputSchema: {
        path: z.string().optional().describe("Path to JSONL file (default: .tx/tasks.jsonl)")
      }
    },
    async ({ path }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const result = await runEffect(
          Effect.gen(function* () {
            const syncService = yield* SyncService
            return yield* syncService.import(path ?? undefined)
          })
        )
        const serialized = serializeImportResult(result)
        const summary = result.conflicts > 0
          ? `Imported ${result.imported}, skipped ${result.skipped}, ${result.conflicts} conflict(s)`
          : `Imported ${result.imported}, skipped ${result.skipped}`
        return {
          content: [
            { type: "text", text: summary },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_sync_status - Get current sync status
  // ---------------------------------------------------------------------------
  server.registerTool(
    "tx_sync_status",
    {
      description: "Get current synchronization status including task counts, last export/import times, and dirty state."
    },
    async (): Promise<{ content: { type: "text"; text: string }[] }> => {
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
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_sync_compact - Compact the JSONL file
  // ---------------------------------------------------------------------------
  server.registerTool(
    "tx_sync_compact",
    {
      description: "Compact the JSONL file by deduplicating operations. Keeps only the latest state per entity, removing tombstones.",
      inputSchema: {
        path: z.string().optional().describe("Path to JSONL file (default: .tx/tasks.jsonl)")
      }
    },
    async ({ path }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const result = await runEffect(
          Effect.gen(function* () {
            const syncService = yield* SyncService
            return yield* syncService.compact(path ?? undefined)
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
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )
}
