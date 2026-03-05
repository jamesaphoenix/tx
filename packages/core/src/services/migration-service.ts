import { Context, Effect, Layer } from "effect"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { EMBEDDED_MIGRATIONS } from "../migrations-embedded.js"

export { EMBEDDED_MIGRATIONS } from "../migrations-embedded.js"

/**
 * Describes a single database migration.
 */
export type Migration = {
  readonly version: number
  readonly description: string
  readonly sql: string};

/**
 * Information about an applied migration.
 */
export type AppliedMigration = {
  readonly version: number
  readonly appliedAt: Date};

/**
 * Migration status including current version and pending migrations.
 */
export type MigrationStatus = {
  readonly currentVersion: number
  readonly latestVersion: number
  readonly pendingCount: number
  readonly appliedMigrations: readonly AppliedMigration[]
  readonly pendingMigrations: readonly Migration[]};

/**
 * Get the migrations directory path.
 * Checks two locations:
 *   1. Package-local: ../../migrations relative to this file (works for npm installs
 *      where migrations/ is copied into the package during build)
 *   2. Monorepo root: ../../../../migrations (works in monorepo development)
 */
const getMigrationsDir = (): string => {
  const currentDir = dirname(fileURLToPath(import.meta.url))

  // From src/services/ or dist/services/, up 2 levels = package root
  const packageLocal = resolve(currentDir, "..", "..", "migrations")
  if (existsSync(packageLocal)) return packageLocal

  // Fallback: monorepo root (up 4 levels from packages/core/src/services/)
  const monorepoRoot = resolve(currentDir, "..", "..", "..", "..", "migrations")
  return monorepoRoot
}

/**
 * Parse a migration filename to extract version and description.
 * Expected format: NNN_description.sql (e.g., 001_initial.sql)
 */
const parseMigrationFilename = (filename: string): { version: number; description: string } | null => {
  const match = filename.match(/^(\d{3})_(.+)\.sql$/)
  if (!match) return null
  return {
    version: parseInt(match[1], 10),
    description: match[2].replace(/_/g, " ")
  }
}

/**
 * Load all migrations from the migrations/ directory.
 * Migrations are sorted by version number.
 * Uses async fs operations to avoid blocking the event loop.
 */
const loadMigrationsFromDir = async (): Promise<Migration[]> => {
  const migrationsDir = getMigrationsDir()

  let files: string[]
  try {
    files = await readdir(migrationsDir)
  } catch {
    // Migrations directory doesn't exist - return empty array
    return []
  }

  const migrations: Migration[] = []

  for (const filename of files) {
    if (!filename.endsWith(".sql")) continue

    const parsed = parseMigrationFilename(filename)
    if (!parsed) continue

    try {
      const sql = await readFile(join(migrationsDir, filename), "utf-8")
      migrations.push({
        version: parsed.version,
        description: parsed.description,
        sql
      })
    } catch {
      // Individual file unreadable — fall back to embedded set
      return []
    }
  }

  // Sort by version number
  migrations.sort((a, b) => a.version - b.version)

  return migrations
}

/**
 * All migrations loaded from the migrations/ directory.
 * Falls back to embedded migrations for compiled binaries where the
 * filesystem path is unavailable (/$bunfs/ virtual filesystem).
 *
 * Uses the embedded set when:
 * - The migrations directory doesn't exist (compiled binary)
 * - Any individual file is unreadable (partial/corrupt install)
 * - Fewer migrations are on disk than embedded (incomplete install)
 */
export const MIGRATIONS: readonly Migration[] = await loadMigrationsFromDir()
  .then(m => m.length >= EMBEDDED_MIGRATIONS.length ? m : EMBEDDED_MIGRATIONS)

/**
 * Get the latest migration version.
 */
export const getLatestVersion = (): number => {
  if (MIGRATIONS.length === 0) return 0
  return MIGRATIONS[MIGRATIONS.length - 1].version
}

/**
 * MigrationService manages database schema migrations.
 * Follows Effect-TS patterns per DD-002.
 */
export class MigrationService extends Context.Tag("MigrationService")<
  MigrationService,
  {
    /**
     * Get the current migration status.
     * Returns current version, latest version, and pending migrations.
     */
    readonly getStatus: () => Effect.Effect<MigrationStatus, DatabaseError>

    /**
     * Apply all pending migrations.
     * Returns the number of migrations applied.
     * Note: Migrations are also applied automatically when the database is opened.
     */
    readonly run: () => Effect.Effect<number, DatabaseError>

    /**
     * Get the current schema version from the database.
     */
    readonly getCurrentVersion: () => Effect.Effect<number, DatabaseError>

    /**
     * Get all applied migrations.
     */
    readonly getAppliedMigrations: () => Effect.Effect<readonly AppliedMigration[], DatabaseError>
  }
>() {}

export const MigrationServiceLive = Layer.effect(
  MigrationService,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    const getCurrentVersion = (): Effect.Effect<number, DatabaseError> =>
      Effect.try({
        try: () => {
          try {
            const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number } | undefined
            return row?.version ?? 0
          } catch {
            // Table doesn't exist yet
            return 0
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const getAppliedMigrations = (): Effect.Effect<readonly AppliedMigration[], DatabaseError> =>
      Effect.try({
        try: () => {
          try {
            const rows = db.prepare("SELECT version, applied_at FROM schema_version ORDER BY version").all() as Array<{ version: number; applied_at: string }>
            return rows.map(row => ({
              version: row.version,
              appliedAt: new Date(row.applied_at)
            }))
          } catch {
            // Table doesn't exist yet
            return []
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    return {
      getCurrentVersion,

      getAppliedMigrations,

      getStatus: () =>
        Effect.gen(function* () {
          const currentVersion = yield* getCurrentVersion()
          const latestVersion = getLatestVersion()
          const appliedMigrations = yield* getAppliedMigrations()
          const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion)

          return {
            currentVersion,
            latestVersion,
            pendingCount: pendingMigrations.length,
            appliedMigrations,
            pendingMigrations
          }
        }),

      run: () =>
        Effect.gen(function* () {
          const currentVersion = yield* getCurrentVersion()
          const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion)

          for (const migration of pendingMigrations) {
            const transactionError = yield* Effect.try({
              try: () => {
                db.exec("BEGIN IMMEDIATE")
                try {
                  db.exec(migration.sql)
                  db.exec("COMMIT")
                  return null
                } catch (e) {
                  db.exec("ROLLBACK")
                  return e
                }
              },
              catch: (cause) => new DatabaseError({ cause })
            })

            if (transactionError !== null) {
              yield* Effect.fail(new DatabaseError({ cause: transactionError }))
            }
          }

          return pendingMigrations.length
        })
    }
  })
)
