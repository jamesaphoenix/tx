# Example: Octospark System Design Source

Source document pattern:

- `/<some-source-path>/specs/<system-design-doc>.md`

Concrete example used for this reference:

- `/Users/jamesaphoenix/Desktop/projects/just-understanding-data/octospark/specs/system-design.md`

Why this is a strong system design example:

- It is clearly broader than a single subsystem or PRD.
- It records cross-cutting constraints like tenancy, storage, platform support, deployment assumptions, and phased delivery priorities.
- It is explicit about legacy-to-rewrite migration context rather than hiding it.
- It is detailed enough to decompose into subsystem docs while still remaining the architectural source of truth.

Representative excerpt:

```md
---
kind: spec
spec_type: design
name: octospark-system-design-source
title: "Octospark System Design Source"
status: draft
version: 1
summary: "High-detail system design source document for the Octospark rewrite."
domain: platform
tags:
  - design
  - system
  - architecture
  - example
depends_on:
  - octospark-product-requirements
implements: octospark-product-requirements
plan: ~/.claude/plans/octospark-system-design.md
---

# Plan

Plan file: [~/.claude/plans/octospark-system-design.md](~/.claude/plans/octospark-system-design.md)

# Summary

This document is a source-level system design for the Octospark rewrite. It demonstrates how a system-wide design can carry tenancy, storage, workflow topology, platform support, deployment constraints, and product guardrails without flattening the cross-domain detail.

# Detailed Source Material

## Octospark — System Design

> Agent note: file paths in this document refer to the old `octospark-services` codebase. The new implementation lives in the rewrite repo and should follow the architecture described here when the concrete files do not exist yet.

> MVP priority: campaigns + manual upload first.

## 1. Tenancy Model

### Hierarchy

Organization
- Team A
- Team B

### Scale Targets

- total users: 1,000
- organizations: ~500
- teams per organization: 50 max
- users per team: 50 max

### Database Tables

- `users`
- `organizations`
- `teams`
- `organization_members`
- `team_members`
- `roles`
- `permissions`
- `invitations`

## 2. Assets

### Storage: Cloudflare R2

Asset storage must not be loss-making. All blob storage uses Cloudflare R2 across all environments.

### Storage Usage Model

The document carries explicit assumptions, monthly storage estimates, and cost calculations so the system boundary includes operational economics, not only software structure.
```

Use a system design example like this when the work spans multiple services or domains and the main job of the document is to define cross-cutting boundaries and runtime topology.
