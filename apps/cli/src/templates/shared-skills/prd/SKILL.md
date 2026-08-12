---
name: prd
description: Generate a detailed Product Requirements Document via `tx doc add prd`. Uses EARS requirement syntax with traceable IDs, acceptance criteria, and non-functional requirements. References plan via file path instead of embedding. Plan lives in ~/.claude/plans/<name>.md. Designed to be created alongside a companion `/design-doc`. Output lands in specs/prd/<name>.md.
argument-hint: <feature-name>
---

# Generate Product Requirements Document (PRD)

Create a comprehensive PRD using the tx doc primitive. PRDs are the source of truth for EARS requirements that feed into `tx spec discover` for spec-to-test traceability.

**PRD + Design Doc are companions.** A PRD defines WHAT and WHY. A design doc defines HOW. They are typically created together. The PRD is created first, then `/design-doc` reads it automatically.

## Naming Discipline

- tx assigns each doc an immutable `doc_id`. Treat human `name` slugs as globally unique for agent workflows, even though legacy duplicates can be resolved by kind or ID.
- Use distinct companion names such as `<feature>-prd` and `<feature>-design`.
- If another doc kind already uses a slug, choose a new PRD slug. For an existing duplicate, use `prd/<name>` or its stable `doc_id`.

## Migration Guidance

- When migrating existing markdown into tx-managed docs, preserve the source wording first, then add structure.
- If you extract sections programmatically, use a fence-aware parser. Headings inside fenced code blocks are content, not real section boundaries.

## Workflow State Machine

```
START
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 0: PLAN GATE                                    │
│                                                      │
│ Is there an active plan in this conversation?        │
│                                                      │
│ ├─ YES → Save plan to `~/.claude/plans/<name>.md` if not       │
│ │        already saved. Set `plan: ~/.claude/plans/<name>.md`  │
│ │        in frontmatter.                             │
│ │        → Continue to Step 1                        │
│ │                                                    │
│ └─ NO  → Tell the user:                              │
│          "No plan found. Run /plan first to create   │
│           one, then re-run /prd. Or describe the     │
│           feature and I'll draft the plan inline."   │
│                                                      │
│          If the user provided enough detail,          │
│          generate a plan yourself (research the      │
│          codebase, think through requirements,       │
│          edge cases, constraints), save to            │
│          `~/.claude/plans/<name>.md`.                           │
│          → Continue to Step 1                        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: SCAFFOLD via tx                              │
│                                                      │
│ tx doc add prd <name> --title "<title>"              │
│ ├─ SUCCESS → Continue to Step 2                      │
│ └─ FAIL (exists) → Edit existing doc                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: GATHER CONTEXT                               │
│                                                      │
│ Read: ARCHITECTURE.md, QUALITY.md, CLAUDE.md,        │
│       domain code, schema.ts, API routes,            │
│       existing specs (tx doc list, tx doc show)      │
│ → Continue to Step 3                                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: FILL DOCUMENT                                │
│                                                      │
│ Write `# Plan` first (reference to plan file).       │
│ Then fill all sections from plan file + codebase.    │
│ Convert plan items to EARS requirements.             │
│                                                      │
│ MINIMUM THRESHOLDS:                                  │
│   - EARS requirements: ≥ 10                          │
│   - Acceptance criteria: ≥ 5                         │
│   - NFRs: ≥ 8                                        │
│   - User personas: ≥ 1                               │
│                                                      │
│ RULE: No section may be left as a template/stub.     │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: SELF-AUDIT                                   │
│                                                      │
│ Re-read the plan. Every plan item must appear.       │
│ Check minimums. Check EARS syntax. No stubs.         │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: REFRESH + VALIDATE                           │
│                                                      │
│ tx doc sync prd/<name>                               │
│ tx spec discover --doc prd/<name>                   │
│ tx spec lint                                         │
│ ├─ PASS → Continue to Step 6                         │
│ └─ WARN/FAIL → Fix, re-validate                     │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: DISCOVER + LINK + REPORT                     │
│                                                      │
│ Step 5.5: SYNC PLAN FILE                             │
│                                                      │
│ Read the plan file from frontmatter `plan:` path.    │
│ Compare with what the doc now contains.              │
│ UPDATE the plan file to incorporate:                 │
│   - New requirements/constraints discovered          │
│   - Refined scope, decisions, error handling         │
│   - Acceptance criteria, risks, NFRs                 │
│ The plan file must reflect the FULL current state    │
│ of the feature - not just the initial draft.         │
│ This is a MANDATORY step, not optional.              │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: DISCOVER + LINK + REPORT                     │
│                                                      │
│ tx doc link <overview> <prd> (if overview exists)    │
│ tx doc show prd/<name>                               │
│ Print summary                                        │
│ Suggest: /design-doc <name> for companion doc        │
└─────────────────────────────────────────────────────┘
  │
  ▼
DONE
```

## Step 0 - Plan Gate

**The plan is the primary input.** Check for plan content in the conversation:

- If the user ran `/plan` or was in plan mode, the plan text is in the conversation. Write it to `~/.claude/plans/<name>.md` (relative to repo root).
- If a plan file already exists at `~/.claude/plans/<name>.md`, read it instead of overwriting.
- If no plan but the user gave detailed requirements, generate a plan yourself: research the codebase, think through requirements/edge cases/constraints, write the plan to `~/.claude/plans/<name>.md`.
- If no plan and the request is vague, ask the user to run `/plan` first or provide more detail.

The plan is saved as a standalone file at `~/.claude/plans/<name>.md` (relative to repo root). The doc's frontmatter gets `plan: ~/.claude/plans/<name>.md` and the `# Plan` section contains a reference link plus a brief summary, not the full verbatim content.

## Step 1 - Scaffold via tx

```bash
tx doc add prd $ARGUMENTS --title "<Human-Readable Title>"
```

Creates `specs/prd/<name>.md`. If exists, edit instead.

## Step 2 - Gather Context

Read these files:

- `docs/ARCHITECTURE.md` - system architecture
- `docs/QUALITY.md` - invariants and constraints
- `CLAUDE.md` - stack and conventions
- Relevant domain code under `packages/core/src/domains/`
- Database schema: `packages/infra/db/src/schema.ts`
- API routes: `apps/api/src/`
- Existing specs: `tx doc list`
- Overview spec if exists: `tx doc show <overview-name> --md`

## Step 3 - Fill the Document

### Required Frontmatter (already generated by tx)

```yaml
---
kind: spec
spec_type: prd
name: <name>
title: "<title>"
status: draft
version: 1
owners:
  - <team-or-person>
summary: <one-line summary>
domain: <product-area>
tags:
  - prd
depends_on: []
supersedes: []
implements: null
last_reviewed_at: <YYYY-MM-DD>
plan: ~/.claude/plans/<name>.md
---
```

Update `owners`, `summary`, `domain`, `tags`, `depends_on`.

### Body Structure - ALL sections MUST have real content

**`# Plan` comes first (as a reference to the plan file). Every subsequent section draws from the plan file content. No section may be a stub.**

### How to Convert Plan Items to EARS

| Plan Item Type | EARS Pattern | Example |
|---------------|-------------|---------|
| "System does X" | Ubiquitous | The system shall X |
| "When user does X, show Y" | Event-driven | When X, the system shall show Y |
| "If logged in, allow X" | State-driven | While authenticated, the system shall allow X |
| "Handle error X" | Unwanted | If X occurs, then the system shall Y |
| "Feature flag for X" | Optional | Where X is enabled, the system shall Y |
| "When state A and user does B" | Complex | While A, when B, the system shall C |

### Structured EARS Rules

- New PRDs should use the markdown-native EARS shape: `id`, `kind`, `statement`, `priority`, plus clause fields.
- Valid `kind` values are `ubiquitous`, `event-driven`, `state-driven`, `optional`, `unwanted`, and `complex`.
- Valid `priority` values are `must`, `should`, and `may`.
- Required clause fields are `when` for `event-driven`, `while` for `state-driven`, `if` for `unwanted`, and `where` for `optional`.
- `complex` requires at least one clause field: `when`, `while`, `if`, or `where`.
- `statement` must contain only the action clause, such as `the system shall create a draft post`. Do not repeat the trigger/state/condition text inside `statement`.
- The legacy decomposed format with `pattern:` and underscored names such as `event_driven` is backward compatibility only. Do not use it for new PRDs.

```markdown
# Plan

> Full plan: [~/.claude/plans/<name>.md](../~/.claude/plans/<name>.md)

<2-3 sentence summary of what the plan covers. The full plan lives in the file referenced above.>

# Summary

2-3 sentence summary of the feature and business value.

# Problem

## Current State
How things work today. Pain points.

## Impact
Quantify: user friction, lost revenue, operational cost.

# Scope

## Included
- Systems, packages, domains affected
- Reference specific paths: `apps/api`, `packages/core/src/domains/<domain>`

## Excluded
- What is explicitly NOT part of this feature

# User Personas

## Persona 1: <Name>

| Attribute | Detail |
|-----------|--------|
| Role | |
| Goals | |
| Pain Points | |
| Technical Proficiency | |

**MINIMUM: ≥ 1 persona.**

# Requirements

## EARS Requirements

All functional requirements use EARS. Each gets `REQ-<SCOPE>-NNN`. These become traceable invariants via `tx spec discover`.

### EARS Pattern Reference

| Pattern | Template | When to Use |
|---------|----------|-------------|
| Ubiquitous | The system shall `<action>` | Always-on behavior |
| Event-driven | When `<trigger>`, the system shall `<action>` | Response to event |
| State-driven | While `<state>`, the system shall `<action>` | State-dependent |
| Optional | Where `<feature>` is enabled, the system shall `<action>` | Feature-flagged |
| Unwanted | If `<condition>`, then the system shall `<action>` | Error/edge case |
| Complex | While `<state>`, when `<trigger>`, the system shall `<action>` | State + event |

### Core Requirements

```yaml
ears_requirements:
  - id: REQ-<SCOPE>-001
    kind: ubiquitous
    statement: the system shall <action>
    priority: must
    rationale: <why this matters>

  - id: REQ-<SCOPE>-002
    kind: event-driven
    when: <trigger>
    statement: the system shall <action>
    priority: must
    rationale: <why this matters>
```

### Authentication & Authorization Requirements

```yaml
ears_requirements:
  - id: REQ-<SCOPE>-100
    kind: ubiquitous
    statement: the system shall require a valid auth token for all protected endpoints
    priority: must
    rationale: security baseline
```

### Data Requirements

```yaml
ears_requirements:
  - id: REQ-<SCOPE>-200
    kind: <kind>
    statement: the system shall <action>
    priority: <must|should|may>
    rationale: <why>
```

### Integration Requirements

```yaml
ears_requirements:
  - id: REQ-<SCOPE>-300
    kind: <kind>
    statement: the system shall <action>
    priority: <must|should|may>
    rationale: <why>
```

### Error Handling Requirements

```yaml
ears_requirements:
  - id: REQ-<SCOPE>-400
    kind: unwanted
    if: <condition>
    statement: the system shall <action>
    priority: must
    rationale: <why>
```

**MINIMUM: ≥ 10 EARS requirements. Convert ALL plan items to EARS.**

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-001
    statement: Given <precondition>, when <action>, then <expected result>
```

**MINIMUM: ≥ 5 acceptance criteria.**

# Non-Functional Requirements

## Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001 | API response time (p95) | < 200ms |
| NFR-002 | Database query time (p95) | < 50ms |
| NFR-003 | Temporal workflow completion | < 30s |

## Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-010 | Uptime SLA | 99.9% |
| NFR-011 | Idempotent workflow execution | Zero duplicates |
| NFR-012 | Transactional outbox delivery | At-least-once |

## Security

| ID | Requirement |
|----|-------------|
| NFR-020 | All endpoints validate auth tokens via Effect HttpApi middleware |
| NFR-021 | Passwords hashed with bcrypt (cost >= 12) |
| NFR-022 | SQL injection prevented via Drizzle parameterized queries |
| NFR-023 | Rate limiting on auth endpoints |

## Observability

| ID | Requirement |
|----|-------------|
| NFR-030 | Structured logging via `@tx-agent-kit/logging` (no `console.*`) |
| NFR-031 | OpenTelemetry spans for key operations |
| NFR-032 | Langfuse tracing for AI operations (if applicable) |

## Data Retention

| ID | Requirement |
|----|-------------|
| NFR-040 | Retention policies for session/token tables |
| NFR-041 | Financial audit trails (`usage_records`, `credit_ledger`) - NO retention |

**MINIMUM: ≥ 8 NFRs across categories.**

# Success Metrics

| Metric | Baseline | Target | Measurement Window |
|--------|----------|--------|--------------------|

# Risks & Mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R-001 | | | | |

# Dependencies

| Dependency | Owner | Status | Risk |
|-----------|-------|--------|------|

# Non-goals

- Explicit exclusions

# Open Questions

- [ ] Questions requiring stakeholder input
```

## Step 4 - Self-Audit

Re-read the plan section. For every item in the plan, confirm it appears in at least one subsequent section. Check:
- ≥ 10 EARS, ≥ 5 ACs, ≥ 8 NFRs, ≥ 1 persona
- EARS IDs unique and sequential
- EARS kinds use the markdown-native values and every required clause field is present
- EARS statements contain only the action clause and do not duplicate `when`/`while`/`if`/`where`
- No stubs, no empty tables, no "..." placeholders
- Verify plan file exists at the path in frontmatter and its content is consistent with the doc sections

## Step 5 - Refresh and Validate

```bash
tx doc sync prd/<name>
tx spec discover --doc prd/<name>
tx spec lint
```

`tx doc sync` refreshes the stored document hash, document-derived invariants, and generated index atomically. The scoped discovery command maps tests without reconciling unrelated docs. Treat schema and parser errors as blocking. Coverage-oriented warnings after generation, such as missing task links or invariants without tests yet, should be surfaced but do not mean the PRD shape is invalid.

## Step 5.5 - Sync Plan File (MANDATORY)

After filling and validating the doc, **update the plan file** at the `plan:` frontmatter path to reflect everything the doc surfaced. The plan file must be the living source of truth - not a stale initial draft.

What to add to the plan file:
- New requirements, constraints, and error handling discovered while writing EARS
- Acceptance criteria summaries
- Refined scope (included/excluded)
- Risk mitigations
- Key decisions made during the PRD process
- NFR targets

Read the current plan file, merge in the new information, and write it back. Preserve the plan's structure but ensure it now covers the full feature scope as understood after the PRD.

## Step 6 - Discover, Link & Report

```bash
tx doc link <overview> <prd>     # if overview exists
tx doc show prd/<name>
```

## Companion: Design Doc

**This PRD is designed to be paired with a design doc.** After creating the PRD, suggest:

```
Run /design-doc <name> to create the companion design document.
The design doc will automatically read this PRD and map EARS requirements to invariants.
```

The design doc reads the PRD via `tx doc show <prd-name> --md` and maps every `must`-priority EARS requirement to an invariant + verification entry.

## Spec-Trace Integration

Once tests exist, annotate with invariant IDs:

```typescript
it('should issue tokens [INV-EARS-AUTH-001]', () => { ... })
// @spec INV-EARS-AUTH-001
```

Then run `tx spec discover --doc prd/<name>` followed by the scoped `tx spec fci`, `tx spec status`, `tx spec gaps`, and `tx spec matrix` commands. Use unscoped discovery only for a deliberate whole-checkout reconciliation.

## After Generation

1. Print output path (`specs/prd/<name>.md`).
2. Summarize: EARS count, AC count, NFR count, persona count.
3. List open questions.
4. **Suggest: `/design-doc <name>` for the companion design doc.**
5. If the plan file is modified later, update the `# Plan` summary and derived sections in this doc. If this doc's scope changes, update the plan file to stay consistent.
