---
kind: spec
spec_type: plan
doc_id: doc-8ce471604b92
name: lean-task-spec-plan
title: "tx v0.20.0 implementation plan"
status: draft
version: 1
owners:
  - docs-team
summary: "Implementation steps for the approved tx v0.20.0 task and spec only release."
domain: lean-task-spec
tags:
  - plan
  - lean
  - task
  - spec
depends_on: []
supersedes: []
implements: lean-task-spec-design
last_reviewed_at: 2026-10-03
---

# tx v0.20.0 implementation plan

1. Preserve unrelated work in an isolated checkout. Record the current task and
   document the agreed tasks/spec-only boundaries.
2. Remove memory, bounded autonomy, coordination, watchdog, Ralph and execution
   services from core, CLI, REST, MCP, SDK and dashboard. Preserve historical
   database migrations and records; keep labels and ordinary planning cycles.
3. Require `tx task` for CRUD, dependencies, hierarchy, bulk actions and labels.
   Fail retired syntax before any state mutation and supply replacement hints.
4. Ship four short guides: task creation, paired PRD/design creation, plan copying
   and invariant mapping/verification. Install no agents, hooks or runners.
5. Add plan documents under `specs/plan/`, link specs to plans and tasks to plans.
   Copy the normal coding-agent plan verbatim beneath tx frontmatter and add an
   adjacent `.source` symlink when an original file already exists elsewhere.
6. Keep hydrate non-destructive. Validate historical stream payloads, count and
   ignore recognised retired events, reject unknown/malformed records and ensure
   commit failures are observable and atomic.
7. Add shared Spec Health across interfaces with explicit missing/failing evidence
   and error propagation. Verify its dashboard loading, empty and error behaviour.
8. Streamline the README/npm pages, docs homepage, navigation, search, crawler
   guides and metadata. Archive obsolete design material outside active docs.
9. Run focused regressions and adversarial review, then clean builds and all CI
   checks. Inspect tarballs, standalone binaries and generated skills.
10. Open a PR against main. After exact-head CI and review, release v0.20.0 and
    verify npm packages, release assets and the published documentation.
