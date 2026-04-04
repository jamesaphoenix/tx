# tx Sync And Data Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx compact

```text
tx compact - Compact completed tasks and export learnings

Usage: tx compact [options]

Compacts completed tasks older than a specified date and exports learnings
to a markdown file (default: CLAUDE.md). Uses LLM to generate summaries
and extract actionable learnings from completed work.

Options:
  --before <date>    Compact tasks before this date (default: 7 days ago)
                     Formats: YYYY-MM-DD or Nd (e.g., 7d for 7 days ago)
  --output, -o <file>  Output file for learnings (default: CLAUDE.md)
  --dry-run, --preview Preview without compacting (no API key needed)
  --json               Output as JSON
  --help               Show this help

Requirements:
  - ANTHROPIC_API_KEY environment variable must be set for actual compaction
  - --dry-run works without an API key

Examples:
  tx compact                           # Compact tasks older than 7 days
  tx compact --before 2024-01-15       # Compact tasks before Jan 15
  tx compact --before 30d              # Compact tasks older than 30 days
  tx compact --dry-run                 # Preview what would be compacted
  tx compact --output agents.md        # Export learnings to agents.md
  tx compact --json                    # Output as JSON
```

## tx history

```text
tx history - View compaction history

Usage: tx history [options]

Shows the history of past compaction operations including dates,
task counts, and where learnings were exported.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx history
  tx history --json
```

## tx migrate

```text
tx migrate - Manage database schema migrations

Usage: tx migrate <subcommand> [options]

Subcommands:
  status    Show current schema version and pending migrations

Run 'tx migrate <subcommand> --help' for subcommand-specific help.

Examples:
  tx migrate status               # Show migration status
```

## tx migrate status

```text
tx migrate status - Show migration status

Usage: tx migrate status [--json]

Shows the current schema version, latest available version, applied
migrations, and any pending migrations that will be applied on next
database open.

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx migrate status
  tx migrate status --json
```

## tx sync

```text
tx sync - Sync, data management, and migrations

Usage: tx sync <subcommand> [options]

Subcommands:
  export    Export stream events
  import    Import stream events incrementally
  status    Show sync status and whether database has unexported changes
  stream    Show current stream ID and sequence info
  hydrate   Rebuild materialized state from all stream events
  auto      Enable or disable automatic sync on mutations
  claude    Write tasks to Claude Code team task directory
  codex     Write tasks to Codex (coming soon)
  compact   Compact completed tasks and export learnings
  history   View compaction history
  migrate   Show database migration status

Run 'tx sync <subcommand> --help' for subcommand-specific help.

Examples:
  tx sync export               # Export events
  tx sync import               # Import events
  tx sync status               # Show sync status
  tx sync compact --dry-run    # Preview compaction
  tx sync history              # View compaction history
  tx sync migrate status       # Show migration status
  tx sync claude --team my-team  # Push tasks to Claude Code team
```

## tx sync auto

```text
tx sync auto - Manage automatic sync

Usage: tx sync auto [--enable | --disable] [--json]

Controls whether mutations automatically trigger stream event export.
When auto-sync is enabled, any task create/update/delete will
automatically export to local stream event logs.

Options:
  --enable   Enable auto-sync
  --disable  Disable auto-sync
  --json     Output as JSON
  --help     Show this help

Without flags, shows current auto-sync status.

Examples:
  tx sync auto              # Show current status
  tx sync auto --enable     # Enable auto-sync
  tx sync auto --disable    # Disable auto-sync
```

## tx sync claude

```text
tx sync claude - Write tasks to Claude Code team directory

Usage: tx sync claude --team <name> [options]
       tx sync claude --dir <path> [options]

Writes all non-done tx tasks as individual JSON files to a Claude Code
team's task directory. Tasks appear immediately in the team's TaskList.
This is a one-way sync: tx is the source of truth.

Teammates should run 'tx done <txId>' when they complete a task to
write back to the tx database.

Options:
  --team <name>   Claude Code team name (resolves to ~/.claude/tasks/<name>/)
  --dir <path>    Direct path to task directory (alternative to --team)
  --json          Output result as JSON
  --help          Show this help

Workflow:
  1. Create team:  Teammate.spawnTeam("my-team")
  2. Sync tasks:   tx sync claude --team my-team
  3. Spawn agents: Task tool with team_name="my-team"
  4. Writeback:    Teammates run 'tx done <txId>' on completion

Examples:
  tx sync claude --team my-team          # Write to ~/.claude/tasks/my-team/
  tx sync claude --dir /tmp/tasks        # Write to custom directory
  tx sync claude --team my-team --json   # JSON output with stats
```

## tx sync codex

```text
tx sync codex - Write tasks to Codex (coming soon)

Usage: tx sync codex [options]

Writes tasks to OpenAI Codex's task format. Not yet implemented.

Options:
  --help  Show this help
```

## tx sync compact

```text
tx sync compact - Compact completed tasks and export learnings

Usage: tx sync compact [options]

Compacts completed tasks older than a specified date and exports learnings
to a markdown file (default: CLAUDE.md). Uses LLM to generate summaries.

Options:
  --before <date>    Compact tasks before this date (default: 7 days ago)
                     Formats: YYYY-MM-DD or Nd (e.g., 7d for 7 days ago)
  --output, -o <file>  Output file for learnings (default: CLAUDE.md)
  --dry-run, --preview Preview without compacting (no API key needed)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx sync compact
  tx sync compact --before 30d --dry-run
  tx sync compact --output agents.md
```

## tx sync export

```text
tx sync export - Export stream events

Usage: tx sync export [options]

Exports current DB state as append-only events to:
.tx/streams/<stream_id>/events-YYYY-MM-DD.jsonl

Options:
  --json            Output result as JSON
  --help            Show this help

Examples:
  tx sync export                    # Export stream events
  tx sync export --json             # Export as JSON
```

## tx sync history

```text
tx sync history - View compaction history

Usage: tx sync history [options]

Shows the history of past compaction operations.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx sync history
  tx sync history --json
```

## tx sync hydrate

```text
tx sync hydrate - Full rebuild from stream event logs

Usage: tx sync hydrate [--json]

Clears materialized task state tables and rebuilds them by replaying all
events from .tx/streams/*/events-*.jsonl.
```

## tx sync import

```text
tx sync import - Import from stream events

Usage: tx sync import [options]

Imports events incrementally from .tx/streams/*/events-*.jsonl.

Options:
  --json            Output result as JSON
  --help            Show this help

Examples:
  tx sync import                    # Import stream events
  tx sync import --json             # Import as JSON
```

## tx sync migrate

```text
tx sync migrate - Show database migration status

Usage: tx sync migrate status [--json]

Shows current schema version, latest available version, and pending migrations.

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx sync migrate status
```

## tx sync status

```text
tx sync status - Show sync status

Usage: tx sync status [--json]

Shows the current sync status including:
- Number of tasks in database
- Number of events in stream logs
- Whether database has unexported changes (dirty)
- Auto-sync enabled status

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx sync status
  tx sync status --json
```

## tx sync stream

```text
tx sync stream - Show stream identity and sequence state

Usage: tx sync stream [--json]

Shows local stream ID, current sequence, and stream directory path.
```
