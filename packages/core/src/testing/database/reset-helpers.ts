import type { Database } from "bun:sqlite"

const RESETTABLE_TABLES_SQL = `
  SELECT name FROM sqlite_master
  WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    AND name != 'schema_version'
    AND name NOT LIKE '%_fts'
    AND name NOT LIKE '%_fts_%'
    AND name NOT LIKE '%_config'
`

const SQLITE_SEQUENCE_EXISTS_SQL = `
  SELECT 1 AS exists_flag
  FROM sqlite_master
  WHERE type = 'table'
    AND name = 'sqlite_sequence'
  LIMIT 1
`

interface ResetMetadata {
  tableNames: string[]
  hasSqliteSequence: boolean
}

const resetMetadataCache = new WeakMap<Database, ResetMetadata>()

const loadResetMetadata = (db: Database): ResetMetadata => {
  const cached = resetMetadataCache.get(db)
  if (cached) {
    return cached
  }

  const tableRows = db.prepare(RESETTABLE_TABLES_SQL).all() as Array<{ name: string }>
  const hasSqliteSequence = Boolean(
    db.prepare(SQLITE_SEQUENCE_EXISTS_SQL).get() as { exists_flag: number } | undefined
  )

  const metadata: ResetMetadata = {
    tableNames: tableRows.map((row) => row.name),
    hasSqliteSequence,
  }
  resetMetadataCache.set(db, metadata)
  return metadata
}

/**
 * Reset all mutable tables in a test database while preserving schema/migration metadata.
 *
 * Runs deletes in a single transaction to reduce WAL churn in large test suites.
 */
export const resetDatabaseTables = (db: Database): void => {
  const { tableNames, hasSqliteSequence } = loadResetMetadata(db)

  db.run("PRAGMA foreign_keys = OFF")
  try {
    db.transaction(() => {
      for (const tableName of tableNames) {
        db.exec(`DELETE FROM "${tableName}"`)
      }
      if (hasSqliteSequence) {
        db.exec("DELETE FROM sqlite_sequence")
      }
    })()
  } finally {
    db.run("PRAGMA foreign_keys = ON")
  }
}
