import { createHash } from "crypto"

/** Run ID format: run-<8 hex chars> */
export type RunId = `run-${string}`

/** Run status */
export type RunStatus = "running" | "completed" | "failed" | "timeout" | "cancelled"

/** Generate a run ID from timestamp + random */
export const generateRunId = (): RunId => {
  const hash = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .substring(0, 8)
  return `run-${hash}` as RunId
}

/** A single Claude agent run/session */
export interface Run {
  readonly id: RunId
  readonly taskId: string | null
  readonly agent: string
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly status: RunStatus
  readonly exitCode: number | null
  readonly pid: number | null
  readonly transcriptPath: string | null
  readonly contextInjected: string | null
  readonly summary: string | null
  readonly errorMessage: string | null
  readonly metadata: Record<string, unknown>
}

/** Input for creating a new run */
export interface CreateRunInput {
  readonly taskId?: string
  readonly agent: string
  readonly pid?: number
  readonly transcriptPath?: string
  readonly contextInjected?: string
  readonly metadata?: Record<string, unknown>
}

/** Input for updating a run */
export interface UpdateRunInput {
  readonly status?: RunStatus
  readonly endedAt?: Date
  readonly exitCode?: number
  readonly summary?: string
  readonly errorMessage?: string
  readonly transcriptPath?: string
}

/** Database row representation */
export interface RunRow {
  id: string
  task_id: string | null
  agent: string
  started_at: string
  ended_at: string | null
  status: string
  exit_code: number | null
  pid: number | null
  transcript_path: string | null
  context_injected: string | null
  summary: string | null
  error_message: string | null
  metadata: string
}

/** Convert database row to Run */
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
  metadata: JSON.parse(row.metadata || "{}")
})

/** Serialize Run for JSON output */
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
