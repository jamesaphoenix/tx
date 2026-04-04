# Example: Contextual Prompt Bandit Subsystem Design

Source document pattern:

- `/<some-source-path>/specs/design/<subsystem-design>.md`

Concrete example used for this reference:

- `/Users/jamesaphoenix/Desktop/projects/just-understanding-data/octospark/specs/design/contextual-prompt-bandit.md`

Why this is a strong subsystem design example:

- It starts with tx-compatible metadata and plan context without stripping the source detail.
- It defines a hard subsystem boundary with explicit owns / does-not-own lists.
- It separates arm identity, policy config, decision context, and outcomes instead of mixing them.
- It includes concrete schemas, algorithms, API surface, integration flows, invariants, and deployment notes.

Representative excerpt:

```md
---
kind: spec
spec_type: design
name: contextual-prompt-bandit-source-design
title: "Contextual Prompt Bandit Source Design"
status: draft
version: 1
summary: "High-detail subsystem design source document for Octospark's contextual prompt bandit."
domain: experimentation
tags:
  - design
  - subsystem
  - bandit
  - example
depends_on:
  - contextual-prompt-bandit
implements: contextual-prompt-bandit
plan: ~/.codex/plans/contextual-prompt-bandit-design.md
---

# Plan

Plan file: [~/.codex/plans/contextual-prompt-bandit-design.md](~/.codex/plans/contextual-prompt-bandit-design.md)

This source example preserves the dense subsystem detail that informed the tx-managed companion documents.

# Summary

This document is a high-fidelity subsystem design source for Octospark's contextual prompt experimentation bandit.

# Detailed Source Material

## Subsystem Design: Contextual Prompt Experimentation Bandit

## 1. Purpose

An adaptive experimentation and decisioning engine for content-generation configs. It sits
between candidate generation and reward attribution — choosing which prompt/config variant to
run, observing outcomes, and continuously updating beliefs about which variants work best for
which contexts.

## 2. Subsystem Boundary

### Owns

- Experiment definitions and lifecycle
- Variant config registry (immutable, hashed)
- Prompt registry (executor + evaluator, versioned, immutable)
- Arm registration per experiment
- Golden reference library (human-curated evaluation targets)
- Decision policy (contextual Thompson sampling)
- Decision logging with propensities
- Delayed reward computation
- Posterior state updates

### Does NOT Own

- LLM text/image/video generation
- Post publishing
- Platform scraping / analytics collection
- Embedding computation
- AI tagging
- Credit/billing

## 3. Four Cleanly Separated Objects

| Object | What it is | Hashed? |
|--------|-----------|---------|
| Variant Config | The arm — what the policy chooses | Yes |
| Experiment Policy Config | How the bandit behaves | No |
| Decision Context | Observed before choice | No |
| Outcome | Observed after choice | No |

## 4. Config Hashing Strategy

Deterministic canonical JSON -> SHA-256.

Hash includes structural behavior:
- model provider/name/version
- prompt ids + versions
- decoding params
- retrieval config
- style config
- schema version

Hash excludes runtime context and outcomes:
- rendered prompt text
- timestamps and trace ids
- platform/account/content type
- policy params
- metrics
- embeddings
```

When a user hands you a handwritten subsystem spec of this quality, preserve the detailed sections. Do not reduce it to only `# Summary`, `# Interfaces`, and a tiny invariant list.
