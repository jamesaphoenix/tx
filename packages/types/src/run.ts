/**
 * Run types for tx
 *
 * Type definitions for tracking Claude agent runs/sessions.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Valid run statuses.
 */
export const RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "timeout",
  "cancelled",
] as const;

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Run status - current state of an agent run. */
export const RunStatusSchema = Schema.Literal(...RUN_STATUSES)
export type RunStatus = typeof RunStatusSchema.Type

/** Run ID - branded string matching run-<hex chars>. */
export const RunIdSchema = Schema.String.pipe(
  Schema.pattern(/^run-.+$/),
  Schema.brand("RunId")
)
export type RunId = typeof RunIdSchema.Type

/** A single Claude agent run/session. */
export const RunSchema = Schema.Struct({
  id: RunIdSchema,
  taskId: Schema.NullOr(Schema.String),
  agent: Schema.String,
  startedAt: Schema.DateFromSelf,
  endedAt: Schema.NullOr(Schema.DateFromSelf),
  status: RunStatusSchema,
  exitCode: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  pid: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  transcriptPath: Schema.NullOr(Schema.String),
  stderrPath: Schema.NullOr(Schema.String),
  stdoutPath: Schema.NullOr(Schema.String),
  contextInjected: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type Run = typeof RunSchema.Type

/** Input for creating a new run. */
export const CreateRunInputSchema = Schema.Struct({
  taskId: Schema.optional(Schema.String),
  agent: Schema.String,
  pid: Schema.optional(Schema.Number.pipe(Schema.int())),
  transcriptPath: Schema.optional(Schema.String),
  stderrPath: Schema.optional(Schema.String),
  stdoutPath: Schema.optional(Schema.String),
  contextInjected: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type CreateRunInput = typeof CreateRunInputSchema.Type

/** Input for updating an existing run. */
export const UpdateRunInputSchema = Schema.Struct({
  status: Schema.optional(RunStatusSchema),
  endedAt: Schema.optional(Schema.DateFromSelf),
  exitCode: Schema.optional(Schema.Number.pipe(Schema.int())),
  summary: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  transcriptPath: Schema.optional(Schema.String),
  stderrPath: Schema.optional(Schema.String),
  stdoutPath: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type UpdateRunInput = typeof UpdateRunInputSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for runs (snake_case from SQLite). */
export interface RunRow {
  id: string;
  task_id: string | null;
  agent: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  exit_code: number | null;
  pid: number | null;
  transcript_path: string | null;
  stderr_path: string | null;
  stdout_path: string | null;
  context_injected: string | null;
  summary: string | null;
  error_message: string | null;
  metadata: string;
}
