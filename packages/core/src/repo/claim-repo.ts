import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { ClaimIdNotFoundError, DatabaseError } from "../errors.js"
import { rowToClaim, type ClaimRow } from "../mappers/claim.js"
import type { TaskClaim } from "../schemas/worker.js"

/**
 * Result of an atomic claim insert attempt.
 */
export interface AtomicInsertResult {
  /** Whether the insert succeeded (no existing active claim) */
  success: boolean
  /** The claim if insert succeeded, null otherwise */
  claim: TaskClaim | null
  /** If insert failed, the existing claim that blocked it */
  existingClaim: TaskClaim | null
}

/**
 * Result of an atomic lease renewal attempt.
 */
export interface AtomicRenewResult {
  /** Whether the renewal succeeded */
  success: boolean
  /** The renewed claim if successful, null otherwise */
  claim: TaskClaim | null
  /** Reason for failure if not successful */
  failureReason: "not_found" | "expired" | null
}

export class ClaimRepository extends Context.Tag("ClaimRepository")<
  ClaimRepository,
  {
    readonly insert: (claim: Omit<TaskClaim, "id">) => Effect.Effect<TaskClaim, DatabaseError>
    /**
     * Atomically insert a claim only if no active claim exists for the task.
     * Uses a single SQL operation to prevent race conditions.
     */
    readonly tryInsertAtomic: (claim: Omit<TaskClaim, "id">) => Effect.Effect<AtomicInsertResult, DatabaseError>
    readonly update: (claim: TaskClaim) => Effect.Effect<void, DatabaseError | ClaimIdNotFoundError>
    /**
     * Atomically renew a lease only if it hasn't expired yet.
     * Uses a single SQL operation to prevent race conditions between
     * checking expiration and performing the renewal.
     *
     * @param claimId - The ID of the claim to renew
     * @param workerId - The worker ID that must own the claim
     * @param newLeaseExpiresAt - The new expiration time
     * @returns AtomicRenewResult indicating success/failure and reason
     */
    readonly tryRenewAtomic: (
      claimId: number,
      workerId: string,
      newLeaseExpiresAt: Date
    ) => Effect.Effect<AtomicRenewResult, DatabaseError>
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

      tryInsertAtomic: (claim) =>
        Effect.try({
          try: () => {
            // Use INSERT ... WHERE NOT EXISTS to atomically check and insert
            // This prevents the check-then-act race condition
            const result = db.prepare(
              `INSERT INTO task_claims
               (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
               SELECT ?, ?, ?, ?, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM task_claims
                 WHERE task_id = ? AND status = 'active'
               )`
            ).run(
              claim.taskId,
              claim.workerId,
              claim.claimedAt.toISOString(),
              claim.leaseExpiresAt.toISOString(),
              claim.renewedCount,
              claim.status,
              claim.taskId // For the WHERE NOT EXISTS subquery
            )

            if (result.changes > 0) {
              // Insert succeeded - fetch the newly created claim
              const row = db.prepare(
                "SELECT * FROM task_claims WHERE id = ?"
              ).get(result.lastInsertRowid) as ClaimRow
              return {
                success: true,
                claim: rowToClaim(row),
                existingClaim: null
              } satisfies AtomicInsertResult
            } else {
              // Insert was blocked by existing active claim - fetch it
              const existingRow = db.prepare(
                "SELECT * FROM task_claims WHERE task_id = ? AND status = 'active' LIMIT 1"
              ).get(claim.taskId) as ClaimRow | undefined
              return {
                success: false,
                claim: null,
                existingClaim: existingRow ? rowToClaim(existingRow) : null
              } satisfies AtomicInsertResult
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (claim) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () =>
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
              ),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new ClaimIdNotFoundError({ claimId: claim.id }))
          }
        }),

      tryRenewAtomic: (claimId, workerId, newLeaseExpiresAt) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            // Atomic update: only succeeds if claim is active, owned by worker, and not expired
            const result = db.prepare(
              `UPDATE task_claims
               SET lease_expires_at = ?, renewed_count = renewed_count + 1
               WHERE id = ? AND worker_id = ? AND status = 'active' AND lease_expires_at >= ?`
            ).run(
              newLeaseExpiresAt.toISOString(),
              claimId,
              workerId,
              now
            )

            if (result.changes > 0) {
              // Renewal succeeded - fetch the updated claim
              const row = db.prepare(
                "SELECT * FROM task_claims WHERE id = ?"
              ).get(claimId) as ClaimRow
              return {
                success: true,
                claim: rowToClaim(row),
                failureReason: null
              } satisfies AtomicRenewResult
            } else {
              // Renewal failed - determine why
              // Check if claim exists and is owned by this worker
              const existingRow = db.prepare(
                "SELECT * FROM task_claims WHERE id = ? AND worker_id = ? AND status = 'active'"
              ).get(claimId, workerId) as ClaimRow | undefined

              if (!existingRow) {
                return {
                  success: false,
                  claim: null,
                  failureReason: "not_found"
                } satisfies AtomicRenewResult
              }

              // Claim exists but lease has expired
              return {
                success: false,
                claim: null,
                failureReason: "expired"
              } satisfies AtomicRenewResult
            }
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
