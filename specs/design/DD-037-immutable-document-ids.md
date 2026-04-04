---
kind: spec
spec_type: design
name: DD-037-immutable-document-ids
title: "DD-037: Immutable Document IDs Design"
status: draft
version: 1
owners:
  - core
summary: Add immutable `doc_id` identity to docs-as-primitives, migrate existing specs, and move public surfaces toward id-first lookup while preserving short-term compatibility.
domain: docs
tags:
  - docs
  - api
  - cli
  - migration
depends_on:
  - PRD-037-immutable-document-ids
  - DD-023-docs-as-primitives
supersedes: []
implements: PRD-037-immutable-document-ids
last_reviewed_at: 2026-03-27
---

# Summary

The current docs model uses `name` as the public identity. This design adds a
stable generated `doc_id`, stores it in both frontmatter and SQLite, and
converts the system to treat `name` as a slug. Compatibility is preserved where
reasonable, but canonical reads and writes become `doc_id`-based.

Implements: [PRD-037](../prd/PRD-037-immutable-document-ids.md)

# Architecture

## 1. Identity Model

Each managed spec document has three identifiers with distinct roles:

- `id`: existing integer SQLite row id for internal relational joins
- `doc_id`: new immutable stable external identity
- `name`: human-facing slug used for filename generation within a doc-kind folder

Rules:

- `doc_id` identifies a logical document lineage and never changes across that lineage's versions
- `name` is no longer globally unique across all doc kinds
- each persisted doc row is uniquely identified by `(doc_id, version)`
- uniqueness is enforced at `(kind, name, version)` for path safety
- frontmatter must include both `doc_id` and `name`

`doc_id` format should match tx-style readable IDs rather than opaque UUIDs, for
example `doc-xxxxxxxx` derived from random bytes or a hash-safe generator.

## 2. Schema Migration

Add a new migration that:

- adds `doc_id TEXT` to `docs`
- backfills each existing row with a generated `doc_id`
- recreates uniqueness/indexes to enforce:
  - unique `(doc_id, version)`
  - unique `(kind, name, version)`
- preserves existing foreign-key relationships because `doc_links`,
  `task_doc_links`, and `invariants` already reference the integer row id

No link-table shape change is required because relational joins continue using
the integer row id.

## 3. Frontmatter and File Migration

For every managed markdown spec:

- parse current frontmatter
- inject `doc_id` if missing
- rewrite file content in place while preserving existing `name`, `title`,
  `spec_type`, and prose sections

Validation changes:

- `frontmatter.doc_id` must match stored `doc.docId`
- `frontmatter.name` must match stored slug
- path resolution stays `specs/<kind-subdir>/<name>.md`

## 4. Repository and Service Changes

Extend `Doc` and related schemas with `docId: string`.

Repository additions:

- `findByDocId(docId, version?)`
- `findLatestByKindAndName(kind, name)`
- `findByCanonicalRef({ docId } | { kind, name })`

Service behavior:

- create: generate `doc_id`, require frontmatter `doc_id` to match generated
  value after normalization, and persist it
- get/update/delete/lock/link/render/source: resolve via `doc_id` first
- compatibility paths may accept name-based references but must reject
  ambiguity if multiple docs match

## 5. External Interfaces

Public interfaces shift to id-first semantics:

- REST API:
  - add `/api/docs/by-id/:docId`
  - keep existing `/api/docs/:name` compatibility route only for unambiguous
    lookup during transition
- MCP:
  - `tx_doc_get`, `tx_doc_update`, `tx_doc_lock`, and link operations accept
    `docId`; `name` remains optional compatibility input where practical
- CLI:
  - doc commands accept `--doc-id` or a canonical ref; legacy positional
    `name` remains temporarily supported for unambiguous docs
- dashboard client/server:
  - use `docId` in list payloads, selection state, and detail/source fetches
- types / agent SDK:
  - serialized doc payloads include `docId`
  - link payloads include both linked row id and external `docId`

## 6. Compatibility Strategy

Compatibility is transitional, not the new model.

- Existing docs without `doc_id` are upgraded by migration.
- Existing API/CLI/MCP name-based reads continue only when a single latest doc
  resolves for the given reference.
- If lookup by bare name becomes ambiguous, return an explicit error directing
  the caller to use `doc_id`.

# Interfaces

```yaml
interfaces:
  - name: docs_schema_migration
    type: sqlite
    semantics: add immutable `doc_id` plus new uniqueness rules while preserving relational row ids
  - name: markdown_frontmatter_doc_id
    type: file
    semantics: every managed spec markdown file includes `doc_id` alongside `name`
  - name: doc_id_lookup_surfaces
    type: cli+http+mcp+sdk+dashboard
    semantics: canonical document operations resolve by `doc_id`
  - name: name_compatibility_resolution
    type: cli+http+mcp
    semantics: legacy name-based operations resolve only when the reference is unambiguous
```

# Data Model

New `Doc` shape:

```ts
type Doc = {
  id: number
  docId: string
  hash: string
  kind: DocKind
  name: string
  title: string
  version: number
  status: DocStatus
  filePath: string
  parentDocId: number | null
  createdAt: Date
  lockedAt: Date | null
  metadata: Record<string, unknown>
}
```

SQLite changes:

```sql
ALTER TABLE docs ADD COLUMN doc_id TEXT;
-- backfill doc_id values
CREATE INDEX idx_docs_doc_id ON docs(doc_id);
CREATE UNIQUE INDEX idx_docs_doc_id_version ON docs(doc_id, version);
DROP INDEX idx_docs_name_version;
CREATE UNIQUE INDEX idx_docs_kind_name_version ON docs(kind, name, version);
```

Frontmatter header changes:

```yaml
kind: spec
spec_type: prd
doc_id: doc-abc12345
name: auth-flow
title: Auth Flow
status: draft
version: 1
```

# Invariants

```yaml
invariants:
  - id: INV-DOCID-001
    statement: every managed doc row and markdown spec file contains the same immutable `doc_id`
    severity: high
    verified_by:
      - test/integration/doc-doc-id-migration.test.ts
  - id: INV-DOCID-002
    statement: two documents with different `doc_id` values may share a slug across different doc kinds without becoming ambiguous in canonical id-based surfaces
    severity: high
    verified_by:
      - test/integration/doc-duplicate-slug-kinds.test.ts
  - id: INV-DOCID-003
    statement: name-based compatibility lookup fails with an explicit ambiguity error when multiple documents match the same slug
    severity: high
    verified_by:
      - test/integration/doc-name-compatibility.test.ts
  - id: INV-DOCID-004
    statement: task-doc links, doc links, and invariants remain attached to the same logical documents after `doc_id` migration
    severity: high
    verified_by:
      - test/integration/doc-doc-id-migration.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: the migration backfills DB `doc_id` values but does not rewrite markdown frontmatter
    impact: validation, render, and later updates fail because file and DB identity diverge
    handling: rewrite every managed markdown spec during migration and add fixture-based migration coverage
  - condition: compatibility lookup silently picks one of several docs sharing the same slug
    impact: callers mutate or delete the wrong document
    handling: detect ambiguity and require `doc_id`
  - condition: API and dashboard keep using slug-based identifiers internally after schema migration
    impact: duplicate-slug support exists in storage but not in user-facing flows
    handling: switch selection/detail routes and client cache keys to `docId`, then add dashboard integration coverage
  - condition: sync/import logic keys by legacy name-version pairs only
    impact: exported/imported docs can fork or duplicate identity
    handling: export/import `doc_id` and verify round-trip preservation in sync tests
```

# Verification

```yaml
verification:
  - requirement_id: EARS-DOCID-001
    test_type: integration
    target: test/integration/doc-doc-id-migration.test.ts
  - requirement_id: EARS-DOCID-004
    test_type: integration
    target: test/integration/doc-doc-id-migration.test.ts
  - requirement_id: EARS-DOCID-005
    test_type: integration
    target: test/integration/doc-duplicate-slug-kinds.test.ts
  - requirement_id: EARS-DOCID-007
    test_type: integration
    target: test/integration/doc-name-compatibility.test.ts
```

# Testing Strategy

- Add migration coverage against the shared singleton SQLite test layer.
- Add repository/service integration tests for `findByDocId` and ambiguous slug
  lookup.
- Add CLI/API/MCP integration tests for id-first operations and name-based
  compatibility.
- Update dashboard and agent-SDK tests where serialized doc payloads now expose
  `docId`.
- Keep fixtures deterministic and avoid per-test database creation.

# Open Questions

- [ ] Should `doc_id` be generated from secure random bytes, SHA256 of initial
      content, or another deterministic seed?
- [ ] Do we want canonical REST routes to become `/api/docs/:docId` directly, or
      should id-based routes be introduced first and slug routes deprecated over
      time?
- [ ] How much CLI backward compatibility is worth carrying for positional
      `name` arguments before forcing explicit `--doc-id`?

# Migration

1. Add schema migration for `doc_id` and new uniqueness indexes.
2. Backfill existing DB rows with generated `doc_id` values.
3. Rewrite markdown frontmatter to include `doc_id`.
4. Update export/import and serialized payloads to carry `docId`.
5. Switch id-first lookups across service, API, CLI, MCP, SDK, and dashboard.
6. Keep explicit compatibility shims for legacy name-based callers.

# References

- Plan file: `/Users/jamesaphoenix/.codex/plans/2026-03-27-doc-id-identity.md`
- Prior docs model: [DD-023](../design/DD-023-docs-as-primitives.md)
