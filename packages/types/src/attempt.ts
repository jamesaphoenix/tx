/**
 * Attempt types for tx
 *
 * Type definitions for tracking task approach outcomes.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"
import { TaskIdSchema } from "./task.js"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Valid attempt outcomes.
 */
export const ATTEMPT_OUTCOMES = ["failed", "succeeded"] as const;

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Attempt outcome - whether the approach failed or succeeded. */
export const AttemptOutcomeSchema = Schema.Literal(...ATTEMPT_OUTCOMES)
export type AttemptOutcome = typeof AttemptOutcomeSchema.Type

/** Attempt ID - branded integer. */
export const AttemptIdSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("AttemptId")
)
export type AttemptId = typeof AttemptIdSchema.Type

/** Attempt entity - records a specific approach tried for a task. */
export const AttemptSchema = Schema.Struct({
  id: AttemptIdSchema,
  taskId: TaskIdSchema,
  approach: Schema.String,
  outcome: AttemptOutcomeSchema,
  reason: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf,
})
export type Attempt = typeof AttemptSchema.Type

/** Input for creating a new attempt. */
export const CreateAttemptInputSchema = Schema.Struct({
  taskId: Schema.String,
  approach: Schema.String,
  outcome: AttemptOutcomeSchema,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
})
export type CreateAttemptInput = typeof CreateAttemptInputSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for attempts (snake_case from SQLite). */
export interface AttemptRow {
  id: number;
  task_id: string;
  approach: string;
  outcome: string;
  reason: string | null;
  created_at: string;
}
