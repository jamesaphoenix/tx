---
name: "tx-observability-traces"
description: "Inspect queue health, diagnostics, dashboards, run traces, and recent failures. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Inspect queue health, diagnostics, dashboards, run traces, and recent failures."
---

# tx Observability And Traces

Use when the user is debugging tx behavior, stalled runs, or dashboard/API status.

## Quick Start

- `tx diag doctor`
- `tx trace list`
- `tx trace errors`

## Included Commands

- `tx dashboard`: Start API server + dashboard and open in browser
- `tx diag`: Diagnostics
- `tx diag dashboard`: Start API server + dashboard UI
- `tx diag doctor`: Run system and worktree health checks
- `tx diag stats`: Show queue metrics and health overview
- `tx doctor`: System health checks
- `tx stats`: Show queue metrics and health overview
- `tx trace`: Execution tracing for debugging run failures
- `tx trace errors`: Show recent errors across all runs
- `tx trace heartbeat`: Update run heartbeat state
- `tx trace list`: Show recent runs with event counts
- `tx trace show`: Show metrics events for a run
- `tx trace stalled`: List or reap stalled running runs
- `tx validate is a deprecated alias for 'tx doctor'.`

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
