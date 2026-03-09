import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToProcessEntry, type ProcessRegistryRow } from "../mappers/process-registry.js"
import type { ProcessEntry, ProcessRole } from "../schemas/worker.js"
import { coerceDbResult } from "../utils/db-result.js"

export class ProcessRegistryRepository extends Context.Tag("ProcessRegistryRepository")<
  ProcessRegistryRepository,
  {
    readonly register: (entry: {
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

export const ProcessRegistryRepositoryLive = Layer.effect(
  ProcessRegistryRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      register: (entry) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () =>
              db.prepare(
                `INSERT INTO process_registry
                 (pid, parent_pid, worker_id, run_id, role, started_at, last_heartbeat_at, command_hint)
                 VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`
              ).run(
                entry.pid,
                entry.parentPid,
                entry.workerId,
                entry.runId,
                entry.role,
                entry.commandHint
              ),
            catch: (cause) => new DatabaseError({ cause })
          })
          const row = yield* Effect.try({
            try: () =>
              coerceDbResult<ProcessRegistryRow | undefined>(
                db.prepare("SELECT * FROM process_registry WHERE id = ?").get(result.lastInsertRowid)
              ),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (!row) {
            return yield* Effect.fail(
              new EntityFetchError({ entity: "process_registry", id: coerceDbResult<number>(result.lastInsertRowid), operation: "insert" })
            )
          }
          return rowToProcessEntry(row)
        }),

      heartbeat: (pid) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `UPDATE process_registry SET last_heartbeat_at = datetime('now')
               WHERE pid = ? AND ended_at IS NULL`
            ).run(pid)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deregister: (pid) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `UPDATE process_registry SET ended_at = datetime('now')
               WHERE pid = ? AND ended_at IS NULL`
            ).run(pid)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAlive: () =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<ProcessRegistryRow[]>(
              db.prepare("SELECT * FROM process_registry WHERE ended_at IS NULL ORDER BY started_at DESC").all()
            )
            return rows.map(rowToProcessEntry)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByWorker: (workerId) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<ProcessRegistryRow[]>(
              db.prepare(
                "SELECT * FROM process_registry WHERE worker_id = ? AND ended_at IS NULL ORDER BY started_at DESC"
              ).all(workerId)
            )
            return rows.map(rowToProcessEntry)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByRun: (runId) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<ProcessRegistryRow[]>(
              db.prepare(
                "SELECT * FROM process_registry WHERE run_id = ? AND ended_at IS NULL ORDER BY started_at DESC"
              ).all(runId)
            )
            return rows.map(rowToProcessEntry)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByRole: (role) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<ProcessRegistryRow[]>(
              db.prepare(
                "SELECT * FROM process_registry WHERE role = ? AND ended_at IS NULL ORDER BY started_at DESC"
              ).all(role)
            )
            return rows.map(rowToProcessEntry)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findOrphans: (heartbeatThresholdSeconds) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<ProcessRegistryRow[]>(
              db.prepare(
                `SELECT * FROM process_registry
                 WHERE ended_at IS NULL
                   AND last_heartbeat_at < datetime('now', '-' || ? || ' seconds')
                 ORDER BY last_heartbeat_at ASC`
              ).all(heartbeatThresholdSeconds)
            )
            return rows.map(rowToProcessEntry)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deregisterByWorker: (workerId) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `UPDATE process_registry SET ended_at = datetime('now')
               WHERE worker_id = ? AND ended_at IS NULL`
            ).run(workerId)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
