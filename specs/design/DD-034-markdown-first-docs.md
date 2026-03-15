---
kind: spec
spec_type: design
name: markdown-first-doc-schemas
title: Markdown-First Doc Schemas
status: draft
version: 1
owners:
  - platform
summary: Define Effect Schema types for markdown-first spec/task documents with frontmatter and embedded YAML blocks.
domain: docs
tags:
  - docs
  - schema
  - markdown-first
depends_on:
  - dd-023-docs-as-primitives
supersedes: []
implements: markdown-first-docs
last_reviewed_at: 2026-03-15
---

## Summary

This design adds markdown-first document schemas to `packages/types/src/doc.ts` using Effect Schema.
The new model keeps prose in markdown and constrains machine-critical data via frontmatter and embedded YAML blocks.
Legacy YAML-first schemas remain intact for backward compatibility in this wave.

## Architecture

The parser pipeline targets two core document kinds:

1. `spec` docs: strict frontmatter + typed embedded block extraction.
2. `task` docs: open frontmatter + shared section/block extraction.

`MdParsedDocSchema` models the parsed output as a discriminated union (`spec` | `task`) and preserves block-level structure needed by downstream validation and tooling.

Required markdown sections by `spec_type` are modeled as constants:

- `prd`: Summary, Problem, Scope, Requirements, Acceptance Criteria
- `design`: Summary, Architecture, Interfaces, Data Model, Invariants, Failure Modes, Verification
- `overview`: Summary, Architecture, Components, Data Flows
- `runbook`: Summary, Symptoms, Diagnosis, Mitigation, Escalation
- `decision`: Summary, Context, Alternatives, Decision, Consequences

## Interfaces

```yaml
interfaces:
  - name: parse_markdown_doc
    type: rpc
    semantics: parse markdown into frontmatter, sections, and embedded typed blocks
    contract: packages/types/src/doc.ts#MdParsedDocSchema
  - name: validate_spec_frontmatter
    type: rpc
    semantics: validate spec identity, routing, and graph metadata from frontmatter
    contract: packages/types/src/doc.ts#MdFrontmatterSchema
```

## Data Model

### New Markdown-First Schemas

- `MdFrontmatterSchema`
- `MdEarsRequirementSchema`
- `MdInvariantSchema`
- `MdVerificationSchema`
- `MdInterfaceSchema`
- `MdFailureModeSchema`
- `MdAcceptanceCriterionSchema`
- `MdParsedDocSchema`

### Migration Mapping (Old YAML -> New Markdown)

| Old YAML field/schema | New markdown location |
|---|---|
| `kind`, `name`, `title`, `status`, `version` | Frontmatter (`MdFrontmatterSchema`) |
| `problem`, `solution`, `overview`, `architecture` prose fields | Markdown section bodies |
| `ears_requirements` | Embedded YAML block `ears_requirements` (`MdEarsRequirementSchema`) |
| `invariants` | Embedded YAML block `invariants` (`MdInvariantSchema`) |
| `testing_strategy` / traceability rows | Embedded YAML block `verification` (`MdVerificationSchema`) |
| interface/endpoint descriptions | Embedded YAML block `interfaces` (`MdInterfaceSchema`) |
| `failure_modes` | Embedded YAML block `failure_modes` (`MdFailureModeSchema`) |
| PRD acceptance criteria strings | Embedded YAML block `acceptance_criteria` (`MdAcceptanceCriterionSchema`) |

## Invariants

```yaml
invariants:
  - id: INV-DOC-001
    statement: markdown frontmatter must declare a valid spec_type when kind is spec
    severity: high
    verified_by:
      - test/integration/doc-schema-validation.test.ts
  - id: INV-DOC-002
    statement: embedded YAML blocks must validate against their corresponding Md* schema
    severity: high
    verified_by:
      - test/integration/doc-schema-validation.test.ts
```

## Failure Modes

```yaml
failure_modes:
  - condition: required design sections missing from markdown
    impact: spec health and validation produce incomplete downstream signals
    handling: enforce required section lists by spec_type during parse/validate
  - condition: embedded YAML block parses but fails schema validation
    impact: malformed structured data enters traceability and invariant workflows
    handling: fail validation with schema error details and source block type
```

## Verification

```yaml
verification:
  - requirement_id: REQ-DOC-001
    test_type: integration
    target: test/integration/doc-schema-validation.test.ts
  - requirement_id: REQ-DOC-002
    test_type: integration
    target: test/integration/doc-cli.test.ts
  - requirement_id: REQ-DOC-003
    test_type: unit
    target: packages/types/src/doc.ts
```
