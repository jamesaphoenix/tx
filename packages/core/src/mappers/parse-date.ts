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
  // SQLite datetime('now') returns UTC without a timezone indicator (e.g. "2026-03-29 13:00:00").
  // JavaScript's new Date() interprets strings without timezone as local time.
  // Append 'Z' to ensure correct UTC interpretation when no timezone is present.
  const normalized = /[TZ+-]\d{2}:?\d{2}$|Z$/i.test(value) ? value : value + "Z"
  const date = new Date(normalized)
  if (isNaN(date.getTime())) {
    throw new InvalidDateError({ field, value, rowId })
  }
  return date
}
