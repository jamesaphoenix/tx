---
kind: spec
spec_type: prd
name: req-test
title: "Req Test"
status: draft
version: 1
owners:
  - docs-team
summary: One-line summary of Req Test
domain: product-area
tags:
  - prd
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-15
---

# Summary
This draft PRD acts as a minimal fixture for validating markdown-first PRD parsing and linting.

# Problem
Template placeholders in fixture specs create avoidable validation noise during doc pipeline checks.

# Scope
Included: a small but realistic auth-related requirement and acceptance check for validation tests.
Excluded: production authentication implementation details.

# Requirements
```yaml
ears_requirements:
  - id: REQ-REQTEST-001
    kind: ubiquitous
    statement: the documentation system shall parse and validate this draft PRD requirement without placeholder-field errors
    priority: must
    rationale: keeps regression fixtures representative and valid
```

# Acceptance Criteria
```yaml
acceptance_criteria:
  - id: AC-001
    statement: "bun apps/cli/src/cli.ts doc validate reports no placeholder-content issues for this document"
```

# Non-goals
- Defining the complete auth product roadmap in this fixture document
