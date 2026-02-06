/**
 * Shared date parsing utility for all mapper functions.
 * Validates that parsed Date objects are valid, preventing NaN cascades
 * through score calculations and sorting.
 */

import { InvalidDateError } from "../errors.js"

/**
 * Parse a date string from a database row and validate it.
 * Throws InvalidDateError if the string produces an Invalid Date.
 */
export const parseDate = (value: string, field: string, rowId?: string | number): Date => {
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    throw new InvalidDateError({ field, value, rowId })
  }
  return date
}
