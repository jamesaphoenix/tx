/**
 * Decision mapper — converts DB rows to domain objects.
 */
import type { DecisionRow, Decision, DecisionStatus, DecisionSource } from "@jamesaphoenix/tx-types"
import { DECISION_STATUSES, DECISION_SOURCES } from "@jamesaphoenix/tx-types"
import { coerceDbResult } from "../utils/db-result.js"

const validStatuses: readonly string[] = DECISION_STATUSES
const validSources: readonly string[] = DECISION_SOURCES

export const isValidDecisionStatus = (s: string): s is DecisionStatus =>
  validStatuses.includes(s)

export const isValidDecisionSource = (s: string): s is DecisionSource =>
  validSources.includes(s)

export const rowToDecision = (row: DecisionRow): Decision => {
  const status = isValidDecisionStatus(row.status) ? row.status : "pending"
  const source = isValidDecisionSource(row.source) ? row.source : "manual"

  return {
    id: coerceDbResult<Decision["id"]>(row.id),
    content: row.content,
    question: row.question,
    status,
    source,
    commitSha: row.commit_sha,
    runId: row.run_id,
    taskId: row.task_id,
    docId: row.doc_id,
    invariantId: row.invariant_id,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note,
    editedContent: row.edited_content,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    contentHash: row.content_hash,
    supersededBy: row.superseded_by,
    syncedToDoc: row.synced_to_doc === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}
