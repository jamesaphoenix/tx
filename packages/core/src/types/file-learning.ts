/**
 * File learning types for tx
 *
 * Type definitions for path-based knowledge storage.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** File learning ID - branded integer. */
export const FileLearningIdSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("FileLearningId")
)
export type FileLearningId = typeof FileLearningIdSchema.Type

/** File learning entity - a note associated with a file pattern. */
export const FileLearningSchema = Schema.Struct({
  id: FileLearningIdSchema,
  filePattern: Schema.String,
  note: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf,
})
export type FileLearning = typeof FileLearningSchema.Type

/** Input for creating a new file learning. */
export const CreateFileLearningInputSchema = Schema.Struct({
  filePattern: Schema.String,
  note: Schema.String,
  taskId: Schema.optional(Schema.NullOr(Schema.String)),
})
export type CreateFileLearningInput = typeof CreateFileLearningInputSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for file learnings (snake_case from SQLite). */
export interface FileLearningRow {
  id: number;
  file_pattern: string;
  note: string;
  task_id: string | null;
  created_at: string;
}
