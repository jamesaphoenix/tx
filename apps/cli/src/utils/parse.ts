/**
 * Shared CLI flag parsing utilities.
 *
 * Centralizes numeric flag validation to prevent parseInt/parseFloat NaN bugs.
 */

export type Flags = Record<string, string | boolean>

/**
 * Get a string flag value from parsed flags, checking multiple names.
 * Returns undefined if no matching flag is found or if the flag is boolean.
 */
export function opt(flags: Flags, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === "string") return v
  }
  return undefined
}

/**
 * Check if a boolean flag is set, checking multiple names.
 */
export function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

/**
 * Parse an optional integer flag from CLI flags.
 *
 * Returns undefined if the flag is not present.
 * Exits with an error if the value is not a valid integer.
 *
 * @example
 * const limit = parseIntOpt(flags, "limit", "limit", "n") ?? 10
 * const score = parseIntOpt(flags, "score", "score", "s")
 */
export function parseIntOpt(
  flags: Flags,
  flagName: string,
  ...names: string[]
): number | undefined {
  const val = opt(flags, ...names)
  if (val === undefined) return undefined
  const parsed = parseInt(val, 10)
  if (Number.isNaN(parsed)) {
    console.error(`Invalid value for --${flagName}: "${val}" is not a valid number`)
    process.exit(1)
  }
  return parsed
}

/**
 * Parse an optional float flag from CLI flags.
 *
 * Returns undefined if the flag is not present.
 * Exits with an error if the value is not a valid number.
 *
 * @example
 * const minScore = parseFloatOpt(flags, "min-score", "min-score") ?? 0.3
 */
export function parseFloatOpt(
  flags: Flags,
  flagName: string,
  ...names: string[]
): number | undefined {
  const val = opt(flags, ...names)
  if (val === undefined) return undefined
  const parsed = parseFloat(val)
  if (Number.isNaN(parsed)) {
    console.error(`Invalid value for --${flagName}: "${val}" is not a valid number`)
    process.exit(1)
  }
  return parsed
}
