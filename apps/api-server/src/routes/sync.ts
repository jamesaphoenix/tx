/**
 * Sync Route Handlers
 *
 * Implements stream-based sync endpoint handlers.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { SyncService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError } from "../api.js"

export const SyncLive = HttpApiBuilder.group(TxApi, "sync", (handlers) =>
  handlers
    .handle("syncExport", () =>
      Effect.gen(function* () {
        const syncService = yield* SyncService
        const result = yield* syncService.export()
        return { eventCount: result.eventCount, streamId: result.streamId, path: result.path }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncImport", () =>
      Effect.gen(function* () {
        const syncService = yield* SyncService
        const result = yield* syncService.import()
        return {
          importedEvents: result.importedEvents,
          appliedEvents: result.appliedEvents,
          streamCount: result.streamCount
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncStatus", () =>
      Effect.gen(function* () {
        const syncService = yield* SyncService
        const status = yield* syncService.status()
        return {
          dbTaskCount: status.dbTaskCount,
          eventOpCount: status.eventOpCount,
          lastExport: status.lastExport?.toISOString() ?? null,
          lastImport: status.lastImport?.toISOString() ?? null,
          isDirty: status.isDirty,
          autoSyncEnabled: status.autoSyncEnabled,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncStream", () =>
      Effect.gen(function* () {
        const syncService = yield* SyncService
        const result = yield* syncService.stream()
        return {
          streamId: result.streamId,
          nextSeq: result.nextSeq,
          lastSeq: result.lastSeq,
          eventsDir: result.eventsDir,
          configPath: result.configPath,
          knownStreams: result.knownStreams,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncHydrate", () =>
      Effect.gen(function* () {
        const syncService = yield* SyncService
        const result = yield* syncService.hydrate()
        return {
          importedEvents: result.importedEvents,
          appliedEvents: result.appliedEvents,
          streamCount: result.streamCount,
          rebuilt: result.rebuilt,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
