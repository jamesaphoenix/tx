---
kind: spec
spec_type: prd
name: PRD-039-skills-sync
title: "PRD-039: Skills Sync"
status: draft
version: 1
owners:
  - core
summary: Add a `tx skills sync` command that refreshes bundled Claude Code and Codex skills in a target project from the canonical tx-generated bundle output.
domain: onboarding
tags:
  - cli
  - skills
  - onboarding
depends_on:
  - PRD-035-generated-cli-skills
supersedes: []
implements: null
last_reviewed_at: 2026-03-27
---

# Summary

`tx skills generate` already renders the canonical Claude Code and Codex skill
bundles, but users still need to copy those files into projects by hand or rely
on `tx init` during first-time setup. tx needs an explicit sync path so skills
can be refreshed later from the canonical tx source without manual copy/paste.

Implements via: [DD-039](../design/DD-039-skills-sync.md)

## Problem

Today there is no dedicated "refresh installed skills" command.

- `tx init --claude` and `tx init --codex` install generated skills once.
- `tx skills generate` writes install-ready bundles, but it does not apply them
  to a target project.
- Updating bundled skills later requires manual file copying or bespoke local
  scripts.
- Claude Code and Codex do not ship a focused workflow skill that teaches users
  how to run a refresh.

This creates drift between the canonical tx skill templates and the skills that
projects actually have installed.

## Solution

Add `tx skills sync`.

- Generate canonical skill bundles in a temp location.
- Sync those managed skill files into a target project’s `.claude/skills` and/or
  `.codex/skills` directories.
- Update changed tx-managed files in place, create missing ones, and preserve
  unrelated custom skills.
- Bundle a `skills-sync` workflow skill into both Claude Code and Codex outputs
  so agents can discover and use the refresh flow directly.

## Requirements

```yaml
ears_requirements:
  - id: EARS-SKILLSYNC-001
    kind: event_driven
    statement: when a user runs `tx skills sync`, the system shall materialize the canonical tx skill bundle into the target project's Claude Code and/or Codex skill directories without requiring manual file copy steps
    priority: must
  - id: EARS-SKILLSYNC-002
    kind: event_driven
    statement: when a generated tx-managed skill file already exists with different content, the system shall update that file during sync
    priority: must
  - id: EARS-SKILLSYNC-003
    kind: unwanted
    statement: if a project contains unrelated user-authored skills outside the generated tx bundle, the system shall not remove or overwrite them during sync
    priority: must
  - id: EARS-SKILLSYNC-004
    kind: ubiquitous
    statement: the system shall expose the sync workflow as a bundled reusable skill for both Claude Code and Codex outputs
    priority: must
  - id: EARS-SKILLSYNC-005
    kind: ubiquitous
    statement: the system shall support targeting either Claude Code, Codex, or both from one sync command
    priority: must
```

## Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-SKILLSYNC-001
    statement: running `tx skills sync --project-dir <dir>` against an empty project creates install-ready `.claude/skills` and `.codex/skills` directories plus manifests
  - id: AC-SKILLSYNC-002
    statement: rerunning `tx skills sync` after editing a generated tx-managed skill file restores the canonical content while preserving unrelated custom skill directories
  - id: AC-SKILLSYNC-003
    statement: `tx skills sync --target codex` updates only Codex skill assets and leaves Claude assets untouched
  - id: AC-SKILLSYNC-004
    statement: generated Claude Code and Codex bundles include a `skills-sync` bundled skill that teaches how to refresh installed tx skills
```

# Non-goals

- Syncing non-skill onboarding assets such as `.codex/rules`, watchdog files, or
  legacy `CLAUDE.md` / `AGENTS.md` compatibility files.
- Deleting user-authored custom skills automatically.
- Introducing a database-backed registry for installed skills.
- Replacing `tx init` as the first-time onboarding path.
