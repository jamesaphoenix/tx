---
kind: spec
spec_type: prd
doc_id: doc-d38909433478
name: lean-task-spec-prd
title: "Tasks, specs and plans"
status: draft
version: 1
owners:
  - docs-team
summary: "Task and spec driven development with plans, safe upgrades and four portable guides."
domain: lean-task-spec
tags:
  - prd
  - lean
  - task
  - spec
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-10-03
---

# Summary
Make tx a small, portable task and specification system. Users keep their coding
agent and save its plans alongside specs rather than adopting a second harness.

# Problem
Memory, execution loops, coordination and supervision obscure the useful task,
document and verification primitives and add unwanted installation ceremony.

# Scope
Tasks, dependencies, hierarchy, labels, documents, decisions, invariant evidence,
sync, CLI, REST, MCP, TypeScript SDK, dashboard and ordinary planning cycles.
Remove runtime agents, Ralph, watchdog, execution tracing, memory, claims, pins,
group context, gates, guards, reflection and automatic decomposition/review.

# Requirements
```yaml
ears_requirements:
  - id: REQ-LEAN-001
    kind: event-driven
    when: a user manages tasks
    statement: when a user manages tasks, the CLI shall require the tx task namespace
    priority: must
    rationale: one discoverable task command family
  - id: REQ-LEAN-002
    kind: ubiquitous
    statement: the system shall preserve existing task, spec, evidence and dormant historical records during upgrade and hydrate
    priority: must
    rationale: retiring capabilities must not delete user data
  - id: REQ-LEAN-003
    kind: event-driven
    when: historical streams are imported
    statement: when importing historical streams, the system shall validate recognised retired events, count and ignore them without projecting retired entities
    priority: must
    rationale: retain compatibility while rejecting malformed or unknown data
  - id: REQ-LEAN-004
    kind: ubiquitous
    statement: Spec Health shall expose evidence gaps and propagate read failures across supported interfaces
    priority: must
    rationale: unavailable evidence is not healthy evidence
  - id: REQ-LEAN-005
    kind: event-driven
    when: a user saves a coding-agent plan
    statement: when a user saves a coding-agent plan, tx shall support a spec-to-plan link and task attachment while preserving copied plan text and optional source provenance
    priority: must
    rationale: specs, plans and tasks form one inspectable hierarchy
```

# Acceptance Criteria
```yaml
acceptance_criteria:
  - id: AC-LEAN-001
    statement: old task commands fail with a replacement hint before opening a database
  - id: AC-LEAN-002
    statement: default onboarding installs exactly tx-tasks, tx-docs, tx-plan and verify-invariants, with no agents or runners
  - id: AC-LEAN-003
    statement: an upgraded v48 database retains old document links and dormant records
  - id: AC-LEAN-004
    statement: historical imports reject malformed payloads and failed commits without advancing progress
  - id: AC-LEAN-005
    statement: a plan copy and spec-to-plan edge survive export and hydrate
```

# Non-functional Requirements
Maintain deterministic embedded skills and portable Node/Bun packages. Preserve
complete dependency information in task responses. Keep defaults low ceremony.

# Out of Scope
Migrating downstream product repos, product email changes and adding a plan generator.

# Success Metrics
All retained interface and upgrade regressions pass. Published docs, npm packages
and binaries expose the same task/spec-only scope.
