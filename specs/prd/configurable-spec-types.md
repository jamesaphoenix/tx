---
kind: spec
spec_type: prd
doc_id: doc-51db774c31f3
name: configurable-spec-types
title: "Configurable Spec Types and Lint-Only Section Enforcement"
status: draft
version: 1
owners:
  - docs-team
summary: "Let projects define their own spec types, required sections, heading descriptions, and lint prompts in .tx/config.toml, enforced by tx spec lint rather than the parser."
domain: docs-specs
tags:
  - spec-types
  - configuration
  - lint
  - docs
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-08-13
---

# Summary

Spec structure in tx is fixed: five spec types (`prd`, `design`, `overview`,
`runbook`, `decision`) with hardcoded required markdown sections. This makes spec
structure configurable per project, adds user-defined spec types, and moves
section enforcement out of the parser into `tx spec lint`, where severity and
message wording are configurable per section.

# Problem

`MD_REQUIRED_SECTIONS_BY_SPEC_TYPE` in `packages/core/src/types/doc.ts` is the
only definition of required sections, and `validateRequiredSections` in the
markdown parser treats a missing heading as a hard parse failure. Three problems
follow.

First, teams cannot express their own documentation conventions. A team whose
design reviews hinge on a "Rollout" or "Security Review" section has no way to
require one, and a team that wants an `rfc` or `postmortem` spec type cannot have
one at all.

Second, enforcement is disproportionate. A missing heading blocks `tx doc add`,
`tx doc update`, `tx doc sync`, `tx doc render`, and even drift detection, which
reports "Unable to validate markdown structure for drift detection" rather than a
hash comparison. A structural preference should not break state reconciliation.

Third, the prompts agents receive are fixed. Teams driving spec adherence through
agents cannot tailor the message an agent sees when a section is missing, and
have nowhere to record what each heading is actually for.

Contrast this with what tx genuinely depends on: the frontmatter contract and the
embedded yaml blocks. `tx spec discover`, invariant sync, and FCI scoring locate
those blocks by fence language and top-level key anywhere in the document body,
never by heading. Headings are therefore a convention, enforced as if they were a
contract.

# Scope

Included:

- Required sections per spec type, defined in `[spec.types.*]` in `.tx/config.toml`.
- A `description` per section explaining what belongs under the heading, and a
  `message` per section overriding the lint prompt when it is missing.
- Per-type lint severity: `error`, `warn`, or `off`.
- User-defined spec types with their own sections, subdirectory, and optional
  markdown template file.
- Lint-only enforcement: `tx spec lint` reports missing sections; nothing else fails.
- Built-in defaults written into every scaffolded `.tx/config.toml` by `tx init`.
- `tx spec types` and `tx doc template` for inspecting the effective structure.
- Generated agent skills that embed the project's configured structure.

Excluded:

- Changing the frontmatter contract or the embedded yaml block schemas.
- Configurable EARS validation rules or invariant id formats.
- Migrating existing spec documents.
- Per-directory or per-branch configuration overrides.

# Requirements

```yaml
ears_requirements:
  - id: REQ-SPECCFG-001
    kind: ubiquitous
    statement: the system shall resolve required sections for each spec type from the [spec.types.*] tables in .tx/config.toml
    priority: must
    rationale: Section structure is the primary thing teams need to vary.
  - id: REQ-SPECCFG-002
    kind: ubiquitous
    statement: the system shall behave identically to the previous release when no spec type configuration is present
    priority: must
    rationale: Existing projects must not change behaviour on upgrade.
  - id: REQ-SPECCFG-003
    kind: event-driven
    when: a spec document is parsed
    statement: the system shall parse the document successfully regardless of which required sections are absent
    priority: must
    rationale: Section structure is a convention; it must not block doc sync or drift detection.
  - id: REQ-SPECCFG-004
    kind: event-driven
    when: tx spec lint runs
    statement: the system shall report each missing required section at the severity configured for that spec type
    priority: must
  - id: REQ-SPECCFG-005
    kind: optional
    where: a section defines a message template
    statement: the system shall render that template, substituting name, spec_type, section, description, and file placeholders
    priority: must
    rationale: Teams drive agent adherence through the wording of the prompt.
  - id: REQ-SPECCFG-006
    kind: ubiquitous
    statement: the system shall accept spec types that are not built in, scaffolding, storing, and linting them like built-in types
    priority: must
  - id: REQ-SPECCFG-007
    kind: ubiquitous
    statement: the system shall keep the frontmatter contract and the embedded yaml block schemas non-configurable
    priority: must
    rationale: tx spec discover, invariant sync, and FCI scoring depend on them.
  - id: REQ-SPECCFG-008
    kind: event-driven
    when: tx init scaffolds a config file
    statement: the system shall write the built-in spec type definitions into that file as active, editable configuration
    priority: must
    rationale: Discoverability; users should not have to read source to learn the defaults.
  - id: REQ-SPECCFG-009
    kind: ubiquitous
    statement: the system shall expose the effective spec type registry through tx spec types in both human and JSON form
    priority: must
  - id: REQ-SPECCFG-010
    kind: event-driven
    when: agent skills are generated or synced
    statement: the system shall embed this project's configured sections, descriptions, and lint prompts into the generated skill content
    priority: must
    rationale: Otherwise scaffolded skills instruct agents to write a structure the project does not use.
  - id: REQ-SPECCFG-011
    kind: unwanted
    if: a spec type's configuration removes a section that conventionally holds an embedded yaml block
    statement: the system shall emit an advisory warning rather than an error
    priority: should
  - id: REQ-SPECCFG-012
    kind: unwanted
    if: the configuration file is malformed or contains invalid values
    statement: the system shall fall back to the built-in defaults without throwing
    priority: must
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-SPECCFG-001
    statement: With no [spec.types.*] configuration, tx doc add and tx spec lint produce the same results as the previous release.
  - id: AC-SPECCFG-002
    statement: A document missing a required section syncs successfully and reports no drift, while tx spec lint reports the missing section and exits 1.
  - id: AC-SPECCFG-003
    statement: Setting a type's severity to warn makes tx spec lint exit 0 while still reporting; setting it to off silences the check.
  - id: AC-SPECCFG-004
    statement: A [spec.types.rfc] table makes tx doc add rfc scaffold into the configured subdirectory, persists kind rfc in SQLite, and lists the type in tx spec types.
  - id: AC-SPECCFG-005
    statement: A section's own message template is rendered with all placeholders substituted and no braces remaining.
  - id: AC-SPECCFG-006
    statement: A scaffolded .tx/config.toml contains the built-in section tables and parses back to the built-in defaults exactly.
  - id: AC-SPECCFG-007
    statement: Generated skills contain the project's configured headings, descriptions, and resolved lint prompts, and refresh when the config changes.
  - id: AC-SPECCFG-008
    statement: A document whose spec_type is no longer configured produces a warning without crashing any command.
```

# Non-goals

- Replacing EARS validation or invariant id conventions with configurable rules.
- A migration tool for restructuring existing spec documents.
- Configurable rules for the other `tx spec lint` sections (drift, coverage,
  index searchability, spec-test status).
