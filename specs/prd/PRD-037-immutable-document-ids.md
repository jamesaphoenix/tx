---
kind: spec
spec_type: prd
name: PRD-037-immutable-document-ids
title: "PRD-037: Immutable Document IDs"
status: draft
version: 1
owners:
  - core
summary: Introduce immutable `doc_id` identity for docs-as-primitives so filenames and slugs remain human-friendly without carrying global uniqueness.
domain: docs
tags:
  - docs
  - api
  - cli
  - migration
depends_on:
  - PRD-023-docs-as-primitives
supersedes: []
implements: null
last_reviewed_at: 2026-03-27
---

# Summary

tx currently treats document `name` as the global stable identity for specs.
That leaks storage constraints into authoring: users must invent globally unique
slugs even when two different folders naturally want the same basename.

tx should introduce an immutable `doc_id` per document and make that the
canonical identity across storage and APIs. `name` should remain a human-facing
slug and filename component, not the globally unique identifier.

Implements via: [DD-037](../design/DD-037-immutable-document-ids.md)

## Problem

The docs-as-primitives model currently conflates several concerns into `name`:

- identity for API, CLI, MCP, and SDK lookups
- uniqueness in the SQLite schema
- frontmatter validation contract
- slug/filename generation
- human-readable linking in docs and prompts

That creates avoidable friction:

- authors must invent unnatural names just to avoid collisions across folders
- a PRD and design doc cannot naturally share a basename
- renaming a doc becomes identity-sensitive rather than cosmetic
- public interfaces couple to mutable human slugs instead of stable identifiers

## Solution

Generate an immutable `doc_id` for every spec document and make that the
canonical identity.

- Every document gets a stable `doc_id` in frontmatter and storage.
- `doc_id` becomes the primary external lookup key for APIs and typed surfaces.
- `name` becomes a folder-local slug / filename component.
- Existing docs are migrated by backfilling IDs into frontmatter and the DB.
- Compatibility remains for selected name-based commands while slugs are still
  unambiguous, but the model is explicitly `doc_id`-first.

## Requirements

```yaml
ears_requirements:
  - id: EARS-DOCID-001
    kind: ubiquitous
    statement: the system shall assign every managed spec document an immutable `doc_id`
    priority: must
  - id: EARS-DOCID-002
    kind: ubiquitous
    statement: the system shall use `doc_id` as the canonical identity for persisted document metadata, link relationships, and typed external interfaces
    priority: must
  - id: EARS-DOCID-003
    kind: ubiquitous
    statement: the system shall treat document `name` as a human-facing slug and filename component rather than as the globally unique identifier
    priority: must
  - id: EARS-DOCID-004
    kind: event-driven
    statement: when existing docs are migrated, the system shall backfill `doc_id` into both the database and markdown frontmatter without losing doc links, task links, or invariants
    priority: must
  - id: EARS-DOCID-005
    kind: event-driven
    statement: when a PRD and a design doc use the same slug in different doc-kind folders, the system shall store and retrieve both documents without requiring renamed files
    priority: must
  - id: EARS-DOCID-006
    kind: event-driven
    statement: when a doc is renamed, the system shall preserve its `doc_id` and relational identity
    priority: should
  - id: EARS-DOCID-007
    kind: event-driven
    statement: when legacy name-based commands or routes are used for an unambiguous document, the system should continue to resolve them during the transition period
    priority: should
  - id: EARS-DOCID-008
    kind: unwanted
    statement: if two documents with different `doc_id` values share a slug, then the system shall not collapse them into a single identity
    priority: must
```

## Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-DOCID-001
    statement: creating a new managed doc persists an immutable `doc_id` in both the database row and markdown frontmatter
  - id: AC-DOCID-002
    statement: doc retrieval, update, lock, delete, and link flows can be executed by `doc_id` without relying on global unique names
  - id: AC-DOCID-003
    statement: a PRD and a design doc may share the same slug while remaining independently addressable
  - id: AC-DOCID-004
    statement: migrating an existing repo preserves doc links, task-doc links, invariant ownership, and rendered file paths
  - id: AC-DOCID-005
    statement: typed task/doc payloads expose `doc_id` so downstream consumers do not need to infer identity from slugs
  - id: AC-DOCID-006
    statement: published docs and help text describe `doc_id` as canonical and `name` as a slug/filename
  - id: AC-DOCID-007
    statement: integration tests cover migration, duplicate slugs across doc kinds, and compatibility behavior for legacy name-based lookup paths
```

# Non-goals

- Replacing numeric internal SQLite row IDs for relational joins.
- Redesigning the markdown-first document format beyond adding stable identity.
- Supporting duplicate slugs within the same doc-kind folder in this slice.
- Removing all name-based compatibility entry points in the same release.
