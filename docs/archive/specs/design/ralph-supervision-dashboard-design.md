---
kind: spec
spec_type: design
doc_id: doc-1702ce12c0a2
name: ralph-supervision-dashboard-design
title: "DD-039: Ralph Supervision Dashboard Design"
status: draft
version: 1
owners:
  - core
  - dashboard
summary: Implement core-owned Ralph supervision sessions, tmux-backed browser terminals, canonical domain events, and config-gated design-doc review triggers.
domain: orchestration
tags:
  - ralph
  - dashboard
  - supervision
  - terminals
  - domain-events
  - pi
depends_on:
  - ralph-supervision-dashboard-prd
  - paired-prd-dd-ralph-workflow-design
supersedes: []
implements: ralph-supervision-dashboard-prd
last_reviewed_at: 2026-03-29
---

# Summary

This design adds a supervision subsystem around the existing Ralph worker loop
without changing tx's core philosophy of headless primitives.

The feature is composed of:

1. `worker_sessions` as a current-state supervision snapshot.
2. `domain_events` as the canonical append-only business event ledger.
3. tmux-backed terminal attach and a read-only wall in the dashboard.
4. explicit pause and resume semantics for human takeover.
5. `doc_review_runs` and a config-gated trigger when all linked design-doc work
   is complete.
6. a core-owned review runtime adapter, with Pi as the default review runtime
   when enabled.

The implementation must keep behavior in Effect core. Ralph shell code and the
dashboard server are adapters: they observe, invoke, and render, but they do
not own supervision state machines or direct SQL.

Implements: [PRD-039](../prd/ralph-supervision-dashboard-prd.md)

# Architecture

## 1. Current Baseline

The current checkout already has the worker-orchestration primitives from
[DD-018](./DD-018-worker-orchestration.md):

- `workers`
- `task_claims`
- `orchestrator_state`
- process registry support in migration 038
- Ralph shell logic in [scripts/ralph.sh](../../scripts/ralph.sh)

It does not yet have:

- a supervision session table
- a canonical domain event ledger for worker/review lifecycle
- dashboard supervision routes or websocket terminal transport
- design-doc completion review runs

The implementation should extend the existing architecture rather than bypass
it.

## 2. Ownership Boundaries

### Core-owned

Core owns:

- schema definitions in `packages/types`
- repositories and services in `packages/core`
- migration SQL and embedded migration bundle
- domain event persistence
- supervision state transitions
- design-doc review eligibility and run lifecycle

### Adapter-owned

Ralph shell owns:

- spawning workers
- starting tmux sessions
- collecting runtime-specific process metadata
- calling core commands/services when state changes

Dashboard server owns:

- HTTP transport
- websocket upgrade and byte forwarding
- terminal bridge plumbing

Dashboard React owns:

- session list/detail UX
- xterm rendering
- event timeline display
- wall-mode layout and presentation

The rule is simple: adapters are allowed to move bytes and call core APIs, but
they are not allowed to invent supervision or review persistence rules.

## 3. Supervision Runtime Model

Add a first-class `WorkerSession` read model that sits alongside, not instead
of, the existing `workers` table.

One live Ralph worker must have at most one live `worker_sessions` row.

Recommended shape:

```ts
const WorkerSessionSchema = Schema.Struct({
  id: Schema.String,
  workerId: Schema.String,
  workerName: Schema.String,
  workerStatus: WorkerStatusSchema,
  scopeMode: Schema.Literal("all", "design-doc"),
  scopeRef: Schema.NullOr(Schema.String),
  orchestrator: Schema.Literal("ralph"),
  runtime: Schema.Literal("claude", "codex", "custom", "pi"),
  terminalBackend: Schema.Literal("tmux"),
  tmuxSessionName: Schema.NullOr(Schema.String),
  tmuxWindowName: Schema.NullOr(Schema.String),
  tmuxPaneId: Schema.NullOr(Schema.String),
  controlMode: Schema.Literal(
    "agent",
    "human_paused",
    "human_attached",
    "detached",
    "ended"
  ),
  currentTaskId: Schema.NullOr(Schema.String),
  currentRunId: Schema.NullOr(Schema.String),
  activeTerminalController: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  lastHeartbeatAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})
```

`workers` remains the coordination snapshot for orchestration. `worker_sessions`
is the supervision snapshot for terminals, control mode, and active context.

## 4. Terminal Model

Use tmux as the durable backend. The browser terminal is a view and control
surface over tmux, not an independent shell.

Design choices:

- each live Ralph worker gets its own tmux session
- the focused dashboard terminal attaches to that specific worker session
- wall tiles are read-only and do not become terminal controllers
- only one active write-capable terminal controller is allowed per session

### Focused terminal

The focused terminal path uses a websocket and a PTY bridge:

1. dashboard client requests a terminal token for a session
2. dashboard opens `/api/supervision/terminal/ws?token=...`
3. server resolves the token via core `SupervisionService`
4. server attaches to the tmux session through a PTY bridge
5. websocket forwards stdin/output/resize until detach

### Terminal wall

The wall must prefer passive monitoring over full multi-attach control.

Recommended implementation:

- each tile subscribes to a read-only snapshot stream
- server captures the relevant tmux pane output on an interval or on change
- client renders the output into a read-only xterm instance
- wall mode never acquires write control and never mutates `controlMode`

This keeps the wall cheap and avoids N simultaneous interactive tmux clients.

## 5. Dashboard UX

The supervision surface should be a dedicated top-level tab in
[apps/dashboard/src/App.tsx](../../apps/dashboard/src/App.tsx), not a hidden
panel under Runs.

The page layout should have four intentional zones:

1. session rail
2. focused session pane
3. event timeline
4. wall mode

### Session rail

Show:

- worker name
- control mode badge
- worker status badge
- current task title
- current run status
- heartbeat freshness
- spec progress percentage
- terminal availability

### Focused pane

Show:

- focused xterm terminal
- pause or resume control
- claim owner and lease status
- current run metadata
- design-doc progress bar and task counts

### Timeline

Render a structured event feed grouped by time with event type chips and a
human-readable summary derived from event payloads.

### Wall

Render all live terminals in one view with:

- session label
- current task label
- heartbeat freshness
- read-only marker

The UX bar is intentionally high: this should feel like a polished operations
surface, not a raw debug inspector.

## 6. Domain Event Architecture

`domain_events` is the canonical business event ledger for this feature.

Do not create separate canonical `worker_session_events` or
`doc_review_events` tables. If convenience projections are needed later, they
must derive from `domain_events`.

### Event envelope

```ts
const DomainEventEnvelopeSchema = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.String,
  eventType: Schema.String,
  streamType: Schema.String,
  streamId: Schema.String,
  aggregateType: Schema.String,
  aggregateId: Schema.String,
  correlationId: Schema.NullOr(Schema.String),
  causationId: Schema.NullOr(Schema.String),
  actorType: Schema.NullOr(Schema.String),
  actorId: Schema.NullOr(Schema.String),
  schemaVersion: Schema.Number,
  payload: Schema.Unknown,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})
```

### Strongly typed event union

Add a tagged union in `packages/types`, not loose stringly typed payloads.

Initial event families:

- `worker.session_created`
- `worker.session_ended`
- `worker.session_attached`
- `worker.session_detached`
- `worker.pause_requested`
- `worker.paused`
- `worker.resumed`
- `worker.task_claimed`
- `worker.task_released`
- `worker.scope_drained`
- `worker.shutdown_requested`
- `worker.shutdown_completed`
- `design_doc.review_eligible`
- `design_doc.review_triggered`
- `design_doc.review_started`
- `design_doc.review_passed`
- `design_doc.review_failed`
- `design_doc.review_superseded`
- `design_doc.review_followup_created`

Keep telemetry such as high-frequency heartbeats and span timing in the
existing telemetry tables. `domain_events` is for durable workflow state, not
metrics spam.

## 7. Design-Doc Completion Review Flow

Treat "all linked tasks are done" as a first-class derived state in core.

### Completion state

Add a derived model such as:

- `no_tasks`
- `implementing`
- `ready_for_review`
- `reviewing`
- `review_failed`
- `verified`
- `superseded`

Derive this from linked tasks in `task_doc_links`, task status, doc version, and
review-run state. Do not infer it from Ralph logs.

### Trigger model

Ralph remains the edge trigger, not the owner of review rules.

When Ralph drains a `--design-doc <name>` scope, it should call a core entry
point equivalent to:

```sh
tx doc review maybe-trigger <design-doc>
```

Core then:

1. checks whether review is enabled for that design doc
2. verifies all linked tasks are done
3. computes a task snapshot hash
4. ensures no active review run exists for that doc version and snapshot
5. appends `design_doc.review_eligible`
6. inserts `doc_review_runs`
7. appends `design_doc.review_triggered`

### Review execution

Review execution must happen through a runtime adapter rather than inline shell
logic inside Ralph.

Introduce a core `ReviewRuntime` port with a Pi implementation:

- `PiReviewRuntime`
- transport: Pi RPC first, SDK second, print mode never as canonical transport
- config-driven prompt template and loop settings

Suggested config section:

```toml
[reviews.design_docs]
enabled = false
runtime = "pi"
transport = "rpc"
template = "double-check"
blocking = false
create_followup_tasks = true
retrigger_on_task_reopen = true
```

## 8. ESLint Guardrail

Add a repo-local ESLint rule so non-core layers cannot embed supervision or
review SQL.

Recommended rules:

- `tx/no-supervision-sql-outside-core`
- `tx/no-domain-events-sql-outside-core`

Enforcement targets:

- `apps/dashboard/server/**`
- `apps/cli/**`
- `scripts/**` where applicable through shell test assertions rather than ESLint

The purpose is to lock in the ownership boundary after implementation.

# Interfaces

## Types

Add or extend shared Effect Schema definitions in `packages/types` for:

- `WorkerSession`
- `WorkerSessionDetail`
- `WorkerSessionControlMode`
- `DomainEventEnvelope`
- `SupervisionDomainEvent`
- `DesignDocCompletionState`
- `DocReviewRun`
- `SupervisionTerminalToken`

Expose them through `packages/types/src/index.ts`.

## Context

Add the following core services:

- `DomainEventService`
- `SupervisionService`
- `DocReviewService`
- `ReviewRuntime`

Add repositories:

- `DomainEventRepo`
- `SupervisionRepo`
- `DocReviewRepo`

Wire them through `packages/core/src/layer.ts` and export them from
`packages/core/src/index.ts`.

## Repositories

### DomainEventRepo

Responsibilities:

- append events
- list by stream
- list by aggregate
- support timeline queries for dashboard views

### SupervisionRepo

Responsibilities:

- create/update/end worker sessions
- join worker/task/run/claim/doc progress state
- resolve terminal-controller ownership

### DocReviewRepo

Responsibilities:

- insert review runs
- claim pending review work
- update run status
- query latest run for a doc version

## Services

### SupervisionService

Suggested methods:

```ts
listSessions(): Effect<ReadonlyArray<WorkerSessionDetail>, SupervisionError>
getSession(sessionId: string): Effect<WorkerSessionDetail, SupervisionError>
listSessionEvents(sessionId: string): Effect<ReadonlyArray<SupervisionDomainEvent>, SupervisionError>
createTerminalToken(sessionId: string, viewerId: string, mode: "control" | "observe"): Effect<SupervisionTerminalToken, SupervisionError>
pauseSession(sessionId: string, actor: ActorRef): Effect<WorkerSessionDetail, SupervisionError>
resumeSession(sessionId: string, actor: ActorRef): Effect<WorkerSessionDetail, SupervisionError>
markAttached(sessionId: string, viewerId: string, writable: boolean): Effect<void, SupervisionError>
markDetached(sessionId: string, viewerId: string): Effect<void, SupervisionError>
```

### DocReviewService

Suggested methods:

```ts
maybeTrigger(docRef: string, cause: ReviewTriggerCause): Effect<MaybeTriggerResult, DocReviewError>
claimPending(workerId: string): Effect<ReadonlyArray<DocReviewRun>, DocReviewError>
startRun(runId: string, workerId: string): Effect<DocReviewRun, DocReviewError>
completeRun(runId: string, result: ReviewRunResult): Effect<DocReviewRun, DocReviewError>
failRun(runId: string, result: ReviewFailureResult): Effect<DocReviewRun, DocReviewError>
getCompletionState(docRef: string): Effect<DesignDocCompletionState, DocReviewError>
```

### DomainEventService

Suggested methods:

```ts
publish(event: SupervisionDomainEvent): Effect<void, DomainEventError>
listByStream(streamType: string, streamId: string): Effect<ReadonlyArray<DomainEventEnvelope>, DomainEventError>
listByAggregate(aggregateType: string, aggregateId: string): Effect<ReadonlyArray<DomainEventEnvelope>, DomainEventError>
```

## Workflows

### Worker supervision lifecycle

1. Ralph worker starts.
2. Ralph creates a tmux session for that worker.
3. Ralph registers or updates `workers`.
4. Ralph calls core `SupervisionService` to create a session snapshot.
5. Core appends `worker.session_created`.
6. Ralph claims work as today.
7. Claim or run transitions update the session snapshot and append events.
8. Pause or resume calls update control mode and emit events.
9. Scope drain requests clean worker shutdown and emits shutdown events.
10. Worker exits and session ends.

### Design-doc review lifecycle

1. Ralph drains a design-doc scope.
2. Ralph calls `maybeTrigger`.
3. Core appends eligibility and trigger events if appropriate.
4. Review worker claims the pending review run.
5. `ReviewRuntime` executes the Pi template loop.
6. Core records pass/fail/supersede and optionally follow-up tasks.

## Events

The following event payloads need dedicated schema definitions:

- `WorkerSessionCreated`
- `WorkerSessionAttached`
- `WorkerPaused`
- `WorkerResumed`
- `WorkerScopeDrained`
- `WorkerShutdownCompleted`
- `DesignDocReviewEligible`
- `DesignDocReviewTriggered`
- `DesignDocReviewStarted`
- `DesignDocReviewPassed`
- `DesignDocReviewFailed`
- `DesignDocReviewSuperseded`

Every event must include enough identifiers to join back to:

- worker
- session
- task
- run
- design doc
- review run

## Endpoints

Expose dashboard transport routes from
[apps/dashboard/server/index.ts](../../apps/dashboard/server/index.ts), but
delegate all business logic to core services.

Required routes:

- `GET /api/supervision/sessions`
- `GET /api/supervision/sessions/:id`
- `GET /api/supervision/sessions/:id/events`
- `GET /api/supervision/terminal-wall`
- `GET /api/supervision/terminal-token/:id`
- `POST /api/supervision/sessions/:id/pause`
- `POST /api/supervision/sessions/:id/resume`
- `GET /api/supervision/terminal/ws?token=...` (websocket)

Optional follow-on CLI/API surface:

- `tx doc review maybe-trigger <doc>`
- `tx worker start --capabilities doc-review`

# Data Model

## Database Schema

Add three migrations after the current `042_doc_id_version_index_repair.sql`:

- `043_domain_events.sql`
- `044_worker_sessions.sql`
- `045_doc_review_runs.sql`

### 043_domain_events.sql

```sql
CREATE TABLE domain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  actor_type TEXT,
  actor_id TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_domain_events_stream
  ON domain_events(stream_type, stream_id, occurred_at DESC, id DESC);
CREATE INDEX idx_domain_events_aggregate
  ON domain_events(aggregate_type, aggregate_id, occurred_at DESC, id DESC);
CREATE INDEX idx_domain_events_type_time
  ON domain_events(event_type, occurred_at DESC, id DESC);
```

### 044_worker_sessions.sql

```sql
CREATE TABLE worker_sessions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  scope_mode TEXT NOT NULL CHECK (scope_mode IN ('all', 'design-doc')),
  scope_ref TEXT,
  orchestrator TEXT NOT NULL CHECK (orchestrator IN ('ralph')),
  runtime TEXT NOT NULL CHECK (runtime IN ('claude', 'codex', 'custom', 'pi')),
  terminal_backend TEXT NOT NULL CHECK (terminal_backend IN ('tmux')),
  tmux_session_name TEXT,
  tmux_window_name TEXT,
  tmux_pane_id TEXT,
  control_mode TEXT NOT NULL CHECK (
    control_mode IN ('agent', 'human_paused', 'human_attached', 'detached', 'ended')
  ),
  current_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  current_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  active_terminal_controller TEXT,
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  ended_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX idx_worker_sessions_live_worker
  ON worker_sessions(worker_id)
  WHERE ended_at IS NULL;
CREATE INDEX idx_worker_sessions_live
  ON worker_sessions(ended_at, last_heartbeat_at DESC);
CREATE INDEX idx_worker_sessions_scope
  ON worker_sessions(scope_mode, scope_ref)
  WHERE ended_at IS NULL;
```

### 045_doc_review_runs.sql

```sql
CREATE TABLE doc_review_runs (
  id TEXT PRIMARY KEY,
  doc_row_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  doc_version INTEGER NOT NULL,
  task_snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'passed', 'failed', 'cancelled', 'superseded')
  ),
  runtime TEXT NOT NULL CHECK (runtime IN ('pi', 'custom')),
  transport TEXT NOT NULL CHECK (transport IN ('rpc', 'sdk')),
  template_name TEXT NOT NULL,
  triggered_by_event_id TEXT,
  worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
  started_at TEXT,
  ended_at TEXT,
  result_summary TEXT,
  findings_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX idx_doc_review_runs_active
  ON doc_review_runs(doc_id, doc_version, task_snapshot_hash)
  WHERE status IN ('pending', 'running');
CREATE INDEX idx_doc_review_runs_doc
  ON doc_review_runs(doc_id, doc_version, ended_at DESC);
CREATE INDEX idx_doc_review_runs_status
  ON doc_review_runs(status, started_at DESC);
```

## Types

Schema definitions should live in `packages/types`. Core-local row interfaces may
exist in repositories, but public contracts should not be plain TypeScript
interfaces.

## Derived Models

### Supervision session detail

`WorkerSessionDetail` should join:

- `worker_sessions`
- `workers`
- active `task_claims`
- `tasks`
- `runs`
- linked design-doc progress when a task is associated with a design doc

### Design-doc progress

Progress is a derived projection, not a persisted counter. For a given design
doc, compute:

- total linked tasks
- done linked tasks
- in-progress linked tasks
- blocked linked tasks
- completion percent

### Review eligibility

Eligibility is derived from:

- design doc version
- linked tasks and their statuses
- active review run state
- optional config enablement

## Indexes and Constraints

- at most one live session per worker
- at most one active review run per doc version and task snapshot
- `domain_events` is append-only; application code never updates historical
  rows
- `human_paused` and `human_attached` sessions cannot claim new work
- wall observers never claim terminal controller ownership

# Invariants

```yaml
invariants:
  - id: INV-SUP-001
    statement: workers shut down cleanly when no eligible tasks remain in their active scope
    severity: high
    verified_by:
      - test/integration/ralph-script.test.ts
  - id: INV-SUP-002
    statement: task claims remain authoritative during supervision and are never stolen by pause, attach, or review side effects
    severity: high
    verified_by:
      - test/integration/supervision-service.test.ts
  - id: INV-SUP-003
    statement: pausing a worker preserves the live session and current claim while blocking new claims until resume
    severity: high
    verified_by:
      - test/integration/supervision-service.test.ts
  - id: INV-SUP-004
    statement: at most one write-capable terminal controller exists for a live worker session at any time
    severity: high
    verified_by:
      - test/integration/dashboard-supervision-e2e.test.ts
  - id: INV-SUP-005
    statement: wall-mode terminals are always read-only and do not mutate session control ownership
    severity: medium
    verified_by:
      - apps/dashboard/e2e/supervision.spec.ts
  - id: INV-SUP-006
    statement: supervision and design-doc review lifecycle changes are durably recorded in domain_events with typed payloads
    severity: high
    verified_by:
      - test/integration/domain-event-service.test.ts
  - id: INV-SUP-007
    statement: design-doc completion progress is derived from linked tasks rather than inferred from shell output
    severity: high
    verified_by:
      - test/integration/doc-review-service.test.ts
  - id: INV-SUP-008
    statement: at most one active review run exists for a given design-doc version and task snapshot
    severity: high
    verified_by:
      - test/integration/doc-review-service.test.ts
  - id: INV-SUP-009
    statement: reopening or adding linked tasks after a passing review supersedes the previous verified state
    severity: high
    verified_by:
      - test/integration/doc-review-service.test.ts
  - id: INV-SUP-010
    statement: app-layer code does not own supervision or review SQL outside core-owned repositories
    severity: medium
    verified_by:
      - eslint-plugin-tx/tests/no-supervision-sql-outside-core.test.js
```

# Failure Modes

```yaml
failure_modes:
  - condition: tmux is unavailable on the host
    impact: browser terminals cannot attach and wall snapshots cannot be collected
    handling: mark terminal availability false, keep the rest of supervision usable, and surface an explicit operator-facing error
  - condition: a websocket disconnects during a focused terminal session
    impact: browser control is lost for that viewer
    handling: release terminal-controller ownership for that viewer, append detach events, and allow clean reconnect
  - condition: Ralph crashes after creating a tmux session but before ending the worker session snapshot
    impact: stale live session rows may remain
    handling: reconciliation logic marks sessions ended when the worker/process registry proves the worker is gone
  - condition: pause and resume requests race with worker shutdown or claim release
    impact: control mode may drift from actual worker liveness
    handling: enforce state-machine validation in SupervisionService and reject invalid transitions
  - condition: design-doc review triggering runs twice for the same task snapshot
    impact: duplicate review work and conflicting verification state
    handling: gate inserts with a unique active review-run index plus idempotent maybeTrigger logic
  - condition: a previously passed review becomes stale because linked tasks were reopened or new tasks were linked
    impact: false confidence in verified state
    handling: supersede the prior review result via domain events and derived completion-state recalculation
  - condition: adapter layers reintroduce direct supervision SQL
    impact: behavior drifts out of core and becomes harder to reason about
    handling: fail lint and focused repository tests
```

# Verification

```yaml
verification:
  - requirement_id: REQ-SUP-001
    test_type: integration
    target: test/integration/supervision-service.test.ts
  - requirement_id: REQ-SUP-002
    test_type: integration
    target: test/integration/dashboard-supervision-e2e.test.ts
  - requirement_id: REQ-SUP-003
    test_type: e2e
    target: apps/dashboard/e2e/supervision.spec.ts
  - requirement_id: REQ-SUP-004
    test_type: integration
    target: test/integration/supervision-service.test.ts
  - requirement_id: REQ-SUP-005
    test_type: integration
    target: test/integration/ralph-script.test.ts
  - requirement_id: REQ-SUP-006
    test_type: integration
    target: test/integration/supervision-service.test.ts
  - requirement_id: REQ-SUP-007
    test_type: integration
    target: test/integration/doc-review-service.test.ts
  - requirement_id: REQ-SUP-008
    test_type: integration
    target: test/integration/domain-event-service.test.ts
  - requirement_id: REQ-SUP-009
    test_type: integration
    target: test/integration/doc-review-service.test.ts
  - requirement_id: REQ-SUP-010
    test_type: integration
    target: test/integration/doc-review-worker.test.ts
  - requirement_id: REQ-SUP-011
    test_type: unit
    target: eslint-plugin-tx/tests/no-supervision-sql-outside-core.test.js
  - requirement_id: REQ-SUP-012
    test_type: unit
    target: apps/dashboard/src/components/supervision/__tests__/SupervisionPage.test.tsx
```

# Testing Strategy

This slice must lean heavily on integration tests. Unit tests alone are not
credible for a feature that spans SQLite, tmux, websocket transport, the shell
adapter, and dashboard rendering.

Required test inventory:

- `test/integration/domain-event-service.test.ts`
  - append/query by stream
  - append/query by aggregate
  - event ordering and envelope persistence
- `test/integration/supervision-service.test.ts`
  - create/list/get session detail
  - pause/resume state validation
  - terminal token issuance rules
  - claim-preserving pause semantics
- `test/integration/doc-review-service.test.ts`
  - derive completion state
  - idempotent maybe-trigger
  - supersede on reopened tasks
  - follow-up task creation on failed review
- `test/integration/doc-review-worker.test.ts`
  - claim pending review run
  - start/complete/fail review execution
  - Pi runtime adapter stub contract
- `test/integration/dashboard-supervision-e2e.test.ts`
  - real dashboard server routes
  - websocket attach handshake
  - attach/detach events
  - pause/resume over HTTP plus core state changes
- `test/integration/ralph-script.test.ts`
  - tmux session creation hook
  - session creation/update/end calls
  - scope-drain shutdown
  - design-doc maybe-trigger hook on drain
- `apps/dashboard/src/components/supervision/__tests__/SupervisionPage.test.tsx`
  - session rail
  - focused pane rendering
  - wall rendering
  - timeline mapping
- `apps/dashboard/e2e/supervision.spec.ts`
  - open Supervision tab
  - view focused terminal
  - verify wall tiles
  - pause and resume from the UI

All integration tests must use the shared singleton test DB pattern from
`@jamesaphoenix/tx-test-utils`. Do not create a new database per test.

# Open Questions

- [ ] Whether the focused terminal PTY bridge should be implemented with a Bun
  native dependency, a small helper process, or another adapter that behaves
  reliably in local development and CI.
- [ ] Whether review-run execution should have its own dedicated worker command
  or piggyback on a generalized worker capability framework.
- [ ] Whether the wall should support user-defined layout presets or only the
  default responsive grid in v1.

# Migration

1. Add migrations 043 through 045.
2. Regenerate `packages/core/src/migrations-embedded.ts`.
3. Add shared Effect Schema contracts in `packages/types`.
4. Add core repos and services.
5. Add ESLint guardrails.
6. Update Ralph shell integration points.
7. Add dashboard transport routes and websocket bridge.
8. Add dashboard supervision UI.
9. Land integration/component/Playwright coverage.

No historical data rewrite is required beyond applying the new tables. The new
feature is additive to existing worker orchestration state.

# References

- Plan file: `/Users/jamesaphoenix/.codex/plans/2026-03-29-reapply-supervision-stack.md`
- Worker orchestration baseline: [DD-018](./DD-018-worker-orchestration.md)
- Workflow baseline for paired PRD/design-doc Ralph execution: [DD-038](./paired-prd-dd-ralph-workflow-design.md)
- Current Ralph shell entrypoint: [scripts/ralph.sh](../../scripts/ralph.sh)
- Current dashboard transport entrypoint: [apps/dashboard/server/index.ts](../../apps/dashboard/server/index.ts)
