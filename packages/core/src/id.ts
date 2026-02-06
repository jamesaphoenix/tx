import { Effect } from "effect"
import { randomBytes, createHash } from "crypto"

/**
 * Generate a random task ID with 12 hex chars (48 bits of entropy).
 * Birthday paradox: ~50% collision probability at ~16.7M tasks.
 * Previous 8-char (32-bit) version collided at ~65K tasks.
 */
export const generateTaskId = (): Effect.Effect<string> =>
  Effect.sync(() => {
    const random = randomBytes(16).toString("hex")
    const timestamp = Date.now().toString(36)
    const hash = createHash("sha256")
      .update(timestamp + random)
      .digest("hex")
      .substring(0, 12)
    return `tx-${hash}`
  })

/**
 * Check if a database error is a UNIQUE constraint violation.
 * Used for collision retry logic in task creation.
 */
export const isUniqueConstraintError = (cause: unknown): boolean => {
  if (cause instanceof Error) {
    const msg = cause.message
    return msg.includes("UNIQUE constraint failed") || msg.includes("SQLITE_CONSTRAINT_UNIQUE") || msg.includes("SQLITE_CONSTRAINT_PRIMARYKEY")
  }
  return false
}

export const deterministicId = (seed: string): string => {
  const hash = createHash("sha256")
    .update(`fixture:${seed}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

/** Alias for deterministicId - generates SHA256-based fixture IDs for tests */
export const fixtureId = deterministicId
