import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { DecomposeService } from "@jamesaphoenix/tx-core"
import {
  serializeDecomposeResult,
} from "@jamesaphoenix/tx-types"
import type { DecomposeRequest } from "@jamesaphoenix/tx-types"
import { TxApi, mapCoreError } from "../api.js"

export const runDecomposeApi = (payload: DecomposeRequest) =>
  Effect.gen(function* () {
    const svc = yield* DecomposeService
    const result = yield* svc.run(payload)
    return serializeDecomposeResult(result)
  }).pipe(Effect.mapError(mapCoreError))

export const DecomposeLive = HttpApiBuilder.group(TxApi, "decompose", (handlers) =>
  handlers.handle("runDecompose", ({ payload }) => runDecomposeApi(payload))
)
