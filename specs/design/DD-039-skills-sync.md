---
kind: spec
spec_type: design
name: DD-039-skills-sync
title: "DD-039: Skills Sync Design"
status: draft
version: 1
owners:
  - core
summary: Add a `tx skills sync` installer/updater that applies canonical generated tx skill bundles to a target project and bundle a reusable sync workflow skill for Claude Code and Codex.
domain: onboarding
tags:
  - cli
  - skills
  - scaffolding
depends_on:
  - PRD-039-skills-sync
  - DD-035-generated-cli-skills
supersedes: []
implements: PRD-039-skills-sync
last_reviewed_at: 2026-03-27
---

# Summary

This design extends the generated-skills work with a direct installation and
refresh path. `tx skills sync` uses the existing canonical bundle generator,
materializes target bundles in a temp directory, and then syncs those files into
the destination project. Only files present in the generated bundle are managed;
custom skill directories remain untouched.

Implements: [PRD-039](../prd/PRD-039-skills-sync.md)

# Architecture

## Flow

1. Parse `tx skills sync` flags for target selection and optional project dir.
2. Run `generateSkillBundles()` into a temp directory with `clean: true`.
3. For each selected target:
   - source root: `<tmp>/<target>/.claude/skills` or `<tmp>/<target>/.codex/skills`
   - destination root: `<project>/.claude/skills` or `<project>/.codex/skills`
4. Recursively compare source and destination files:
   - missing file -> write and record as `added`
   - same content -> keep and record as `unchanged`
   - different content -> overwrite and record as `updated`
5. Write the generated manifest at the destination root as part of the same sync.
6. Remove the temp directory and print a summary or JSON payload.

## Bundled Skill

Add one shared skill template:

- `apps/cli/src/templates/shared-skills/skills-sync/SKILL.md`

The existing generator already adapts bundled shared skills for Claude Code and
Codex, so adding this template to the bundled skill list makes it available in
both outputs automatically.

# Interfaces

```yaml
interfaces:
  - name: tx_skills_sync
    type: cli
    command: tx skills sync [--target <all|claude|codex>] [--project-dir <dir>] [--json]
    semantics: sync canonical tx-generated skills into the target project's Claude Code and/or Codex skill directories
  - name: bundled_skills_sync_skill
    type: file_bundle
    path: apps/cli/src/templates/shared-skills/skills-sync/SKILL.md
    semantics: reusable workflow skill that teaches agents how to refresh installed tx skills
```

# Data Model

No database changes are required.

Add file-backed result summaries for CLI reporting:

```ts
interface SkillSyncTargetSummary {
  target: "claude" | "codex"
  installRoot: ".claude/skills" | ".codex/skills"
  manifestPath: string
  added: string[]
  updated: string[]
  unchanged: string[]
}

interface SkillSyncResult {
  projectDir: string
  targets: SkillSyncTargetSummary[]
}
```

# Invariants

```yaml
invariants:
  - id: INV-SKILLSYNC-001
    statement: `tx skills sync` always installs from the same canonical generated bundle pipeline as `tx skills generate`
    severity: high
    verified_by:
      - test/integration/skills-sync.test.ts
  - id: INV-SKILLSYNC-002
    statement: sync overwrites changed tx-managed files but preserves unrelated custom skill directories
    severity: high
    verified_by:
      - test/integration/skills-sync.test.ts
  - id: INV-SKILLSYNC-003
    statement: generated Claude Code and Codex bundles both include the `skills-sync` bundled skill
    severity: medium
    verified_by:
      - test/integration/skills-generate.test.ts
      - test/integration/scaffold.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: destination path collides with a file where a directory is required
    impact: sync cannot materialize the generated skill tree
    handling: fail with an actionable error naming the conflicting path
  - condition: a target project contains a locally modified tx-managed skill file
    impact: local drift persists
    handling: overwrite the managed file during explicit sync and report it as updated
  - condition: a target project contains custom skills not emitted by tx
    impact: user-authored skills could be lost
    handling: leave files not present in the generated bundle untouched
```

# Verification

```yaml
verification:
  - requirement_id: EARS-SKILLSYNC-001
    test_type: integration
    target: test/integration/skills-sync.test.ts
  - requirement_id: EARS-SKILLSYNC-002
    test_type: integration
    target: test/integration/skills-sync.test.ts
  - requirement_id: EARS-SKILLSYNC-003
    test_type: integration
    target: test/integration/skills-sync.test.ts
  - requirement_id: EARS-SKILLSYNC-004
    test_type: integration
    target: test/integration/skills-generate.test.ts; test/integration/scaffold.test.ts
  - requirement_id: EARS-SKILLSYNC-005
    test_type: integration
    target: test/integration/skills-sync.test.ts
```

# Testing Strategy

- Add CLI integration tests for empty-project sync and update-in-place behavior.
- Reuse the existing bundle generation tests to assert the new bundled skill is
  present in both targets.
- Keep verification at the CLI/integration layer because the feature is
  file-system orchestration rather than pure business logic.

# Open Questions

- [ ] Should a future `--prune` mode remove stale tx-managed skill directories
  that no longer exist in the canonical bundle?

# Migration

No data migration is needed. Existing projects can opt in by running
`tx skills sync` after upgrading tx.

# References

- Plan file: `~/.codex/plans/2026-03-27-skills-sync.md`
- Generated skills PRD: [PRD-035](../prd/PRD-035-generated-cli-skills.md)
- Generated skills design: [DD-035](DD-035-generated-cli-skills.md)
