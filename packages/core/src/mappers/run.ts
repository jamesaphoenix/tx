/**
 * Run mappers - convert database rows to domain objects
 */

import { createHash } from "crypto"
import { Schema } from "effect"
import type {
  Run,
  RunId,
  RunStatus,
  RunRow
} from "@jamesaphoenix/tx-types"
import { RUN_STATUSES } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

// Re-export constants from @tx/types for convenience
export { RUN_STATUSES }

/**
 * Schema for metadata - a record of string keys to unknown values.
 */
const MetadataSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

/**
 * Generate a run ID from timestamp + random.
 */
export const generateRunId = (): RunId => {
  const hash = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .substring(0, 8)
  return `run-${hash}` as RunId
}

/**
 * Check if a string is a valid RunStatus.
 */
export const isValidRunStatus = (s: string): s is RunStatus => {
  return (RUN_STATUSES as readonly string[]).includes(s)
}

/**
 * Safely parse and validate metadata JSON string.
 * Returns empty object if parsing fails or validation fails.
 */
const safeParseMetadata = (json: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(json || "{}")
    return Schema.decodeUnknownSync(MetadataSchema)(parsed)
  } catch {
    return {}
  }
}

/**
 * Convert a database row to a Run domain object.
 * Validates status at runtime.
 */
export const rowToRun = (row: RunRow): Run => {
  if (!isValidRunStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "run",
      status: row.status,
      validStatuses: RUN_STATUSES,
      rowId: row.id
    })
  }
  return {
    id: row.id as RunId,
    taskId: row.task_id,
    agent: row.agent,
    startedAt: parseDate(row.started_at, "started_at", row.id),
    endedAt: row.ended_at ? parseDate(row.ended_at, "ended_at", row.id) : null,
    status: row.status,
    exitCode: row.exit_code,
    pid: row.pid,
    transcriptPath: row.transcript_path,
    stderrPath: row.stderr_path,
    stdoutPath: row.stdout_path,
    contextInjected: row.context_injected,
    summary: row.summary,
    errorMessage: row.error_message,
    metadata: safeParseMetadata(row.metadata)
  }
}

/**
 * Serialize Run for JSON output.
 */
export const serializeRun = (run: Run) => ({
  id: run.id,
  taskId: run.taskId,
  agent: run.agent,
  startedAt: run.startedAt.toISOString(),
  endedAt: run.endedAt?.toISOString() ?? null,
  status: run.status,
  exitCode: run.exitCode,
  pid: run.pid,
  transcriptPath: run.transcriptPath,
  stderrPath: run.stderrPath,
  stdoutPath: run.stdoutPath,
  contextInjected: run.contextInjected,
  summary: run.summary,
  errorMessage: run.errorMessage,
  metadata: run.metadata
})
