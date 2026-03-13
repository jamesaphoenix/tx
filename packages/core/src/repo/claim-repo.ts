import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { ClaimIdNotFoundError, DatabaseError, EntityFetchError } from "../errors.js"
import { rowToClaim, type ClaimRow } from "../mappers/claim.js"
import type { TaskClaim } from "../schemas/worker.js"
import { coerceDbResult } from "../utils/db-result.js"
import { chunkBySqlLimit } from "./task-repo/shared.js"

/**
 * Result of an atomic claim insert attempt.
 */
export type AtomicInsertResult = {
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
export type AtomicRenewResult = {
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
    /** Batch-fetch active claims for multiple task IDs. Returns a map of taskId → TaskClaim. */
    readonly findActiveByTaskIds: (taskIds: readonly string[]) => Effect.Effect<Map<string, TaskClaim>, DatabaseError>
    /** Find the most recent non-completed claim for a task (any status except 'completed'). Used for orchestration status derivation. */
    readonly findLatestByTaskId: (taskId: string) => Effect.Effect<TaskClaim | null, DatabaseError>
    /** Batch-fetch the most recent non-completed claim for multiple tasks. Returns a map of taskId → TaskClaim. */
    readonly findLatestByTaskIds: (taskIds: readonly string[]) => Effect.Effect<Map<string, TaskClaim>, DatabaseError>
    readonly findExpired: (now: Date) => Effect.Effect<readonly TaskClaim[], DatabaseError>
    readonly releaseAllByWorkerId: (workerId: string) => Effect.Effect<number, DatabaseError>
    /**
     * Find active claims where the associated task status is not 'active'.
     * This detects orphaned claims left behind when claim release fails
     * after task completion.
     */
    readonly findOrphanedClaims: () => Effect.Effect<readonly TaskClaim[], DatabaseError>
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
            const row = coerceDbResult<ClaimRow | undefined>(db.prepare(
              "SELECT * FROM task_claims WHERE id = ?"
            ).get(result.lastInsertRowid))
            if (!row) {
              throw new EntityFetchError({
                entity: "claim",
                id: coerceDbResult<number>(result.lastInsertRowid),
                operation: "insert"
              })
            }
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
              const row = coerceDbResult<ClaimRow | undefined>(db.prepare(
                "SELECT * FROM task_claims WHERE id = ?"
              ).get(result.lastInsertRowid))
              if (!row) {
                throw new EntityFetchError({
                  entity: "claim",
                  id: coerceDbResult<number>(result.lastInsertRowid),
                  operation: "insert"
                })
              }
              return {
                success: true,
                claim: rowToClaim(row),
                existingClaim: null
              } satisfies AtomicInsertResult
            } else {
              // Insert was blocked by existing active claim - fetch it
              const existingRow = coerceDbResult<ClaimRow | undefined>(db.prepare(
                "SELECT * FROM task_claims WHERE task_id = ? AND status = 'active' LIMIT 1"
              ).get(claim.taskId))
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
              const row = coerceDbResult<ClaimRow | undefined>(db.prepare(
                "SELECT * FROM task_claims WHERE id = ?"
              ).get(claimId))
              if (!row) {
                throw new EntityFetchError({
                  entity: "claim",
                  id: claimId,
                  operation: "update"
                })
              }
              return {
                success: true,
                claim: rowToClaim(row),
                failureReason: null
              } satisfies AtomicRenewResult
            } else {
              // Renewal failed - determine why
              // Check if claim exists and is owned by this worker
              const existingRow = coerceDbResult<ClaimRow | undefined>(db.prepare(
                "SELECT * FROM task_claims WHERE id = ? AND worker_id = ? AND status = 'active'"
              ).get(claimId, workerId))

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
            const row = coerceDbResult<ClaimRow | undefined>(db.prepare(
              "SELECT * FROM task_claims WHERE id = ?"
            ).get(id))
            return row ? rowToClaim(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findActiveByTaskId: (taskId) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<ClaimRow | undefined>(db.prepare(
              "SELECT * FROM task_claims WHERE task_id = ? AND status = 'active' LIMIT 1"
            ).get(taskId))
            return row ? rowToClaim(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findActiveByTaskIds: (taskIds) =>
        Effect.try({
          try: () => {
            const result = new Map<string, TaskClaim>()
            if (taskIds.length === 0) return result

            for (const chunk of chunkBySqlLimit(taskIds)) {
              const placeholders = chunk.map(() => "?").join(",")
              const rows = coerceDbResult<ClaimRow[]>(db.prepare(
                `SELECT * FROM task_claims WHERE task_id IN (${placeholders}) AND status = 'active'`
              ).all(...chunk))
              for (const row of rows) {
                result.set(row.task_id, rowToClaim(row))
              }
            }
            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findLatestByTaskId: (taskId) =>
        Effect.try({
          try: () => {
            // Use ORDER BY id DESC for deterministic results when multiple
            // claims share the same claimed_at timestamp (common in tests)
            const row = coerceDbResult<ClaimRow | undefined>(db.prepare(
              "SELECT * FROM task_claims WHERE task_id = ? AND status != 'completed' ORDER BY id DESC LIMIT 1"
            ).get(taskId))
            return row ? rowToClaim(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findLatestByTaskIds: (taskIds) =>
        Effect.try({
          try: () => {
            const result = new Map<string, TaskClaim>()
            if (taskIds.length === 0) return result

            for (const chunk of chunkBySqlLimit(taskIds)) {
              const placeholders = chunk.map(() => "?").join(",")
              // Get the most recent non-completed claim per task using MAX(id)
              // for deterministic results (id is monotonically increasing PK,
              // unlike claimed_at which can have duplicate timestamps)
              const rows = coerceDbResult<ClaimRow[]>(db.prepare(
                `SELECT c.* FROM task_claims c
                 INNER JOIN (
                   SELECT task_id, MAX(id) AS max_id
                   FROM task_claims
                   WHERE task_id IN (${placeholders}) AND status != 'completed'
                   GROUP BY task_id
                 ) latest ON c.id = latest.max_id`
              ).all(...chunk))
              for (const row of rows) {
                result.set(row.task_id, rowToClaim(row))
              }
            }
            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findExpired: (now) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<ClaimRow[]>(db.prepare(
              `SELECT * FROM task_claims
               WHERE status = 'active' AND lease_expires_at < ?
               ORDER BY lease_expires_at ASC`
            ).all(now.toISOString()))
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
        }),

      findOrphanedClaims: () =>
        Effect.try({
          try: () => {
            // Find active claims where the task status is NOT 'active'
            // This catches claims that weren't released after task completion
            const rows = coerceDbResult<ClaimRow[]>(db.prepare(
              `SELECT c.* FROM task_claims c
               JOIN tasks t ON c.task_id = t.id
               WHERE c.status = 'active'
               AND t.status != 'active'
               ORDER BY c.claimed_at ASC`
            ).all())
            return rows.map(rowToClaim)
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
