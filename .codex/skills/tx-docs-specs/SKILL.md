---
name: "tx-docs-specs"
description: "Create, patch, lint, discover, trace, and complete docs-first specs. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Create, patch, lint, discover, trace, and complete docs-first specs."
---

# tx Docs And Specs

Use when the user is working in PRDs, DDs, invariants, decision tracking, or markdown export flows.

## Quick Start

- `tx doc add prd <feature>-prd --title "Title"`
- `tx doc sync <doc-ref>`
- `tx spec discover --doc <doc-ref>`
- `tx spec lint`

## Operational Safety

- Treat `<doc-ref>` as a globally unique name, a kind-scoped reference such as `design/auth-flow`, or a stable `doc_id`. Prefer distinct companion names such as `<feature>-prd` and `<feature>-design`; use `tx doc list --json` to recover IDs for legacy duplicate slugs.
- `tx doc sync <doc-ref>` refreshes the stored document record, document-derived invariants, and generated index in one transaction.
- `tx spec discover` reports every stale tag, comment, and manifest mapping by identity. It retains them by default; use `--dry-run` to preview all writes and `--prune` to delete stale auto-discovered mappings explicitly. Manual mappings are always preserved.
- Task state can remain shared while derived spec projections are scoped to the content checkout. Use `--state-root <main-repo>` with `--content-root <worktree>` when the roots differ, and confirm both with `tx diag doctor`.
- Clear drift with `tx doc sync <doc-ref>`. Never remove and recreate a document merely to update its hash.

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
- `tx doc remove`: Alias for tx doc rm
- `tx doc rm`: Remove latest mutable doc version
- `tx doc show`: Show doc details
- `tx doc sync`: Atomically refresh docs, invariants, and index
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

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
