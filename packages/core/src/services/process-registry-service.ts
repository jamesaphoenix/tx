import { Context, Effect, Layer } from "effect"
import type { DatabaseError, EntityFetchError } from "../errors.js"
import { ProcessRegistryRepository } from "../repo/process-registry-repo.js"
import type { ProcessEntry, ProcessRole } from "../schemas/worker.js"

export class ProcessRegistryService extends Context.Tag("ProcessRegistryService")<
  ProcessRegistryService,
  {
    readonly register: (opts: {
      pid: number
      parentPid: number | null
      workerId: string | null
      runId: string | null
      role: ProcessRole
      commandHint: string | null
    }) => Effect.Effect<ProcessEntry, DatabaseError | EntityFetchError>

    readonly heartbeat: (pid: number) => Effect.Effect<number, DatabaseError>

    readonly deregister: (pid: number) => Effect.Effect<number, DatabaseError>

    readonly findAlive: () => Effect.Effect<readonly ProcessEntry[], DatabaseError>

    readonly findByWorker: (workerId: string) => Effect.Effect<readonly ProcessEntry[], DatabaseError>

    readonly findByRun: (runId: string) => Effect.Effect<readonly ProcessEntry[], DatabaseError>

    readonly findByRole: (role: ProcessRole) => Effect.Effect<readonly ProcessEntry[], DatabaseError>

    readonly findOrphans: (heartbeatThresholdSeconds: number) => Effect.Effect<readonly ProcessEntry[], DatabaseError>

    readonly deregisterByWorker: (workerId: string) => Effect.Effect<number, DatabaseError>
  }
>() {}

export const ProcessRegistryServiceLive = Layer.effect(
  ProcessRegistryService,
  Effect.gen(function* () {
    const repo = yield* ProcessRegistryRepository

    return {
      register: (opts) => repo.register(opts),

      heartbeat: (pid) => repo.heartbeat(pid),

      deregister: (pid) => repo.deregister(pid),

      findAlive: () => repo.findAlive(),

      findByWorker: (workerId) => repo.findByWorker(workerId),

      findByRun: (runId) => repo.findByRun(runId),

      findByRole: (role) => repo.findByRole(role),

      findOrphans: (heartbeatThresholdSeconds) => repo.findOrphans(heartbeatThresholdSeconds),

      deregisterByWorker: (workerId) => repo.deregisterByWorker(workerId)
    }
  })
)
