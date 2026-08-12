---
name: overview-spec
description: Generate a system overview spec via `tx doc add overview`. Produces an architectural overview covering problem, scope, components, data flows, and non-goals. References plan via file path instead of embedding. Plan lives in ~/.claude/plans/<name>.md. Output lands in specs/<name>.md with tx-managed frontmatter.
argument-hint: <system-name>
---

# Generate Overview Spec

Create a system-level overview specification using the tx doc primitive. One overview per project - it is the root of the spec graph.

## Naming Discipline

- tx assigns each doc an immutable `doc_id`. Treat human `name` slugs as globally unique for agent workflows, even though legacy duplicates can be resolved by kind or ID.
- If an existing slug is duplicated, use `overview/<name>` or its stable `doc_id`; choose a distinct slug for every new doc.
- Keep the overview slug stable and distinct from companion PRDs and design docs.

## Migration Guidance

- When migrating an existing requirements or system-design document into an overview, preserve the original wording first, then reorganize it into tx-managed sections.
- If you extract sections programmatically, use a fence-aware parser. Headings inside fenced code blocks are content, not section boundaries.

## Workflow State Machine

```
START
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 0: PLAN GATE                                    │
│                                                      │
│ Is there an active plan in this conversation?        │
│ (i.e. the user used /plan or plan mode before        │
│  invoking this skill)                                │
│                                                      │
│ ├─ YES → Save plan to `~/.claude/plans/<name>.md` if not       │
│ │        already saved. Set `plan: ~/.claude/plans/<name>.md`  │
│ │        in frontmatter.                             │
│ │        → Continue to Step 1                        │
│ │                                                    │
│ └─ NO  → Tell the user:                              │
│          "No plan found in conversation. Run /plan   │
│           first to create one, then re-run           │
│           /overview-spec. Or describe what you want  │
│           and I'll draft the plan inline."            │
│                                                      │
│          If the user provides enough detail in their │
│          message to proceed, generate a plan         │
│          yourself (act as if you are in plan mode - │
│          research the codebase, think through scope, │
│          components, constraints). Save it to        │
│          `~/.claude/plans/<name>.md`.                          │
│          → Continue to Step 1                        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: SCAFFOLD via tx                              │
│                                                      │
│ tx doc add overview <name> --title "<title>"         │
│ ├─ SUCCESS → Continue to Step 2                      │
│ └─ FAIL (name exists) → tx doc show <name>           │
│          → Edit existing doc instead                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: GATHER CONTEXT                               │
│                                                      │
│ Read: ARCHITECTURE.md, QUALITY.md, CLAUDE.md,        │
│       domain code, existing specs (tx doc list)      │
│ → Continue to Step 3                                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: FILL DOCUMENT                                │
│                                                      │
│ Write `# Plan` section first (verbatim from Step 0). │
│ Then write all remaining sections, drawing from the  │
│ plan content + codebase context.                     │
│                                                      │
│ For EVERY section header:                            │
│ ├─ Plan has relevant content?                        │
│ │   → Use it + expand with codebase detail           │
│ ├─ Codebase provides signal?                         │
│ │   → Generate from analysis                         │
│ └─ Neither?                                          │
│     → Generate best analysis, mark [NEEDS REVIEW]    │
│                                                      │
│ RULE: No section may be left as a template/stub.     │
│       Every section MUST have real content.           │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: SELF-AUDIT                                   │
│                                                      │
│ Re-read the plan. Every plan item must appear        │
│ somewhere in the document. Re-read every section - │
│ no stubs, no empty tables.                           │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: VALIDATE                                     │
│                                                      │
│ tx spec lint                                         │
│ ├─ PASS → Continue to Step 6                         │
│ └─ WARN/FAIL → Fix issues, re-validate              │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5.5: SYNC PLAN FILE                             │
│                                                      │
│ Read the plan file from frontmatter `plan:` path.    │
│ UPDATE the plan file to incorporate everything       │
│ the doc surfaced: refined scope, components,         │
│ data flows, risks, dependencies, stakeholders.       │
│ The plan file must reflect the FULL current state.   │
│ This is a MANDATORY step, not optional.              │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: LINK & REPORT                                │
│                                                      │
│ tx doc link <overview> <related-docs>                │
│ tx doc show <name>                                   │
│ Print summary                                        │
└─────────────────────────────────────────────────────┘
  │
  ▼
DONE
```

## Step 0 - Plan Gate

**The plan is the primary input.** Check for plan content in the conversation:

- If the user ran `/plan` or was in plan mode before invoking this skill, the plan text is in the conversation context. Write it to `~/.claude/plans/<name>.md` (relative to repo root).
- If a plan file already exists at `~/.claude/plans/<name>.md`, read it instead of overwriting.
- If no plan exists and the user gave a detailed description, generate a plan yourself: research the codebase, think through scope/components/constraints, and save it to `~/.claude/plans/<name>.md`.
- If no plan and the request is vague, ask the user to run `/plan` first or provide more detail.

The doc's frontmatter gets `plan: ~/.claude/plans/<name>.md` and the `# Plan` section in the document body contains a reference link to the plan file, not the full content.

## Step 1 - Scaffold via tx

```bash
tx doc add overview $ARGUMENTS --title "<Human-Readable Title>"
```

Creates `specs/<name>.md` with correct frontmatter. If name exists, edit instead.

## Step 2 - Gather Context

Read these files:

- `docs/ARCHITECTURE.md` - current system architecture
- `docs/QUALITY.md` - invariants and constraints
- `CLAUDE.md` - stack, repo map, conventions
- Domain code under `packages/core/src/domains/` related to the system
- Existing specs: `tx doc list`

## Step 3 - Fill the Document

### Required Frontmatter (already generated by tx)

```yaml
---
kind: spec
spec_type: overview
name: <name>
title: "<title>"
status: draft
version: 1
owners:
  - <team-or-person>
summary: <one-line summary>
domain: <product-area>
tags:
  - overview
depends_on: []
supersedes: []
implements: null
last_reviewed_at: <YYYY-MM-DD>
plan: ~/.claude/plans/<name>.md
---
```

Update `owners`, `summary`, `domain`, and `tags`.

### Body Structure - ALL sections MUST have real content

**The `# Plan` section comes first. It contains a reference to the plan file and a brief summary. Every subsequent section draws from the plan content.**

```markdown
# Plan

> Full plan: [~/.claude/plans/<name>.md](../~/.claude/plans/<name>.md)

<2-3 sentence summary of what the plan covers. The full plan lives in the file referenced above.>

# Summary

2-3 sentence summary of what this system is and why it exists.

# Problem

What problem does this system solve? Who experiences it? Current state or workaround?

# Architecture

High-level architecture narrative with ASCII diagram:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Client      │────▶│  API         │────▶│  Worker      │
│  (web/mobile)│     │  (Effect     │     │  (Temporal   │
│              │◀────│   HttpApi)   │◀────│   workflows) │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │  Database    │
                    │  (Drizzle)   │
                    └─────────────┘
```

# Components

| Component | Package/App | Responsibility |
|-----------|-------------|---------------|

# Data Flows

## Flow 1: <Name>

```
[Source] → [Service] → [Store]
```

# Scope

## Included
## Excluded

# Non-goals

# Stakeholders

| Role | Who | Interest |
|------|-----|----------|

# Dependencies

| Dependency | Type | Status |
|-----------|------|--------|

# Key Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|

# Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|

# Open Questions

- [ ] Questions that need answers
```

## Step 4 - Self-Audit

Re-read the plan section. For each item in the plan, confirm it appears in at least one subsequent section. No stubs, no empty tables, no "..." placeholders. Verify plan file exists at the path in frontmatter and its content is consistent with the doc.

## Step 5 - Sync and Validate

```bash
tx doc sync overview/<name>
tx spec lint
```

Treat schema and parser errors as blocking. Coverage-oriented warnings after generation can be surfaced separately when the overview is structurally valid. Use the kind-scoped reference so legacy duplicate slugs cannot select the wrong document.

## Step 5.5 - Sync Plan File (MANDATORY)

After filling and validating the doc, **update the plan file** at the `plan:` frontmatter path to reflect everything the doc surfaced. The plan file must be the living source of truth - not a stale initial draft.

What to add to the plan file:
- Refined problem statement and scope
- Component inventory and data flows
- Stakeholders, dependencies, and risks discovered
- Success criteria and key decisions

Read the current plan file, merge in the new information, and write it back.

## Step 6 - Link & Report

```bash
tx doc link <overview-name> <prd-name>
tx doc show <name>
```

## After Generation

1. Print the output path (`specs/<name>.md`).
2. Confirm with `tx doc show <name>`.
3. Ask the user if they want to refine any section.
4. Suggest: `/prd <feature-name>` to create a companion PRD.

**Sync note:** If the plan file is modified later, update the `# Plan` summary in this doc to stay consistent. If this doc's scope changes, update the plan file.
