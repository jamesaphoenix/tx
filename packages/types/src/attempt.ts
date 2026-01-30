/**
 * Attempt types for tx
 *
 * Type definitions for tracking task approach outcomes.
 * Zero runtime dependencies - pure TypeScript types only.
 */

import type { TaskId } from "./task.js";

/**
 * Valid attempt outcomes.
 */
export const ATTEMPT_OUTCOMES = ["failed", "succeeded"] as const;

/**
 * Attempt outcome - whether the approach failed or succeeded.
 */
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/**
 * Branded type for attempt IDs.
 */
export type AttemptId = number & { readonly _brand: unique symbol };

/**
 * Attempt entity - records a specific approach tried for a task.
 */
export interface Attempt {
  readonly id: AttemptId;
  readonly taskId: TaskId;
  readonly approach: string;
  readonly outcome: AttemptOutcome;
  readonly reason: string | null;
  readonly createdAt: Date;
}

/**
 * Input for creating a new attempt.
 */
export interface CreateAttemptInput {
  readonly taskId: string;
  readonly approach: string;
  readonly outcome: AttemptOutcome;
  readonly reason?: string | null;
}

/**
 * Database row type for attempts (snake_case from SQLite).
 */
export interface AttemptRow {
  id: number;
  task_id: string;
  approach: string;
  outcome: string;
  reason: string | null;
  created_at: string;
}
