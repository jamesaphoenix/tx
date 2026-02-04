import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToOrchestratorState, type OrchestratorStateRow } from "../mappers/orchestrator-state.js"
import type { OrchestratorState } from "../schemas/worker.js"

/**
 * Partial update type for OrchestratorState (all fields optional).
 */
export type OrchestratorStateUpdate = Partial<Omit<OrchestratorState, "metadata">> & {
  metadata?: Record<string, unknown>
}

export class OrchestratorStateRepository extends Context.Tag("OrchestratorStateRepository")<
  OrchestratorStateRepository,
  {
    /**
     * Get the singleton orchestrator state.
     * Initializes the state if it doesn't exist (should never happen with proper migration).
     */
    readonly get: () => Effect.Effect<OrchestratorState, DatabaseError>
    /**
     * Update the singleton orchestrator state.
     * Only updates the fields provided in the partial update.
     */
    readonly update: (partial: OrchestratorStateUpdate) => Effect.Effect<void, DatabaseError>
  }
>() {}

/**
 * Default values for orchestrator state initialization.
 */
const DEFAULT_STATE: OrchestratorState = {
  status: "stopped",
  pid: null,
  startedAt: null,
  lastReconcileAt: null,
  workerPoolSize: 1,
  reconcileIntervalSeconds: 60,
  heartbeatIntervalSeconds: 30,
  leaseDurationMinutes: 30,
  metadata: {}
}

export const OrchestratorStateRepositoryLive = Layer.effect(
  OrchestratorStateRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    /**
     * Initialize the singleton row if it doesn't exist.
     * Uses INSERT OR IGNORE to be idempotent.
     */
    const ensureSingletonExists = (): void => {
      db.prepare(
        `INSERT OR IGNORE INTO orchestrator_state
         (id, status, pid, started_at, last_reconcile_at, worker_pool_size,
          reconcile_interval_seconds, heartbeat_interval_seconds, lease_duration_minutes, metadata)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        DEFAULT_STATE.status,
        DEFAULT_STATE.pid,
        DEFAULT_STATE.startedAt?.toISOString() ?? null,
        DEFAULT_STATE.lastReconcileAt?.toISOString() ?? null,
        DEFAULT_STATE.workerPoolSize,
        DEFAULT_STATE.reconcileIntervalSeconds,
        DEFAULT_STATE.heartbeatIntervalSeconds,
        DEFAULT_STATE.leaseDurationMinutes,
        JSON.stringify(DEFAULT_STATE.metadata)
      )
    }

    return {
      get: () =>
        Effect.try({
          try: () => {
            // Ensure singleton exists before querying
            ensureSingletonExists()

            const row = db.prepare(
              "SELECT * FROM orchestrator_state WHERE id = 1"
            ).get() as OrchestratorStateRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "orchestrator_state",
                id: 1,
                operation: "insert"
              })
            }

            return rowToOrchestratorState(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (partial) =>
        Effect.try({
          try: () => {
            // Ensure singleton exists before updating
            ensureSingletonExists()

            // Build dynamic UPDATE based on provided fields
            const setClauses: string[] = []
            const params: unknown[] = []

            if (partial.status !== undefined) {
              setClauses.push("status = ?")
              params.push(partial.status)
            }
            if (partial.pid !== undefined) {
              setClauses.push("pid = ?")
              params.push(partial.pid)
            }
            if (partial.startedAt !== undefined) {
              setClauses.push("started_at = ?")
              params.push(partial.startedAt?.toISOString() ?? null)
            }
            if (partial.lastReconcileAt !== undefined) {
              setClauses.push("last_reconcile_at = ?")
              params.push(partial.lastReconcileAt?.toISOString() ?? null)
            }
            if (partial.workerPoolSize !== undefined) {
              setClauses.push("worker_pool_size = ?")
              params.push(partial.workerPoolSize)
            }
            if (partial.reconcileIntervalSeconds !== undefined) {
              setClauses.push("reconcile_interval_seconds = ?")
              params.push(partial.reconcileIntervalSeconds)
            }
            if (partial.heartbeatIntervalSeconds !== undefined) {
              setClauses.push("heartbeat_interval_seconds = ?")
              params.push(partial.heartbeatIntervalSeconds)
            }
            if (partial.leaseDurationMinutes !== undefined) {
              setClauses.push("lease_duration_minutes = ?")
              params.push(partial.leaseDurationMinutes)
            }
            if (partial.metadata !== undefined) {
              setClauses.push("metadata = ?")
              params.push(JSON.stringify(partial.metadata))
            }

            // Only run UPDATE if there are fields to update
            if (setClauses.length > 0) {
              params.push(1) // WHERE id = 1
              db.prepare(
                `UPDATE orchestrator_state SET ${setClauses.join(", ")} WHERE id = ?`
              ).run(...params)
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
