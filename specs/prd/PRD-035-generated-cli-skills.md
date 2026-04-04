---
kind: spec
spec_type: prd
name: PRD-035-generated-cli-skills
title: "PRD-035: Generated CLI Skills"
status: draft
version: 1
owners:
  - core
summary: Replace static onboarding files and Codex sub-agent profiles with generated, downloadable skill bundles derived from the tx CLI command/help corpus.
domain: onboarding
tags:
  - cli
  - skills
  - onboarding
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-17
---

# Summary

tx onboarding currently ships as a mix of static templates, top-level context
files, and Codex-specific sub-agent profiles. That material overlaps heavily
with `tx help`, drifts as commands evolve, and forces tx to maintain multiple
copies of the same guidance. tx should instead ship generated, downloadable
skill bundles for Claude Code and Codex, built from the same canonical command
corpus that powers the CLI help surface.

Implements via: [DD-035](../design/DD-035-generated-cli-skills.md)

## Problem

Today, onboarding is template-first:

- `tx init --claude` copies a static `CLAUDE.md` plus a small set of hand-written
  Claude skills from `apps/cli/src/templates/claude/**`.
- `tx init --codex` copies a static `AGENTS.md`, `.codex/agents/**`, and
  `.codex/rules/**`.
- The same concepts are repeated across `apps/cli/src/help.ts`, scaffold
  templates, README/docs, and agent profile files.
- Codex onboarding currently depends on sub-agent profiles, but the desired
  direction is skill-first rather than sub-agent-first.

This creates four concrete problems:

1. Help drift: command behavior changes require manual edits in several places.
2. Product inconsistency: Claude onboarding is partially skills-based, Codex
   onboarding is not.
3. Distribution friction: the primary deliverables are repo files, not portable
   installable bundles.
4. Context bloat: large top-level instruction files encourage monolithic context
   instead of targeted, selective skill loading.

## Solution

Make generated skills the primary onboarding artifact.

- Define a canonical command/help registry for tx.
- Generate concise, target-specific skill bundles from that registry plus a
  small grouping manifest.
- Publish downloadable release artifacts for `claude` and `codex`.
- Change `tx init --claude` and `tx init --codex` to install those generated
  skills by default.
- Treat `CLAUDE.md`, `AGENTS.md`, and Codex sub-agent profiles as legacy
  compatibility outputs rather than the primary product surface.

The key product decision is that tx should ship "skills for a host CLI" instead
of "a giant instruction file plus bespoke agents."

## Requirements

```yaml
ears_requirements:
  - id: EARS-SKILL-001
    kind: ubiquitous
    statement: the system shall derive onboarding skill content from the same canonical command/help corpus that powers `tx help`
    priority: must
  - id: EARS-SKILL-002
    kind: event_driven
    statement: when a skill bundle is generated for a supported target CLI form factor, the system shall emit deterministic skill files for that target
    priority: must
  - id: EARS-SKILL-003
    kind: event_driven
    statement: when `tx init --claude` or `tx init --codex` installs onboarding assets, the system shall install generated skills by default instead of static top-level context files or Codex sub-agent profiles
    priority: must
  - id: EARS-SKILL-004
    kind: optional
    statement: where a user explicitly requests legacy compatibility, the system shall emit minimal compatibility context files that point to the installed skills
    priority: should
  - id: EARS-SKILL-005
    kind: ubiquitous
    statement: the system shall package downloadable skill bundles for each supported target as release artifacts
    priority: must
  - id: EARS-SKILL-006
    kind: unwanted
    statement: if a supported command group is not mapped into a generated skill or an explicit exclusion list, then the build shall fail with actionable diagnostics
    priority: must
  - id: EARS-SKILL-007
    kind: state_driven
    statement: while a target requires target-specific metadata, trigger phrasing, or install layout, the system shall render target-specific wrappers around shared command content without duplicating the underlying help source
    priority: must
  - id: EARS-SKILL-008
    kind: ubiquitous
    statement: the system shall keep generated skill bundles concise enough to be usable as selective skills rather than a single monolithic context dump
    priority: must
```

## Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-SKILL-001
    statement: a clean generation run produces separate `claude` and `codex` skill bundle directories from the same command/help source without hand-editing generated files
  - id: AC-SKILL-002
    statement: `tx init --claude` installs generated Claude skills on a clean project and does not require a generated `CLAUDE.md` by default
  - id: AC-SKILL-003
    statement: `tx init --codex` installs generated Codex skills on a clean project and does not require `.codex/agents` sub-agent profiles or a generated `AGENTS.md` by default
  - id: AC-SKILL-004
    statement: release output includes downloadable archive artifacts for both targets and a manifest describing included skills and source command groups
  - id: AC-SKILL-005
    statement: adding, removing, or renaming a help entry without updating the skill grouping manifest causes generation or CI validation to fail
  - id: AC-SKILL-006
    statement: integration tests verify deterministic generation, scaffold behavior, compatibility mode, and target-specific metadata validation
```

# Non-goals

- Generating skills for third-party CLIs other than tx.
- Replacing user-authored project-specific skills or local workflows.
- Removing `tx help`, README guidance, or published docs.
- Forcing immediate deletion of all legacy onboarding files in the same release.
- Reintroducing Codex sub-agent profiles under a new generated name.
