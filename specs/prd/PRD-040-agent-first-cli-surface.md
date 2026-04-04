---
kind: spec
spec_type: prd
name: agent-first-cli-surface
title: "PRD-040: Agent-First CLI Surface"
status: draft
version: 1
owners:
  - core
summary: Upgrade the tx CLI help and validation surface so agents can discover commands programmatically and recover from failures with explicit, machine-readable fixes.
domain: cli
tags:
  - cli
  - help
  - validation
  - agents
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-27
---

# Summary

`tx` is increasingly used by coding agents, but its CLI surface still behaves
like a human-first shell tool in a few critical places. Help is mostly static
terminal prose, validation errors are inconsistent, and several command paths
still terminate with ad hoc `process.exit()` calls. Agents can work around that,
but they waste context and retries doing it.

This slice makes the CLI easier to discover and recover from without requiring a
full parser rewrite. The surface should expose machine-readable help and schema
data, produce structured error envelopes when `--json` is present, and make
validation failures explicitly fixable.

Implements via: [DD-040](../design/DD-040-agent-first-cli-surface.md)

## Problem

Today the CLI has four concrete agent-hostile behaviors:

1. `tx help` is mostly terminal-only prose, so agents cannot inspect command
   structure without scraping strings.
2. Validation failures and unknown-command paths are inconsistent. Some commands
   throw, some print to stderr, and some call `process.exit()` directly.
3. `--json` mostly helps on success paths but does not reliably provide a
   machine-readable failure contract.
4. The CLI has no introspection surface equivalent to `schema` or
   command-catalog queries, so agents must infer shape from docs or examples.

This increases retries, token usage, and brittle command generation.

## Solution

Add an explicit agent-facing CLI contract on top of the existing command
surface:

- Introduce a typed command catalog for command discovery, aliases, and
  deprecations.
- Add `tx help --json` so agents can enumerate commands and inspect help without
  scraping terminal output.
- Add `tx schema [command]` so agents can request machine-readable command
  structure for a specific command or the full catalog.
- Introduce structured CLI usage/validation errors with stable error codes,
  hints, and usage/examples.
- Route top-level command resolution and the highest-value compound command paths
  through that shared error layer instead of direct `process.exit()` calls.
- Add an ESLint rule so newly added command modules are checked for ad hoc
  stderr/exit handling automatically rather than relying on manual review.

This PRD does not require a full replacement of the custom argv parser. It is a
surface-contract upgrade that can be layered onto the existing implementation.

## Requirements

```yaml
ears_requirements:
  - id: EARS-CLI-001
    kind: ubiquitous
    statement: the system shall expose machine-readable command discovery via `tx help --json`
    priority: must
  - id: EARS-CLI-002
    kind: ubiquitous
    statement: the system shall expose machine-readable command schemas via `tx schema [command]`
    priority: must
  - id: EARS-CLI-003
    kind: ubiquitous
    statement: when `--json` is present and command parsing or validation fails, the system shall emit a structured error envelope with a stable code, human message, and fix hint
    priority: must
  - id: EARS-CLI-004
    kind: ubiquitous
    statement: the system shall include exact usage text and at least one corrective example for missing-argument, invalid-flag, and unknown-command failures in text mode
    priority: must
  - id: EARS-CLI-005
    kind: ubiquitous
    statement: the system shall centralize top-level help and error rendering so command handlers do not need to duplicate generic failure formatting
    priority: must
  - id: EARS-CLI-006
    kind: event-driven
    statement: when a command is deprecated or aliased, the system shall expose that relationship in machine-readable discovery output
    priority: should
  - id: EARS-CLI-007
    kind: state-driven
    statement: when command scaffolding or docs creation rejects a valid project naming convention, the system shall return an actionable error that states the accepted format and the exact field that failed
    priority: should
```

## Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-CLI-001
    statement: `tx help --json` returns a parseable JSON catalog with top-level commands, subcommands, aliases, and summary text
  - id: AC-CLI-002
    statement: `tx schema dep block` returns parseable JSON describing usage, positional arguments, options, and examples for that command
  - id: AC-CLI-003
    statement: `tx dep block --json` without required arguments exits non-zero and returns a structured JSON error envelope instead of plain stderr prose
  - id: AC-CLI-004
    statement: `tx sync export --path old.json` exits non-zero with a clear fix that legacy file flags are unsupported and what to run instead
  - id: AC-CLI-005
    statement: `tx does-not-exist --json` exits non-zero with a machine-readable unknown-command error and a suggestion to run `tx help` or inspect similar commands
```

# Non-goals

- Replacing the custom argv parser with `@effect/cli` in this slice.
- Adding raw JSON payload input to every complex command.
- Adding `--dry-run` to every mutating command.
- Rewriting every existing help entry into a fully typed registry in one pass.
