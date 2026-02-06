import { Context, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"
import { mkdirSync, existsSync } from "fs"
import { dirname } from "path"
import { MIGRATIONS } from "./services/migration-service.js"
import { DatabaseError } from "./errors.js"

/**
 * Result type for SQL statement run operations.
 * Compatible with bun:sqlite's return type.
 */
export interface SqliteRunResult {
  lastInsertRowid: number | bigint
  changes: number
}

/**
 * Minimal interface for SQL statement objects.
 * Describes what we need from bun:sqlite's Statement type.
 */
export interface SqliteStatement<TResult = unknown> {
  run(...params: unknown[]): SqliteRunResult
  get(...params: unknown[]): TResult | null
  all(...params: unknown[]): TResult[]
}

/**
 * Minimal interface for the SQLite database.
 * Describes what we need from bun:sqlite's Database type.
 * This allows declaration generation without exposing private types.
 */
export interface SqliteDatabase {
  prepare<T = unknown>(sql: string): SqliteStatement<T>
  run(sql: string, ...params: unknown[]): SqliteRunResult
  exec(sql: string): void
  close(): void
}

/** The SqliteClient service provides a bun:sqlite Database instance. */
export class SqliteClient extends Context.Tag("SqliteClient")<
  SqliteClient,
  SqliteDatabase
>() {}

/**
 * Get the current schema version from a database instance.
 * Exported for use in tests and CLI commands.
 */
export const getSchemaVersion = (db: Database): number => {
  try {
    const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number } | null
    return row?.version ?? 0
  } catch {
    return 0
  }
}

/**
 * Apply all pending migrations to the database.
 * Uses the centralized MIGRATIONS from migration-service.ts.
 * Each migration is wrapped in BEGIN IMMEDIATE/COMMIT/ROLLBACK
 * to ensure atomicity and prevent concurrent application.
 */
export const applyMigrations = (db: Database): void => {
  const currentVersion = getSchemaVersion(db)

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.exec("BEGIN IMMEDIATE")
      try {
        db.exec(migration.sql)
        db.exec("COMMIT")
      } catch (e) {
        db.exec("ROLLBACK")
        throw e
      }
    }
  }
}

export const makeSqliteClient = (dbPath: string): Effect.Effect<Database, DatabaseError> =>
  Effect.try({
    try: () => {
      const dir = dirname(dbPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const db = new Database(dbPath)
      db.run("PRAGMA busy_timeout = " + (process.env.TX_DB_BUSY_TIMEOUT || "5000"))
      db.run("PRAGMA journal_mode = WAL")
      db.run("PRAGMA foreign_keys = ON")
      applyMigrations(db)
      return db
    },
    catch: (cause) => new DatabaseError({ cause })
  })

export const SqliteClientLive = (dbPath: string) =>
  Layer.scoped(
    SqliteClient,
    Effect.acquireRelease(
      makeSqliteClient(dbPath),
      (db) => Effect.sync(() => { try { db.close() } catch { /* already closed */ } })
    )
  )
