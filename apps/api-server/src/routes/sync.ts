/**
 * Sync Route Handlers
 *
 * Implements JSONL-based git-tracked sync endpoint handlers.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { resolve, sep } from "node:path"
import { SyncService } from "@jamesaphoenix/tx-core"
import { TxApi, BadRequest, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Path Validation
// -----------------------------------------------------------------------------

/**
 * Validate that a user-provided sync file path does not escape the project
 * directory via path traversal (e.g. "../../etc/passwd" or absolute paths
 * outside the project root).
 *
 * Returns Effect that fails with BadRequest on invalid path.
 */
const validateSyncPath = (userPath: string | undefined): Effect.Effect<string | undefined, BadRequest> => {
  if (userPath === undefined) return Effect.succeed(undefined)

  const projectRoot = process.cwd()
  const resolved = resolve(projectRoot, userPath)

  if (!resolved.startsWith(projectRoot + sep)) {
    return Effect.fail(new BadRequest({
      message: "Path traversal rejected: sync file path must be within the project directory",
    }))
  }

  return Effect.succeed(userPath)
}

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const SyncLive = HttpApiBuilder.group(TxApi, "sync", (handlers) =>
  handlers
    .handle("syncExport", ({ payload }) =>
      Effect.gen(function* () {
        const safePath = yield* validateSyncPath(payload.path)
        const syncService = yield* SyncService
        const result = yield* syncService.export(safePath ?? undefined)
        return { opCount: result.opCount, path: result.path }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncImport", ({ payload }) =>
      Effect.gen(function* () {
        const safePath = yield* validateSyncPath(payload.path)
        const syncService = yield* SyncService
        const result = yield* syncService.import(safePath ?? undefined)
        return { imported: result.imported, skipped: result.skipped, conflicts: result.conflicts }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncStatus", () =>
      Effect.gen(function* () {
        const syncService = yield* SyncService
        const status = yield* syncService.status()
        return {
          dbTaskCount: status.dbTaskCount,
          jsonlOpCount: status.jsonlOpCount,
          lastExport: status.lastExport?.toISOString() ?? null,
          lastImport: status.lastImport?.toISOString() ?? null,
          isDirty: status.isDirty,
          autoSyncEnabled: status.autoSyncEnabled,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncCompact", ({ payload }) =>
      Effect.gen(function* () {
        const safePath = yield* validateSyncPath(payload.path)
        const syncService = yield* SyncService
        const result = yield* syncService.compact(safePath ?? undefined)
        return { before: result.before, after: result.after }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
