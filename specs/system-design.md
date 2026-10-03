---
kind: spec
spec_type: overview
name: system-design
title: tx system overview
status: draft
version: 2
owners: [maintainers]
summary: "Tasks, specifications, plans and verification through shared services."
domain: task-spec
tags: [tasks, specs, plans, verification]
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-10-03
---

# Summary
tx provides local task and specification storage through the CLI, dashboard,
REST, MCP and TypeScript SDK. Use your existing coding agent to plan and implement.

# Problem
Task progress and specification evidence need durable, inspectable storage without
introducing another execution harness.

# Scope
Specs define requirements and invariants. Plan documents copy normal coding-agent
plans. Tasks attach to plans and retain dependency and hierarchy information.
Invariant annotations map enforcement sites and executable assertions; recorded
results and human sign-off establish completion.

# Components
Shared Effect services own task, document, sync and spec rules. Interfaces compose
those services. SQLite stores metadata and results; Markdown stores document content.
Git-backed streams retain historical compatibility. Dashboard cycles are planning.

# Data Flows
spec -> plan -> tasks -> implementation -> mapped tests -> recorded verification.
The four portable guides teach this workflow without starting agents or runners.

# Non-goals
Memory retrieval, orchestration, watchdog, Ralph, claims, messaging, bounded autonomy
and automatic decomposition or review. Historical data for retired features remains
stored without runtime controls.

# References
- [PRD](prd/lean-task-spec-prd.md)
- [Design](design/lean-task-spec-design.md)
- [Implementation plan](plan/lean-task-spec-plan.md)
