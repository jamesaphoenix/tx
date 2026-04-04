/**
 * DocReviewService — DD-039
 *
 * Manages design-doc completion state derivation and review run lifecycle.
 * Enforces:
 *   INV-SUP-007 — completion progress derived from linked tasks, not shell output
 *   INV-SUP-008 — at most one active review run per doc version + task snapshot
 *   INV-SUP-009 — reopening/adding linked tasks supersedes previous verified state
 *
 * Uses Effect-TS patterns per DD-002.
 */

import { Context, Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import { DocReviewRepository } from "../repo/doc-review-repo.js"
import {
  DomainEventService,
  type PublishDomainEventInput,
} from "./domain-event-service.js"
import { DocRepository } from "../repo/doc-repo.js"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { generateUlid } from "../utils/ulid.js"
import type {
  DesignDocCompletionState,
  DesignDocProgress,
  DocReviewRun,
  MaybeTriggerResult,
  ReviewTriggerCause,
  ReviewRunResult,
  ReviewFailureResult,
} from "@jamesaphoenix/tx-types"

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for design-doc review triggering.
 * Maps to [reviews.design_docs] config section from DD-039.
 */
export type DocReviewConfig = {
  readonly enabled: boolean
  readonly runtime: "pi" | "custom"
  readonly transport: "rpc" | "sdk"
  readonly template: string
  readonly blocking: boolean
  readonly createFollowupTasks: boolean
  readonly retriggerOnTaskReopen: boolean
}

export const DEFAULT_REVIEW_CONFIG: DocReviewConfig = {
  enabled: true,
  runtime: "pi",
  transport: "rpc",
  template: "double-check",
  blocking: false,
  createFollowupTasks: true,
  retriggerOnTaskReopen: true,
}

/** Completion state result including progress details. */
export type CompletionStateResult = {
  readonly state: DesignDocCompletionState
  readonly progress: DesignDocProgress
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Compute a SHA256 hash of sorted task IDs and statuses.
 * Used to detect whether the task state has changed since the last review.
 */
const computeTaskSnapshotHash = (
  tasks: ReadonlyArray<{ id: string; status: string }>
): string => {
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id))
  const data = sorted.map((t) => `${t.id}:${t.status}`).join("|")
  return createHash("sha256").update(data, "utf8").digest("hex")
}

// =============================================================================
// SERVICE
// =============================================================================

export class DocReviewService extends Context.Tag("DocReviewService")<
  DocReviewService,
  {
    /**
     * Derive the completion state for a design doc from linked tasks and review runs.
     * INV-SUP-007: derived from linked tasks, not shell output.
     */
    readonly getCompletionState: (
      docRef: string
    ) => Effect.Effect<CompletionStateResult, DatabaseError>

    /**
     * Check eligibility and trigger a review run if all conditions are met.
     * INV-SUP-008: at most one active review run per doc version + snapshot.
     */
    readonly maybeTrigger: (
      docRef: string,
      cause: ReviewTriggerCause,
      config?: DocReviewConfig
    ) => Effect.Effect<MaybeTriggerResult, DatabaseError>

    /**
     * Claim a pending review run for a worker.
     * Delegates to DocReviewRepository.claimPending.
     */
    readonly claimPending: (
      workerId: string
    ) => Effect.Effect<DocReviewRun | null, DatabaseError>

    /**
     * Start a review run (update status to running, emit event).
     */
    readonly startRun: (
      runId: string,
      workerId: string
    ) => Effect.Effect<DocReviewRun, DatabaseError>

    /**
     * Complete a review run with a passing result.
     */
    readonly completeRun: (
      runId: string,
      result: ReviewRunResult
    ) => Effect.Effect<DocReviewRun, DatabaseError>

    /**
     * Fail a review run, optionally creating follow-up tasks.
     */
    readonly failRun: (
      runId: string,
      result: ReviewFailureResult,
      _config?: DocReviewConfig
    ) => Effect.Effect<DocReviewRun, DatabaseError>

    /**
     * Supersede previous passing runs when tasks reopen or new tasks are linked.
     * INV-SUP-009: reopening tasks after passing review supersedes verified state.
     */
    readonly supersedePreviousRuns: (
      docRef: string,
      reason: string,
      triggerTaskId?: string | null
    ) => Effect.Effect<number, DatabaseError>
  }
>() {}

export const DocReviewServiceLive = Layer.effect(
  DocReviewService,
  Effect.gen(function* () {
    const reviewRepo = yield* DocReviewRepository
    const eventService = yield* DomainEventService
    const docRepo = yield* DocRepository
    const db = yield* SqliteClient

    // -------------------------------------------------------------------------
    // Internal: query linked tasks for a doc (by integer row id)
    // -------------------------------------------------------------------------
    const getLinkedTasks = (docRowId: number) =>
      Effect.try({
        try: () =>
          db
            .prepare<{ id: string; status: string }>(
              `SELECT t.id, t.status
               FROM tasks t
               JOIN task_doc_links tdl ON tdl.task_id = t.id
               WHERE tdl.doc_id = ?
               ORDER BY t.id`
            )
            .all(docRowId),
        catch: (cause) => new DatabaseError({ cause }),
      })

    // -------------------------------------------------------------------------
    // Internal: query passing runs for a doc (for supersede)
    // -------------------------------------------------------------------------
    const getPassingRuns = (docId: string) =>
      Effect.try({
        try: () =>
          db
            .prepare<{
              id: string
              doc_row_id: number
              doc_id: string
              doc_version: number
              task_snapshot_hash: string
              status: string
              runtime: string
              transport: string
              template_name: string
              triggered_by_event_id: string | null
              worker_id: string | null
              started_at: string | null
              ended_at: string | null
              result_summary: string | null
              findings_count: number
              metadata: string
            }>(
              `SELECT * FROM doc_review_runs
               WHERE doc_id = ? AND status = 'passed'
               ORDER BY ended_at DESC`
            )
            .all(docId),
        catch: (cause) => new DatabaseError({ cause }),
      })

    // -------------------------------------------------------------------------
    // Internal: publish a domain event via DomainEventService
    // -------------------------------------------------------------------------
    const publishEvent = (input: PublishDomainEventInput) =>
      eventService.publish(input)

    // -------------------------------------------------------------------------
    // Internal: compute progress from linked tasks
    // -------------------------------------------------------------------------
    const computeProgress = (
      tasks: ReadonlyArray<{ id: string; status: string }>
    ): DesignDocProgress => {
      const total = tasks.length
      let done = 0
      let inProgress = 0
      let blocked = 0

      for (const t of tasks) {
        if (t.status === "done") {
          done++
        } else if (t.status === "blocked") {
          blocked++
        } else if (
          t.status === "active" ||
          t.status === "review" ||
          t.status === "needs_review"
        ) {
          inProgress++
        }
        // backlog, ready, planning count toward total but not active buckets
      }

      return {
        total,
        done,
        inProgress,
        blocked,
        completionPercent: total > 0 ? Math.round((done / total) * 100) : 0,
      }
    }

    // -------------------------------------------------------------------------
    // Internal: derive completion state from tasks + latest review run
    // -------------------------------------------------------------------------
    const deriveState = (
      progress: DesignDocProgress,
      latestRun: DocReviewRun | null
    ): DesignDocCompletionState => {
      if (progress.total === 0) return "no_tasks"

      // Check for active review runs
      if (
        latestRun &&
        (latestRun.status === "pending" || latestRun.status === "running")
      ) {
        return "reviewing"
      }

      // Check completed run states
      if (latestRun) {
        if (latestRun.status === "passed") return "verified"
        if (latestRun.status === "superseded") return "superseded"
        if (latestRun.status === "failed") return "review_failed"
      }

      // No run or cancelled run — check task progress
      if (progress.done === progress.total) return "ready_for_review"
      return "implementing"
    }

    return {
      // =======================================================================
      // getCompletionState
      // =======================================================================
      getCompletionState: (docRef: string) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(docRef)
          if (!doc) {
            return {
              state: "no_tasks" as DesignDocCompletionState,
              progress: {
                total: 0,
                done: 0,
                inProgress: 0,
                blocked: 0,
                completionPercent: 0,
              },
            }
          }

          const tasks = yield* getLinkedTasks(doc.id as number)
          const progress = computeProgress(tasks)
          const latestRun = yield* reviewRepo.getLatestRunForDocVersion(
            doc.docId,
            doc.version
          )

          return { state: deriveState(progress, latestRun), progress }
        }),

      // =======================================================================
      // maybeTrigger
      // =======================================================================
      maybeTrigger: (
        docRef: string,
        cause: ReviewTriggerCause,
        config?: DocReviewConfig
      ) =>
        Effect.gen(function* () {
          const cfg = config ?? DEFAULT_REVIEW_CONFIG

          // 1. Config gate
          if (!cfg.enabled) {
            return {
              outcome: "config_disabled" as const,
              reviewRunId: null,
              message: "Review triggering is disabled in config",
            }
          }

          // 2. Find doc
          const doc = yield* docRepo.findByName(docRef)
          if (!doc) {
            return {
              outcome: "config_disabled" as const,
              reviewRunId: null,
              message: `Doc not found: ${docRef}`,
            }
          }

          // 3. Query linked tasks
          const tasks = yield* getLinkedTasks(doc.id as number)
          if (tasks.length === 0) {
            return {
              outcome: "no_linked_tasks" as const,
              reviewRunId: null,
              message: `No tasks linked to doc '${docRef}'`,
            }
          }

          // 4. Check all tasks are done
          const allDone = tasks.every((t) => t.status === "done")
          if (!allDone) {
            const progress = computeProgress(tasks)
            return {
              outcome: "not_all_done" as const,
              reviewRunId: null,
              message: `Not all tasks done: ${progress.done}/${progress.total} completed`,
            }
          }

          // 5. Compute snapshot hash (INV-SUP-008)
          const snapshotHash = computeTaskSnapshotHash(tasks)

          // 6. Check no active run for this version + snapshot
          const activeRun = yield* reviewRepo.getActiveRunForSnapshot(
            doc.docId,
            doc.version,
            snapshotHash
          )
          if (activeRun) {
            return {
              outcome: "already_active" as const,
              reviewRunId: activeRun.id,
              message: `Active review run already exists: ${activeRun.id}`,
            }
          }

          // 7. Emit design_doc.review_eligible
          const eligibleEvent = yield* publishEvent({
            eventType: "design_doc.review_eligible",
            streamType: "design_doc",
            streamId: doc.docId,
            aggregateType: "design_doc",
            aggregateId: doc.docId,
            payload: {
              docId: doc.docId,
              docVersion: doc.version,
              taskSnapshotHash: snapshotHash,
              totalLinkedTasks: tasks.length,
              doneLinkedTasks: tasks.length,
            },
          })

          // 8. Insert review run
          const runId = `drr-${generateUlid()}`
          const run = yield* reviewRepo.insertRun({
            id: runId,
            docRowId: doc.id as number,
            docId: doc.docId,
            docVersion: doc.version,
            taskSnapshotHash: snapshotHash,
            status: "pending",
            runtime: cfg.runtime,
            transport: cfg.transport,
            templateName: cfg.template,
            triggeredByEventId: eligibleEvent.id,
            metadata: { cause },
          })

          // 9. Emit design_doc.review_triggered
          yield* publishEvent({
            eventType: "design_doc.review_triggered",
            streamType: "design_doc",
            streamId: doc.docId,
            aggregateType: "design_doc",
            aggregateId: doc.docId,
            correlationId: eligibleEvent.id,
            payload: {
              docId: doc.docId,
              docVersion: doc.version,
              reviewRunId: run.id,
              taskSnapshotHash: snapshotHash,
              runtime: cfg.runtime,
              transport: cfg.transport,
              templateName: cfg.template,
              cause,
            },
          })

          return {
            outcome: "triggered" as const,
            reviewRunId: run.id,
            message: `Review triggered for '${docRef}' v${doc.version}`,
          }
        }),

      // =======================================================================
      // claimPending
      // =======================================================================
      claimPending: (workerId: string) => reviewRepo.claimPending(workerId),

      // =======================================================================
      // startRun
      // =======================================================================
      startRun: (runId: string, workerId: string) =>
        Effect.gen(function* () {
          yield* reviewRepo.updateRunStatus(runId, "running")

          const run = yield* reviewRepo.getRunById(runId)
          if (!run) {
            return yield* Effect.fail(
              new DatabaseError({
                cause: new Error(`Review run not found after update: ${runId}`),
              })
            )
          }

          yield* publishEvent({
            eventType: "design_doc.review_started",
            streamType: "design_doc",
            streamId: run.docId,
            aggregateType: "design_doc",
            aggregateId: run.docId,
            payload: {
              docId: run.docId,
              docVersion: run.docVersion,
              reviewRunId: run.id,
              workerId,
            },
          })

          return run
        }),

      // =======================================================================
      // completeRun
      // =======================================================================
      completeRun: (runId: string, result: ReviewRunResult) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()

          yield* reviewRepo.updateRunStatus(runId, "passed", {
            endedAt: now,
            resultSummary: result.summary,
            findingsCount: result.findingsCount,
          })

          const run = yield* reviewRepo.getRunById(runId)
          if (!run) {
            return yield* Effect.fail(
              new DatabaseError({
                cause: new Error(`Review run not found after update: ${runId}`),
              })
            )
          }

          yield* publishEvent({
            eventType: "design_doc.review_passed",
            streamType: "design_doc",
            streamId: run.docId,
            aggregateType: "design_doc",
            aggregateId: run.docId,
            payload: {
              docId: run.docId,
              docVersion: run.docVersion,
              reviewRunId: run.id,
              findingsCount: result.findingsCount,
              summary: result.summary,
            },
          })

          return run
        }),

      // =======================================================================
      // failRun
      // =======================================================================
      failRun: (
        runId: string,
        result: ReviewFailureResult,
        _config?: DocReviewConfig
      ) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()

          yield* reviewRepo.updateRunStatus(runId, "failed", {
            endedAt: now,
            resultSummary: result.errorMessage,
          })

          const run = yield* reviewRepo.getRunById(runId)
          if (!run) {
            return yield* Effect.fail(
              new DatabaseError({
                cause: new Error(`Review run not found after update: ${runId}`),
              })
            )
          }

          yield* publishEvent({
            eventType: "design_doc.review_failed",
            streamType: "design_doc",
            streamId: run.docId,
            aggregateType: "design_doc",
            aggregateId: run.docId,
            payload: {
              docId: run.docId,
              docVersion: run.docVersion,
              reviewRunId: run.id,
              findingsCount: 0,
              summary: result.errorMessage,
              followupTaskIds: [],
            },
          })

          return run
        }),

      // =======================================================================
      // supersedePreviousRuns
      // =======================================================================
      supersedePreviousRuns: (
        docRef: string,
        reason: string,
        triggerTaskId?: string | null
      ) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(docRef)
          if (!doc) return 0

          const passingRows = yield* getPassingRuns(doc.docId)
          if (passingRows.length === 0) return 0

          let count = 0
          for (const row of passingRows) {
            yield* reviewRepo.updateRunStatus(row.id, "superseded", {
              endedAt: new Date().toISOString(),
            })

            yield* publishEvent({
              eventType: "design_doc.review_superseded",
              streamType: "design_doc",
              streamId: doc.docId,
              aggregateType: "design_doc",
              aggregateId: doc.docId,
              payload: {
                docId: doc.docId,
                docVersion: row.doc_version,
                reviewRunId: row.id,
                reason,
                supersededByTaskId: triggerTaskId ?? null,
              },
            })

            count++
          }

          return count
        }),
    }
  })
)
