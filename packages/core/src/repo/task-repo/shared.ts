import type { SqliteDatabase } from "../../db.js"

const MAX_SQL_VARIABLES = 900

export const chunkBySqlLimit = <T>(
  values: readonly T[],
  chunkSize: number = MAX_SQL_VARIABLES
): ReadonlyArray<ReadonlyArray<T>> => {
  if (values.length === 0) {
    return []
  }
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize))
  }
  return chunks
}

export const runImmediateTransaction = <T>(
  db: SqliteDatabase,
  body: () => T
): { ok: true; value: T } | { ok: false; error: unknown } => {
  db.exec("BEGIN IMMEDIATE")
  try {
    const value = body()
    db.exec("COMMIT")
    return { ok: true, value }
  } catch (error) {
    try {
      db.exec("ROLLBACK")
    } catch {
      // no-op
    }
    return { ok: false, error }
  }
}
