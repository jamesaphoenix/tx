---
kind: spec
spec_type: design
doc_id: doc-fae227e3223e
name: minimal-agent-skills-design
title: "Minimal agent skills design"
status: draft
version: 1
owners:
  - docs-team
summary: "Four portable guides with safe retirement of tx-owned legacy skills."
domain: minimal-agent-skills
tags:
  - design
  - minimal
  - agent
  - skills
depends_on: []
supersedes: []
implements: minimal-agent-skills-prd
last_reviewed_at: 2026-10-03
---

# Summary
Bundle four canonical Markdown guides and embed their content as generated TypeScript
for identical standalone binary and Node behaviour. A parity test detects stale embeds.

# Architecture
`skills/generate.ts` declares the four IDs and writes deterministic manifests.
`skills/sync.ts` validates previous manifest entries and destination trees for all
selected targets before mutation. It prunes only retired IDs with exact owned paths.
Default scaffold calls that pipeline without agent, rule or Ralph copies.

# Interfaces
CLI generate/sync and existing init target flags remain. Sync summaries add `removed`.
Guides use live CLI help and document templates instead of a command catalogue.

# Data Model
Manifest shape is retained. The bundle has four entries and no embedded command index.
Task state remains in the main repository; content roots select isolated checkouts.

# Invariants
```yaml
invariants:
  - id: INV-MINIMAL-001
    statement: default onboarding ships exactly four guides without harness files
    severity: high
    verified_by:
      - test/integration/minimal-skills.test.ts
  - id: INV-MINIMAL-002
    statement: sync validates owned paths before pruning and preserves custom guides
    severity: high
    verified_by:
      - test/integration/minimal-skills.test.ts
      - test/integration/skills-sync.test.ts
  - id: INV-MINIMAL-003
    statement: document guidance consults live configured templates
    severity: medium
    verified_by:
      - test/integration/spec-types-config.test.ts
  - id: INV-MINIMAL-004
    statement: embedded guides equal canonical templates and work in standalone binaries
    severity: high
    verified_by:
      - test/integration/minimal-skills.test.ts
```

# Failure Modes
```yaml
failure_modes:
  - condition: previous manifest has an invalid or escaping install path
    impact: sync cannot safely establish ownership
    handling: reject before writes or removal
  - condition: a destination path is symlinked or has a conflicting type
    impact: writes could escape the project or destroy local content
    handling: preflight all targets before writes or removal
  - condition: generated embedded guides are stale
    impact: published output could disagree with source guidance
    handling: regenerate during build and fail the parity test
```

# Verification
Executable integration tests cover inventory, pruning, idempotence, path rejection,
configuration changes and template parity. Smoke-check compiled and built npm CLIs
from an unrelated directory. Release CI validates the exact commit before publication.

# Testing Strategy
Retain task/spec golden-path tests and retire watchdog tests with the feature. Replace only assertions for
intentionally removed default outputs. Check lint, types and build before publication.

# Open Questions
None.
