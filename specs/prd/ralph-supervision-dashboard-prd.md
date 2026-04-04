---
kind: spec
spec_type: prd
doc_id: doc-fdba8c1b4463
name: ralph-supervision-dashboard-prd
title: "PRD-039: Ralph Supervision Dashboard"
status: draft
version: 1
owners:
  - core
  - dashboard
summary: Add a live Ralph supervision surface with tmux-backed browser terminals, pause and takeover controls, canonical domain events, and optional design-doc completion review loops.
domain: orchestration
tags:
  - ralph
  - dashboard
  - supervision
  - terminals
  - events
  - review
depends_on:
  - paired-prd-dd-ralph-workflow-prd
supersedes: []
implements: null
last_reviewed_at: 2026-03-29
---

# Summary

Ralph already owns a useful execution loop, but it is still effectively a
black-box shell harness. Users cannot watch workers cleanly in the dashboard,
cannot safely take over a live worker without killing it, and cannot treat
worker/review lifecycle changes as a first-class stream of durable events.

This PRD adds a supervision layer around Ralph:

- live worker session visibility
- focused browser terminal attach
- an all-terminals wall for passive monitoring
- pause and resume without reaping worker ownership
- canonical domain events for worker and review lifecycle
- optional triggering of a review loop when a design doc's linked work is done

The goal is not to turn tx into a fixed orchestrator. The goal is to add the
headless primitives needed to observe, control, and hook into Ralph safely.

Implements via: [DD-039](../design/ralph-supervision-dashboard-design.md)

## Problem

Today Ralph exposes the minimum viable loop:

- workers register and heartbeat
- claims prevent duplicate work
- scopes such as `--design-doc` constrain the queue

But several important gaps remain:

1. There is no first-class session model for a live worker terminal.
2. The dashboard cannot attach to or display Ralph terminals.
3. A user cannot pause automation and take over a worker in place.
4. There is no canonical event ledger for worker supervision or review
   lifecycle.
5. The system does not represent "all linked design-doc tasks are done" as a
   first-class transition that other features can hook into.
6. Design-doc review loops are currently a workflow idea, not a durable,
   triggerable runtime feature.

That means the most operationally important moments in the system are still
hidden in shell state and human log parsing.

## Solution

Introduce a core-owned supervision and review model with four pillars:

- `worker_sessions` as the current-state snapshot for live Ralph sessions
- `domain_events` as the canonical durable lifecycle log
- dashboard supervision views for focused attach, wall view, timeline, and
  progress
- `doc_review_runs` plus a config-gated trigger when all tasks linked to a
  design doc are done

The implementation must keep orchestration headless:

- Ralph stays a shell orchestrator and worker harness
- core owns state transitions, event persistence, and read models
- dashboard is a transport and presentation layer over core services
- review execution is routed through a runtime adapter, with `pi` as the
  default review runtime when enabled

## Scope

Included:

- live supervision sessions for Ralph workers
- tmux-backed browser terminals with one write-capable controller
- read-only all-terminals wall tiles
- pause, resume, attach, and detach semantics
- task and spec progress display for focused sessions
- canonical `domain_events` for supervision and review lifecycle
- optional design-doc completion review trigger and review-run persistence
- an implementation guardrail so app layers do not embed supervision SQL

Excluded:

- replacing Ralph with Pi as the primary implementation runtime
- generic multi-orchestrator abstractions beyond Ralph and review runtime hooks
- a distributed event bus or external pub/sub system
- a full dashboard server rewrite away from the current Bun transport layer
- remote tmux multiplexing across multiple hosts in this slice

## Requirements

```yaml
ears_requirements:
  - id: REQ-SUP-001
    kind: ubiquitous
    statement: the system shall expose live Ralph worker sessions as first-class supervision records with current worker, task, run, terminal, and control metadata
    priority: must
    rationale: the dashboard needs a stable current-state source instead of log scraping
  - id: REQ-SUP-002
    kind: event-driven
    when: a user opens a supervision session in the dashboard
    statement: when a user opens a supervision session in the dashboard, the system shall allow focused tmux-backed browser terminal attachment for that session
    priority: must
    rationale: users need direct watch and takeover capability
  - id: REQ-SUP-003
    kind: event-driven
    when: a user views supervision in wall mode
    statement: when a user views supervision in wall mode, the system shall display all live worker terminals in a single read-only monitoring surface
    priority: must
    rationale: passive monitoring should not require N manual attaches
  - id: REQ-SUP-004
    kind: event-driven
    when: a user pauses a worker
    statement: when a user pauses a worker, the system shall preserve the worker session and current claim while preventing that worker from claiming new work until resumed
    priority: must
    rationale: pause must support human takeover without losing ownership
  - id: REQ-SUP-005
    kind: state-driven
    while: a worker has no more eligible work in its active scope
    statement: when a worker has no more eligible work in its active scope, the system shall shut that worker down cleanly instead of leaving it idle indefinitely
    priority: must
    rationale: workers should drain when there is no remaining work
  - id: REQ-SUP-006
    kind: ubiquitous
    statement: the system shall respect existing task claims during supervision and review operations
    priority: must
    rationale: observation and review features must not violate lease safety
  - id: REQ-SUP-007
    kind: ubiquitous
    statement: the system shall expose linked design-doc task completion progress for a supervised worker or task scope
    priority: must
    rationale: the dashboard should show meaningful progress, not only logs
  - id: REQ-SUP-008
    kind: ubiquitous
    statement: the system shall store supervision and review lifecycle changes in a canonical strongly typed domain event log
    priority: must
    rationale: future hooks and projections need a single business-event source of truth
  - id: REQ-SUP-009
    kind: event-driven
    when: all tasks linked to a design doc are done and design-doc review is enabled
    statement: when all tasks linked to a design doc are done and design-doc review is enabled, the system shall emit a review-eligible event and enqueue at most one active review run for that doc version and task snapshot
    priority: must
    rationale: review triggering should be durable and idempotent
  - id: REQ-SUP-010
    kind: event-driven
    when: a design-doc review run is triggered
    statement: when a design-doc review run is triggered, the system shall execute it through a runtime adapter that can target Pi prompt-template loops without shell-only coupling
    priority: should
    rationale: the review engine should be pluggable and core-owned
  - id: REQ-SUP-011
    kind: unwanted
    if: dashboard or shell layers perform direct supervision or review SQL outside core-owned repositories
    statement: if dashboard or shell layers perform direct supervision or review SQL outside core-owned repositories, then lint or test validation shall fail
    priority: should
    rationale: behavior must stay in effectful core
  - id: REQ-SUP-012
    kind: ubiquitous
    statement: the dashboard shall provide an intentionally designed supervision UX with session list, focused detail, event timeline, and terminal wall rather than a raw admin dump
    priority: must
    rationale: operational clarity is part of the feature, not an afterthought
```

## Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-SUP-001
    statement: the dashboard exposes a Supervision tab that lists live and recent worker sessions with control mode, task, run, heartbeat, and terminal availability
  - id: AC-SUP-002
    statement: selecting a live session opens a focused browser terminal, structured timeline, and spec-progress panel without leaving the dashboard
  - id: AC-SUP-003
    statement: the dashboard exposes a read-only wall that renders all active worker terminals in one view
  - id: AC-SUP-004
    statement: pausing a worker keeps the claim active, prevents new claims, records domain events, and allows later resume on the same session
  - id: AC-SUP-005
    statement: when a scoped Ralph run drains all remaining eligible work, the worker exits cleanly and records the shutdown in session state and domain events
  - id: AC-SUP-006
    statement: the canonical business event log contains typed supervision and review lifecycle events that can be queried by stream or aggregate
  - id: AC-SUP-007
    statement: when a design doc's linked tasks are all done and review is enabled, tx creates one pending review run and records review-eligible plus review-triggered events
  - id: AC-SUP-008
    statement: focused integration tests and Playwright coverage verify the live supervision flow, including websocket attach and wall rendering
```

# Non-goals

- Replacing `workers` and `task_claims`; supervision augments those primitives.
- Building a general-purpose event-sourcing runtime for every tx feature.
- Turning the dashboard into the only way to use Ralph.
- Making Pi mandatory for implementation loops.
- Supporting collaborative multi-writer control of the same live terminal.
