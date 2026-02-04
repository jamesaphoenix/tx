/**
 * Sync Routes
 *
 * Provides REST API endpoints for JSONL-based git-tracked sync operations.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { Effect } from "effect"
import { resolve, sep } from "node:path"
import { SyncService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"

// -----------------------------------------------------------------------------
// Path Validation
// -----------------------------------------------------------------------------

/**
 * Validate that a user-provided sync file path does not escape the project
 * directory via path traversal (e.g. "../../etc/passwd" or absolute paths
 * outside the project root).
 *
 * Returns the original path string unchanged when valid; throws when the
 * resolved path would land outside process.cwd().
 */
const validateSyncPath = (userPath: string | undefined): string | undefined => {
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
// Schemas
// -----------------------------------------------------------------------------

const ExportResultSchema = z.object({
  opCount: z.number().int(),
  path: z.string()
}).openapi("ExportResult")

const ImportResultSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  conflicts: z.number().int()
}).openapi("ImportResult")

const SyncStatusSchema = z.object({
  dbTaskCount: z.number().int(),
  jsonlOpCount: z.number().int(),
  lastExport: z.string().datetime().nullable(),
  lastImport: z.string().datetime().nullable(),
  isDirty: z.boolean(),
  autoSyncEnabled: z.boolean()
}).openapi("SyncStatus")

const CompactResultSchema = z.object({
  before: z.number().int(),
  after: z.number().int()
}).openapi("CompactResult")

// -----------------------------------------------------------------------------
// Route Definitions
// -----------------------------------------------------------------------------

const exportRoute = createRoute({
  method: "post",
  path: "/api/sync/export",
  tags: ["Sync"],
  summary: "Export tasks to JSONL",
  description: "Export all tasks and dependencies to a JSONL file for git-based synchronization",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            path: z.string().optional().openapi({ description: "Path to JSONL file (default: .tx/tasks.jsonl)" })
          })
        }
      },
      required: false
    }
  },
  responses: {
    200: {
      description: "Export completed",
      content: { "application/json": { schema: ExportResultSchema } }
    }
  }
})

const importRoute = createRoute({
  method: "post",
  path: "/api/sync/import",
  tags: ["Sync"],
  summary: "Import tasks from JSONL",
  description: "Import tasks and dependencies from a JSONL file with timestamp-based conflict resolution",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            path: z.string().optional().openapi({ description: "Path to JSONL file (default: .tx/tasks.jsonl)" })
          })
        }
      },
      required: false
    }
  },
  responses: {
    200: {
      description: "Import completed",
      content: { "application/json": { schema: ImportResultSchema } }
    }
  }
})

const statusRoute = createRoute({
  method: "get",
  path: "/api/sync/status",
  tags: ["Sync"],
  summary: "Get sync status",
  description: "Get current synchronization status including task counts and dirty state",
  responses: {
    200: {
      description: "Sync status",
      content: { "application/json": { schema: SyncStatusSchema } }
    }
  }
})

const compactRoute = createRoute({
  method: "post",
  path: "/api/sync/compact",
  tags: ["Sync"],
  summary: "Compact JSONL file",
  description: "Compact the JSONL file by deduplicating operations",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            path: z.string().optional().openapi({ description: "Path to JSONL file (default: .tx/tasks.jsonl)" })
          })
        }
      },
      required: false
    }
  },
  responses: {
    200: {
      description: "Compaction completed",
      content: { "application/json": { schema: CompactResultSchema } }
    }
  }
})

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export const syncRouter = new OpenAPIHono()

syncRouter.openapi(exportRoute, async (c) => {
  const body = c.req.valid("json")
  const safePath = validateSyncPath(body.path)

  const result = await runEffect(
    Effect.gen(function* () {
      const syncService = yield* SyncService
      return yield* syncService.export(safePath ?? undefined)
    })
  )

  return c.json({
    opCount: result.opCount,
    path: result.path
  }, 200)
})

syncRouter.openapi(importRoute, async (c) => {
  const body = c.req.valid("json")
  const safePath = validateSyncPath(body.path)

  const result = await runEffect(
    Effect.gen(function* () {
      const syncService = yield* SyncService
      return yield* syncService.import(safePath ?? undefined)
    })
  )

  return c.json({
    imported: result.imported,
    skipped: result.skipped,
    conflicts: result.conflicts
  }, 200)
})

syncRouter.openapi(statusRoute, async (c) => {
  const status = await runEffect(
    Effect.gen(function* () {
      const syncService = yield* SyncService
      return yield* syncService.status()
    })
  )

  return c.json({
    dbTaskCount: status.dbTaskCount,
    jsonlOpCount: status.jsonlOpCount,
    lastExport: status.lastExport?.toISOString() ?? null,
    lastImport: status.lastImport?.toISOString() ?? null,
    isDirty: status.isDirty,
    autoSyncEnabled: status.autoSyncEnabled
  }, 200)
})

syncRouter.openapi(compactRoute, async (c) => {
  const body = c.req.valid("json")
  const safePath = validateSyncPath(body.path)

  const result = await runEffect(
    Effect.gen(function* () {
      const syncService = yield* SyncService
      return yield* syncService.compact(safePath ?? undefined)
    })
  )

  return c.json({
    before: result.before,
    after: result.after
  }, 200)
})
