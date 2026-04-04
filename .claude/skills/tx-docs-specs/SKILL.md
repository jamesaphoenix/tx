---
name: "tx-docs-specs"
description: "Create, patch, lint, discover, trace, and complete docs-first specs. Use when working in Claude Code and the user needs tx commands from this area."
metadata:
  short-description: "Create, patch, lint, discover, trace, and complete docs-first specs."
---

# tx Docs And Specs

Use when the user is working in PRDs, DDs, invariants, decision tracking, or markdown export flows.

## Quick Start

- `tx doc add prd <name> --title "Title"`
- `tx spec discover`
- `tx spec status`

## Included Commands

- `tx decision`: Manage decisions as first-class artifacts
- `tx decompose`: Create a task graph from a design spec
- `tx doc`: Manage docs-as-primitives
- `tx doc add`: Create a new doc
- `tx doc attach`: Attach a doc to a task
- `tx doc edit`: Open doc YAML in editor
- `tx doc link`: Link two docs
- `tx doc list`: List all docs
- `tx doc lock`: Lock a doc version
- `tx doc patch`: Create a design patch doc
- `tx doc rm`: Remove latest mutable doc version
- `tx doc rm`: Remove latest mutable doc version
- `tx doc show`: Show doc details
- `tx doc sync`: Re-read docs from disk and update DB hashes
- `tx doc validate`: Validate doc/task coverage and index search metadata
- `tx doc version`: Create new version from locked doc
- `tx invariant is deprecated. Use 'tx spec' instead.`
- `tx md-export`: Export tasks to markdown file
- `tx spec`: Docs-first spec-to-test traceability primitives
- `tx spec batch`: Import test run results from stdin
- `tx spec complete`: Record human completion sign-off
- `tx spec discover`: Refresh doc-derived invariants and upsert test mappings
- `tx spec fci`: Compute Feature Completion Index
- `tx spec gaps`: List uncovered invariants (no linked tests)
- `tx spec health`: Repo-level spec-driven development rollup
- `tx spec link`: Manually link an invariant to a test
- `tx spec lint`: All-in-one spec and doc checker
- `tx spec matrix`: Full invariant-to-test traceability matrix
- `tx spec run`: Record a pass/fail run result for a canonical test ID
- `tx spec status`: Explain scope closure state
- `tx spec tests`: List tests linked to an invariant
- `tx spec unlink`: Remove an invariant/test mapping
- `tx triangle is a deprecated alias for 'tx spec health'.`

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Claude Code, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
