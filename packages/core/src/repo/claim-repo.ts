import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToClaim, type ClaimRow } from "../mappers/claim.js"
import type { TaskClaim } from "../schemas/worker.js"

export class ClaimRepository extends Context.Tag("ClaimRepository")<
  ClaimRepository,
  {
    readonly insert: (claim: Omit<TaskClaim, "id">) => Effect.Effect<TaskClaim, DatabaseError>
    readonly update: (claim: TaskClaim) => Effect.Effect<void, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<TaskClaim | null, DatabaseError>
    readonly findActiveByTaskId: (taskId: string) => Effect.Effect<TaskClaim | null, DatabaseError>
    readonly findExpired: (now: Date) => Effect.Effect<readonly TaskClaim[], DatabaseError>
    readonly releaseAllByWorkerId: (workerId: string) => Effect.Effect<number, DatabaseError>
  }
>() {}

export const ClaimRepositoryLive = Layer.effect(
  ClaimRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (claim) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO task_claims
               (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(
              claim.taskId,
              claim.workerId,
              claim.claimedAt.toISOString(),
              claim.leaseExpiresAt.toISOString(),
              claim.renewedCount,
              claim.status
            )
            const row = db.prepare(
              "SELECT * FROM task_claims WHERE id = ?"
            ).get(result.lastInsertRowid) as ClaimRow
            return rowToClaim(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (claim) =>
        Effect.try({
          try: () => {
            db.prepare(
              `UPDATE task_claims SET
                task_id = ?, worker_id = ?, claimed_at = ?,
                lease_expires_at = ?, renewed_count = ?, status = ?
               WHERE id = ?`
            ).run(
              claim.taskId,
              claim.workerId,
              claim.claimedAt.toISOString(),
              claim.leaseExpiresAt.toISOString(),
              claim.renewedCount,
              claim.status,
              claim.id
            )
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM task_claims WHERE id = ?"
            ).get(id) as ClaimRow | undefined
            return row ? rowToClaim(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findActiveByTaskId: (taskId) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM task_claims WHERE task_id = ? AND status = 'active' LIMIT 1"
            ).get(taskId) as ClaimRow | undefined
            return row ? rowToClaim(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findExpired: (now) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM task_claims
               WHERE status = 'active' AND lease_expires_at < ?
               ORDER BY lease_expires_at ASC`
            ).all(now.toISOString()) as ClaimRow[]
            return rows.map(rowToClaim)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      releaseAllByWorkerId: (workerId) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `UPDATE task_claims SET status = 'released'
               WHERE worker_id = ? AND status = 'active'`
            ).run(workerId)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
