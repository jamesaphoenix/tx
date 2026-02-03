/**
 * Run types for tx
 *
 * Type definitions for tracking Claude agent runs/sessions.
 * Zero runtime dependencies - pure TypeScript types only.
 */

/**
 * Run ID format: run-<8 hex chars>
 */
export type RunId = `run-${string}`;

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

/**
 * Run status - current state of an agent run.
 */
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * A single Claude agent run/session.
 */
export interface Run {
  readonly id: RunId;
  readonly taskId: string | null;
  readonly agent: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly status: RunStatus;
  readonly exitCode: number | null;
  readonly pid: number | null;
  readonly transcriptPath: string | null;
  readonly stderrPath: string | null;
  readonly stdoutPath: string | null;
  readonly contextInjected: string | null;
  readonly summary: string | null;
  readonly errorMessage: string | null;
  readonly metadata: Record<string, unknown>;
}

/**
 * Input for creating a new run.
 */
export interface CreateRunInput {
  readonly taskId?: string;
  readonly agent: string;
  readonly pid?: number;
  readonly transcriptPath?: string;
  readonly stderrPath?: string;
  readonly stdoutPath?: string;
  readonly contextInjected?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Input for updating an existing run.
 */
export interface UpdateRunInput {
  readonly status?: RunStatus;
  readonly endedAt?: Date;
  readonly exitCode?: number;
  readonly summary?: string;
  readonly errorMessage?: string;
  readonly transcriptPath?: string;
  readonly stderrPath?: string;
  readonly stdoutPath?: string;
}

/**
 * Database row type for runs (snake_case from SQLite).
 */
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
