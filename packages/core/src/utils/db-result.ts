import { ValidationError } from "../errors.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Typed DB-boundary coercion helper.
 * Use this from repos/mappers instead of inline `as` assertions.
 */
export const coerceDbResult = <T>(value: unknown): T => value as T

/**
 * Convert SQLite row IDs (number | bigint) to a safe JS number.
 */
export const sqliteRowIdToNumber = (rowId: number | bigint, context: string): number => {
  if (typeof rowId === "number") {
    return rowId
  }

  if (rowId > BigInt(Number.MAX_SAFE_INTEGER) || rowId < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ValidationError({
      reason: `${context}: row id ${rowId.toString()} is outside Number safe range`
    })
  }

  return Number(rowId)
}

/**
 * Read a numeric field from an aggregate row.
 */
export const readNumberField = (
  row: unknown,
  field: string,
  context: string
): number => {
  if (!isRecord(row)) {
    throw new ValidationError({ reason: `${context}: expected an object row` })
  }
  const value = row[field]
  if (typeof value !== "number") {
    throw new ValidationError({
      reason: `${context}: expected numeric field "${field}"`
    })
  }
  return value
}
