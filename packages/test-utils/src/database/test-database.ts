/**
 * Test database utilities for in-memory SQLite testing.
 *
 * Provides an in-memory SQLite database with all migrations applied,
 * suitable for integration testing of tx services.
 *
 * @module @tx/test-utils/database
 */

import { Database } from "bun:sqlite"
import { Context, Effect, Layer } from "effect"
import { applyMigrations, type SqliteRunResult } from "@jamesaphoenix/tx-core"

/**
 * Interface for test database operations.
 * Wraps bun:sqlite with convenience methods for testing.
 */
export interface TestDatabase {
  /** The underlying bun:sqlite Database instance */
  readonly db: Database
  /** Close the database connection */
  readonly close: () => Effect.Effect<void>
  /** Delete all data from tables (preserves schema and migrations table) */
  readonly reset: () => Effect.Effect<void>
  /** Execute a SELECT query and return results */
  readonly query: <T = unknown>(sql: string, params?: unknown[]) => T[]
  /** Execute raw SQL (DDL or DML) */
  readonly exec: (sql: string) => void
  /** Execute a parameterized INSERT/UPDATE/DELETE and return run result */
  readonly run: (sql: string, params?: unknown[]) => SqliteRunResult
  /** Execute a function within a transaction */
  readonly transaction: <T>(fn: () => T) => T
}

/**
 * Service tag for test database dependency injection.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const testDb = yield* TestDatabaseService
 *   testDb.exec("INSERT INTO tasks ...")
 * })
 *
 * Effect.runSync(Effect.provide(program, TestDatabaseLive))
 * ```
 */
export class TestDatabaseService extends Context.Tag("TestDatabaseService")<
  TestDatabaseService,
  TestDatabase
>() {}

/**
 * Create an in-memory test database with all migrations applied.
 *
 * @returns Effect that resolves to a TestDatabase instance
 *
 * @example
 * ```typescript
 * const testDb = await Effect.runPromise(createTestDatabase())
 * testDb.exec("INSERT INTO tasks (id, title, status, score) VALUES ('tx-abc123', 'Test', 'backlog', 500)")
 * const tasks = testDb.query("SELECT * FROM tasks")
 * await Effect.runPromise(testDb.close())
 * ```
 */
export const createTestDatabase = (): Effect.Effect<TestDatabase, Error> =>
  Effect.try({
    try: () => {
      const db = new Database(":memory:")

      // Enable WAL mode for better concurrent access (matches production settings)
      db.run("PRAGMA journal_mode = WAL")
      db.run("PRAGMA foreign_keys = ON")

      // Run all migrations
      applyMigrations(db)

      const testDb: TestDatabase = {
        db,

        close: () =>
          Effect.sync(() => {
            db.close()
          }),

        reset: () =>
          Effect.sync(() => {
            // Get all user tables (exclude sqlite internals, migrations tracking, and FTS tables)
            // FTS5 shadow tables (*_fts, *_fts_data, *_fts_idx, etc.) cannot be modified directly
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
          }),

        query: <T = unknown>(sql: string, params: unknown[] = []): T[] => {
          return db.prepare(sql).all(...(params as any[])) as T[]
        },

        exec: (sql: string): void => {
          db.exec(sql)
        },

        run: (sql: string, params: unknown[] = []): SqliteRunResult => {
          return db.prepare(sql).run(...(params as any[]))
        },

        transaction: <T>(fn: () => T): T => {
          return db.transaction(fn)()
        }
      }

      return testDb
    },
    catch: (error) =>
      new Error(`Failed to create test database: ${error instanceof Error ? error.message : String(error)}`)
  })

/**
 * Layer that provides a scoped test database.
 * The database is automatically closed when the scope ends.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect'
 * import { TestDatabaseService, TestDatabaseLive } from '@tx/test-utils'
 *
 * const program = Effect.gen(function* () {
 *   const testDb = yield* TestDatabaseService
 *   testDb.exec("INSERT INTO tasks ...")
 *   return testDb.query("SELECT * FROM tasks")
 * })
 *
 * const result = await Effect.runPromise(
 *   Effect.provide(program, TestDatabaseLive)
 * )
 * ```
 */
export const TestDatabaseLive = Layer.scoped(
  TestDatabaseService,
  Effect.acquireRelease(createTestDatabase(), (db) => db.close())
)

/**
 * Create a test database Layer that can be used with SqliteClient.
 * This allows using the test database with existing services that depend on SqliteClient.
 *
 * @example
 * ```typescript
 * import { SqliteClient } from '@tx/core'
 * import { createTestDatabaseLayer } from '@tx/test-utils'
 *
 * const testLayer = createTestDatabaseLayer()
 *
 * // Use with services that depend on SqliteClient
 * const result = await Effect.runPromise(
 *   Effect.provide(myServiceMethod(), testLayer)
 * )
 * ```
 */
export const createTestDatabaseLayer = (): Layer.Layer<TestDatabaseService, Error> =>
  Layer.scoped(
    TestDatabaseService,
    Effect.acquireRelease(createTestDatabase(), (db) => db.close())
  )
