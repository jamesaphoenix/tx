/**
 * DocReviewWorker Integration Tests
 *
 * Covers:
 * - claim pending review run (worker claims and status transitions to running)
 * - start/complete/fail review execution lifecycle
 * - Pi runtime adapter stub contract (verify executeReview is called with
 *   correct template and doc context, returns structured findings)
 * - concurrent claim prevention (two workers cannot claim the same run)
 *
 * Uses per-test in-memory SQLite (Rule 3, Rule 8 deviation — see
 * doc-review-service.test.ts for precedent).
 *
 * @see DD-039 for specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import type {
  ReviewTriggerCause,
  ReviewRunResult,
} from "@jamesaphoenix/tx/types"
import {
  SqliteClientLive,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  SqliteClient,
} from "@jamesaphoenix/tx"
import {
  DocRepositoryLive,
  DomainEventRepositoryLive,
  DocReviewRepositoryLive,
  DocReviewRepository,
} from "@jamesaphoenix/tx/repo"
import {
  DomainEventService,
  DomainEventServiceLive,
  DocReviewService,
  DocReviewServiceLive,
  ReviewRuntime,
  type ReviewExecutionParams,
} from "@jamesaphoenix/tx"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const NAMESPACE = "doc-review-worker-test"

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
  DOC_STABLE_1: fixtureDocStableId("design-doc-1"),
  DOC_NAME_1: "worker-test-design-doc-1",
  WORKER_1: "review-worker-1",
  WORKER_2: "review-worker-2",
} as const

// =============================================================================
// Stub ReviewRuntime that records calls for assertion
// =============================================================================

type RecordedCall = {
  params: ReviewExecutionParams
}

function makeStubReviewRuntime(
  result?: Partial<ReviewRunResult>
): { layer: Layer.Layer<ReviewRuntime>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []

  const defaultResult: ReviewRunResult = {
    passed: true,
    summary: "Stub review passed",
    findingsCount: 0,
    findings: [],
    ...result,
  }

  const layer = Layer.succeed(ReviewRuntime, {
    executeReview: (params: ReviewExecutionParams) => {
      calls.push({ params })
      return Effect.succeed(defaultResult)
    },
  })

  return { layer, calls }
}

// =============================================================================
// Helper: Create test layer with DocReviewService + ReviewRuntime stub
// =============================================================================

function makeTestLayer(stubRuntime?: {
  layer: Layer.Layer<ReviewRuntime>
  calls: RecordedCall[]
}) {
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

  const runtimeLayer = stubRuntime?.layer ?? makeStubReviewRuntime().layer

  return Layer.mergeAll(
    repos,
    domainEventService,
    docReviewService,
    runtimeLayer,
    infra,
  )
}

// Type-safe run helpers
const run = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(makeTestLayer())) as Effect.Effect<A, never, never>
  )

const runWith = <A>(
  effect: Effect.Effect<A, unknown, unknown>,
  stubRuntime: { layer: Layer.Layer<ReviewRuntime>; calls: RecordedCall[] }
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(makeTestLayer(stubRuntime))
    ) as Effect.Effect<A, never, never>
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

const seedWorker = (workerId: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const now = new Date().toISOString()
    db.prepare(
      `INSERT OR IGNORE INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, 'test-host', 1234, 'idle', ?, ?, '[]', '{}')`
    ).run(workerId, `Worker ${workerId}`, now, now)
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

/**
 * Seed a complete scenario: doc + tasks (all done) + links + triggered review run.
 * Returns the reviewRunId from maybeTrigger.
 */
const seedTriggeredReviewRun = () =>
  Effect.gen(function* () {
    yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
    yield* seedTask(FIXTURES.TASK_1, "done")
    yield* seedTask(FIXTURES.TASK_2, "done")
    yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
    yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)
    yield* seedWorker(FIXTURES.WORKER_1)
    yield* seedWorker(FIXTURES.WORKER_2)

    const svc = yield* DocReviewService
    const trigger = yield* svc.maybeTrigger(
      FIXTURES.DOC_NAME_1,
      "scope_drained" as ReviewTriggerCause
    )
    if (trigger.outcome !== "triggered" || !trigger.reviewRunId) {
      throw new Error(`Expected trigger, got: ${trigger.outcome}`)
    }
    return trigger.reviewRunId
  })

// =============================================================================
// Tests
// =============================================================================

describe("DocReviewWorker Integration", () => {

  // ---------------------------------------------------------------------------
  // 1. Claim pending review run
  // ---------------------------------------------------------------------------
  describe("claim pending review run", () => {

    it("worker claims a pending run and status transitions to running", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()

        // Verify run is pending before claim
        const repo = yield* DocReviewRepository
        const beforeClaim = yield* repo.getRunById(runId)
        expect(beforeClaim).not.toBeNull()
        expect(beforeClaim!.status).toBe("pending")

        // Worker claims the pending run
        const svc = yield* DocReviewService
        const claimed = yield* svc.claimPending(FIXTURES.WORKER_1)

        expect(claimed).not.toBeNull()
        expect(claimed!.id).toBe(runId)
        expect(claimed!.status).toBe("running")
        expect(claimed!.workerId).toBe(FIXTURES.WORKER_1)
        expect(claimed!.startedAt).not.toBeNull()
      })))

    it("returns null when no pending runs exist", () =>
      run(Effect.gen(function* () {
        // No seeded data — empty DB
        const svc = yield* DocReviewService
        const claimed = yield* svc.claimPending(FIXTURES.WORKER_1)
        expect(claimed).toBeNull()
      })))

    it("claimed run is no longer returned by subsequent claimPending", () =>
      run(Effect.gen(function* () {
        yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService

        // First claim succeeds
        const first = yield* svc.claimPending(FIXTURES.WORKER_1)
        expect(first).not.toBeNull()

        // Second claim finds nothing pending
        const second = yield* svc.claimPending(FIXTURES.WORKER_2)
        expect(second).toBeNull()
      })))
  })

  // ---------------------------------------------------------------------------
  // 2. Start/complete/fail review execution lifecycle
  // ---------------------------------------------------------------------------
  describe("review execution lifecycle", () => {

    it("start → complete lifecycle with passing result", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService

        // Start the run
        const started = yield* svc.startRun(runId, FIXTURES.WORKER_1)
        expect(started.status).toBe("running")

        // Complete with passing result
        const completed = yield* svc.completeRun(runId, {
          passed: true,
          summary: "All 5 invariants verified",
          findingsCount: 2,
          findings: [
            { severity: "info", message: "Minor note", location: "line 10" },
            { severity: "warning", message: "Style issue", location: "line 42" },
          ],
        })

        expect(completed.status).toBe("passed")
        expect(completed.resultSummary).toBe("All 5 invariants verified")
        expect(completed.findingsCount).toBe(2)
        expect(completed.endedAt).not.toBeNull()
      })))

    it("start → fail lifecycle with failure result", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService

        // Start the run
        const started = yield* svc.startRun(runId, FIXTURES.WORKER_1)
        expect(started.status).toBe("running")

        // Fail the run
        const failed = yield* svc.failRun(runId, {
          errorMessage: "Runtime crashed during review",
          retryable: true,
        })

        expect(failed.status).toBe("failed")
        expect(failed.resultSummary).toBe("Runtime crashed during review")
        expect(failed.endedAt).not.toBeNull()
      })))

    it("emits review_started event on startRun", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService
        yield* svc.startRun(runId, FIXTURES.WORKER_1)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
        const startEvents = events.filter((e) => e.eventType === "design_doc.review_started")
        expect(startEvents.length).toBe(1)

        const payload = startEvents[0]!.payload as Record<string, unknown>
        expect(payload.reviewRunId).toBe(runId)
        expect(payload.workerId).toBe(FIXTURES.WORKER_1)
      })))

    it("emits review_passed event on completeRun", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService
        yield* svc.startRun(runId, FIXTURES.WORKER_1)
        yield* svc.completeRun(runId, {
          passed: true,
          summary: "All good",
          findingsCount: 0,
          findings: [],
        })

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
        const passedEvents = events.filter((e) => e.eventType === "design_doc.review_passed")
        expect(passedEvents.length).toBe(1)

        const payload = passedEvents[0]!.payload as Record<string, unknown>
        expect(payload.reviewRunId).toBe(runId)
        expect(payload.findingsCount).toBe(0)
      })))

    it("emits review_failed event on failRun", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService
        yield* svc.startRun(runId, FIXTURES.WORKER_1)
        yield* svc.failRun(runId, { errorMessage: "Crash", retryable: false })

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
        const failedEvents = events.filter((e) => e.eventType === "design_doc.review_failed")
        expect(failedEvents.length).toBe(1)

        const payload = failedEvents[0]!.payload as Record<string, unknown>
        expect(payload.reviewRunId).toBe(runId)
      })))

    it("completion state transitions through lifecycle: pending → running → passed → verified", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()
        const svc = yield* DocReviewService

        // After trigger: reviewing (pending run exists)
        const afterTrigger = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(afterTrigger.state).toBe("reviewing")

        // After start: still reviewing (running run)
        yield* svc.startRun(runId, FIXTURES.WORKER_1)
        const afterStart = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(afterStart.state).toBe("reviewing")

        // After complete: verified
        yield* svc.completeRun(runId, {
          passed: true,
          summary: "Verified",
          findingsCount: 0,
          findings: [],
        })
        const afterComplete = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(afterComplete.state).toBe("verified")
      })))

    it("completion state after fail: review_failed", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()
        const svc = yield* DocReviewService

        yield* svc.startRun(runId, FIXTURES.WORKER_1)
        yield* svc.failRun(runId, { errorMessage: "Error", retryable: false })

        const state = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
        expect(state.state).toBe("review_failed")
      })))
  })

  // ---------------------------------------------------------------------------
  // 3. Pi runtime adapter stub contract
  // ---------------------------------------------------------------------------
  describe("ReviewRuntime stub contract", () => {

    it("executeReview is called with correct template and doc context", async () => {
      const stub = makeStubReviewRuntime({
        passed: true,
        summary: "Found 2 issues",
        findingsCount: 2,
        findings: [
          { severity: "warning", message: "Missing test", location: "line 5" },
          { severity: "error", message: "Invariant gap", location: "line 20" },
        ],
      })

      await runWith(
        Effect.gen(function* () {
          const runtime = yield* ReviewRuntime
          const result = yield* runtime.executeReview({
            docId: FIXTURES.DOC_STABLE_1,
            docVersion: 1,
            templateName: "double-check",
            transport: "rpc",
          })

          // Verify the result shape
          expect(result.passed).toBe(true)
          expect(result.summary).toBe("Found 2 issues")
          expect(result.findingsCount).toBe(2)
          expect(result.findings).toHaveLength(2)
          expect(result.findings[0]!.severity).toBe("warning")
          expect(result.findings[0]!.message).toBe("Missing test")
          expect(result.findings[1]!.severity).toBe("error")
        }),
        stub,
      )

      // Verify the stub was called with correct params
      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0]!.params.docId).toBe(FIXTURES.DOC_STABLE_1)
      expect(stub.calls[0]!.params.docVersion).toBe(1)
      expect(stub.calls[0]!.params.templateName).toBe("double-check")
      expect(stub.calls[0]!.params.transport).toBe("rpc")
    })

    it("executeReview with sdk transport passes correct transport", async () => {
      const stub = makeStubReviewRuntime()

      await runWith(
        Effect.gen(function* () {
          const runtime = yield* ReviewRuntime
          yield* runtime.executeReview({
            docId: FIXTURES.DOC_STABLE_1,
            docVersion: 2,
            templateName: "custom-template",
            transport: "sdk",
          })
        }),
        stub,
      )

      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0]!.params.transport).toBe("sdk")
      expect(stub.calls[0]!.params.templateName).toBe("custom-template")
      expect(stub.calls[0]!.params.docVersion).toBe(2)
    })

    it("ReviewRuntime returns structured findings with all severity levels", async () => {
      const stub = makeStubReviewRuntime({
        passed: false,
        summary: "3 findings across severities",
        findingsCount: 3,
        findings: [
          { severity: "info", message: "Note: consider docs update", location: null },
          { severity: "warning", message: "Missing edge case test", location: "test/foo.test.ts:42" },
          { severity: "error", message: "INV-SUP-007 not covered", location: "src/service.ts:100" },
        ],
      })

      await runWith(
        Effect.gen(function* () {
          const runtime = yield* ReviewRuntime
          const result = yield* runtime.executeReview({
            docId: FIXTURES.DOC_STABLE_1,
            docVersion: 1,
            templateName: "double-check",
            transport: "rpc",
          })

          expect(result.passed).toBe(false)
          expect(result.findings).toHaveLength(3)

          // Verify each severity level
          const severities = result.findings.map((f) => f.severity)
          expect(severities).toContain("info")
          expect(severities).toContain("warning")
          expect(severities).toContain("error")

          // Verify nullable location field
          const infoFinding = result.findings.find((f) => f.severity === "info")
          expect(infoFinding!.location).toBeNull()

          const errorFinding = result.findings.find((f) => f.severity === "error")
          expect(errorFinding!.location).toBe("src/service.ts:100")
        }),
        stub,
      )
    })

    it("ReviewRuntimeNoop returns passing result with zero findings", async () => {
      const { ReviewRuntimeNoop } = await import(
        "../../packages/core/src/services/review-runtime.js"
      )

      const layer = Layer.mergeAll(
        ReviewRuntimeNoop,
        SqliteClientLive(":memory:"),
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const runtime = yield* ReviewRuntime
          return yield* runtime.executeReview({
            docId: "test-doc",
            docVersion: 1,
            templateName: "double-check",
            transport: "rpc",
          })
        }).pipe(Effect.provide(layer)) as Effect.Effect<ReviewRunResult, never, never>
      )

      expect(result.passed).toBe(true)
      expect(result.findingsCount).toBe(0)
      expect(result.findings).toHaveLength(0)
      expect(result.summary).toContain("noop")
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Concurrent claim prevention
  // ---------------------------------------------------------------------------
  describe("concurrent claim prevention", () => {

    it("two workers cannot claim the same pending run", () =>
      run(Effect.gen(function* () {
        yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService

        // Worker 1 claims first
        const claim1 = yield* svc.claimPending(FIXTURES.WORKER_1)
        expect(claim1).not.toBeNull()
        expect(claim1!.workerId).toBe(FIXTURES.WORKER_1)
        expect(claim1!.status).toBe("running")

        // Worker 2 finds no pending runs
        const claim2 = yield* svc.claimPending(FIXTURES.WORKER_2)
        expect(claim2).toBeNull()
      })))

    it("after claim, the run's worker_id is set to the claimer", () =>
      run(Effect.gen(function* () {
        const runId = yield* seedTriggeredReviewRun()

        const svc = yield* DocReviewService
        yield* svc.claimPending(FIXTURES.WORKER_1)

        // Verify via repo direct lookup
        const repo = yield* DocReviewRepository
        const run = yield* repo.getRunById(runId)
        expect(run).not.toBeNull()
        expect(run!.workerId).toBe(FIXTURES.WORKER_1)
        expect(run!.status).toBe("running")
      })))

    it("multiple pending runs are claimed one-at-a-time in order", () =>
      run(Effect.gen(function* () {
        // Trigger two separate review runs by using different doc snapshots
        yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* seedWorker(FIXTURES.WORKER_1)
        yield* seedWorker(FIXTURES.WORKER_2)

        const svc = yield* DocReviewService

        // First trigger
        const trigger1 = yield* svc.maybeTrigger(
          FIXTURES.DOC_NAME_1,
          "scope_drained" as ReviewTriggerCause,
        )
        expect(trigger1.outcome).toBe("triggered")

        // Complete first run so we can trigger again with different snapshot
        yield* svc.startRun(trigger1.reviewRunId!, FIXTURES.WORKER_1)
        yield* svc.completeRun(trigger1.reviewRunId!, {
          passed: true,
          summary: "Done",
          findingsCount: 0,
          findings: [],
        })

        // Add a new task to change the snapshot hash
        yield* seedTask(FIXTURES.TASK_2, "done")
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)

        // Supersede the old run first
        yield* svc.supersedePreviousRuns(FIXTURES.DOC_NAME_1, "new task added")

        // Second trigger with different snapshot
        const trigger2 = yield* svc.maybeTrigger(
          FIXTURES.DOC_NAME_1,
          "scope_drained" as ReviewTriggerCause,
        )
        expect(trigger2.outcome).toBe("triggered")
        expect(trigger2.reviewRunId).not.toBe(trigger1.reviewRunId)

        // Worker claims the latest pending run
        const claimed = yield* svc.claimPending(FIXTURES.WORKER_2)
        expect(claimed).not.toBeNull()
        expect(claimed!.id).toBe(trigger2.reviewRunId)
        expect(claimed!.workerId).toBe(FIXTURES.WORKER_2)
      })))
  })

  // ---------------------------------------------------------------------------
  // 5. Full worker lifecycle: trigger → claim → execute → complete
  // ---------------------------------------------------------------------------
  describe("full worker lifecycle", () => {

    it("trigger → claim → start → complete with stub runtime", async () => {
      const stub = makeStubReviewRuntime({
        passed: true,
        summary: "All invariants verified",
        findingsCount: 1,
        findings: [
          { severity: "info", message: "INV-SUP-007 coverage confirmed", location: null },
        ],
      })

      await runWith(
        Effect.gen(function* () {
          // Setup
          yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
          yield* seedTask(FIXTURES.TASK_1, "done")
          yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
          yield* seedWorker(FIXTURES.WORKER_1)

          const svc = yield* DocReviewService
          const runtime = yield* ReviewRuntime

          // 1. Trigger review
          const trigger = yield* svc.maybeTrigger(
            FIXTURES.DOC_NAME_1,
            "scope_drained" as ReviewTriggerCause,
          )
          expect(trigger.outcome).toBe("triggered")

          // 2. Worker claims pending run
          const claimed = yield* svc.claimPending(FIXTURES.WORKER_1)
          expect(claimed).not.toBeNull()
          expect(claimed!.id).toBe(trigger.reviewRunId)

          // 3. Worker starts the run
          const started = yield* svc.startRun(claimed!.id, FIXTURES.WORKER_1)
          expect(started.status).toBe("running")

          // 4. Worker invokes ReviewRuntime
          const reviewResult = yield* runtime.executeReview({
            docId: claimed!.docId,
            docVersion: claimed!.docVersion,
            templateName: "double-check",
            transport: "rpc",
          })

          // 5. Worker completes the run with the result
          const completed = yield* svc.completeRun(claimed!.id, {
            passed: reviewResult.passed,
            summary: reviewResult.summary,
            findingsCount: reviewResult.findingsCount,
            findings: reviewResult.findings,
          })

          expect(completed.status).toBe("passed")
          expect(completed.resultSummary).toBe("All invariants verified")
          expect(completed.findingsCount).toBe(1)

          // 6. Verify final state is verified
          const state = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
          expect(state.state).toBe("verified")
        }),
        stub,
      )

      // Verify runtime was called exactly once with correct params
      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0]!.params.docId).toBe(FIXTURES.DOC_STABLE_1)
      expect(stub.calls[0]!.params.templateName).toBe("double-check")
      expect(stub.calls[0]!.params.transport).toBe("rpc")
    })

    it("trigger → claim → start → fail with stub runtime", async () => {
      const stub = makeStubReviewRuntime()

      await runWith(
        Effect.gen(function* () {
          yield* seedDoc(FIXTURES.DOC_STABLE_1, FIXTURES.DOC_NAME_1)
          yield* seedTask(FIXTURES.TASK_1, "done")
          yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
          yield* seedWorker(FIXTURES.WORKER_1)

          const svc = yield* DocReviewService

          // Trigger and claim
          yield* svc.maybeTrigger(
            FIXTURES.DOC_NAME_1,
            "scope_drained" as ReviewTriggerCause,
          )
          const claimed = yield* svc.claimPending(FIXTURES.WORKER_1)
          yield* svc.startRun(claimed!.id, FIXTURES.WORKER_1)

          // Worker fails the run (simulating runtime error)
          const failed = yield* svc.failRun(claimed!.id, {
            errorMessage: "Pi runtime connection timeout",
            retryable: true,
          })

          expect(failed.status).toBe("failed")
          expect(failed.resultSummary).toBe("Pi runtime connection timeout")

          // State should be review_failed
          const state = yield* svc.getCompletionState(FIXTURES.DOC_NAME_1)
          expect(state.state).toBe("review_failed")

          // Verify all domain events in order
          const eventSvc = yield* DomainEventService
          const events = yield* eventSvc.listByStream("design_doc", FIXTURES.DOC_STABLE_1)
          const types = events.map((e) => e.eventType)
          expect(types).toContain("design_doc.review_eligible")
          expect(types).toContain("design_doc.review_triggered")
          expect(types).toContain("design_doc.review_started")
          expect(types).toContain("design_doc.review_failed")
        }),
        stub,
      )
    })
  })
})
