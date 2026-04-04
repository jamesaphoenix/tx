# tx Graph And Utilities Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx graph:invalidate

```text
tx graph:invalidate - Manually invalidate an anchor

Usage: tx graph:invalidate <anchor-id> [--reason <reason>] [--json]

Marks an anchor as invalid (soft delete). The anchor is kept for history
but excluded from retrieval. Use graph:restore to undo.

Arguments:
  <anchor-id>  Required. Anchor ID (number)

Options:
  --reason <text>  Reason for invalidation (default: "Manual invalidation")
  --json           Output as JSON
  --help           Show this help

Examples:
  tx graph:invalidate 42 --reason "Code removed"
  tx graph:invalidate 42 --json
```

## tx graph:pin

```text
tx graph:pin - Pin an anchor

Usage: tx graph:pin <anchor-id> [--json]

Pins an anchor to prevent automatic invalidation. Pinned anchors are
skipped during periodic and on-access verification. Use for anchors
you want to preserve regardless of code changes.

Arguments:
  <anchor-id>  Required. Anchor ID (number)

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx graph:pin 42
  tx graph:pin 42 --json
```

## tx graph:prune

```text
tx graph:prune - Hard delete old invalid anchors

Usage: tx graph:prune [--older-than <days>] [--json]

Permanently deletes anchors that have been invalid for longer than the
specified period. Default retention is 90 days.

Options:
  --older-than <days>  Delete anchors invalid for this many days (default: 90)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx graph:prune                     # Delete anchors invalid > 90 days
  tx graph:prune --older-than 30     # Delete anchors invalid > 30 days
  tx graph:prune --json
```

## tx graph:restore

```text
tx graph:restore - Restore a soft-deleted anchor

Usage: tx graph:restore <anchor-id> [--json]

Restores an invalid anchor back to valid status. Use this to undo
accidental invalidations or re-enable an anchor after code is restored.

Arguments:
  <anchor-id>  Required. Anchor ID (number)

Options:
  --human  Treat bulk completion as human initiated
  --json   Output as JSON
  --help   Show this help

Examples:
  tx graph:restore 42
  tx graph:restore 42 --json
```

## tx graph:status

```text
tx graph:status - Show graph health metrics

Usage: tx graph:status [--json]

Shows overall health of the knowledge graph including anchor counts by
status, pinned anchors, and recent invalidation events.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx graph:status
  tx graph:status --json
```

## tx graph:unpin

```text
tx graph:unpin - Unpin an anchor

Usage: tx graph:unpin <anchor-id> [--json]

Removes the pin from an anchor, allowing automatic invalidation
during verification.

Arguments:
  <anchor-id>  Required. Anchor ID (number)

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx graph:unpin 42
  tx graph:unpin 42 --json
```

## tx graph:verify

```text
tx graph:verify - Verify anchor validity

Usage: tx graph:verify [file] [--all] [--json]

Verifies that anchors still point to valid code locations. Checks if files
exist, content hashes match, and symbols are present.

Arguments:
  [file]     Optional. File path to verify anchors for

Options:
  --file <path>   File path to verify (alternative to positional arg)
  --all           Verify all anchors (default if no file specified)
  --json          Output as JSON
  --help          Show this help

Examples:
  tx graph:verify                    # Verify all anchors
  tx graph:verify src/auth.ts        # Verify anchors for specific file
  tx graph:verify --json             # Output as JSON
```

## tx mcp-server

```text
tx mcp-server - Start MCP server

Usage: tx mcp-server [options]

Starts the Model Context Protocol (MCP) server for integration with
AI agents. Communicates via JSON-RPC over stdio.

Options:
  --db <path>  Database path (default: .tx/tasks.db)
  --help       Show this help

Examples:
  tx mcp-server
  tx mcp-server --db ~/project/.tx/tasks.db
```

## tx schema

```text
tx schema - Show machine-readable CLI command schemas

Usage: tx schema [command] [subcommand]

Returns structured JSON describing the tx command catalog or a specific
command's usage, arguments, options, subcommands, examples, aliases, and
deprecation mapping.

Examples:
  tx schema
  tx schema dep
  tx schema dep block
```

## tx skills

```text
tx skills - Generate or sync installable tx skill bundles

Usage: tx skills <generate|sync> [options]

Subcommands:
  generate                 Generate Claude/Codex skill bundles from command help
  sync                     Sync generated Claude/Codex skill bundles into a project

Run 'tx skills <subcommand> --help' for subcommand-specific help.

Examples:
  tx skills generate
  tx skills generate --target codex
  tx skills generate --output-dir apps/cli/generated-skills --clean
  tx skills sync
  tx skills sync --project-dir ../my-project --target codex
```

## tx skills generate

```text
tx skills generate - Generate tx skill bundles

Usage: tx skills generate [options]

Renders deterministic skill bundles for Claude Code and/or Codex from the
existing tx CLI help text, plus bundled spec-writing skills. Output is install-ready:

  <output-dir>/claude/.claude/skills/<skill-id>/
  <output-dir>/codex/.codex/skills/<skill-id>/

Options:
  --target, -t <target>     Bundle target: all|claude|codex (default: all)
  --output-dir, -o <dir>    Output directory (default: .tx/generated-skills)
  --clean                   Remove existing target bundle dirs before writing
  --json                    Output generation summary as JSON
  --help                    Show this help

Examples:
  tx skills generate
  tx skills generate --target claude
  tx skills generate --output-dir apps/cli/generated-skills --clean
  tx skills generate --target codex --json
```

## tx skills sync

```text
tx skills sync - Sync generated tx skill bundles into a project

Usage: tx skills sync [options]

Generates the canonical tx skill bundles in a temp directory, then syncs them
into the target project's install roots:

  .claude/skills/<skill-id>/
  .codex/skills/<skill-id>/

Changed tx-managed skill files are updated in place. Unrelated custom skills are
left untouched.

Options:
  --target, -t <target>      Sync target: all|claude|codex (default: all)
  --project-dir, -p <dir>    Target project directory (default: current working directory)
  --json                     Output sync summary as JSON
  --help                     Show this help

Examples:
  tx skills sync
  tx skills sync --target claude
  tx skills sync --project-dir ../my-project --target codex
  tx skills sync --project-dir ../my-project --json
```

## tx test:cache-stats

```text
tx test:cache-stats - Show LLM cache statistics

Usage: tx test:cache-stats [--json]

Shows statistics about the LLM response cache including:
- Total number of cache entries
- Total cache size in bytes
- Date range of cached entries
- Breakdown by model
- Breakdown by cache version

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx test:cache-stats                # Show formatted statistics
  tx test:cache-stats --json         # Output as JSON
```

## tx test:clear-cache

```text
tx test:clear-cache - Clear LLM cache entries

Usage: tx test:clear-cache [options]

Clears LLM cache entries based on specified criteria. At least one
option must be provided to prevent accidental cache deletion.

Options:
  --all              Clear all cache entries
  --older-than <n>d  Clear entries older than N days (e.g., 30d, 7d)
                     Supports: d (days), h (hours), m (minutes), s (seconds)
  --model <name>     Clear entries for a specific model
  --version <n>      Clear entries with a specific cache version
  --json             Output as JSON
  --help             Show this help

Examples:
  tx test:clear-cache --all                  # Clear entire cache
  tx test:clear-cache --older-than 30d       # Clear entries older than 30 days
  tx test:clear-cache --older-than 2h        # Clear entries older than 2 hours
  tx test:clear-cache --model claude-haiku   # Clear claude-haiku entries
  tx test:clear-cache --version 1            # Clear version 1 entries
  tx test:clear-cache --model claude-sonnet-4 --older-than 7d
```

## tx utils

```text
tx utils - Utility commands for external tool integration

Usage: tx utils <subcommand> [options]

Subcommands:
  claude-usage    Show Claude Code rate limit usage (% remaining, reset times)
  codex-usage     Show Codex rate limit usage (% remaining, reset times)

Options:
  --json          Output as JSON
  --help          Show this help

Run 'tx utils <subcommand> --help' for subcommand-specific help.
```

## tx utils claude-usage

```text
tx utils claude-usage - Show Claude Code usage

Usage: tx utils claude-usage [--json]

Reads OAuth credentials from ~/.claude/.credentials.json and queries
the Anthropic usage API. Shows utilization percentages for 5-hour and
7-day rate limit windows, with time until reset.

Options:
  --json          Output raw API response as JSON
  --help          Show this help

Examples:
  tx utils claude-usage
  tx utils claude-usage --json
```

## tx utils codex-usage

```text
tx utils codex-usage - Show Codex usage

Usage: tx utils codex-usage [--json]

Spawns codex app-server over stdio and queries rate limits via JSON-RPC.
Shows utilization percentages for 5-hour and weekly windows, with time
until reset and per-model breakdown.

Requires: codex CLI installed (npm install -g codex@latest)

Options:
  --json          Output raw JSON-RPC response as JSON
  --help          Show this help

Examples:
  tx utils codex-usage
  tx utils codex-usage --json
```
