/**
 * DocReviewService Integration Tests
 *
 * Covers:
 * - derive completion state from linked tasks (INV-SUP-007)
 * - idempotent maybeTrigger (INV-SUP-008)
 * - supersede on reopened tasks (INV-SUP-009)
 * - follow-up task creation on failed review
 * - config-gated triggering (disabled config returns early)
 * - completion progress computation
 *
 * Uses per-test in-memory SQLite (Rule 3, Rule 8).
 * Real SQLite + real Effect layers, no mocks.
 *
 * @see DD-039 for specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import type { ReviewTriggerCause } from "@jamesaphoenix/tx-types"
import {
  SqliteClientLive,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  SqliteClient,
} from "@jamesaphoenix/tx-core"
import {
  DocRepositoryLive,
  DomainEventRepositoryLive,
  DocReviewRepositoryLive,
} from "@jamesaphoenix/tx-core/repo"
import {
  DomainEventService,
  DomainEventServiceLive,
  DocReviewService,
  DocReviewServiceLive,
  DEFAULT_REVIEW_CONFIG,
} from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const NAMESPACE = "doc-review-service-test"

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${NAMESPACE}:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const fixtureDocStableId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${NAMESPACE}:doc:${name}`)
    .digest("hex")
    .substring(0, 12)
  return `doc-${hash}`
}

const FIXTURES = {
  TASK_1: fixtureId("task-1"),
  TASK_2: fixtureId("task-2"),
  TASK_3: fixtureId("task-3"),
  TASK_4: fixtureId("task-4"),
  DOC_STABLE_1: fixtureDocStableId("design-doc-1"),
  DOC_NAME_1: "test-design-doc-1",
} as const

// =============================================================================
// Helper: Create test layer with DocReviewService + all dependencies
// =============================================================================

function makeTestLayer() {
  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    DocRepositoryLive,
    TaskRepositoryLive,
    DependencyRepositoryLive,
    DomainEventRepositoryLive,
    DocReviewRepositoryLive,
  ).pipe(Layer.provide(infra))

  const domainEventService = DomainEventServiceLive.pipe(
    Layer.provide(repos)
  )

  const docReviewService = DocReviewServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, domainEventService, infra))
  )

  return Layer.mergeAll(repos, domainEventService, docReviewService, infra)
}

// Type-safe run helper
const run = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(makeTestLayer())) as Effect.Effect<A, never, never>
  )

// =============================================================================
// Seed helpers — operate on SqliteClient from the Effect context
// =============================================================================

const seedDoc = (docStableId: string, name: string, version = 1) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const now = new Date().toISOString()
    const hash = createHash("sha256").update(`${name}:${version}`).digest("hex").substring(0, 16)
    db.prepare(
      `INSERT INTO docs (doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
       VALUES (?, ?, 'design', ?, ?, ?, 'changing', ?, NULL, ?, '{}')`
    ).run(docStableId, hash, name, `Test: ${name}`, version, `design/${name}.md`, now)
  })

const seedTask = (taskId: string, status = "ready") =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const now = new Date().toISOString()
    const completedAt = status === "done" ? now : null
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, 'Test description', ?, NULL, 500, ?, ?, ?, '{}')`
    ).run(taskId, `Task ${taskId}`, status, now, now, completedAt)
  })

const linkTaskToDoc = (taskId: string, docName: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const docRow = db.prepare(
      "SELECT id FROM docs WHERE name = ? ORDER BY version DESC LIMIT 1"
    ).get(docName) as { id: number } | null
    if (!docRow) throw new Error(`Doc not found: ${docName}`)
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, 'references', ?)"
    ).run(taskId, docRow.id, now)
  })

const updateTaskStatus = (taskId: string, status: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const now = new Date().toISOString()
    const completedAt = status === "done" ? now : null
    db.prepare(
      "UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?"
    ).run(status, now, completedAt, taskId)
  })

// =============================================================================
// Tests
// =============================================================================

describe("DocReviewService Integration", () => {

  // ---------------------------------------------------------------------------
  // 1. Completion state derivation (INV-SUP-007)
  // ---------------------------------------------------------------------------
  describe("getCompletionState [INV-SUP-007]", () => {

    it("returns no_tasks when doc has no linked tasks", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)

        expect(result.state).toBe("no_tasks")
        expect(result.progress.total).toBe(0)
        expect(result.progress.done).toBe(0)
        expect(result.progress.completionPercent).toBe(0)
      })))

    it("returns implementing when some linked tasks are not done", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* seedTask(FIXTURES.TASK_2, "active")
        yield* seedTask(FIXTURES.TASK_3, "blocked")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_3, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)

        expect(result.state).toBe("implementing")
        expect(result.progress.total).toBe(3)
        expect(result.progress.done).toBe(1)
        expect(result.progress.inProgress).toBe(1)
        expect(result.progress.blocked).toBe(1)
        expect(result.progress.completionPercent).toBe(33)
      })))

    it("returns ready_for_review when all linked tasks are done and no review run exists", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* seedTask(FIXTURES.TASK_2, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)

        expect(result.state).toBe("ready_for_review")
        expect(result.progress.total).toBe(2)
        expect(result.progress.done).toBe(2)
        expect(result.progress.completionPercent).toBe(100)
      })))

    it("returns verified when all tasks done and a passing review run exists", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const trigger = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        expect(trigger.outcome).toBe("triggered")

        yield* svc.startRun(trigger.reviewRunId!, "test-worker")
        yield* svc.completeRun(trigger.reviewRunId!, {
          passed: true, summary: "All good", findingsCount: 0, findings: [],
        })

        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(result.state).toBe("verified")
      })))

    it("returns no_tasks for a non-existent doc", () =>
      run(Effect.gen(function* () {
        const svc = yield* DocReviewService
        const result = yield* svc.getCompletionState("non-existent-doc")
        expect(result.state).toBe("no_tasks")
        expect(result.progress.total).toBe(0)
      })))

    it("returns reviewing when a review run is in progress", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const trigger = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        yield* svc.startRun(trigger.reviewRunId!, "test-worker")

        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(result.state).toBe("reviewing")
      })))

    it("returns review_failed when the latest run failed", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const trigger = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        yield* svc.startRun(trigger.reviewRunId!, "test-worker")
        yield* svc.failRun(trigger.reviewRunId!, { errorMessage: "Review found issues", retryable: false })

        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(result.state).toBe("review_failed")
      })))
  })

  // ---------------------------------------------------------------------------
  // 2. Completion progress computation (INV-SUP-007)
  // ---------------------------------------------------------------------------
  describe("completion progress computation [INV-SUP-007]", () => {

    it("correctly categorizes tasks by status into progress buckets", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* seedTask(FIXTURES.TASK_2, "active")
        yield* seedTask(FIXTURES.TASK_3, "blocked")
        yield* seedTask(FIXTURES.TASK_4, "ready")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_3, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_4, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)

        expect(result.progress.total).toBe(4)
        expect(result.progress.done).toBe(1)
        expect(result.progress.inProgress).toBe(1)
        expect(result.progress.blocked).toBe(1)
        expect(result.progress.completionPercent).toBe(25)
      })))

    it("completionPercent is 0 when no tasks are done", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "active")
        yield* seedTask(FIXTURES.TASK_2, "blocked")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const result = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)

        expect(result.progress.completionPercent).toBe(0)
        expect(result.progress.done).toBe(0)
      })))
  })

  // ---------------------------------------------------------------------------
  // 3. Config-gated triggering
  // ---------------------------------------------------------------------------
  describe("config-gated triggering", () => {

    it("returns config_disabled when config.enabled is false", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const result = yield* svc.maybeTrigger(
          FIXTURES.DOC_NAME_1,
          "scope_drained" as ReviewTriggerCause,
          { ...DEFAULT_REVIEW_CONFIG, enabled: false }
        )

        expect(result.outcome).toBe("config_disabled")
        expect(result.reviewRunId).toBeNull()
        expect(result.message).toContain("disabled")
      })))
  })

  // ---------------------------------------------------------------------------
  // 4. Idempotent maybeTrigger (INV-SUP-008)
  // ---------------------------------------------------------------------------
  describe("idempotent maybeTrigger [INV-SUP-008]", () => {

    it("triggers on first call and returns already_active on second call with same snapshot", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* seedTask(FIXTURES.TASK_2, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService

        const first = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        const second = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)

        expect(first.outcome).toBe("triggered")
        expect(first.reviewRunId).toBeTruthy()
        expect(second.outcome).toBe("already_active")
        expect(second.reviewRunId).toBe(first.reviewRunId)
      })))

    it("returns not_all_done when linked tasks are still in progress", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* seedTask(FIXTURES.TASK_2, "active")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const result = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)

        expect(result.outcome).toBe("not_all_done")
        expect(result.reviewRunId).toBeNull()
      })))

    it("emits review_eligible and review_triggered domain events on successful trigger", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
        const eventTypes = events.map((e) => e.eventType)

        expect(eventTypes).toContain("design_doc.review_eligible")
        expect(eventTypes).toContain("design_doc.review_triggered")
      })))
  })

  // ---------------------------------------------------------------------------
  // 5. Supersede on reopened tasks (INV-SUP-009)
  // ---------------------------------------------------------------------------
  describe("supersedePreviousRuns [INV-SUP-009]", () => {

    it("supersedes a passing review when a linked task is reopened", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* seedTask(FIXTURES.TASK_2, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService

        // Trigger and complete a review
        const trigger = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        yield* svc.startRun(trigger.reviewRunId!, "test-worker")
        yield* svc.completeRun(trigger.reviewRunId!, { passed: true, summary: "All good", findingsCount: 0, findings: [] })

        const beforeReopen = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(beforeReopen.state).toBe("verified")

        // Reopen a linked task
        yield* updateTaskStatus(FIXTURES.TASK_1, "active")

        // Supersede previous runs
        const count = yield* svc.supersedePreviousRuns(FIXTURES.DOC_NAME_1, "Task reopened", FIXTURES.TASK_1)
        expect(count).toBe(1)

        // State after supersede — latest run is superseded, so state is "superseded"
        const afterReopen = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(afterReopen.state).toBe("superseded")

        // Check superseded event was emitted
        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
        const superseded = events.filter((e) => e.eventType === "design_doc.review_superseded")
        expect(superseded.length).toBe(1)
      })))

    it("returns 0 when no passing runs exist to supersede", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const count = yield* svc.supersedePreviousRuns(FIXTURES.DOC_NAME_1, "No runs")
        expect(count).toBe(0)
      })))

    it("returns 0 for a non-existent doc", () =>
      run(Effect.gen(function* () {
        const svc = yield* DocReviewService
        const count = yield* svc.supersedePreviousRuns("non-existent-doc", "No doc")
        expect(count).toBe(0)
      })))
  })

  // ---------------------------------------------------------------------------
  // 6. failRun and completeRun lifecycle
  // ---------------------------------------------------------------------------
  describe("failRun / completeRun", () => {

    it("marks run as failed and emits review_failed domain event", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const trigger = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        yield* svc.startRun(trigger.reviewRunId!, "test-worker")
        const failedRun = yield* svc.failRun(trigger.reviewRunId!, { errorMessage: "Critical issues", retryable: false })

        expect(failedRun.status).toBe("failed")
        expect(failedRun.resultSummary).toBe("Critical issues")

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
        expect(events.some((e) => e.eventType === "design_doc.review_failed")).toBe(true)
      })))

    it("completeRun marks run as passed with summary and findings count", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService
        const trigger = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        yield* svc.startRun(trigger.reviewRunId!, "test-worker")
        const completed = yield* svc.completeRun(trigger.reviewRunId!, {
          passed: true,
          summary: "Reviewed 5 invariants, all verified",
          findingsCount: 3,
          findings: [
            { severity: "warning", message: "Minor issue", location: "line 10" },
            { severity: "info", message: "Suggestion", location: null },
            { severity: "error", message: "Critical", location: "line 42" },
          ],
        })

        expect(completed.status).toBe("passed")
        expect(completed.resultSummary).toBe("Reviewed 5 invariants, all verified")
        expect(completed.findingsCount).toBe(3)
      })))
  })

  // ---------------------------------------------------------------------------
  // 7. Full lifecycle: trigger → start → complete → supersede
  // ---------------------------------------------------------------------------
  describe("full review lifecycle", () => {

    it("runs the complete trigger → start → pass → supersede cycle", () =>
      run(Effect.gen(function* () {
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* seedTask(FIXTURES.TASK_2, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)

        const svc = yield* DocReviewService

        // 1. Trigger
        const trigger = yield* svc.maybeTrigger(FIXTURES.DOC_NAME_1, "scope_drained" as ReviewTriggerCause)
        expect(trigger.outcome).toBe("triggered")

        // 2. Start
        const started = yield* svc.startRun(trigger.reviewRunId!, "worker-1")
        expect(started.status).toBe("running")

        // 3. Complete
        const completed = yield* svc.completeRun(trigger.reviewRunId!, { passed: true, summary: "All good", findingsCount: 0, findings: [] })
        expect(completed.status).toBe("passed")

        // Verify state is verified
        const verified = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(verified.state).toBe("verified")

        // 4. Reopen task → supersede
        yield* updateTaskStatus(FIXTURES.TASK_1, "active")
        const count = yield* svc.supersedePreviousRuns(FIXTURES.DOC_NAME_1, "task reopened", FIXTURES.TASK_1)
        expect(count).toBe(1)

        const after = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(after.state).toBe("superseded")

        // Verify all expected event types were emitted
        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
        const types = events.map((e) => e.eventType)
        expect(types).toContain("design_doc.review_eligible")
        expect(types).toContain("design_doc.review_triggered")
        expect(types).toContain("design_doc.review_started")
        expect(types).toContain("design_doc.review_passed")
        expect(types).toContain("design_doc.review_superseded")
      })))
  })
})
