# Example: Contextual Prompt Bandit PRD

Source document pattern:

- `/<some-source-path>/specs/prd/<feature-prd>.md`

Concrete example used for this reference:

- `/Users/jamesaphoenix/Desktop/projects/just-understanding-data/octospark/specs/prd/contextual-prompt-bandit.md`

Why this is a strong PRD example:

- It is tx-native instead of handwritten freeform markdown.
- It keeps product scope and user value separate from implementation detail.
- The EARS block is parser-friendly and uses stable IDs.
- The companion design relationship is implied by scope and naming, not by leaking schemas into the PRD.

Representative excerpt:

```md
---
kind: spec
spec_type: prd
name: contextual-prompt-bandit
title: "Contextual Prompt Bandit"
status: draft
version: 1
summary: "Product requirements for Octospark's contextual prompt experimentation and reward loop."
domain: experimentation
tags:
  - prd
  - experimentation
  - bandit
depends_on:
  - octospark-product-requirements
plan: ~/.claude/plans/contextual-prompt-bandit.md
---

# Plan

Plan file: [~/.claude/plans/contextual-prompt-bandit.md](~/.claude/plans/contextual-prompt-bandit.md)

# Summary

The contextual prompt bandit chooses which immutable prompt/configuration variant should run for an eligible generation request, logs the decision with enough data for offline analysis, and updates its policy as reward signals arrive.

# Problem

Octospark can generate content, publish it, and collect analytics, but that alone does not produce a reusable policy for choosing better prompt and model configurations over time.

# Scope

Included:
- experiment definitions and lifecycle
- immutable prompt and variant configuration registry
- contextual decisioning
- decision logging with propensities
- internal-eval, post-metric, and blended reward modes

Excluded:
- actual text, image, video, or audio generation
- publishing to social platforms
- analytics collection from platform APIs
- billing and credit accounting

# User Personas

- Growth Operator
- Campaign Manager
- Platform Engineer

# Requirements

```yaml
ears_requirements:
  - id: REQ-CONTEXTUAL-BANDIT-001
    kind: event-driven
    when: "a team defines an experiment arm"
    statement: "when a team defines an experiment arm, the system shall register or reference an immutable prompt and variant configuration for that arm."
    priority: must
  - id: REQ-CONTEXTUAL-BANDIT-002
    kind: event-driven
    when: "an eligible generation request asks for a decision"
    statement: "when an eligible generation request asks for a decision, the system shall choose exactly one arm and return the resolved configuration plus decision metadata."
    priority: must
  - id: REQ-CONTEXTUAL-BANDIT-007
    kind: unwanted
    if: "a reward update for the same decision, reward source, and window is submitted more than once"
    statement: "if a reward update for the same decision, reward source, and window is submitted more than once, then the system shall accept it idempotently without double-counting posterior updates."
    priority: must
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-CONTEXTUAL-BANDIT-001
    statement: "Creating or reusing an arm records immutable prompt and variant identities that can be referenced across experiments."
  - id: AC-CONTEXTUAL-BANDIT-003
    statement: "Submitting the same reward window twice does not increment the posterior twice."
```

# Non-Functional Requirements

- Decision latency must stay low enough to sit in the generation path.
- Decision and outcome records must be append-only or idempotent.
- Reward attribution must remain explainable through stored context and policy metadata.
```

Bias toward this style when the user wants a real PRD: problem and scope first, EARS requirements next, implementation detail deferred to the companion design doc.
