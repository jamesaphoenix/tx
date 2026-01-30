import { Context, Effect, Layer } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"

/**
 * Describes a single database migration.
 */
export interface Migration {
  readonly version: number
  readonly description: string
  readonly sql: string
}

/**
 * Information about an applied migration.
 */
export interface AppliedMigration {
  readonly version: number
  readonly appliedAt: Date
}

/**
 * Migration status including current version and pending migrations.
 */
export interface MigrationStatus {
  readonly currentVersion: number
  readonly latestVersion: number
  readonly pendingCount: number
  readonly appliedMigrations: readonly AppliedMigration[]
  readonly pendingMigrations: readonly Migration[]
}

/**
 * Get the migrations directory path.
 * Looks for migrations/ relative to the package root.
 */
const getMigrationsDir = (): string => {
  // When running from source (src/services/migration-service.ts)
  // or from dist (dist/services/migration-service.js),
  // we need to go up to the package root and then into migrations/
  const currentDir = dirname(fileURLToPath(import.meta.url))
  // Go up two levels: services/ -> src/ (or dist/) -> package root
  const packageRoot = resolve(currentDir, "..", "..")
  return join(packageRoot, "migrations")
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
 */
const loadMigrationsFromDir = (): Migration[] => {
  const migrationsDir = getMigrationsDir()

  let files: string[]
  try {
    files = readdirSync(migrationsDir)
  } catch {
    // Migrations directory doesn't exist - return empty array
    return []
  }

  const migrations: Migration[] = []

  for (const filename of files) {
    if (!filename.endsWith(".sql")) continue

    const parsed = parseMigrationFilename(filename)
    if (!parsed) continue

    const sql = readFileSync(join(migrationsDir, filename), "utf-8")
    migrations.push({
      version: parsed.version,
      description: parsed.description,
      sql
    })
  }

  // Sort by version number
  migrations.sort((a, b) => a.version - b.version)

  return migrations
}

/**
 * All migrations loaded from the migrations/ directory.
 * Sorted by version number.
 */
export const MIGRATIONS: readonly Migration[] = loadMigrationsFromDir()

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
            yield* Effect.try({
              try: () => db.exec(migration.sql),
              catch: (cause) => new DatabaseError({ cause })
            })
          }

          return pendingMigrations.length
        })
    }
  })
)
