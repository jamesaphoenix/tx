/**
 * SupervisionService Integration Tests
 *
 * Covers:
 * - create/list/get session detail (verify joins with workers, tasks, runs, doc progress)
 * - pause/resume state machine validation (reject invalid transitions)
 * - terminal token issuance rules (INV-SUP-004)
 * - claim-preserving pause semantics (INV-SUP-002, INV-SUP-003)
 * - single write controller enforcement (INV-SUP-004)
 * - attach/detach event emission
 *
 * Uses per-test in-memory SQLite (Rule 3, Rule 8 deviation).
 * Real SQLite + real Effect layers, no mocks.
 *
 * @see DD-039 for specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import {
  SqliteClientLive,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  SqliteClient,
} from "@jamesaphoenix/tx-core"
import {
  DomainEventRepositoryLive,
} from "../../packages/core/src/repo/domain-event-repo.js"
import {
  SupervisionRepository,
  SupervisionRepositoryLive,
} from "../../packages/core/src/repo/supervision-repo.js"
import {
  DomainEventService,
  DomainEventServiceLive,
} from "../../packages/core/src/services/domain-event-service.js"
import {
  SupervisionService,
  SupervisionServiceLive,
} from "../../packages/core/src/services/supervision-service.js"
import type { ActorRef } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const NAMESPACE = "supervision-service-test"

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${NAMESPACE}:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const FIXTURES = {
  WORKER_1: fixtureId("worker-1"),
  WORKER_2: fixtureId("worker-2"),
  SESSION_1: fixtureId("session-1"),
  SESSION_2: fixtureId("session-2"),
  TASK_1: fixtureId("task-1"),
  TASK_2: fixtureId("task-2"),
  RUN_1: fixtureId("run-1"),
  DOC_NAME_1: "test-design-doc-supervision",
} as const

const ACTOR_HUMAN: ActorRef = { type: "human", id: "operator-1" }

// =============================================================================
// Helper: Create test layer with SupervisionService + all dependencies
// =============================================================================

function makeTestLayer() {
  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    DomainEventRepositoryLive,
    SupervisionRepositoryLive,
  ).pipe(Layer.provide(infra))

  const domainEventService = DomainEventServiceLive.pipe(
    Layer.provide(repos)
  )

  const supervisionService = SupervisionServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, domainEventService))
  )

  return Layer.mergeAll(repos, domainEventService, supervisionService, infra)
}

// Type-safe run helper
const run = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(makeTestLayer())) as Effect.Effect<A, never, never>
  )

// =============================================================================
// Seed helpers — operate on SqliteClient from the Effect context
// =============================================================================

const NOW = new Date().toISOString()

const seedWorker = (workerId: string, name: string, status = "idle") =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    db.prepare(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, metadata)
       VALUES (?, ?, 'test-host', 12345, ?, ?, ?, '{}')`
    ).run(workerId, name, status, NOW, NOW)
  })

const seedTask = (taskId: string, title: string, status = "active") =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const completedAt = status === "done" ? NOW : null
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, 'Test task description', ?, NULL, 500, ?, ?, ?, '{}')`
    ).run(taskId, title, status, NOW, NOW, completedAt)
  })

const seedRun = (runId: string, taskId: string, status = "running") =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
       VALUES (?, ?, 'tx-tester', ?, ?, '{}')`
    ).run(runId, taskId, NOW, status)
  })

const seedClaim = (taskId: string, workerId: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    db.prepare(
      `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, status)
       VALUES (?, ?, ?, ?, 'active')`
    ).run(taskId, workerId, NOW, expiresAt)
  })

const seedDoc = (docStableId: string, name: string, version = 1) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const hash = createHash("sha256").update(`${name}:${version}`).digest("hex").substring(0, 16)
    db.prepare(
      `INSERT INTO docs (doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
       VALUES (?, ?, 'design', ?, ?, ?, 'changing', ?, NULL, ?, '{}')`
    ).run(docStableId, hash, name, `Test: ${name}`, version, `design/${name}.md`, NOW)
  })

const linkTaskToDoc = (taskId: string, docName: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const docRow = db.prepare(
      "SELECT id FROM docs WHERE name = ? ORDER BY version DESC LIMIT 1"
    ).get(docName) as { id: number } | null
    if (!docRow) throw new Error(`Doc not found: ${docName}`)
    db.prepare(
      "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, 'references', ?)"
    ).run(taskId, docRow.id, NOW)
  })

/**
 * Create a worker session via the repository (not the service, since the service
 * doesn't expose a createSession method — that's Ralph's responsibility).
 */
const createSession = (opts: {
  sessionId: string
  workerId: string
  controlMode?: string
  scopeMode?: string
  scopeRef?: string | null
  currentTaskId?: string | null
  currentRunId?: string | null
  activeTerminalController?: string | null
  endedAt?: string | null
}) =>
  Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    return yield* repo.createSession({
      id: opts.sessionId,
      workerId: opts.workerId,
      scopeMode: opts.scopeMode ?? "all",
      scopeRef: opts.scopeRef ?? null,
      orchestrator: "ralph",
      runtime: "claude",
      terminalBackend: "tmux",
      tmuxSessionName: `ralph-${opts.sessionId}`,
      tmuxWindowName: "main",
      tmuxPaneId: "%0",
      controlMode: opts.controlMode ?? "agent",
      currentTaskId: opts.currentTaskId ?? null,
      currentRunId: opts.currentRunId ?? null,
      activeTerminalController: opts.activeTerminalController ?? null,
      startedAt: NOW,
      lastHeartbeatAt: NOW,
      metadata: {},
    })
    // If ended, update immediately
  }).pipe(
    Effect.tap(() => {
      if (opts.endedAt) {
        return Effect.gen(function* () {
          const repo = yield* SupervisionRepository
          yield* repo.endSession(opts.sessionId, opts.endedAt!)
        })
      }
      return Effect.void
    })
  )

// =============================================================================
// Tests
// =============================================================================

describe("SupervisionService Integration", () => {

  // ---------------------------------------------------------------------------
  // 1. Create/list/get session detail
  // ---------------------------------------------------------------------------
  describe("create/list/get session detail", () => {

    it("lists live sessions (excludes ended sessions)", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedWorker(FIXTURES.WORKER_2, "worker-beta")
        yield* createSession({ sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1 })
        yield* createSession({
          sessionId: FIXTURES.SESSION_2, workerId: FIXTURES.WORKER_2,
          endedAt: NOW,
        })

        const svc = yield* SupervisionService
        const sessions = yield* svc.listSessions()

        // Only live session should be returned
        expect(sessions.length).toBe(1)
        expect(sessions[0].id).toBe(FIXTURES.SESSION_1)
        expect(sessions[0].workerName).toBe("worker-alpha")
      })))

    it("gets session detail by ID with worker info", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha", "busy")
        yield* createSession({ sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1 })

        const svc = yield* SupervisionService
        const detail = yield* svc.getSession(FIXTURES.SESSION_1)

        expect(detail.id).toBe(FIXTURES.SESSION_1)
        expect(detail.workerId).toBe(FIXTURES.WORKER_1)
        expect(detail.workerName).toBe("worker-alpha")
        expect(detail.workerStatus).toBe("busy")
        expect(detail.controlMode).toBe("agent")
        expect(detail.terminalAvailable).toBe(true)
      })))

    it("session detail includes current task info when set", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedTask(FIXTURES.TASK_1, "Implement feature X", "active")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          currentTaskId: FIXTURES.TASK_1,
        })

        const svc = yield* SupervisionService
        const detail = yield* svc.getSession(FIXTURES.SESSION_1)

        expect(detail.currentTaskId).toBe(FIXTURES.TASK_1)
        expect(detail.currentTaskTitle).toBe("Implement feature X")
        expect(detail.currentTaskStatus).toBe("active")
      })))

    it("session detail includes current run info when set", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedTask(FIXTURES.TASK_1, "Task with run", "active")
        yield* seedRun(FIXTURES.RUN_1, FIXTURES.TASK_1, "running")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          currentTaskId: FIXTURES.TASK_1,
          currentRunId: FIXTURES.RUN_1,
        })

        const svc = yield* SupervisionService
        const detail = yield* svc.getSession(FIXTURES.SESSION_1)

        expect(detail.currentRunId).toBe(FIXTURES.RUN_1)
        expect(detail.currentRunStatus).toBe("running")
      })))

    it("session detail includes claim info when an active claim exists", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedTask(FIXTURES.TASK_1, "Claimed task", "active")
        yield* seedClaim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          currentTaskId: FIXTURES.TASK_1,
        })

        const svc = yield* SupervisionService
        const detail = yield* svc.getSession(FIXTURES.SESSION_1)

        expect(detail.claimOwner).toBe(FIXTURES.WORKER_1)
        expect(detail.claimExpiresAt).toBeTruthy()
      })))

    it("session detail includes design-doc progress for scoped sessions", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedDoc("doc-test-sup-1", FIXTURES.DOC_NAME_1)
        yield* seedTask(FIXTURES.TASK_1, "Done task", "done")
        yield* seedTask(FIXTURES.TASK_2, "Active task", "active")
        yield* linkTaskToDoc(FIXTURES.TASK_1, FIXTURES.DOC_NAME_1)
        yield* linkTaskToDoc(FIXTURES.TASK_2, FIXTURES.DOC_NAME_1)
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: FIXTURES.DOC_NAME_1,
        })

        const svc = yield* SupervisionService
        const detail = yield* svc.getSession(FIXTURES.SESSION_1)

        expect(detail.designDocProgress).toBeTruthy()
        expect(detail.designDocProgress!.total).toBe(2)
        expect(detail.designDocProgress!.done).toBe(1)
        expect(detail.designDocProgress!.inProgress).toBe(1)
        expect(detail.designDocProgress!.completionPercent).toBe(50)
        expect(detail.designDocCompletionState).toBe("implementing")
      })))

    it("fails when session does not exist", () =>
      run(Effect.gen(function* () {
        const svc = yield* SupervisionService
        const result = yield* Effect.either(svc.getSession("non-existent-session"))
        expect(result._tag).toBe("Left")
      })))
  })

  // ---------------------------------------------------------------------------
  // 2. Pause/resume state machine validation
  // ---------------------------------------------------------------------------
  describe("pause/resume state machine [INV-SUP-002, INV-SUP-003]", () => {

    it("pauses session from agent mode → human_paused", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
        })

        const svc = yield* SupervisionService
        const result = yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        expect(result.controlMode).toBe("human_paused")
      })))

    it("rejects pause from human_paused mode", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "human_paused",
        })

        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        )

        expect(result._tag).toBe("Left")
      })))

    it("rejects pause from ended mode", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          endedAt: NOW,
        })

        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        )

        expect(result._tag).toBe("Left")
      })))

    it("resumes session from human_paused → agent", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
        })

        const svc = yield* SupervisionService
        yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        const result = yield* svc.resumeSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        expect(result.controlMode).toBe("agent")
      })))

    it("rejects resume from agent mode", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
        })

        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.resumeSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        )

        expect(result._tag).toBe("Left")
      })))

    it("rejects resume from ended mode", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          endedAt: NOW,
        })

        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.resumeSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        )

        expect(result._tag).toBe("Left")
      })))

    it("pause emits worker.pause_requested and worker.paused events", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
        })

        const svc = yield* SupervisionService
        yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", FIXTURES.SESSION_1)
        const types = events.map((e) => e.eventType)

        expect(types).toContain("worker.pause_requested")
        expect(types).toContain("worker.paused")
      })))

    it("resume emits worker.resumed event", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
        })

        const svc = yield* SupervisionService
        yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        yield* svc.resumeSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", FIXTURES.SESSION_1)
        const types = events.map((e) => e.eventType)

        expect(types).toContain("worker.resumed")
      })))

    it("pause on non-existent session fails", () =>
      run(Effect.gen(function* () {
        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.pauseSession("non-existent", ACTOR_HUMAN)
        )
        expect(result._tag).toBe("Left")
      })))
  })

  // ---------------------------------------------------------------------------
  // 3. Terminal token issuance rules [INV-SUP-004]
  // ---------------------------------------------------------------------------
  describe("terminal token issuance [INV-SUP-004]", () => {

    it("observe mode always succeeds for live session", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
        })

        const svc = yield* SupervisionService
        const token = yield* svc.createTerminalToken(
          FIXTURES.SESSION_1, "viewer-1", "observe"
        )

        expect(token.token).toBeTruthy()
        expect(token.sessionId).toBe(FIXTURES.SESSION_1)
        expect(token.viewerId).toBe("viewer-1")
        expect(token.mode).toBe("observe")
        expect(token.expiresAt).toBeTruthy()
      })))

    it("control mode succeeds when no existing controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
        })

        const svc = yield* SupervisionService
        const token = yield* svc.createTerminalToken(
          FIXTURES.SESSION_1, "viewer-1", "control"
        )

        expect(token.mode).toBe("control")
        expect(token.viewerId).toBe("viewer-1")
      })))

    it("control mode fails when a different viewer is already controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "existing-viewer",
        })

        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.createTerminalToken(FIXTURES.SESSION_1, "new-viewer", "control")
        )

        expect(result._tag).toBe("Left")
      })))

    it("control mode succeeds when same viewer is already controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "viewer-1",
        })

        const svc = yield* SupervisionService
        const token = yield* svc.createTerminalToken(
          FIXTURES.SESSION_1, "viewer-1", "control"
        )

        expect(token.mode).toBe("control")
      })))

    it("observe mode succeeds even with existing controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "existing-viewer",
        })

        const svc = yield* SupervisionService
        const token = yield* svc.createTerminalToken(
          FIXTURES.SESSION_1, "another-viewer", "observe"
        )

        expect(token.mode).toBe("observe")
      })))

    it("fails for ended session", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          endedAt: NOW,
        })

        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.createTerminalToken(FIXTURES.SESSION_1, "viewer-1", "observe")
        )

        expect(result._tag).toBe("Left")
      })))

    it("fails for non-existent session", () =>
      run(Effect.gen(function* () {
        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.createTerminalToken("non-existent", "viewer-1", "observe")
        )

        expect(result._tag).toBe("Left")
      })))
  })

  // ---------------------------------------------------------------------------
  // 4. Claim-preserving pause semantics [INV-SUP-002, INV-SUP-003]
  // ---------------------------------------------------------------------------
  describe("claim-preserving pause [INV-SUP-002, INV-SUP-003]", () => {

    it("pause preserves the task claim (never stolen)", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedTask(FIXTURES.TASK_1, "Claimed task", "active")
        yield* seedClaim(FIXTURES.TASK_1, FIXTURES.WORKER_1)
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
          currentTaskId: FIXTURES.TASK_1,
        })

        const svc = yield* SupervisionService

        // Verify claim exists before pause
        const before = yield* svc.getSession(FIXTURES.SESSION_1)
        expect(before.claimOwner).toBe(FIXTURES.WORKER_1)

        // Pause
        yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        // Verify claim is still intact after pause
        const after = yield* svc.getSession(FIXTURES.SESSION_1)
        expect(after.claimOwner).toBe(FIXTURES.WORKER_1)
        expect(after.claimExpiresAt).toBeTruthy()
      })))

    it("pause preserves current_task_id on the session", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedTask(FIXTURES.TASK_1, "Claimed task", "active")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
          currentTaskId: FIXTURES.TASK_1,
        })

        const svc = yield* SupervisionService
        const result = yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        expect(result.currentTaskId).toBe(FIXTURES.TASK_1)
        expect(result.currentTaskTitle).toBe("Claimed task")
      })))

    it("pause preserves live session (endedAt remains null)", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
        })

        const svc = yield* SupervisionService
        const result = yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        expect(result.endedAt).toBeNull()
        expect(result.controlMode).toBe("human_paused")
      })))

    it("pause event payload includes current task and run IDs", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* seedTask(FIXTURES.TASK_1, "Active task", "active")
        yield* seedRun(FIXTURES.RUN_1, FIXTURES.TASK_1, "running")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
          currentTaskId: FIXTURES.TASK_1,
          currentRunId: FIXTURES.RUN_1,
        })

        const svc = yield* SupervisionService
        yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", FIXTURES.SESSION_1)
        const pausedEvent = events.find((e) => e.eventType === "worker.paused")

        expect(pausedEvent).toBeTruthy()
        const payload = pausedEvent!.payload as Record<string, unknown>
        expect(payload.currentTaskId).toBe(FIXTURES.TASK_1)
        expect(payload.currentRunId).toBe(FIXTURES.RUN_1)
      })))
  })

  // ---------------------------------------------------------------------------
  // 5. Single write controller enforcement [INV-SUP-004]
  // ---------------------------------------------------------------------------
  describe("single write controller [INV-SUP-004]", () => {

    it("markAttached with writable=true sets active controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
        })

        const svc = yield* SupervisionService
        yield* svc.markAttached(FIXTURES.SESSION_1, "viewer-1", true)

        const detail = yield* svc.getSession(FIXTURES.SESSION_1)
        expect(detail.activeTerminalController).toBe("viewer-1")
      })))

    it("markAttached with writable=true from different viewer fails when controller exists", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "viewer-1",
        })

        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.markAttached(FIXTURES.SESSION_1, "viewer-2", true)
        )

        expect(result._tag).toBe("Left")
      })))

    it("markAttached with writable=false succeeds without claiming controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "viewer-1",
        })

        const svc = yield* SupervisionService
        yield* svc.markAttached(FIXTURES.SESSION_1, "viewer-2", false)

        // Controller remains unchanged
        const detail = yield* svc.getSession(FIXTURES.SESSION_1)
        expect(detail.activeTerminalController).toBe("viewer-1")
      })))

    it("markAttached with writable=true from same viewer succeeds", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "viewer-1",
        })

        const svc = yield* SupervisionService
        yield* svc.markAttached(FIXTURES.SESSION_1, "viewer-1", true)

        const detail = yield* svc.getSession(FIXTURES.SESSION_1)
        expect(detail.activeTerminalController).toBe("viewer-1")
      })))
  })

  // ---------------------------------------------------------------------------
  // 6. Attach/detach event emission
  // ---------------------------------------------------------------------------
  describe("attach/detach events", () => {

    it("markAttached emits worker.session_attached event", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
        })

        const svc = yield* SupervisionService
        yield* svc.markAttached(FIXTURES.SESSION_1, "viewer-1", true)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", FIXTURES.SESSION_1)
        const attachedEvent = events.find((e) => e.eventType === "worker.session_attached")

        expect(attachedEvent).toBeTruthy()
        const payload = attachedEvent!.payload as Record<string, unknown>
        expect(payload.sessionId).toBe(FIXTURES.SESSION_1)
        expect(payload.viewerId).toBe("viewer-1")
        expect(payload.mode).toBe("control")
      })))

    it("markAttached with writable=false emits observe mode in event", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
        })

        const svc = yield* SupervisionService
        yield* svc.markAttached(FIXTURES.SESSION_1, "viewer-1", false)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", FIXTURES.SESSION_1)
        const attachedEvent = events.find((e) => e.eventType === "worker.session_attached")

        expect(attachedEvent).toBeTruthy()
        const payload = attachedEvent!.payload as Record<string, unknown>
        expect(payload.mode).toBe("observe")
      })))

    it("markDetached emits worker.session_detached event", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "viewer-1",
        })

        const svc = yield* SupervisionService
        yield* svc.markDetached(FIXTURES.SESSION_1, "viewer-1")

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", FIXTURES.SESSION_1)
        const detachedEvent = events.find((e) => e.eventType === "worker.session_detached")

        expect(detachedEvent).toBeTruthy()
        const payload = detachedEvent!.payload as Record<string, unknown>
        expect(payload.sessionId).toBe(FIXTURES.SESSION_1)
        expect(payload.viewerId).toBe("viewer-1")
      })))

    it("markDetached clears controller when viewer was the active controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "viewer-1",
        })

        const svc = yield* SupervisionService
        yield* svc.markDetached(FIXTURES.SESSION_1, "viewer-1")

        const detail = yield* svc.getSession(FIXTURES.SESSION_1)
        expect(detail.activeTerminalController).toBeNull()
      })))

    it("markDetached does not clear controller when viewer was not the controller", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          activeTerminalController: "viewer-1",
        })

        const svc = yield* SupervisionService
        yield* svc.markDetached(FIXTURES.SESSION_1, "viewer-2")

        const detail = yield* svc.getSession(FIXTURES.SESSION_1)
        expect(detail.activeTerminalController).toBe("viewer-1")
      })))

    it("markDetached on non-existent session fails", () =>
      run(Effect.gen(function* () {
        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.markDetached("non-existent", "viewer-1")
        )
        expect(result._tag).toBe("Left")
      })))

    it("markAttached on non-existent session fails", () =>
      run(Effect.gen(function* () {
        const svc = yield* SupervisionService
        const result = yield* Effect.either(
          svc.markAttached("non-existent", "viewer-1", true)
        )
        expect(result._tag).toBe("Left")
      })))
  })

  // ---------------------------------------------------------------------------
  // 7. Session events query
  // ---------------------------------------------------------------------------
  describe("listSessionEvents", () => {

    it("returns domain events for a session stream", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
          controlMode: "agent",
        })

        const svc = yield* SupervisionService

        // Perform actions that emit events
        yield* svc.pauseSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        yield* svc.resumeSession(FIXTURES.SESSION_1, ACTOR_HUMAN)
        yield* svc.markAttached(FIXTURES.SESSION_1, "viewer-1", true)
        yield* svc.markDetached(FIXTURES.SESSION_1, "viewer-1")

        const events = yield* svc.listSessionEvents(FIXTURES.SESSION_1)

        // Should have: pause_requested, paused, resumed, session_attached, session_detached
        const types = events.map((e) => e.eventType)
        expect(types).toContain("worker.pause_requested")
        expect(types).toContain("worker.paused")
        expect(types).toContain("worker.resumed")
        expect(types).toContain("worker.session_attached")
        expect(types).toContain("worker.session_detached")
        expect(events.length).toBe(5)
      })))

    it("returns empty array for session with no events", () =>
      run(Effect.gen(function* () {
        yield* seedWorker(FIXTURES.WORKER_1, "worker-alpha")
        yield* createSession({
          sessionId: FIXTURES.SESSION_1,
          workerId: FIXTURES.WORKER_1,
        })

        const svc = yield* SupervisionService
        const events = yield* svc.listSessionEvents(FIXTURES.SESSION_1)

        expect(events).toEqual([])
      })))
  })
})
