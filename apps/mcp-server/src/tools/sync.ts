/**
 * Sync-related MCP Tools
 *
 * Provides MCP tools for stream-based sync operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import type {
  SyncStatus,
  SyncExportResult,
  SyncImportResult,
  SyncHydrateResult,
  SyncStreamInfoResult
} from "@jamesaphoenix/tx-core"
import { SyncService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

export const serializeSyncStatus = (status: SyncStatus): Record<string, unknown> => ({
  dbTaskCount: status.dbTaskCount,
  eventOpCount: status.eventOpCount,
  lastExport: status.lastExport?.toISOString() ?? null,
  lastImport: status.lastImport?.toISOString() ?? null,
  isDirty: status.isDirty,
  autoSyncEnabled: status.autoSyncEnabled
})

const serializeExportResult = (result: SyncExportResult): Record<string, unknown> => ({
  eventCount: result.eventCount,
  streamId: result.streamId,
  path: result.path
})

const serializeImportResult = (result: SyncImportResult): Record<string, unknown> => ({
  importedEvents: result.importedEvents,
  appliedEvents: result.appliedEvents,
  streamCount: result.streamCount
})

const serializeHydrateResult = (result: SyncHydrateResult): Record<string, unknown> => ({
  importedEvents: result.importedEvents,
  appliedEvents: result.appliedEvents,
  streamCount: result.streamCount,
  rebuilt: result.rebuilt
})

const serializeStreamInfoResult = (result: SyncStreamInfoResult): Record<string, unknown> => ({
  streamId: result.streamId,
  nextSeq: result.nextSeq,
  lastSeq: result.lastSeq,
  eventsDir: result.eventsDir,
  configPath: result.configPath,
  knownStreams: result.knownStreams
})

const handleExport = async (): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.export()
      })
    )
    return {
      content: [
        { type: "text", text: `Events: ${result.eventCount} event(s) → ${result.path}` },
        { type: "text", text: JSON.stringify(serializeExportResult(result)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_export", {}, error)
  }
}

const handleImport = async (): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.import()
      })
    )
    return {
      content: [
        { type: "text", text: `Events: imported=${result.importedEvents}, applied=${result.appliedEvents}, streams=${result.streamCount}` },
        { type: "text", text: JSON.stringify(serializeImportResult(result)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_import", {}, error)
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
        { type: "text", text: `Sync status: ${status.dbTaskCount} tasks in DB, ${status.eventOpCount} events in stream logs${dirtyStatus}${autoSync}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_status", {}, error)
  }
}

const handleStream = async (): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.stream()
      })
    )
    return {
      content: [
        { type: "text", text: `Stream ${result.streamId} (next=${result.nextSeq}, last=${result.lastSeq})` },
        { type: "text", text: JSON.stringify(serializeStreamInfoResult(result)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_stream", {}, error)
  }
}

const handleHydrate = async (): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const syncService = yield* SyncService
        return yield* syncService.hydrate()
      })
    )
    return {
      content: [
        { type: "text", text: `Hydrated ${result.appliedEvents} event(s) across ${result.streamCount} stream(s)` },
        { type: "text", text: JSON.stringify(serializeHydrateResult(result)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_sync_hydrate", {}, error)
  }
}

export const registerSyncTools = (server: McpServer): void => {
  // tx_sync_export - Export stream events
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_export",
    "Export current state as append-only sync events under .tx/streams.",
    {},
    handleExport as Parameters<typeof server.tool>[3]
  )

  // tx_sync_import - Import stream events
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_import",
    "Import and apply sync events from .tx/streams incrementally.",
    {},
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

  // tx_sync_stream - Show current stream identity and sequence info
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_stream",
    "Show the local sync stream identity and sequence state.",
    {},
    handleStream as Parameters<typeof server.tool>[3]
  )

  // tx_sync_hydrate - Full projection rebuild from event streams
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_sync_hydrate",
    "Rebuild materialized task state by replaying all sync events from stream logs.",
    {},
    handleHydrate as Parameters<typeof server.tool>[3]
  )
}
