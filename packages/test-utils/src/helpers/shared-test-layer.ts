/**
 * Shared test layer utilities for memory-efficient integration tests.
 *
 * Instead of creating a new database per test, creates ONE database per describe block
 * and resets between tests. This reduces memory from ~54GB to ~8GB for the test suite.
 *
 * @module @tx/test-utils/helpers/shared-test-layer
 */

import { Layer } from "effect"
import type { Database } from "bun:sqlite"
import type { SqliteDatabase } from "@jamesaphoenix/tx-core"

/**
 * Result of creating a shared test layer.
 */
export interface SharedTestLayer<L> {
  /** The Effect layer - pass to Effect.provide() */
  readonly layer: Layer.Layer<L, never, never>
  /** Reset all database tables (call in afterEach) */
  readonly reset: () => Promise<void>
  /** Close the database (call in afterAll) */
  readonly close: () => Promise<void>
  /** Access to underlying database for advanced use cases */
  readonly getDb: () => Database
}

/**
 * Create a shared app layer for testing.
 *
 * This creates ONE in-memory SQLite database that can be reset between tests.
 * Much more memory-efficient than creating a new database per test.
 *
 * @example
 * ```typescript
 * import { createSharedTestLayer } from '@jamesaphoenix/tx-test-utils'
 * import { describe, it, beforeAll, afterEach, afterAll } from 'vitest'
 *
 * describe('MyService', () => {
 *   let shared: SharedTestLayer<...>
 *
 *   beforeAll(async () => {
 *     shared = await createSharedTestLayer()
 *   })
 *
 *   afterEach(async () => {
 *     await shared.reset()  // Clean slate between tests
 *   })
 *
 *   afterAll(async () => {
 *     await shared.close()
 *   })
 *
 *   it('test 1', async () => {
 *     const result = await Effect.runPromise(
 *       myEffect.pipe(Effect.provide(shared.layer))
 *     )
 *   })
 * })
 * ```
 */
export const createSharedTestLayer = async () => {
  // Dynamically import to avoid circular dependencies
  // Use makeMinimalLayerFromInfra (Noop variants for LLM/embedding/reranker)
  // instead of makeAppLayerFromInfra (Auto variants that probe for node-llama-cpp etc.)
  // to avoid slow auto-detection overhead in tests.
  const { makeMinimalLayerFromInfra, SqliteClient, applyMigrations } = await import("@jamesaphoenix/tx-core")
  const { Database } = await import("bun:sqlite")

  // Create ONE database instance directly — this ensures all tests share the
  // exact same DB connection rather than each Layer build creating a new one
  // (Layer.effect-based layers like SqliteClientLive create new connections per build).
  const db = new Database(":memory:")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA busy_timeout = " + (process.env.TX_DB_BUSY_TIMEOUT || "5000"))
  applyMigrations(db)

  // Use Layer.succeed to provide the concrete DB instance — this is a constant
  // layer that always provides the same DB reference, unlike Layer.effect which
  // would create a new connection on each build.
  const infra = Layer.succeed(SqliteClient, db as unknown as SqliteDatabase)

  // Wrap with Layer.fresh so that service layers (repos, services) are NOT
  // memoized across separate Effect.provide calls. This ensures each test gets
  // fresh service instances while sharing the same underlying database.
  const layer = Layer.fresh(makeMinimalLayerFromInfra(infra))

  /**
   * Reset all tables in the database.
   * Preserves schema but deletes all data.
   */
  const reset = async (): Promise<void> => {
    // Get all user tables (exclude sqlite internals, migrations tracking, and FTS tables)
    const tables = db
      .prepare(
        `
        SELECT name FROM sqlite_master
        WHERE type='table'
          AND name NOT LIKE 'sqlite_%'
          AND name != 'schema_version'
          AND name NOT LIKE '%_fts'
          AND name NOT LIKE '%_fts_%'
          AND name NOT LIKE '%_config'
      `
      )
      .all() as Array<{ name: string }>

    // Disable foreign keys temporarily to allow deletion in any order
    db.run("PRAGMA foreign_keys = OFF")
    for (const { name } of tables) {
      db.exec(`DELETE FROM "${name}"`)
    }
    // Reset auto-increment counters so IDs start from 1 in each test
    db.exec("DELETE FROM sqlite_sequence")
    db.run("PRAGMA foreign_keys = ON")
  }

  /**
   * Close the database connection.
   */
  const close = async (): Promise<void> => {
    db.close()
  }

  /**
   * Get the underlying database instance.
   */
  const getDb = (): Database => db

  return {
    layer,
    reset,
    close,
    getDb
  }
}

/**
 * Type helper for the return type of createSharedTestLayer.
 * Use this when you need to type the shared layer variable.
 */
export type SharedTestLayerResult = Awaited<ReturnType<typeof createSharedTestLayer>>
