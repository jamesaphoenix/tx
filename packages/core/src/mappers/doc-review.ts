/**
 * Doc review mappers - convert database rows to domain objects
 */

import {
  DOC_REVIEW_RUN_STATUSES,
  REVIEW_RUNTIMES,
  REVIEW_TRANSPORTS,
  type DocReviewRun,
  type DocReviewRunStatus,
  type ReviewRuntimeType,
  type ReviewTransport,
  type DocReviewRunRow,
} from "../types/index.js"
import { InvalidStatusError } from "../errors.js"

// Local string arrays for .includes() checks
const statusStrings: readonly string[] = DOC_REVIEW_RUN_STATUSES
const runtimeStrings: readonly string[] = REVIEW_RUNTIMES
const transportStrings: readonly string[] = REVIEW_TRANSPORTS

// =============================================================================
// TYPE GUARDS
// =============================================================================

export const isValidDocReviewRunStatus = (s: string): s is DocReviewRunStatus =>
  statusStrings.includes(s)
export const isValidReviewRuntime = (s: string): s is ReviewRuntimeType =>
  runtimeStrings.includes(s)
export const isValidReviewTransport = (s: string): s is ReviewTransport =>
  transportStrings.includes(s)

// =============================================================================
// METADATA PARSING
// =============================================================================

const safeParseMetadata = (json: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(json || "{}")
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = value
      }
      return result
    }
    return {}
  } catch {
    return {}
  }
}

// =============================================================================
// ROW MAPPERS
// =============================================================================

/**
 * Convert a database row to a DocReviewRun domain object.
 * Validates enum fields at runtime.
 */
export const rowToDocReviewRun = (row: DocReviewRunRow): DocReviewRun => {
  if (!isValidDocReviewRunStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "doc_review_run",
      status: row.status,
      validStatuses: [...DOC_REVIEW_RUN_STATUSES],
      rowId: row.id,
    })
  }
  if (!isValidReviewRuntime(row.runtime)) {
    throw new InvalidStatusError({
      entity: "doc_review_run",
      status: row.runtime,
      validStatuses: [...REVIEW_RUNTIMES],
      rowId: row.id,
    })
  }
  if (!isValidReviewTransport(row.transport)) {
    throw new InvalidStatusError({
      entity: "doc_review_run",
      status: row.transport,
      validStatuses: [...REVIEW_TRANSPORTS],
      rowId: row.id,
    })
  }

  return {
    id: row.id,
    docRowId: row.doc_row_id,
    docId: row.doc_id,
    docVersion: row.doc_version,
    taskSnapshotHash: row.task_snapshot_hash,
    status: row.status,
    runtime: row.runtime,
    transport: row.transport,
    templateName: row.template_name,
    triggeredByEventId: row.triggered_by_event_id,
    workerId: row.worker_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    resultSummary: row.result_summary,
    findingsCount: row.findings_count,
    metadata: safeParseMetadata(row.metadata),
  }
}
