/**
 * SQLite database factory for tests.
 *
 * Creates database instances for use in tests. Since we run tests with
 * `bunx --bun vitest run`, bun:sqlite is always available.
 *
 * @module @tx/test-utils/helpers/sqlite-factory
 */

/**
 * Create an in-memory SQLite database with PRAGMAs set.
 * Migrations are NOT applied — call applyMigrations(db) yourself if needed.
 *
 * @param path - Database file path, or ":memory:" (default)
 */
export const createSqliteDatabase = async (path = ":memory:") => {
  const { Database } = await import("bun:sqlite")
  const db = new Database(path)
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run(
    "PRAGMA busy_timeout = " + (process.env.TX_DB_BUSY_TIMEOUT || "5000")
  )
  return db
}

/**
 * Create a SQLite database with all migrations applied.
 *
 * Convenience wrapper around createSqliteDatabase + applyMigrations.
 *
 * @param path - Database file path, or ":memory:" (default)
 */
export const createMigratedSqliteDatabase = async (path = ":memory:") => {
  const { applyMigrations } = await import("@jamesaphoenix/tx-core")
  const db = await createSqliteDatabase(path)
  applyMigrations(db)
  return db
}
