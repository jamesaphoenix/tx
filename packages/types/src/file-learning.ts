/**
 * File learning types for tx
 *
 * Type definitions for path-based knowledge storage.
 * Zero runtime dependencies - pure TypeScript types only.
 */

/**
 * Branded type for file learning IDs.
 */
export type FileLearningId = number & { readonly _brand: unique symbol };

/**
 * File learning entity - a note associated with a file pattern.
 */
export interface FileLearning {
  readonly id: FileLearningId;
  readonly filePattern: string;
  readonly note: string;
  readonly taskId: string | null;
  readonly createdAt: Date;
}

/**
 * Input for creating a new file learning.
 */
export interface CreateFileLearningInput {
  readonly filePattern: string;
  readonly note: string;
  readonly taskId?: string | null;
}

/**
 * Database row type for file learnings (snake_case from SQLite).
 */
export interface FileLearningRow {
  id: number;
  file_pattern: string;
  note: string;
  task_id: string | null;
  created_at: string;
}
