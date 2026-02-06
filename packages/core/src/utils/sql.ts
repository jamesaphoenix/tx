/** Escape LIKE special characters so user input is treated as literal text. */
export const escapeLikePattern = (input: string): string =>
  input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")

/**
 * Default row limit for unbounded SELECT queries (findAll / getAll).
 * Prevents accidental memory blowup when tables grow large.
 * Callers that genuinely need more rows should pass an explicit limit.
 */
export const DEFAULT_QUERY_LIMIT = 1000
