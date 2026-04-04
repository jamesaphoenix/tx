---
name: "tx-graph-utils"
description: "Inspect graph anchors plus supporting utility and usage commands. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Inspect graph anchors plus supporting utility and usage commands."
---

# tx Graph And Utilities

Use when the user is repairing anchor graphs, checking CLI usage limits, or working with utility helpers.

## Quick Start

- `tx graph:status`
- `tx graph:verify`
- `tx utils codex-usage`

## Included Commands

- `tx graph:invalidate`: Manually invalidate an anchor
- `tx graph:pin`: Pin an anchor
- `tx graph:prune`: Hard delete old invalid anchors
- `tx graph:restore`: Restore a soft-deleted anchor
- `tx graph:status`: Show graph health metrics
- `tx graph:unpin`: Unpin an anchor
- `tx graph:verify`: Verify anchor validity
- `tx mcp-server`: Start MCP server
- `tx schema`: Show machine-readable CLI command schemas
- `tx skills`: Generate or sync installable tx skill bundles
- `tx skills generate`: Generate tx skill bundles
- `tx skills sync`: Sync generated tx skill bundles into a project
- `tx test:cache-stats`: Show LLM cache statistics
- `tx test:clear-cache`: Clear LLM cache entries
- `tx utils`: Utility commands for external tool integration
- `tx utils claude-usage`: Show Claude Code usage
- `tx utils codex-usage`: Show Codex usage

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
