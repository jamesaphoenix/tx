---
kind: spec
spec_type: design
name: agent-first-cli-surface-design
title: "DD-040: Agent-First CLI Surface Design"
status: draft
version: 1
owners:
  - core
summary: Add a typed command catalog, JSON help/schema introspection, and a shared CLI error envelope so tx becomes easier for agents to discover and self-correct.
domain: cli
tags:
  - cli
  - help
  - validation
  - agents
depends_on: []
supersedes: []
implements: agent-first-cli-surface
last_reviewed_at: 2026-03-27
---

# Summary

This design adds an agent-first contract to `tx` without rewriting the whole
CLI parser. The core additions are:

1. A typed command catalog for discovery, aliases, deprecations, and command
   lookup.
2. A renderer that derives `tx help --json` and `tx schema [command]` from that
   catalog plus existing per-command help text.
3. A shared CLI error type and formatter that can render either human-readable
   guidance or machine-readable JSON envelopes.

The slice intentionally focuses on top-level command resolution and the
highest-value compound command paths. It should be straightforward to extend the
same helpers across the rest of the CLI after this lands.

Implements: [PRD-040](../prd/PRD-040-agent-first-cli-surface.md)

# Architecture

## 1. Command Catalog

Add a new typed command metadata module in `apps/cli/src/help-registry.ts`.

It models:

- canonical command key
- one-line summary
- parent command, when compound
- aliases
- deprecation target
- subcommand list
- whether the command requires the database/runtime

This catalog becomes the authoritative index for:

- `tx help --json`
- `tx schema [command]`
- top-level command lookup and suggestions
- future skills/help generation work from [DD-035](./DD-035-generated-cli-skills.md)

The existing long-form `commandHelp` prose remains in `help.ts` for now, but it
is no longer the only discoverability surface.

## 2. Schema Extraction

`tx schema` should not require every command help entry to be rewritten into a
fully typed object in this slice. Instead:

- the catalog resolves the command key and relationship graph
- a lightweight parser extracts `Usage`, `Arguments`, `Options`, `Subcommands`,
  and `Examples` sections from the existing help text
- the result is normalized into a JSON structure

That provides immediate introspection coverage for the current surface while
preserving backwards compatibility with the existing help corpus.

## 3. Error Envelope

Add a shared `CliUserError` shape in a dedicated helper module, for example
`apps/cli/src/cli-errors.ts`.

Suggested fields:

```ts
interface CliUserErrorShape {
  code: string
  message: string
  hint?: string
  usage?: string
  examples?: string[]
  command?: string
  details?: Record<string, unknown>
  exitCode: number
}
```

Renderer behavior:

- text mode:
  - print the primary message
  - print `Hint:` when present
  - print `Usage:` when present
  - print examples when present
- `--json` mode:
  - emit one JSON object to stdout:

```json
{
  "ok": false,
  "error": {
    "code": "cli/missing-argument",
    "message": "Missing required argument <task-id>.",
    "hint": "Run `tx dep block <task-id> <blocker-id>`.",
    "usage": "tx dep block <task-id> <blocker-id> [--json]",
    "examples": ["tx dep block tx-abc123 tx-def456"],
    "command": "dep block"
  }
}
```

## 4. Integration Points

Update:

- `apps/cli/src/cli.ts`
- `apps/cli/src/utils/parse.ts`
- selected compound commands such as:
  - `apps/cli/src/commands/dep-compound.ts`
  - `apps/cli/src/commands/sync.ts`
  - `apps/cli/src/commands/skills.ts`

Top-level changes in `cli.ts`:

- replace ad hoc help branching with a shared `resolveHelpRequest(...)`
- add `schema` command handling
- centralize unknown-command rendering and suggestions
- detect `--json` once and pass that into the final error renderer

Command-level changes:

- replace direct `process.exit()` on touched paths with `CliUserError` or
  `CliExitError`
- upgrade missing-argument and invalid-flag messages to include exact fixes

## 5. Pragmatic Scope Boundary

This slice does not attempt to normalize every command handler at once. The
initial target is:

- all top-level command resolution
- help and schema output
- shared parse helpers
- `dep`
- `sync`
- `skills`

Other commands can migrate to the same helper over follow-up slices.

## 6. Lint Ratchet

Add a custom ESLint rule, `tx/require-cli-user-errors`, and configure it
against the CLI command root rather than a hard-coded list of command names.

- enforcement root: `apps/cli/src/commands/`
- extra inclusion: `apps/cli/src/utils/parse.ts`
- temporary ignore list: legacy command files that still use ad hoc error paths

This keeps new command files covered automatically while allowing the existing
legacy debt to be burned down incrementally.

# Interfaces

```yaml
interfaces:
  - name: tx_help_json
    type: cli
    command: tx help --json
    semantics: returns a machine-readable command catalog for agent discovery
  - name: tx_help_command_json
    type: cli
    command: tx help <command> [<subcommand>] --json
    semantics: returns machine-readable metadata and parsed sections for one command
  - name: tx_schema
    type: cli
    command: tx schema [command] [subcommand]
    semantics: returns machine-readable usage, arguments, options, and examples for a command or the full catalog
  - name: tx_json_error_envelope
    type: cli
    command: any tx command with --json on failure
    semantics: returns a structured error envelope with a stable code and correction guidance
```

# Data Model

No database schema changes.

Add file-backed CLI metadata types:

```ts
interface CommandCatalogEntry {
  key: string
  summary: string
  parent?: string
  aliases?: string[]
  deprecatedTo?: string
  subcommands?: string[]
  requiresDb?: boolean
}

interface ParsedCommandSchema {
  key: string
  summary: string
  usage: string[]
  arguments: Array<{ name: string; required: boolean; description?: string }>
  options: Array<{ flags: string[]; valueName?: string; description?: string }>
  subcommands: Array<{ key: string; summary?: string }>
  examples: string[]
  aliases: string[]
  deprecatedTo?: string
}
```

# Invariants

```yaml
invariants:
  - id: INV-CLI-001
    statement: `tx help --json` and `tx schema` resolve commands from the same catalog used for help lookup and alias handling
    severity: high
    verified_by:
      - test/integration/cli-help-schema.test.ts
  - id: INV-CLI-002
    statement: when `--json` is present, CLI usage and validation failures return a structured error envelope instead of unstructured prose
    severity: high
    verified_by:
      - test/integration/cli-help-schema.test.ts
  - id: INV-CLI-003
    statement: touched command handlers do not terminate via direct `process.exit()` for expected user-facing validation failures
    severity: medium
    verified_by:
      - test/integration/cli-help-schema.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: catalog keys and legacy help entries drift apart
    impact: help lookup and schema output become inconsistent
    handling: validate that every catalog key has help text and fail tests on missing coverage
  - condition: the help parser fails to extract a section from legacy prose
    impact: schema output is incomplete for that command
    handling: return best-effort parsed output plus raw help text and add tests for commands that need richer coverage
  - condition: command handlers keep calling process.exit directly
    impact: JSON error envelopes are bypassed and cleanup consistency regresses
    handling: migrate touched commands in this slice and enforce the new command root with `tx/require-cli-user-errors`, using a temporary ignore list for legacy debt
  - condition: numbered spec filenames are rejected by doc scaffolding due to a stricter lowercase name validator
    impact: docs-first workflows fail on the project's own spec naming convention
    handling: document the mismatch here and follow up by aligning doc naming validation with repository conventions
```

# Verification

```yaml
verification:
  - requirement_id: EARS-CLI-001
    test_type: integration
    target: test/integration/cli-help-schema.test.ts
  - requirement_id: EARS-CLI-002
    test_type: integration
    target: test/integration/cli-help-schema.test.ts
  - requirement_id: EARS-CLI-003
    test_type: integration
    target: test/integration/cli-help-schema.test.ts
  - requirement_id: EARS-CLI-004
    test_type: integration
    target: test/integration/cli-help-schema.test.ts
  - requirement_id: EARS-CLI-005
    test_type: integration
    target: test/integration/cli-help-schema.test.ts
```

# Testing Strategy

Use CLI integration tests that spawn the real Bun entrypoint and assert on both
stdout/stderr and exit codes. Cover:

- top-level `help` and `schema`
- specific compound command schema output
- unknown-command behavior
- missing-argument behavior
- invalid flag/value behavior
- legacy sync flag rejection

Keep the tests targeted and deterministic; they do not require a full repo
integration sweep.

# Open Questions

- [ ] Should JSON errors be emitted on stdout only, or duplicated to stderr for parity with human mode?
- [ ] Should `tx schema` be a pure alias for `tx help --json`, or remain a narrower machine-oriented surface?
- [ ] How aggressively should this slice migrate existing command handlers away from direct `process.exit()` calls?

# Migration

- Preserve existing text help output and `tx help <command>` behavior.
- Add the new JSON discovery surfaces without breaking current scripts.
- Migrate touched commands to the new error contract first, then expand
  coverage in follow-up slices.

# References

- [PRD-040](../prd/PRD-040-agent-first-cli-surface.md)
- [DD-035](./DD-035-generated-cli-skills.md)
- [DD-003](./DD-003-cli-implementation.md)
- Plan: `/Users/jamesaphoenix/.codex/plans/2026-03-27-agent-first-cli-hardening.md`
