import { Context, Effect, Layer } from "effect"
import Database from "better-sqlite3"
import { mkdirSync, existsSync } from "fs"
import { dirname } from "path"
import { MIGRATIONS } from "./services/migration-service.js"

/** The SqliteClient service provides a better-sqlite3 Database instance. */
export class SqliteClient extends Context.Tag("SqliteClient")<
  SqliteClient,
  ReturnType<typeof Database>
>() {}

/**
 * Get the current schema version from a database instance.
 * Exported for use in tests and CLI commands.
 */
export const getSchemaVersion = (db: Database.Database): number => {
  try {
    const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number } | undefined
    return row?.version ?? 0
  } catch {
    return 0
  }
}

/**
 * Apply all pending migrations to the database.
 * Uses the centralized MIGRATIONS from migration-service.ts.
 */
export const applyMigrations = (db: Database.Database): void => {
  const currentVersion = getSchemaVersion(db)

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.exec(migration.sql)
    }
  }
}

export const makeSqliteClient = (dbPath: string): Effect.Effect<Database.Database> =>
  Effect.sync(() => {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    return db
  })

export const SqliteClientLive = (dbPath: string) =>
  Layer.effect(
    SqliteClient,
    makeSqliteClient(dbPath)
  )
