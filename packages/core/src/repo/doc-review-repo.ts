/**
 * DocReviewRepository — database operations for design-doc review runs.
 *
 * Manages the doc_review_runs table for config-gated review triggers.
 * Tracks review lifecycle: pending → running → passed/failed/cancelled/superseded.
 * See DD-039 for specification.
 */
import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToDocReviewRun } from "../mappers/doc-review.js"
import type {
  DocReviewRun,
  DocReviewRunRow,
  DocReviewRunStatus,
} from "../types/index.js"

// =============================================================================
// TYPES
// =============================================================================

export type DocReviewRunInsertInput = {
  readonly id: string
  readonly docRowId: number
  readonly docId: string
  readonly docVersion: number
  readonly taskSnapshotHash: string
  readonly status: DocReviewRunStatus
  readonly runtime: string
  readonly transport: string
  readonly templateName: string
  readonly triggeredByEventId?: string | null
  readonly workerId?: string | null
  readonly startedAt?: string | null
  readonly endedAt?: string | null
  readonly resultSummary?: string | null
  readonly findingsCount?: number
  readonly metadata?: Record<string, unknown>
}

// =============================================================================
// SERVICE
// =============================================================================

export type DocReviewRepositoryService = {
  readonly insertRun: (input: DocReviewRunInsertInput) => Effect.Effect<DocReviewRun, DatabaseError>
  readonly claimPending: (workerId: string) => Effect.Effect<DocReviewRun | null, DatabaseError>
  readonly updateRunStatus: (
    id: string,
    status: DocReviewRunStatus,
    fields?: {
      readonly endedAt?: string | null
      readonly resultSummary?: string | null
      readonly findingsCount?: number
    },
  ) => Effect.Effect<void, DatabaseError>
  readonly getRunById: (id: string) => Effect.Effect<DocReviewRun | null, DatabaseError>
  readonly getLatestRunForDocVersion: (
    docId: string,
    docVersion: number,
  ) => Effect.Effect<DocReviewRun | null, DatabaseError>
  readonly getActiveRunForSnapshot: (
    docId: string,
    docVersion: number,
    taskSnapshotHash: string,
  ) => Effect.Effect<DocReviewRun | null, DatabaseError>
}

export class DocReviewRepository extends Context.Tag("DocReviewRepository")<
  DocReviewRepository,
  DocReviewRepositoryService
>() {}

export const DocReviewRepositoryLive = Layer.effect(
  DocReviewRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insertRun: (input: DocReviewRunInsertInput) =>
        Effect.try({
          try: () => {
            db.prepare(
              `INSERT INTO doc_review_runs
               (id, doc_row_id, doc_id, doc_version, task_snapshot_hash,
                status, runtime, transport, template_name,
                triggered_by_event_id, worker_id, started_at, ended_at,
                result_summary, findings_count, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              input.id,
              input.docRowId,
              input.docId,
              input.docVersion,
              input.taskSnapshotHash,
              input.status,
              input.runtime,
              input.transport,
              input.templateName,
              input.triggeredByEventId ?? null,
              input.workerId ?? null,
              input.startedAt ?? null,
              input.endedAt ?? null,
              input.resultSummary ?? null,
              input.findingsCount ?? 0,
              JSON.stringify(input.metadata ?? {}),
            )
            const row = db
              .prepare<DocReviewRunRow>(
                "SELECT * FROM doc_review_runs WHERE id = ?"
              )
              .get(input.id)
            if (!row) {
              throw new EntityFetchError({
                entity: "doc_review_run",
                id: input.id,
                operation: "insert",
              })
            }
            return rowToDocReviewRun(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      claimPending: (workerId: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocReviewRunRow>(
                `SELECT * FROM doc_review_runs
                 WHERE status = 'pending'
                 ORDER BY started_at ASC, id ASC
                 LIMIT 1`
              )
              .get()
            if (!row) return null

            const claimResult = db.prepare(
              `UPDATE doc_review_runs
               SET worker_id = ?, status = 'running', started_at = datetime('now')
               WHERE id = ? AND status = 'pending'`
            ).run(workerId, row.id)

            // If the guarded UPDATE changed no rows, another worker claimed this
            // run between our SELECT and UPDATE. Return null rather than handing
            // back a row we do not own — otherwise two workers would both believe
            // they own the run and execute the same review concurrently.
            if (claimResult.changes === 0) return null

            const updated = db
              .prepare<DocReviewRunRow>(
                "SELECT * FROM doc_review_runs WHERE id = ?"
              )
              .get(row.id)
            if (!updated) return null
            return rowToDocReviewRun(updated)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      updateRunStatus: (
        id: string,
        status: DocReviewRunStatus,
        fields?: {
          readonly endedAt?: string | null
          readonly resultSummary?: string | null
          readonly findingsCount?: number
        },
      ) =>
        Effect.try({
          try: () => {
            const sets: string[] = ["status = ?"]
            const params: unknown[] = [status]

            if (fields?.endedAt !== undefined) {
              sets.push("ended_at = ?")
              params.push(fields.endedAt)
            }
            if (fields?.resultSummary !== undefined) {
              sets.push("result_summary = ?")
              params.push(fields.resultSummary)
            }
            if (fields?.findingsCount !== undefined) {
              sets.push("findings_count = ?")
              params.push(fields.findingsCount)
            }

            params.push(id)
            db.prepare(
              `UPDATE doc_review_runs SET ${sets.join(", ")} WHERE id = ?`
            ).run(...params)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getRunById: (id: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocReviewRunRow>(
                "SELECT * FROM doc_review_runs WHERE id = ?"
              )
              .get(id)
            return row ? rowToDocReviewRun(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getLatestRunForDocVersion: (docId: string, docVersion: number) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocReviewRunRow>(
                `SELECT * FROM doc_review_runs
                 WHERE doc_id = ? AND doc_version = ?
                 ORDER BY ended_at DESC, id DESC
                 LIMIT 1`
              )
              .get(docId, docVersion)
            return row ? rowToDocReviewRun(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getActiveRunForSnapshot: (
        docId: string,
        docVersion: number,
        taskSnapshotHash: string,
      ) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocReviewRunRow>(
                `SELECT * FROM doc_review_runs
                 WHERE doc_id = ? AND doc_version = ? AND task_snapshot_hash = ?
                   AND status IN ('pending', 'running')
                 LIMIT 1`
              )
              .get(docId, docVersion, taskSnapshotHash)
            return row ? rowToDocReviewRun(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
    }
  })
)
