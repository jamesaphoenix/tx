---
kind: spec
spec_type: design
doc_id: doc-991279fd2ba5
name: paired-prd-dd-ralph-workflow-design
title: "DD-038: PRD/DD Pair Workflow For RALPH Design"
status: draft
version: 1
owners:
  - core
summary: Update workflow docs, planner guidance, and RALPH prompts so paired PRD/design docs plus tx tasks become the default execution contract.
domain: orchestration
tags:
  - design
  - prd
  - ralph
  - workflow
  - docs
  - task-graph
depends_on:
  - paired-prd-dd-ralph-workflow-prd
supersedes: []
implements: paired-prd-dd-ralph-workflow-prd
last_reviewed_at: 2026-03-27
---

# Summary
This change is documentation and prompt-contract work, not a storage change.
The implementation updates the workflow surfaces that shape user and agent
behavior:

- quickstart and human-in-loop examples
- scaffold templates and shared workflow skills
- planner agent guidance
- the main and scaffolded RALPH executor prompts

Implements: [PRD-038](../prd/paired-prd-dd-ralph-workflow-prd.md)

# Architecture
## 1. Workflow Docs

Replace `plan.md`-driven human-in-loop examples with a two-stage flow:

1. inspect `tx show <task>` and ensure the paired PRD/design docs are linked
2. decompose the work into `tx` subtasks and dependencies, review the task
   graph, then execute approved ready work

This applies to:

- `AGENTS.md`
- `CLAUDE.md`
- package/app READMEs
- published docs pages such as getting-started and primitives index

## 2. Docs-First Quickstarts

Docs-first snippets should show:

- `tx doc add prd <feature>-prd`
- `tx doc add design <feature>-design`
- `tx doc link <feature>-prd <feature>-design`
- `tx spec status --doc <feature>-design`
- `tx spec complete --doc <feature>-design --by <human>`

Using the design doc as the status/complete scope aligns the example with the
invariants and verification data that live in the design document.

## 3. Planner And Task-Spec Guidance

Planner/task-spec instructions should treat the `tx` task graph as the execution
plan:

- decompose from linked PRD/design docs
- add subtasks and blockers instead of writing `plan.md`
- create docs follow-up work if a non-trivial task is missing one half of the
  pair

## 4. RALPH Prompt Contract

The executor prompt should explicitly tell agents to:

- read `tx show <task-id>` for linked docs
- attach the PRD with `--type implements`
- attach the design doc with `--type references`
- create follow-up docs work or block when a non-trivial change lacks the pair

No shell logic changes are required beyond prompt text because task-doc linkage
already exists.

# Interfaces
```yaml
interfaces:
  - name: workflow_examples
    type: rpc
    contract: docs
    semantics: human-in-loop and quickstart examples use paired PRD/design docs plus tx tasks as the execution plan
  - name: planner_contract
    type: rpc
    contract: agent_profile
    semantics: planner guidance decomposes from linked PRD/design docs and avoids standalone implementation-plan files
  - name: task_spec_skill
    type: rpc
    contract: skill
    semantics: shared task/spec workflow guidance teaches PRD as implements and design as references
  - name: ralph_prompt_contract
    type: rpc
    contract: script:scripts/ralph.sh
    semantics: executor prompt references paired PRD/design docs and tx task-graph mutation commands
```

# Data Model
No database or external API schema changes are required.

The only persisted additions in this slice are the new PRD/DD pair documents and
their link to the parent `tx` task for the change.

# Invariants
```yaml
invariants:
  - id: INV-RALPHPAIR-001
    statement: default workflow docs for non-trivial work do not teach Execute plan.md as the implementation step
    severity: high
    verified_by:
      - test/integration/prd-dd-workflow-docs.test.ts
  - id: INV-RALPHPAIR-002
    statement: the main RALPH prompt contract teaches paired PRD/design doc attachment with implements and references link types
    severity: high
    verified_by:
      - test/integration/ralph-script.test.ts
  - id: INV-RALPHPAIR-003
    statement: planner and shared task-spec guidance treat the tx task graph as the living execution plan
    severity: medium
    verified_by:
      - test/integration/prd-dd-workflow-docs.test.ts
```

# Failure Modes
```yaml
failure_modes:
  - condition: only the top-level docs are updated while package READMEs or scaffold templates keep the old plan.md flow
    impact: users continue copying stale workflow examples depending on which surface they read
    handling: cover the curated workflow surfaces with a file-content integration test
  - condition: the RALPH prompt mentions paired docs but omits explicit implements/references attachment guidance
    impact: agents attach docs inconsistently and tasks lose semantic linkage
    handling: assert the exact prompt guidance in the RALPH script integration test
  - condition: quickstart snippets create only a PRD and run spec status on the wrong doc
    impact: the examples drift from the PRD/DD pair contract and undercut the design-doc verification path
    handling: update every quickstart snippet to show paired docs and design-doc status/complete commands
```

# Verification
```yaml
verification:
  - requirement_id: REQ-RALPHPAIR-001
    test_type: integration
    target: test/integration/prd-dd-workflow-docs.test.ts
  - requirement_id: REQ-RALPHPAIR-002
    test_type: integration
    target: test/integration/prd-dd-workflow-docs.test.ts
  - requirement_id: REQ-RALPHPAIR-003
    test_type: integration
    target: test/integration/ralph-script.test.ts
  - requirement_id: REQ-RALPHPAIR-004
    test_type: integration
    target: test/integration/ralph-script.test.ts
  - requirement_id: REQ-RALPHPAIR-005
    test_type: integration
    target: test/integration/prd-dd-workflow-docs.test.ts
  - requirement_id: REQ-RALPHPAIR-006
    test_type: integration
    target: test/integration/prd-dd-workflow-docs.test.ts
```

# Testing Strategy
- Add a text-level integration test that reads the curated workflow files and
  asserts that stale `plan.md` execution guidance is gone and paired PRD/design
  language is present.
- Extend the existing `ralph-script` integration test to assert the new prompt
  contract strings around paired-doc attachment.
- Run the focused integration tests rather than the full suite for this change,
  because no runtime behavior beyond prompt/doc content is being modified.

# Open Questions
- [ ] Decide later whether tx should grow a first-class `tx doc add pair` helper
  for the manual two-command PRD/design-doc flow.

# Migration

This is an in-place migration of workflow guidance.

- existing docs and templates are edited in place
- historical plan-mode skills remain supported for drafting specs
- no task or doc data migration is required

# References

- Plan file: `/Users/jamesaphoenix/.codex/plans/2026-03-27-prd-dd-ralph-standardization.md`
- Supporting spec: [PRD-036](../prd/PRD-036-task-spec-linkage-and-open-export.md)
