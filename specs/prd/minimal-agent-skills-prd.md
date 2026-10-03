---
kind: spec
spec_type: prd
doc_id: doc-8b8134d9a433
name: minimal-agent-skills-prd
title: "Minimal agent skills"
status: draft
version: 1
owners:
  - docs-team
summary: "Low-ceremony task and document creation plus invariant mapping and verification."
domain: minimal-agent-skills
tags:
  - prd
  - minimal
  - agent
  - skills
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-10-03
---

# Summary
Ship three small portable guides: tx-tasks, tx-docs and verify-invariants.
Task guidance creates tasks; feature documentation creates paired PRD/design docs.
Invariant guidance maps declared IDs to enforcement sites and assertions, then records
actual verification evidence. Tags alone never mean a check passed.

# Problem
A large command catalogue and shipped agent/loop scaffolding add ceremony to projects
that only need creation guidance and traceability.

# Scope
Default skill onboarding and explicit skill sync. Existing repository runners and
opt-in watchdog integrations remain independently maintained.

# Requirements
```yaml
ears_requirements:
  - id: REQ-MINIMAL-001
    kind: ubiquitous
    statement: the default bundle shall install exactly three guides without agents, rules, hooks or Ralph
    priority: must
    rationale: keep onboarding small and portable
  - id: REQ-MINIMAL-002
    kind: event-driven
    when: skills are explicitly synced
    statement: when skills are synced, the system shall prune only known retired directories in a validated tx manifest and preserve custom skills
    priority: must
    rationale: support upgrades without losing local guidance
  - id: REQ-MINIMAL-003
    kind: ubiquitous
    statement: document guidance shall consult current configured templates and teach paired PRD/design creation
    priority: must
    rationale: avoid stale embedded project configuration
  - id: REQ-MINIMAL-004
    kind: ubiquitous
    statement: compiled binaries and the built npm CLI shall install identical current guides
    priority: must
    rationale: published installations must work outside the source checkout
```

# Acceptance Criteria
```yaml
acceptance_criteria:
  - id: AC-MINIMAL-001
    statement: default init emits three SKILL.md files and a manifest per selected host
  - id: AC-MINIMAL-002
    statement: malformed manifests and destination links fail before removal; repeated sync is unchanged
  - id: AC-MINIMAL-003
    statement: changing project templates changes live doc previews without regenerating guides
  - id: AC-MINIMAL-004
    statement: binary and built built npm CLI generation succeeds from an unrelated directory
```

# Non-goals
Remove task/spec primitives, impose task execution loops, delete repository runners,
or install specialised agents. No requirement for one mapping per invariant.
