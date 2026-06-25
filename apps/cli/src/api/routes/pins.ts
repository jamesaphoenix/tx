/**
 * Pin Route Handlers
 *
 * Implements context pin endpoint handlers for CRUD and file sync.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { serializePin } from "@jamesaphoenix/tx-types"
import { PinService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError, NotFound } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const PinsLive = HttpApiBuilder.group(TxApi, "pins", (handlers) =>
  handlers
    .handle("setPin", ({ path, payload }) =>
      Effect.gen(function* () {
        const pinService = yield* PinService
        const pin = yield* pinService.set(path.id, payload.content)
        return serializePin(pin)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listPins", () =>
      Effect.gen(function* () {
        const pinService = yield* PinService
        const pins = yield* pinService.list()
        return { pins: pins.map(serializePin) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getPin", ({ path }) =>
      Effect.gen(function* () {
        const pinService = yield* PinService
        const pin = yield* pinService.get(path.id)
        if (!pin) {
          return yield* Effect.fail(new NotFound({ message: `Pin '${path.id}' not found` }))
        }
        return serializePin(pin)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("deletePin", ({ path }) =>
      Effect.gen(function* () {
        const pinService = yield* PinService
        const deleted = yield* pinService.remove(path.id)
        if (!deleted) {
          return yield* Effect.fail(new NotFound({ message: `Pin '${path.id}' not found` }))
        }
        return { deleted }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("syncPins", () =>
      Effect.gen(function* () {
        const pinService = yield* PinService
        const result = yield* pinService.sync()
        return { synced: [...result.synced] }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getPinTargets", () =>
      Effect.gen(function* () {
        const pinService = yield* PinService
        const files = yield* pinService.getTargetFiles()
        return { files: [...files] }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("setPinTargets", ({ payload }) =>
      Effect.gen(function* () {
        const pinService = yield* PinService
        yield* pinService.setTargetFiles(payload.files)
        const files = yield* pinService.getTargetFiles()
        return { files: [...files] }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
