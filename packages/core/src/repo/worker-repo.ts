import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, UnexpectedRowCountError, WorkerNotFoundError } from "../errors.js"
import { rowToWorker, type WorkerRow } from "../mappers/worker.js"
import type { Worker, WorkerStatus } from "../schemas/worker.js"

export class WorkerRepository extends Context.Tag("WorkerRepository")<
  WorkerRepository,
  {
    readonly insert: (worker: Worker) => Effect.Effect<void, DatabaseError>
    readonly insertIfUnderCapacity: (worker: Worker, maxCapacity: number) => Effect.Effect<boolean, DatabaseError>
    readonly update: (worker: Worker) => Effect.Effect<void, DatabaseError | WorkerNotFoundError>
    readonly delete: (id: string) => Effect.Effect<boolean, DatabaseError>
    readonly findById: (id: string) => Effect.Effect<Worker | null, DatabaseError>
    readonly findByStatus: (status: WorkerStatus) => Effect.Effect<readonly Worker[], DatabaseError>
    readonly findByLastHeartbeatBefore: (threshold: Date) => Effect.Effect<readonly Worker[], DatabaseError>
    readonly countByStatus: (status: WorkerStatus) => Effect.Effect<number, DatabaseError>
    readonly findAll: () => Effect.Effect<readonly Worker[], DatabaseError>
  }
>() {}

export const WorkerRepositoryLive = Layer.effect(
  WorkerRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (worker) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO workers
               (id, name, hostname, pid, status, registered_at, last_heartbeat_at, current_task_id, capabilities, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              worker.id,
              worker.name,
              worker.hostname,
              worker.pid,
              worker.status,
              worker.registeredAt.toISOString(),
              worker.lastHeartbeatAt.toISOString(),
              worker.currentTaskId,
              JSON.stringify(worker.capabilities),
              JSON.stringify(worker.metadata)
            )
            if (result.changes !== 1) {
              throw new UnexpectedRowCountError({
                operation: "worker insert",
                expected: 1,
                actual: result.changes
              })
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertIfUnderCapacity: (worker, maxCapacity) =>
        Effect.try({
          try: () => {
            // BEGIN IMMEDIATE acquires write lock immediately, preventing other writers
            // from registering workers until we commit/rollback
            db.exec("BEGIN IMMEDIATE")
            try {
              // Count active workers atomically within the transaction
              const countResult = db.prepare(
                "SELECT COUNT(*) as cnt FROM workers WHERE status IN ('starting', 'idle', 'busy')"
              ).get() as { cnt: number }

              if (countResult.cnt >= maxCapacity) {
                db.exec("ROLLBACK")
                return false
              }

              const result = db.prepare(
                `INSERT INTO workers
                 (id, name, hostname, pid, status, registered_at, last_heartbeat_at, current_task_id, capabilities, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                worker.id,
                worker.name,
                worker.hostname,
                worker.pid,
                worker.status,
                worker.registeredAt.toISOString(),
                worker.lastHeartbeatAt.toISOString(),
                worker.currentTaskId,
                JSON.stringify(worker.capabilities),
                JSON.stringify(worker.metadata)
              )

              if (result.changes !== 1) {
                db.exec("ROLLBACK")
                throw new UnexpectedRowCountError({
                  operation: "worker insertIfUnderCapacity",
                  expected: 1,
                  actual: result.changes
                })
              }

              db.exec("COMMIT")
              return true
            } catch (e) {
              try { db.exec("ROLLBACK") } catch { /* already rolled back */ }
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (worker) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () =>
              db.prepare(
                `UPDATE workers SET
                  name = ?, hostname = ?, pid = ?, status = ?,
                  registered_at = ?, last_heartbeat_at = ?, current_task_id = ?,
                  capabilities = ?, metadata = ?
                 WHERE id = ?`
              ).run(
                worker.name,
                worker.hostname,
                worker.pid,
                worker.status,
                worker.registeredAt.toISOString(),
                worker.lastHeartbeatAt.toISOString(),
                worker.currentTaskId,
                JSON.stringify(worker.capabilities),
                JSON.stringify(worker.metadata),
                worker.id
              ),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new WorkerNotFoundError({ workerId: worker.id }))
          }
        }),

      delete: (id) =>
        Effect.try({
          try: () => {
            const result = db.prepare("DELETE FROM workers WHERE id = ?").run(id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM workers WHERE id = ?").get(id) as WorkerRow | undefined
            return row ? rowToWorker(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByStatus: (status) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM workers WHERE status = ? ORDER BY registered_at DESC"
            ).all(status) as WorkerRow[]
            return rows.map(rowToWorker)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByLastHeartbeatBefore: (threshold) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM workers WHERE last_heartbeat_at < ? ORDER BY last_heartbeat_at ASC"
            ).all(threshold.toISOString()) as WorkerRow[]
            return rows.map(rowToWorker)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countByStatus: (status) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "SELECT COUNT(*) as cnt FROM workers WHERE status = ?"
            ).get(status) as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM workers ORDER BY registered_at DESC"
            ).all() as WorkerRow[]
            return rows.map(rowToWorker)
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
