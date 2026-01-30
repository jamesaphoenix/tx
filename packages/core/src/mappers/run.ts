/**
 * Run mappers - convert database rows to domain objects
 */

import { createHash } from "crypto"
import type {
  Run,
  RunId,
  RunStatus,
  RunRow
} from "@tx/types"

// Re-export constants from @tx/types for convenience
export { RUN_STATUSES } from "@tx/types"

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
 * Safely parse JSON with fallback to empty object.
 */
const safeParseMetadata = (json: string | null | undefined): Record<string, unknown> => {
  try {
    return JSON.parse(json || "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Convert a database row to a Run domain object.
 */
export const rowToRun = (row: RunRow): Run => ({
  id: row.id as RunId,
  taskId: row.task_id,
  agent: row.agent,
  startedAt: new Date(row.started_at),
  endedAt: row.ended_at ? new Date(row.ended_at) : null,
  status: row.status as RunStatus,
  exitCode: row.exit_code,
  pid: row.pid,
  transcriptPath: row.transcript_path,
  contextInjected: row.context_injected,
  summary: row.summary,
  errorMessage: row.error_message,
  metadata: safeParseMetadata(row.metadata)
})

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
  contextInjected: run.contextInjected,
  summary: run.summary,
  errorMessage: run.errorMessage,
  metadata: run.metadata
})
