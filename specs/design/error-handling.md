---
kind: spec
spec_type: design
name: error-handling
title: Error Handling
status: draft
version: 1
owners:
  - team
summary: Draft system design guidance for consistent error handling across tx services.
domain: platform
tags: []
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-15
---


# Summary
System design guidance for consistent error handling across tx services using Effect-TS tagged errors.

# Architecture
All errors use `Data.TaggedError` with explicit union types. Services return `Effect<T, E>` where E is a discriminated union. No raw try/catch in service code.

# Interfaces
```yaml
interfaces:
  - name: error_handler
    type: rpc
    semantics: all service errors are tagged and typed
    contract: packages/types/src/errors.ts
```

# Data Model
Errors are represented as `Data.TaggedError` instances with structured fields for context (id, message, cause).

# Invariants
```yaml
invariants:
  - id: INV-ERR-001
    statement: all service errors must be tagged with Data.TaggedError
    severity: high
    verified_by:
      - test/integration/core.test.ts
```

# Failure Modes
```yaml
failure_modes:
  - condition: untyped error thrown in service code
    impact: error union becomes unknown, breaking typed error handling
    handling: wrap in appropriate TaggedError before propagating
```

# Verification
```yaml
verification:
  - requirement_id: REQ-ERR-001
    test_type: integration
    target: test/integration/core.test.ts
```
