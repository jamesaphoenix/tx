---
kind: spec
spec_type: prd
doc_id: doc-123edb25d441
name: paired-prd-dd-ralph-workflow-prd
title: "PRD-038: PRD/DD Pair Workflow For RALPH"
status: draft
version: 1
owners:
  - core
summary: Standardize non-trivial execution work on paired PRD and design docs, with tx tasks as the living implementation plan.
domain: orchestration
tags:
  - prd
  - ralph
  - workflow
  - docs
  - task-graph
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-27
---

# Summary
tx should standardize on a simple execution contract for non-trivial work:

- a paired PRD and design doc define the authoritative intent and design
- the `tx` task graph captures the live execution plan
- RALPH loops, human-in-loop examples, and scaffolded workflow guidance all use
  the same contract

The goal is to remove stale standalone implementation-plan files from the
default path without removing the ability to draft plans before writing specs.

# Problem
The repo currently mixes two competing models:

- newer doctrine says non-trivial work should be formalized as PRD/design-doc
  pairs
- several human-in-loop examples and workflow prompts still teach
  `Plan implementation for $task > plan.md`

That inconsistency creates the wrong execution habit:

- agents generate a second planning artifact after the design doc already exists
- the task graph stops being the canonical execution plan
- humans have to reconcile `plan.md`, linked specs, and `tx` tasks instead of
  reviewing one authoritative queue plus the paired docs

RALPH prompts are also too loose today. They tell agents to attach "a spec or
implementation plan" rather than the paired PRD/design-doc structure we want as
the default.

# Solution

Standardize every default workflow surface around the same rule:

- for non-trivial work, create or link a paired PRD and design doc
- attach the PRD to the task as `implements`
- attach the design doc as `references`
- decompose implementation into `tx add`, `tx dep block`, `tx dep unblock`,
  and status changes rather than writing a persistent `plan.md`

Human-in-loop examples should review the task graph plus linked docs instead of
a standalone plan file. RALPH prompts should explicitly teach the same behavior.

# Scope
Included:
- top-level workflow docs such as `AGENTS.md`, `CLAUDE.md`, package READMEs,
  and published docs pages that still show `plan.md`-based execution
- scaffold templates for Claude/Codex onboarding
- shared workflow guidance for task/spec loops and planner agents
- RALPH executor prompt text and its prompt-contract tests

Excluded:
- changing the docs storage model or `task_doc_links`
- forcing the shell script itself to auto-create PRD/design-doc pairs
- removing plan-mode tooling used to draft specs before PRD/DD formalization

# Requirements
```yaml
ears_requirements:
  - id: REQ-RALPHPAIR-001
    kind: ubiquitous
    statement: the system shall describe paired PRD and design docs as the default prerequisite for non-trivial RALPH execution work
    priority: must
    rationale: workflow docs and prompts need one canonical contract
  - id: REQ-RALPHPAIR-002
    kind: event-driven
    when: a human-in-loop example is shown
    statement: when a human-in-loop example is shown, the system shall use tx tasks and dependencies as the execution plan instead of writing or executing a standalone plan.md file
    priority: must
    rationale: the tx task graph should remain the living execution plan
  - id: REQ-RALPHPAIR-003
    kind: event-driven
    when: a RALPH executor prompt describes linked specs
    statement: when a RALPH executor prompt describes linked specs, the system shall instruct agents to attach the PRD as implements and the design doc as references
    priority: must
    rationale: task-doc linkage should reflect the paired-doc contract explicitly
  - id: REQ-RALPHPAIR-004
    kind: event-driven
    when: a non-trivial task is missing one half of the PRD/design pair
    statement: when a non-trivial task is missing one half of the PRD/design pair, the system shall direct the agent to create follow-up docs work or block on the missing doc before large implementation proceeds
    priority: should
    rationale: missing design context should be surfaced early instead of hidden in ad hoc planning
  - id: REQ-RALPHPAIR-005
    kind: event-driven
    when: docs-first quickstart examples create specs
    statement: when docs-first quickstart examples create specs, the system shall show creating and linking both the PRD and design doc before running spec status or completion commands
    priority: must
    rationale: quickstarts shape the default habit across the repo
  - id: REQ-RALPHPAIR-006
    kind: unwanted
    if: user-facing workflow docs still teach Execute plan.md as the default implementation step for non-trivial work
    statement: if user-facing workflow docs still teach Execute plan.md as the default implementation step for non-trivial work, then validation coverage shall fail
    priority: should
    rationale: stale examples would reintroduce the deprecated workflow
```

# Acceptance Criteria
```yaml
acceptance_criteria:
  - id: AC-RALPHPAIR-001
    statement: AGENTS, CLAUDE, scaffold templates, package READMEs, and published docs pages no longer show a default human-in-loop flow based on plan.md followed by Execute plan.md
  - id: AC-RALPHPAIR-002
    statement: docs-first quickstart examples show creating a PRD slug and a design slug, linking them, and running spec status/complete against the design doc
  - id: AC-RALPHPAIR-003
    statement: the main RALPH executor prompt and scaffolded RALPH prompt explicitly mention paired PRD/design docs plus tx doc attach commands with implements and references link types
  - id: AC-RALPHPAIR-004
    statement: planner and task-spec guidance describe the tx task graph as the execution plan and stop asking for standalone implementation-plan files in the default path
  - id: AC-RALPHPAIR-005
    statement: focused automated tests cover the RALPH prompt contract and the standardized workflow docs
```

# Non-goals
- Replacing the existing plan-mode workflow for drafting PRD/DD content.
- Adding a new CLI command that auto-generates a PRD/design-doc pair.
- Enforcing paired docs at the database level for every task in this slice.
