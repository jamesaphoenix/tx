---
kind: spec
spec_type: design
doc_id: doc-e0437e3e9019
name: configurable-spec-types-design
title: "Spec Type Registry Design"
status: draft
version: 1
owners:
  - docs-team
summary: "Resolves a spec-type registry from .tx/config.toml and threads it through the parser, doc service, CLI lint, templates, and generated skills."
domain: docs-specs
tags:
  - spec-types
  - configuration
  - registry
  - lint
depends_on:
  - configurable-spec-types
supersedes: []
implements: configurable-spec-types
last_reviewed_at: 2026-08-13
---

# Summary

A pure `resolveSpecTypes(config)` function turns `[spec.types.*]` config into a
`SpecTypeRegistry`. Everything that used to consult the hardcoded
`MD_REQUIRED_SECTIONS_BY_SPEC_TYPE` constant now consults the registry instead.
Section checking moves out of `parseMdDocSync` into a separate
`lintSpecSections` function called by `tx spec lint`, so documents always parse.

# Architecture

Four layers, each depending only on the one above it.

**Config** (`packages/core/src/utils/toml-config.ts`). `TxConfig.spec` gains
`types: Record<string, SpecTypeConfig>` and `lintMessages: Record<string, string>`.
`readTxConfig` merges user tables over `DEFAULT_CONFIG.spec.types` per type and
per key, so a type declaring only `severity` keeps its default sections. Two new
helpers support this: `listTomlSections(toml, prefix)` enumerates table names the
hand-rolled parser could not otherwise discover, and `collectTomlTables` walks the
whole file once, merging repeated tables (later keys win) rather than stopping at
the first occurrence as `extractTomlValue` does.

`DEFAULT_CONFIG_TOML` interpolates `renderDefaultSpecTypesToml()`, which renders
the tables from `DEFAULT_CONFIG` itself. The scaffolded file and the in-code
defaults therefore cannot drift, and a round-trip test asserts it.

**Registry** (`packages/core/src/utils/spec-type-registry.ts`). `resolveSpecTypes`
is pure: it resolves each section's message through the per-section, then global,
then built-in fallback chain; computes `sectionsCustomized` by comparing headings
against the built-in list; derives `subdir`; adds the legacy `requirement` and
`system_design` kinds so path lookups keep working; and collects advisory
warnings when a block-bearing section is dropped.

**Enforcement** (`packages/core/src/utils/spec-section-lint.ts`).
`lintSpecSections(parsed, registry, ctx)` returns one `SectionLintFinding` per
missing section, each carrying its rendered message and the type's severity.
`validateRequiredSections` is deleted from the parser.

**Consumers**. The doc service resolves the registry per call from its content
root (not at layer construction) so config edits apply without a restart;
`kindSubdir` and `parseSpecTypeAsDocKind` take it as a parameter. The CLI adds
`config` and `sections` lint groups, plus `tx spec types` and `tx doc template`.
Skill generation fills a marker block in bundled SKILL.md files from the registry.

To let a project declare its own types, `DocKindSchema` and `MdSpecTypeSchema`
change from `Schema.Literal` unions to branded strings validated against
`SPEC_TYPE_NAME_PATTERN`. Membership is checked against the registry at the
service boundary instead. Migration 048 drops the `CHECK (kind IN (...))`
allow-list from the `docs` table.

# Interfaces

```yaml
interfaces:
  - name: resolveSpecTypes
    type: rpc
    semantics: Pure. Maps TxConfig to a SpecTypeRegistry with resolved messages, subdirs, customization flags, and advisory warnings. Never throws.
    contract: packages/core/src/utils/spec-type-registry.ts#resolveSpecTypes
  - name: lintSpecSections
    type: rpc
    semantics: Pure. Returns one finding per missing section at the type's severity, or a single warn finding for an unconfigured spec_type. Returns empty for task docs and for severity off.
    contract: packages/core/src/utils/spec-section-lint.ts#lintSpecSections
  - name: renderLintMessage
    type: rpc
    semantics: Substitutes {placeholder} tokens; unknown placeholders are left verbatim.
    contract: packages/core/src/utils/spec-type-registry.ts#renderLintMessage
  - name: listTomlSections
    type: rpc
    semantics: Returns unique TOML table names equal to a prefix or beginning with prefix + dot, in first-occurrence file order.
    contract: packages/core/src/utils/toml-config.ts#listTomlSections
  - name: tx spec types
    type: rpc
    semantics: Prints the effective registry. The --json form is the stable contract consumed by agents and skill generation.
    contract: apps/cli/src/commands/spec.ts#specTypes
  - name: tx doc template
    type: rpc
    semantics: Prints the scaffold for a spec type without writing to disk or the database.
    contract: apps/cli/src/commands/doc.ts#docTemplate
```

# Data Model

`SpecSectionConfig` is `{ slug, heading, description, message }`, where a null
message means "inherit". `SpecTypeConfig` adds `{ sections, severity, subdir,
template }`, with null `subdir` meaning "derive from the type name". The resolved
`SpecSectionDefinition` differs in one way: `message` is always a concrete string.

TOML shape, one table per section:

```
[spec.types.prd]
severity = "error"

[spec.types.prd.section.problem]
heading = "Problem"
description = "..."
message = "{name}: PRD is missing '# Problem'. ..."
```

A `sections = ["A", "B"]` array shorthand is also accepted for quick custom
types; per-section tables win when both are present.

Migration 048 rebuilds `docs` with `kind TEXT NOT NULL` and no allow-list,
following migration 046's pattern: foreign keys off for the rebuild, and the
self-reference written with the final table name (`REFERENCES docs(id)`), because
SQLite only rewrites a renamed table's own foreign keys when `foreign_keys = ON`.

# Invariants

```yaml
invariants:
  - id: INV-SPECCFG-001
    statement: With no spec type configuration present, the resolved registry equals the built-in defaults.
    severity: critical
    verified_by:
      - test/unit/spec-type-registry.test.ts
      - test/integration/spec-types-config.test.ts
  - id: INV-SPECCFG-002
    statement: A scaffolded .tx/config.toml parses back to exactly the built-in default config.
    severity: high
    verified_by:
      - test/unit/toml-config.test.ts
  - id: INV-SPECCFG-003
    statement: A spec document parses successfully regardless of which required sections are missing.
    severity: critical
    verified_by:
      - test/unit/spec-section-lint.test.ts
      - test/integration/spec-types-config.test.ts
      - test/integration/doc-schema-validation.test.ts
  - id: INV-SPECCFG-004
    statement: Every missing-section finding carries a fully substituted message with no remaining placeholder braces.
    severity: medium
    verified_by:
      - test/unit/spec-section-lint.test.ts
      - test/integration/spec-types-config.test.ts
  - id: INV-SPECCFG-005
    statement: A spec type whose severity is off produces no section findings.
    severity: medium
    verified_by:
      - test/unit/spec-section-lint.test.ts
  - id: INV-SPECCFG-006
    statement: A user-defined spec type round-trips through SQLite as its own kind value.
    severity: high
    verified_by:
      - test/integration/spec-types-config.test.ts
  - id: INV-SPECCFG-007
    statement: A document whose spec_type is absent from the registry yields exactly one warn finding and never fails a command.
    severity: high
    verified_by:
      - test/unit/spec-section-lint.test.ts
      - test/integration/spec-types-config.test.ts
  - id: INV-SPECCFG-008
    statement: Generated skills contain the project's configured headings, descriptions, and resolved lint prompts.
    severity: high
    verified_by:
      - test/integration/spec-types-config.test.ts
  - id: INV-SPECCFG-009
    statement: A malformed or unreadable config file resolves to the built-in defaults without throwing.
    severity: high
    verified_by:
      - test/unit/toml-config.test.ts
  - id: INV-SPECCFG-010
    statement: Heading matching is case-insensitive, whitespace-trimmed, heading-level agnostic, and ignores headings inside fenced code blocks.
    severity: medium
    verified_by:
      - test/unit/spec-section-lint.test.ts
  - id: INV-SPECCFG-011
    statement: Dropping a section that conventionally holds an embedded yaml block yields an advisory warning, never an error.
    severity: medium
    verified_by:
      - test/unit/spec-type-registry.test.ts
      - test/integration/spec-types-config.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: The config file is malformed, unreadable, or contains an invalid severity or type name.
    impact: Configuration would otherwise be partially applied or the command would crash.
    handling: readTxConfig keeps its never-throw contract, falling back per key; invalid type and slug names are skipped and invalid severities fall back to the default.
  - condition: A spec type is removed from config while documents of that type remain on disk.
    impact: Those documents have no section definition to check against.
    handling: lintSpecSections emits a single unknown_spec_type warning; parsing, sync, discovery, and FCI are unaffected because embedded blocks are found by fence, not heading.
  - condition: A design or PRD type is configured without its block-bearing section.
    impact: Agents stop being prompted to write invariants or requirements blocks, so spec coverage silently decays.
    handling: resolveSpecTypes returns an advisory warning, surfaced by the lint config group and by tx spec types.
  - condition: A type sets template to a path that does not exist.
    impact: Scaffolding would emit an empty or confusing document.
    handling: tx doc add exits 1 naming the missing file and the config key that referenced it.
  - condition: A table such as [spec.types.design] appears more than once in the file.
    impact: The first-occurrence-wins parser would silently ignore the later table.
    handling: collectTomlTables merges repeated tables, later keys winning.
  - condition: A project edits config after skills were synced.
    impact: Generated skills would describe a stale structure.
    handling: Skills carry an instruction to treat tx spec types --json as authoritative, and re-running tx skills sync re-renders the block.
```

# Verification

```yaml
verification:
  - requirement_id: REQ-SPECCFG-001
    test_type: integration
    target: test/integration/spec-types-config.test.ts
  - requirement_id: REQ-SPECCFG-002
    test_type: unit
    target: test/unit/toml-config.test.ts
  - requirement_id: REQ-SPECCFG-003
    test_type: integration
    target: test/integration/spec-types-config.test.ts
  - requirement_id: REQ-SPECCFG-004
    test_type: unit
    target: test/unit/spec-section-lint.test.ts
  - requirement_id: REQ-SPECCFG-005
    test_type: unit
    target: test/unit/spec-section-lint.test.ts
  - requirement_id: REQ-SPECCFG-006
    test_type: integration
    target: test/integration/spec-types-config.test.ts
  - requirement_id: REQ-SPECCFG-007
    test_type: integration
    target: test/integration/doc-schema-validation.test.ts
  - requirement_id: REQ-SPECCFG-008
    test_type: integration
    target: test/integration/spec-types-config.test.ts
  - requirement_id: REQ-SPECCFG-009
    test_type: integration
    target: test/integration/spec-types-config.test.ts
  - requirement_id: REQ-SPECCFG-010
    test_type: integration
    target: test/integration/spec-types-config.test.ts
  - requirement_id: REQ-SPECCFG-011
    test_type: unit
    target: test/unit/spec-type-registry.test.ts
  - requirement_id: REQ-SPECCFG-012
    test_type: unit
    target: test/unit/toml-config.test.ts
```

# Testing Strategy

## Unit Tests

`test/unit/toml-config.test.ts` covers `listTomlSections` (prefix matching,
ordering, dedupe, partial-segment rejection), per-section table parsing, the
array shorthand and its precedence, per-type merge behaviour, invalid-value
fallbacks, lint message overrides, and the `DEFAULT_CONFIG_TOML` round trip.

`test/unit/spec-type-registry.test.ts` covers registry composition, subdir
derivation including legacy kinds, message resolution precedence,
`sectionsCustomized` detection under case and whitespace variation, advisory
warnings, and `renderLintMessage` placeholder handling.

`test/unit/spec-section-lint.test.ts` covers findings per missing section,
severity mapping, message rendering, heading matching rules, fenced-code
exclusion, unknown spec types, and task documents.

Nothing is mocked; these functions are pure and take config as input.

## Integration Tests

`test/integration/spec-types-config.test.ts` drives the real CLI against a
temporary project. Fourteen numbered scenarios cover: default config lints clean;
missing sections do not block sync or drift; lint reports and exits 1; warn and
off severities; custom type scaffolding, subdirectory, SQLite kind, and listing;
custom message rendering; an unconfigured spec type; template file use and its
missing-file error; customized built-in sections switching to the generic
template with blocks still seeded; the advisory warning; `tx doc template`
previewing without writing; generated skills embedding and refreshing the
configured structure; `tx spec types --json` shape; and `tx init` scaffolding.

`test/integration/doc-schema-validation.test.ts` scenarios 2, 5, and 10 were
inverted from asserting parse rejection to asserting creation plus a lint
finding.

## Edge Cases

Repeated TOML tables, invalid type and section slugs, empty section lists, a
section list that drops a block-bearing heading, config removed after documents
exist, and template files with unknown placeholders.

# Open Questions

- [ ] Should `tx spec lint` gain a `--fix` that inserts missing headings with
      their configured descriptions as placeholder text?
- [ ] Should the API and dashboard docs-health endpoints reuse `lintSpecSections`
      instead of their duplicated placeholder check? Currently out of scope.

# Migration

Projects with no `[spec.types.*]` configuration keep the previous behaviour
exactly, because `readTxConfig` falls back to the built-in defaults. `tx init`
writes the defaults into new config files; existing files are untouched and may
be upgraded by copying the block from a freshly scaffolded config.

Migration 048 runs automatically and only widens the `docs.kind` column, so it is
safe on existing databases. It is a loosening and is not reversible without
re-adding the allow-list.

# References

- PRD: `specs/prd/configurable-spec-types.md`
- Migration: `migrations/048_docs_configurable_kinds.sql`, which follows the
  pattern documented in `migrations/046_docs_self_fk_repair.sql`
- CLAUDE.md doctrine: Rule 5 (Effect-TS patterns), Rule 8 (singleton test
  database), Rule 10 (Effect Schema for domain types)
