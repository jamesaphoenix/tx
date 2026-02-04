/**
 * Shared test layer utilities for memory-efficient integration tests.
 *
 * Instead of creating a new database per test, creates ONE database per describe block
 * and resets between tests. This reduces memory from ~54GB to ~8GB for the test suite.
 *
 * @module @tx/test-utils/helpers/shared-test-layer
 */

import { Effect, Layer } from "effect"
import type { Database } from "bun:sqlite"

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
  const { makeAppLayer, SqliteClient } = await import("@jamesaphoenix/tx-core")

  // Create the layer once
  const layer = makeAppLayer(":memory:")

  // Capture the database instance by running an effect
  // Use explicit type to satisfy TypeScript
  const db = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* SqliteClient
      return client as unknown as Database
    }).pipe(Effect.provide(layer))
  )

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
