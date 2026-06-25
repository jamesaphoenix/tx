/**
 * Verify Route Handlers
 *
 * Implements verify endpoint handlers for machine-checkable done criteria.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { VerifyService } from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"
import { TxApi, mapCoreError } from "../api.js"

export const VerifyLive = HttpApiBuilder.group(TxApi, "verify", (handlers) =>
  handlers
    .handle("setVerify", ({ path, payload }) =>
      Effect.gen(function* () {
        const svc = yield* VerifyService
        yield* svc.set(path.id as TaskId, payload.cmd, payload.schema)
        return { message: `Verify command set for task ${path.id}` }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("showVerify", ({ path }) =>
      Effect.gen(function* () {
        const svc = yield* VerifyService
        return yield* svc.show(path.id as TaskId)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("runVerify", ({ path, urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* VerifyService
        const timeout = urlParams.timeout
        const result = yield* svc.run(
          path.id as TaskId,
          timeout ? { timeout } : undefined
        )
        return {
          taskId: result.taskId,
          exitCode: result.exitCode,
          passed: result.passed,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
          output: result.output,
          schemaValid: result.schemaValid,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("clearVerify", ({ path }) =>
      Effect.gen(function* () {
        const svc = yield* VerifyService
        yield* svc.clear(path.id as TaskId)
        return { message: `Verify command cleared for task ${path.id}` }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
