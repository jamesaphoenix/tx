/**
 * CLI help text for all commands
 */
import { CLI_VERSION } from "./version.js"

export const HELP_TEXT = `tx v${CLI_VERSION} - Task management for AI agents and humans

Usage: tx <command> [arguments] [options]

Start Here (recommended first pass):
  tx init [--codex|--claude]
  tx add <title>
  tx ready
  tx show <id>
  tx done <id>
  tx sync export

When you are ready to add docs-first specs:
  tx doc add prd <name> --title <title>
  tx spec discover
  tx spec status
  tx spec complete --doc <name> --by <human>

Core Workflow:
  init                    Initialize task database
  add <title>             Create a new task
  list                    List tasks
  ready                   List ready tasks (no blockers)
  show <id>               Show task details
  update <id>             Update task
  done <id>               Mark task complete
  reset <id>              Reset task to ready
  delete <id>             Delete task
  md-export               Export tasks to markdown file
  group-context set       Set task-group context on a task
  group-context clear     Clear task-group context on a task

Dependencies & Hierarchy:
  block <id> <blocker>    Add blocking dependency
  unblock <id> <blocker>  Remove blocking dependency
  children <id>           List child tasks
  tree <id>               Show task subtree

Memory (filesystem-backed .md search):
  memory source           Manage indexed directories (add, rm, list)
  memory add              Create a new memory document (.md file)
  memory index            Index all registered sources
  memory search           Search memory documents (BM25/semantic/graph)
  memory show             Display a memory document
  memory tag/untag        Add or remove tags
  memory set/unset/props  Manage key-value properties
  memory links/backlinks  Show document connections
  memory list             List indexed documents
  memory link             Create explicit edge between documents
  memory relate           Add to frontmatter.related
  memory context          Get task-relevant memory for prompt injection
  memory learn            Attach a learning to a file/glob pattern
  memory recall           Query file-specific learnings by path

Messages:
  send                    Send a message to a channel
  inbox                   Read messages from a channel
  ack                     Acknowledge a message
  ack all                 Acknowledge all messages on a channel
  outbox pending          Count pending messages on a channel
  outbox gc               Garbage collect old messages

Context Pins:
  pin set <id> [content]  Create/update a context pin
  pin get <id>            Show pin content
  pin rm <id>             Remove a pin
  pin list                List all pins
  pin sync                Sync pins to target files
  pin targets [files...]  Show/set target files

Docs-First Specs:
  doc <subcommand>        Manage docs (add, edit, show, list, render, lock, version, link, attach, patch, validate, drift, lint-ears)
  spec <subcommand>       Spec traceability (discover, run/batch, fci, status, complete, health)
  invariant <subcommand>  Advanced invariant inspection/repair tooling

Cycle Scan:
  cycle                   Run cycle-based issue discovery with sub-agent swarms

Sync & Data:
  sync export             Export stream events
  sync import             Import stream events
  sync stream             Show stream identity
  sync hydrate            Rebuild state from stream events
  sync status             Show sync status
  sync claude             Sync tasks to Claude Code team directory
  compact                 Compact completed tasks and export learnings
  history                 View compaction history
  migrate status          Show database migration status

Bulk Operations:
  bulk done <id...>       Complete multiple tasks
  bulk score <n> <id...>  Set score for multiple tasks
  bulk reset <id...>      Reset multiple tasks to ready
  bulk delete <id...>     Delete multiple tasks

Diagnostics & Rollups:
  stats                   Show queue metrics and health overview
  validate                Run pre-flight database health checks
  doctor                  Run system diagnostics
  dashboard               Start API server + dashboard

Guards & Limits:
  guard set               Set task creation guards (--max-pending, --max-children, --max-depth)
  guard show              Show current guard configuration
  guard clear             Clear guards
  gate create <name>      Create a HITL phase gate (stored as gate.<name> pin)
  gate check <name>       Exit 0 if approved, 1 if not approved
  gate approve <name>     Approve a gate
  gate revoke <name>      Revoke a gate

Verification:
  verify set <id> <cmd>   Attach a verify command to a task
  verify show <id>        Show verify command for a task
  verify run <id>         Run verification command
  verify clear <id>       Clear verify command from a task

Labels:
  label add <name>        Create a label
  label list              List all labels
  label assign <id> <l>   Assign a label to a task
  label unassign <id> <l> Remove a label from a task
  label delete <name>     Delete a label

Reflection:
  reflect                 Session retrospective (throughput, signals, stuck tasks)

Utils:
  utils claude-usage      Show Claude Code rate limit usage
  utils codex-usage       Show Codex rate limit usage

Global Options:
  --json                  Output as JSON
  --db <path>             Database path (default: .tx/tasks.db)
  --help                  Show help
  --version               Show version

Run 'tx help <command>' or 'tx <command> --help' for command-specific help.

Examples:
  tx init
  tx add "Implement auth" --score 800
  tx add "Login page" --parent tx-a1b2c3d4 --score 600
  tx list --status backlog,ready
  tx ready --json
  tx block <task-id> <blocker-id>
  tx done <task-id>
  tx doc add prd auth-flow --title "Auth Flow"
  tx spec discover
  tx spec status --doc auth-flow`

export const commandHelp: Record<string, string> = {
  init: `tx init - Initialize task database

Usage: tx init [--db <path>] [--claude] [--codex] [--watchdog] [--watchdog-runtime <auto|codex|claude|both>]

Initializes the tx database and required tables. Creates .tx/tasks.db
by default. Safe to run multiple times (idempotent).

Options:
  --db <path>   Database path (default: .tx/tasks.db)
  --claude      Scaffold Claude Code integration (CLAUDE.md + .claude/skills/)
  --codex       Scaffold Codex integration (AGENTS.md + .codex/agents + .codex/rules)
  --watchdog    Scaffold watchdog launcher/scripts/assets (optional later)
  --watchdog-runtime <mode>
                Runtime mode for watchdog: auto|codex|claude|both (default: auto, requires --watchdog)
  --help        Show this help

Examples:
  tx init                     # Initialize database only
  tx init --claude            # Database + Claude Code skills & CLAUDE.md
  tx init --codex             # Database + Codex AGENTS.md + agent profiles + rules
  tx init --claude --codex    # Database + both integrations
  tx init --watchdog          # Optional later: watchdog scaffolding (runtime auto-detect)
  tx init --watchdog --watchdog-runtime both
                              # Require both codex and claude runtimes for watchdog
  tx init --db ~/my-tasks.db  # Use custom path`,

  add: `tx add - Create a new task

Usage: tx add <title> [options]

Creates a new task with the given title. Tasks start with status "backlog"
and default score 500.

Arguments:
  <title>         Required. The task title (use quotes for multi-word titles)

Options:
  --parent, -p <id>       Parent task ID (for subtasks)
  --score, -s <n>         Priority score 0-1000 (default: 500, higher = more important)
  --description, -d <text> Task description
  --verify <cmd>          Attach a verify command at creation time
  --json                  Output as JSON
  --help                  Show this help

Examples:
  tx add "Implement auth"
  tx add "Login page" --parent tx-a1b2c3d4 --score 600
  tx add "Fix bug" -s 800 -d "Urgent fix for login"
  tx add "Implement auth tests" --verify "bun run test:auth"`,

  list: `tx list - List tasks

Usage: tx list [options]

Lists all tasks, optionally filtered by status. Shows task ID, status,
score, title, and ready indicator (+).

Options:
  --status <s>               Filter by status (comma-separated: backlog,ready,active,done)
  --limit, -n <n>            Maximum tasks to show
  --label <name,...>         Filter to tasks with these labels (comma-separated)
  --exclude-label <name,...> Exclude tasks with these labels (comma-separated)
  --json                     Output as JSON
  --help                     Show this help

Examples:
  tx list                          # List all tasks
  tx list --status backlog,ready   # Only backlog and ready tasks
  tx list -n 10 --json             # Top 10 as JSON
  tx list --label "phase:implement"  # Tasks with specific label`,

  ready: `tx ready - List ready tasks

Usage: tx ready [options]

Lists tasks that are ready to work on (status is workable and all blockers
are done). Sorted by score, highest first.

Options:
  --limit, -n <n>            Maximum tasks to show (default: 10)
  --claim <worker-id>        Atomically claim the first ready task for the given worker
  --lease <minutes>          Lease duration when using --claim (default: 30)
  --label <name,...>         Filter to tasks with these labels (comma-separated)
  --exclude-label <name,...> Exclude tasks with these labels (comma-separated)
  --json                     Output as JSON
  --help                     Show this help

Examples:
  tx ready                                # Top 10 ready tasks
  tx ready -n 5                           # Top 5 ready tasks
  tx ready --json                         # Output as JSON for scripting
  tx ready --claim worker-1 --lease 30    # Atomic ready+claim for parallel workers
  tx ready --label "phase:implement"      # Only implementation-phase tasks
  tx ready --exclude-label "needs-review" # Skip tasks needing review`,

  show: `tx show - Show task details

Usage: tx show <id> [options]

Shows full details for a single task including title, status, score,
description, parent, blockers, blocks, children, and timestamps.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx show tx-a1b2c3d4
  tx show tx-a1b2c3d4 --json`,

  update: `tx update - Update a task

Usage: tx update <id> [options]

Updates one or more fields on an existing task.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --status <s>          New status (backlog|ready|planning|active|blocked|review|human_needs_to_review|done)
  --title <t>           New title
  --score <n>           New score (0-1000)
  --description, -d <text>  New description
  --parent, -p <id>     New parent task ID
  --human               Treat completion-style updates as human initiated
  --json                Output as JSON
  --help                Show this help

Examples:
  tx update tx-a1b2c3d4 --status active
  tx update tx-a1b2c3d4 --score 900 --title "High priority bug"`,

  done: `tx done - Mark task complete

Usage: tx done <id> [options]

Marks a task as complete (status = done). Also reports any tasks
that become unblocked as a result.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --human  Treat completion as human initiated
  --json  Output as JSON (includes task and newly unblocked task IDs)
  --help  Show this help

Examples:
  tx done tx-a1b2c3d4
  tx done tx-a1b2c3d4 --human
  tx done tx-a1b2c3d4 --json`,

  reset: `tx reset - Reset task to ready status

Usage: tx reset <id> [options]

Resets a task back to ready status, regardless of current status.
Use this to recover from stuck tasks (e.g., worker killed mid-task).

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx reset tx-a1b2c3d4              # Reset stuck active task
  tx reset tx-a1b2c3d4 --json`,

  delete: `tx delete - Delete a task

Usage: tx delete <id> [options]

Permanently deletes a task. Also removes any dependencies involving
this task. If the task has children, use --cascade to delete the
entire subtree.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --cascade  Delete task and all its descendants (entire subtree)
  --json     Output as JSON
  --help     Show this help

Examples:
  tx delete tx-a1b2c3d4
  tx delete tx-a1b2c3d4 --cascade   # Delete task and all children`,

  "md-export": `tx md-export - Export tasks to markdown file

Usage: tx md-export [options]

Materializes tasks into a markdown file for file-based agent loops.
Agents read the file directly instead of calling tx ready.

Options:
  --path, -p <path>      Output file path (default: .tx/tasks.md)
  --filter, -f <filter>  Task filter: ready (default), all (every status), or a status name
  --include-context      Include relevant learnings per task
  --include-done <n>     Include last N completed tasks (default: 5)
  --watch, -w            Re-export on changes (poll mode)
  --interval <seconds>   Poll interval for --watch (default: 5)
  --json                 Output result metadata as JSON
  --help                 Show this help

Examples:
  tx md-export                              # Export ready tasks to .tx/tasks.md
  tx md-export --path tasks.md              # Custom output path
  tx md-export --include-context            # Include learnings per task
  tx md-export --filter all                 # Export all tasks
  tx md-export --include-done 10            # Include last 10 completed tasks
  tx md-export --watch                      # Watch and re-export on changes
  tx md-export --watch --interval 10        # Poll every 10 seconds

File-based agent loop:
  while true; do
    tx md-export
    claude -p "Read .tx/tasks.md and complete the highest priority task. When done, run: tx done <id>"
  done`,

  block: `tx block - Add blocking dependency

Usage: tx block <task-id> <blocker-id> [options]

Makes one task block another. The blocked task cannot be ready until
the blocker is marked done. Circular dependencies are not allowed.

Arguments:
  <task-id>     Required. The task that will be blocked
  <blocker-id>  Required. The task that blocks it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx block tx-abc123 tx-def456   # tx-def456 blocks tx-abc123`,

  unblock: `tx unblock - Remove blocking dependency

Usage: tx unblock <task-id> <blocker-id> [options]

Removes a blocking dependency between two tasks.

Arguments:
  <task-id>     Required. The task that was blocked
  <blocker-id>  Required. The task that was blocking it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx unblock tx-abc123 tx-def456`,

  children: `tx children - List child tasks

Usage: tx children <id> [options]

Lists all direct children of a task (tasks with this task as parent).
Shows task ID, status, score, title, and ready indicator (+).

Arguments:
  <id>    Required. Parent task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx children tx-a1b2c3d4
  tx children tx-a1b2c3d4 --json`,

  tree: `tx tree - Show task subtree

Usage: tx tree <id> [options]

Shows a task and all its descendants in a tree view. Useful for
visualizing task hierarchy.

Arguments:
  <id>    Required. Root task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON (nested structure with childTasks array)
  --help  Show this help

Examples:
  tx tree tx-a1b2c3d4
  tx tree tx-a1b2c3d4 --json`,

  "mcp-server": `tx mcp-server - Start MCP server

Usage: tx mcp-server [options]

Starts the Model Context Protocol (MCP) server for integration with
AI agents. Communicates via JSON-RPC over stdio.

Options:
  --db <path>  Database path (default: .tx/tasks.db)
  --help       Show this help

Examples:
  tx mcp-server
  tx mcp-server --db ~/project/.tx/tasks.db`,

  sync: `tx sync - Manage stream-based sync and platform integrations

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

Run 'tx sync <subcommand> --help' for subcommand-specific help.

Examples:
  tx sync export               # Export events to .tx/streams/<stream>/events-YYYY-MM-DD.jsonl
  tx sync import               # Import events from .tx/streams
  tx sync stream               # Show stream identity
  tx sync hydrate              # Full rebuild from events
  tx sync status               # Show sync status
  tx sync auto --enable        # Enable auto-sync
  tx sync claude --team my-team  # Push tasks to Claude Code team`,

  "sync export": `tx sync export - Export stream events

Usage: tx sync export [options]

Exports current DB state as append-only events to:
.tx/streams/<stream_id>/events-YYYY-MM-DD.jsonl

Options:
  --json            Output result as JSON
  --help            Show this help

Examples:
  tx sync export                    # Export stream events
  tx sync export --json             # Export as JSON`,

  "sync import": `tx sync import - Import from stream events

Usage: tx sync import [options]

Imports events incrementally from .tx/streams/*/events-*.jsonl.

Options:
  --json            Output result as JSON
  --help            Show this help

Examples:
  tx sync import                    # Import stream events
  tx sync import --json             # Import as JSON`,

  "sync stream": `tx sync stream - Show stream identity and sequence state

Usage: tx sync stream [--json]

Shows local stream ID, current sequence, and stream directory path.`,

  "sync hydrate": `tx sync hydrate - Full rebuild from stream event logs

Usage: tx sync hydrate [--json]

Clears materialized task state tables and rebuilds them by replaying all
events from .tx/streams/*/events-*.jsonl.`,

  "sync status": `tx sync status - Show sync status

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
  tx sync status --json`,

  "sync auto": `tx sync auto - Manage automatic sync

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
  tx sync auto --disable    # Disable auto-sync`,

  "sync claude": `tx sync claude - Write tasks to Claude Code team directory

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
  tx sync claude --team my-team --json   # JSON output with stats`,

  "sync codex": `tx sync codex - Write tasks to Codex (coming soon)

Usage: tx sync codex [options]

Writes tasks to OpenAI Codex's task format. Not yet implemented.

Options:
  --help  Show this help`,

  migrate: `tx migrate - Manage database schema migrations

Usage: tx migrate <subcommand> [options]

Subcommands:
  status    Show current schema version and pending migrations

Run 'tx migrate <subcommand> --help' for subcommand-specific help.

Examples:
  tx migrate status               # Show migration status`,

  "migrate status": `tx migrate status - Show migration status

Usage: tx migrate status [--json]

Shows the current schema version, latest available version, applied
migrations, and any pending migrations that will be applied on next
database open.

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx migrate status
  tx migrate status --json`,

  "group-context set": `tx group-context set - Set task-group context on a task

Usage: tx group-context set <task-id> <context> [options]

Sets task-group context on a task. The context is inherited by related
ancestors and descendants when querying task payloads.

Arguments:
  <task-id>  Required. Task ID (e.g., tx-a1b2c3d4)
  <context>  Required. Context text (quote for multi-word text)

Options:
  --json     Output as JSON
  --help     Show this help

Examples:
  tx group-context set tx-a1b2c3d4 "Shared auth rollout context"
  tx group-context set tx-a1b2c3d4 "Phase 2 migration notes" --json`,

  "group-context clear": `tx group-context clear - Clear task-group context on a task

Usage: tx group-context clear <task-id> [options]

Removes direct task-group context from a task. Effective inherited context
is re-resolved from the remaining lineage context sources.

Arguments:
  <task-id>  Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json     Output as JSON
  --help     Show this help

Examples:
  tx group-context clear tx-a1b2c3d4
  tx group-context clear tx-a1b2c3d4 --json`,

  help: `tx help - Show help

Usage: tx help [command]
       tx --help
       tx <command> --help

Shows general help or help for a specific command.

Examples:
  tx help           # General help
  tx help add       # Help for 'add' command
  tx add --help     # Same as above`,

  "graph:verify": `tx graph:verify - Verify anchor validity

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
  tx graph:verify --json             # Output as JSON`,

  "graph:invalidate": `tx graph:invalidate - Manually invalidate an anchor

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
  tx graph:invalidate 42 --json`,

  "graph:restore": `tx graph:restore - Restore a soft-deleted anchor

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
  tx graph:restore 42 --json`,

  "graph:prune": `tx graph:prune - Hard delete old invalid anchors

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
  tx graph:prune --json`,

  "graph:status": `tx graph:status - Show graph health metrics

Usage: tx graph:status [--json]

Shows overall health of the knowledge graph including anchor counts by
status, pinned anchors, and recent invalidation events.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx graph:status
  tx graph:status --json`,

  "graph:pin": `tx graph:pin - Pin an anchor

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
  tx graph:pin 42 --json`,

  "graph:unpin": `tx graph:unpin - Unpin an anchor

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
  tx graph:unpin 42 --json`,

  "hooks:install": `tx hooks:install - Install post-commit hook

Usage: tx hooks:install [options]

Installs a git post-commit hook that automatically triggers anchor
verification when commits meet certain criteria:
- More than 10 files changed (configurable)
- High-value configuration files modified

The hook runs verification in the background to avoid blocking commits.
Configuration is stored in .txrc.json and can be customized.

Options:
  --force, -f              Overwrite existing hook
  --threshold, -t <n>      File count threshold (default: 10)
  --high-value, -h <list>  Comma-separated list of high-value file patterns
  --json                   Output as JSON
  --help                   Show this help

Examples:
  tx hooks:install                           # Install with defaults
  tx hooks:install --threshold 5             # Trigger on 5+ files
  tx hooks:install --high-value "*.config.ts,schema.prisma"
  tx hooks:install --force                   # Reinstall hook
  tx hooks:install --json                    # JSON output for scripting`,

  "hooks:uninstall": `tx hooks:uninstall - Remove post-commit hook

Usage: tx hooks:uninstall [options]

Removes the tx post-commit hook. Only removes hooks that were
installed by tx (identified by marker comment). Updates .txrc.json
to disable hook settings.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx hooks:uninstall
  tx hooks:uninstall --json                  # JSON output for scripting`,

  "hooks:status": `tx hooks:status - Show git hook status

Usage: tx hooks:status [--json]

Shows the current status of the tx git hook integration including:
- Whether a hook is installed
- Whether hooks are enabled in config
- Current configuration settings

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx hooks:status
  tx hooks:status --json`,

  "test:cache-stats": `tx test:cache-stats - Show LLM cache statistics

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
  tx test:cache-stats --json         # Output as JSON`,

  "test:clear-cache": `tx test:clear-cache - Clear LLM cache entries

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
  tx test:clear-cache --model claude-sonnet-4 --older-than 7d`,

  daemon: `tx daemon - Background daemon for learning extraction

Usage: tx daemon <subcommand> [options]

Subcommands:
  start       Start the background daemon
  stop        Stop the background daemon
  status      Show daemon status
  track       Track a project for learning extraction
  untrack     Stop tracking a project
  list        List tracked projects
  process     Process learning candidates
  review      Review a learning candidate
  promote     Promote a candidate to learning
  reject      Reject a learning candidate

Run 'tx daemon <subcommand> --help' for subcommand-specific help.

Examples:
  tx daemon start               # Start the daemon
  tx daemon status              # Show daemon status
  tx daemon track .             # Track current directory
  tx daemon list                # List tracked projects`,

  "daemon start": `tx daemon start - Start the background daemon

Usage: tx daemon start [options]

Starts the background daemon process that monitors tracked projects
for file changes and extracts learning candidates.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon start`,

  "daemon stop": `tx daemon stop - Stop the background daemon

Usage: tx daemon stop [options]

Stops the running background daemon process.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon stop`,

  "daemon status": `tx daemon status - Show daemon status

Usage: tx daemon status [options]

Shows the current status of the daemon including:
- Whether daemon is running
- PID if running
- Number of tracked projects
- Number of pending candidates

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon status
  tx daemon status --json`,

  "daemon track": `tx daemon track - Track a project for learning extraction

Usage: tx daemon track <project-path> [options]

Adds a project directory to the daemon's watch list. The daemon will
monitor file changes and extract learning candidates.

Arguments:
  <project-path>  Required. Path to the project directory

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon track .              # Track current directory
  tx daemon track ~/projects/my-app`,

  "daemon untrack": `tx daemon untrack - Stop tracking a project

Usage: tx daemon untrack <project-path> [options]

Removes a project from the daemon's watch list.

Arguments:
  <project-path>  Required. Path to the project directory

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon untrack .
  tx daemon untrack ~/projects/my-app`,

  "daemon list": `tx daemon list - List tracked projects

Usage: tx daemon list [options]

Lists all projects currently being tracked by the daemon.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon list
  tx daemon list --json`,

  "daemon process": `tx daemon process - Process JSONL files for learning candidates

Usage: tx daemon process [options]

Processes JSONL files to extract learning candidates. By default, processes
files from tracked projects. Use --path to specify a custom glob pattern.

Options:
  --path, -p <glob>  Glob pattern for JSONL files to process
  --json             Output as JSON
  --help             Show this help

Examples:
  tx daemon process                              # Process tracked projects
  tx daemon process --path ~/.claude/**/*.jsonl  # Process specific files`,

  "daemon review": `tx daemon review - List pending learning candidates

Usage: tx daemon review [options]

Lists pending learning candidates awaiting promotion.

Options:
  --confidence, -c <levels>  Filter by confidence (comma-separated: high,medium,low)
  --limit, -l <n>            Maximum candidates to show
  --json                     Output as JSON
  --help                     Show this help

Examples:
  tx daemon review
  tx daemon review --confidence medium,low
  tx daemon review --limit 10 --json`,

  "daemon promote": `tx daemon promote - Promote a candidate to learning

Usage: tx daemon promote <candidate-id> [options]

Promotes a learning candidate to a permanent learning entry.

Arguments:
  <candidate-id>  Required. Candidate ID

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon promote 42`,

  "daemon reject": `tx daemon reject - Reject a learning candidate

Usage: tx daemon reject <candidate-id> --reason <reason> [options]

Rejects a learning candidate with a reason.

Arguments:
  <candidate-id>  Required. Candidate ID

Options:
  --reason <text>  Required. Reason for rejection
  --json           Output as JSON
  --help           Show this help

Examples:
  tx daemon reject 42 --reason "Not relevant"
  tx daemon reject 42 --reason "Duplicate of existing learning"`,

  coordinator: `tx coordinator - Worker coordination primitives

Usage: tx coordinator <subcommand> [options]

Manages the worker coordination system for parallel task processing.
Provides Kubernetes-style worker health tracking, lease-based claims,
and automatic orphan detection.

Subcommands:
  start       Start the coordinator
  stop        Stop the coordinator
  status      Show coordinator status
  reconcile   Force a reconciliation pass

Run 'tx coordinator <subcommand> --help' for subcommand-specific help.

Examples:
  tx coordinator start               # Start with default settings
  tx coordinator start --workers 3   # Start with 3 workers
  tx coordinator status              # Show current status
  tx coordinator reconcile           # Force orphan detection`,

  "coordinator start": `tx coordinator start - Start the coordinator

Usage: tx coordinator start [options]

Starts the worker coordination system. The coordinator manages worker
health via heartbeats, handles lease-based task claims, and runs periodic
reconciliation to detect dead workers and orphaned tasks.

Options:
  --workers, -w <n>  Worker pool size (default: 1)
  --daemon, -d       Run as daemon in background
  --json             Output as JSON
  --help             Show this help

Examples:
  tx coordinator start                  # Start with 1 worker
  tx coordinator start --workers 3      # Start with 3 workers
  tx coordinator start -w 5 --daemon    # 5 workers in background`,

  "coordinator stop": `tx coordinator stop - Stop the coordinator

Usage: tx coordinator stop [options]

Stops the running coordinator. By default, immediately marks all workers
as dead. With --graceful, signals workers to finish current tasks first.

Options:
  --graceful, -g  Wait for workers to finish current tasks
  --json          Output as JSON
  --help          Show this help

Examples:
  tx coordinator stop               # Immediate stop
  tx coordinator stop --graceful    # Wait for workers to finish`,

  "coordinator status": `tx coordinator status - Show coordinator status

Usage: tx coordinator status [options]

Shows the current status of the coordinator including:
- Running status (stopped/starting/running/stopping)
- Process ID if running
- Worker pool size configuration
- Heartbeat and lease timing settings
- Last reconciliation timestamp

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx coordinator status
  tx coordinator status --json`,

  "coordinator reconcile": `tx coordinator reconcile - Force reconciliation pass

Usage: tx coordinator reconcile [options]

Runs a single reconciliation pass immediately. Reconciliation:
- Detects dead workers (missed 2+ heartbeats)
- Releases expired task claims
- Recovers orphaned tasks (active but no claim)
- Fixes state inconsistencies

Normally runs automatically every 60s, but can be triggered manually.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx coordinator reconcile
  tx coordinator reconcile --json`,

  worker: `tx worker - Worker process management

Usage: tx worker <subcommand> [options]

Manages worker processes for the coordination system. Workers claim and
execute tasks, sending heartbeats to the coordinator.

Subcommands:
  start       Start a worker process
  stop        Stop a worker process
  status      Show worker status
  list        List all workers

Run 'tx worker <subcommand> --help' for subcommand-specific help.

Examples:
  tx worker start                           # Start with defaults
  tx worker start --name my-worker          # Start with custom name
  tx worker status                          # Show worker summary
  tx worker list                            # List all workers`,

  "worker start": `tx worker start - Start a worker process

Usage: tx worker start [options]

Starts a worker process that registers with the coordinator, claims tasks,
and executes them using Claude. The worker sends periodic heartbeats and
handles graceful shutdown on SIGTERM/SIGINT.

Options:
  --name, -n <name>              Worker name (default: worker-<auto>)
  --capabilities, -c <list>      Comma-separated capabilities (default: tx-implementer)
  --heartbeat <seconds>          Heartbeat interval in seconds (default: 30)
  --json                         Output as JSON
  --help                         Show this help

Examples:
  tx worker start                                    # Start with defaults
  tx worker start --name my-worker                   # Custom name
  tx worker start -c tx-implementer,tx-tester        # Multiple capabilities
  tx worker start --heartbeat 15                     # Custom heartbeat interval`,

  "worker stop": `tx worker stop - Stop a worker process

Usage: tx worker stop [options]

Workers are stopped by sending SIGTERM to the worker process. The worker
will finish its current task (if any) before exiting gracefully.

Options:
  --graceful, -g  Graceful shutdown (workers already handle this)
  --json          Output as JSON
  --help          Show this help

Note: To stop a worker, find its PID with 'tx worker list --json' and
send SIGTERM:

  kill -SIGTERM <worker-pid>

Examples:
  tx worker stop                   # Show stop instructions`,

  "worker status": `tx worker status - Show worker status

Usage: tx worker status [worker-id] [options]

Shows the status of workers. If a worker ID is provided, shows detailed
status for that specific worker. Otherwise, shows a summary of all workers.

Arguments:
  [worker-id]   Optional. Show detailed status for this worker

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx worker status                        # Summary of all workers
  tx worker status worker-abc12345        # Detailed status for one worker
  tx worker status --json                 # Summary as JSON`,

  "worker list": `tx worker list - List all workers

Usage: tx worker list [options]

Lists all registered workers with their current status, name, and active task.

Options:
  --status, -s <list>   Filter by status (comma-separated: starting,idle,busy,stopping,dead)
  --json                Output as JSON
  --help                Show this help

Examples:
  tx worker list                    # List all workers
  tx worker list --status idle,busy # Only idle and busy workers
  tx worker list --json             # Output as JSON for scripting`,

  trace: `tx trace - Execution tracing for debugging run failures

Usage: tx trace <subcommand> [options]

Subcommands:
  list                  Show recent runs with event counts
  show <run-id>         Show metrics events for a run
  transcript <run-id>   Display raw transcript content
  stderr <run-id>       Display stderr content
  heartbeat <run-id>    Update run transcript heartbeat state
  stalled               List or reap stalled running runs
  errors                Show recent errors across all runs

Run 'tx trace <subcommand> --help' for subcommand-specific help.

Examples:
  tx trace list                    # Recent runs with span counts
  tx trace list --hours 48         # Runs from last 48 hours
  tx trace show run-abc123         # Metrics events for a run
  tx trace show run-abc123 --full  # Combined events + tool calls timeline
  tx trace transcript run-abc123   # Raw JSONL transcript
  tx trace stderr run-abc123       # Stderr output for debugging
  tx trace heartbeat run-abc123 --transcript-bytes 2048 --delta-bytes 256
  tx trace stalled --transcript-idle-seconds 300
  tx trace stalled --reap --transcript-idle-seconds 300
  tx trace errors                  # Recent errors across all runs
  tx trace errors --hours 48       # Errors from last 48 hours`,

  "trace list": `tx trace list - Show recent runs with event counts

Usage: tx trace list [options]

Lists recent runs from the database with their agent, task, status, span count,
and relative time. Useful for quick overview of recent execution activity.

Options:
  --hours <n>       Time window in hours (default: 24)
  --limit, -n <n>   Maximum number of results (default: 20)
  --json            Output as JSON
  --help            Show this help

Examples:
  tx trace list                    # Recent runs (last 24h)
  tx trace list --hours 48         # Last 48 hours
  tx trace list --limit 10         # Top 10 only
  tx trace list --json             # JSON output for scripting`,

  "trace show": `tx trace show - Show metrics events for a run

Usage: tx trace show <run-id> [options]

Displays operational metrics events (spans, metrics) recorded during a run.
With --full, also includes tool calls from the transcript file, interleaved
by timestamp for comprehensive debugging.

Arguments:
  <run-id>   Required. Run ID (e.g., run-abc12345)

Options:
  --full     Combine events timeline with transcript tool calls
  --json     Output as JSON
  --help     Show this help

Output (default):
  Shows run metadata (agent, task, status, times) followed by metrics events
  in chronological order with their duration and status.

Output (--full):
  Shows a combined timeline that interleaves:
  - [span] Operational spans with timing data
  - [metric] Custom metrics
  - [tool] Tool calls from the transcript (e.g., Bash, Read, Edit)

  This is useful for understanding exactly what the agent was doing at each
  point in time, correlating service operations with agent tool usage.

Examples:
  tx trace show run-abc123           # Metrics events only
  tx trace show run-abc123 --full    # Combined timeline with tool calls
  tx trace show run-abc123 --json    # JSON output for scripting`,

  "trace heartbeat": `tx trace heartbeat - Update run heartbeat state

Usage: tx trace heartbeat <run-id> [options]

Records a run-level heartbeat used for transcript progress monitoring.
This is a primitive for orchestration loops and watchdogs.

Arguments:
  <run-id>   Required. Run ID (e.g., run-abc12345)

Options:
  --stdout-bytes <n>      Current stdout byte count (default: 0)
  --stderr-bytes <n>      Current stderr byte count (default: 0)
  --transcript-bytes <n>  Current transcript byte count (default: 0)
  --delta-bytes <n>       Bytes changed since last sample (default: 0)
  --check-at <iso>        Override check timestamp (ISO format)
  --activity-at <iso>     Override activity timestamp (ISO format)
  --json                  Output as JSON
  --help                  Show this help

Examples:
  tx trace heartbeat run-abc123 --transcript-bytes 1024 --delta-bytes 128
  tx trace heartbeat run-abc123 --stdout-bytes 500 --stderr-bytes 120 --json`,

  "trace stalled": `tx trace stalled - List or reap stalled running runs

Usage: tx trace stalled [options]

Finds running runs whose transcript heartbeat has not progressed in time.
With --reap, kills stalled processes, marks runs cancelled, and resets tasks.

Options:
  --transcript-idle-seconds <n>  Idle threshold for transcript activity (default: 300)
  --heartbeat-lag-seconds <n>    Optional threshold for stale heartbeat checks
  --reap, --kill                 Reap (kill + cancel) stalled runs
  --dry-run                      Show what would be reaped without mutating state
  --no-reset-task                Do not reset associated tasks to ready on reap
  --json                         Output as JSON
  --help                         Show this help

Examples:
  tx trace stalled --transcript-idle-seconds 300
  tx trace stalled --reap --transcript-idle-seconds 300
  tx trace stalled --reap --dry-run --json`,

  "trace errors": `tx trace errors - Show recent errors across all runs

Usage: tx trace errors [options]

Aggregates errors from multiple sources:
- Failed runs (runs with status='failed')
- Error spans (operations that threw exceptions)
- Error events (explicit error events)

Useful for quickly identifying patterns in failures across multiple runs.

Options:
  --hours <n>       Time window in hours (default: 24)
  --limit, -n <n>   Maximum number of results (default: 20)
  --json            Output as JSON
  --help            Show this help

Examples:
  tx trace errors                  # Recent errors (last 24h)
  tx trace errors --hours 48       # Last 48 hours
  tx trace errors --limit 10       # Top 10 only
  tx trace errors --json           # JSON output for scripting`,

  claim: `tx claim - Claim a task for a worker with a lease

Usage: tx claim <task-id> <worker-id> [options]

Claims a task for a worker, preventing other workers from claiming it.
The claim has a lease duration; if the lease expires, the task becomes
claimable again. Workers should renew leases for long-running tasks.

Arguments:
  <task-id>     Required. Task ID (e.g., tx-a1b2c3d4)
  <worker-id>   Required. Worker ID (e.g., worker-abc12345)

Options:
  --lease <m>   Lease duration in minutes (default: 30)
  --json        Output as JSON
  --help        Show this help

Examples:
  tx claim tx-abc123 worker-def456              # Claim with default 30m lease
  tx claim tx-abc123 worker-def456 --lease 60   # Claim with 60m lease
  tx claim tx-abc123 worker-def456 --json       # JSON output`,

  "claim release": `tx claim release - Release a claim on a task

Usage: tx claim release <task-id> <worker-id> [options]

Releases a worker's claim on a task, allowing other workers to claim it.
Only the worker holding the claim can release it.

Arguments:
  <task-id>     Required. Task ID (e.g., tx-a1b2c3d4)
  <worker-id>   Required. Worker ID that holds the claim

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx claim release tx-abc123 worker-def456
  tx claim release tx-abc123 worker-def456 --json`,

  "claim renew": `tx claim renew - Renew the lease on a claim

Usage: tx claim renew <task-id> <worker-id> [options]

Extends the lease on an existing claim. Use this for long-running tasks
to prevent the claim from expiring. Maximum 10 renewals by default.

Arguments:
  <task-id>     Required. Task ID (e.g., tx-a1b2c3d4)
  <worker-id>   Required. Worker ID that holds the claim

Options:
  --json   Output as JSON
  --help   Show this help

Fails if:
  - No active claim exists for this task and worker
  - The lease has already expired
  - Maximum renewals (10) have been exceeded

Examples:
  tx claim renew tx-abc123 worker-def456
  tx claim renew tx-abc123 worker-def456 --json`,

  compact: `tx compact - Compact completed tasks and export learnings

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
  tx compact --json                    # Output as JSON`,

  history: `tx history - View compaction history

Usage: tx history [options]

Shows the history of past compaction operations including dates,
task counts, and where learnings were exported.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx history
  tx history --json`,

  validate: `tx validate - Database health checks

Usage: tx validate [options]

Performs comprehensive pre-flight checks on the database:
- Database integrity (SQLite PRAGMA integrity_check)
- Schema version verification
- Foreign key constraint validation
- Orphaned dependency detection
- Invalid status values scan
- Missing parent references

Use before running agents or after sync import to catch corruption early.

Options:
  --fix    Auto-fix what's fixable (orphaned deps, invalid statuses, missing parent refs)
  --json   Output as JSON
  --help   Show this help

Exit Codes:
  0        Database is valid (no errors)
  1        Validation failed (errors found)

Examples:
  tx validate              # Run all checks
  tx validate --fix        # Auto-fix fixable issues
  tx validate --json       # Machine-readable output`,

  stats: `tx stats - Show queue metrics and health overview

Usage: tx stats [options]

Displays aggregate statistics about the task queue including:
- Task counts by status with percentages
- Ready tasks grouped by priority (score range)
- Completion activity (last 24h, 7d, avg per day)
- Active and expired claim counts

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx stats              # Show queue metrics
  tx stats --json       # Machine-readable output`,

  bulk: `tx bulk - Batch operations on multiple tasks

Usage: tx bulk <subcommand> <args...> [options]

Subcommands:
  done <id...>           Complete multiple tasks at once
  score <n> <id...>      Set priority score for multiple tasks
  reset <id...>          Reset multiple tasks to ready status
  delete <id...>         Delete multiple tasks

Operations are executed sequentially. Each task is processed independently;
failures on one task do not prevent processing of the remaining tasks.
A summary of successes and failures is printed at the end.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx bulk done tx-abc123 tx-def456 tx-ghi789
  tx bulk score 900 tx-abc123 tx-def456
  tx bulk reset tx-abc123 tx-def456
  tx bulk delete tx-abc123 tx-def456 --json`,

  doctor: `tx doctor - System diagnostics for troubleshooting

Usage: tx doctor [options]

Runs diagnostic checks to help troubleshoot issues:
- Database file exists and is readable
- WAL mode enabled
- Schema version matches expected
- Effect services are properly wired
- Stale claims and workers
- Task and learning counts
- ANTHROPIC_API_KEY availability for LLM features

Options:
  --verbose, -v  Include detailed output for each check
  --json         Output as JSON
  --help         Show this help

Exit Codes:
  0        All checks pass (healthy)
  1        One or more checks failed

Examples:
  tx doctor              # Run diagnostics
  tx doctor --verbose    # Include detailed output
  tx doctor --json       # Machine-readable output`,

  dashboard: `tx dashboard - Start API server + dashboard and open in browser

Usage: tx dashboard [options]

Starts the dashboard API server (port 3001) and Vite dev server (port 5173),
then opens the dashboard in Brave Browser (falls back to Chrome).

Options:
  --no-open    Start servers without opening browser
  --port <n>   Custom API server port (default: 3001)

Press Ctrl+C to stop both servers.

Examples:
  tx dashboard              # Start and open in Brave/Chrome
  tx dashboard --no-open    # Start without opening browser
  tx dashboard --port 3002  # Custom API port`,

  send: `tx send - Send a message to a channel

Usage: tx send <channel> <content> [options]

Options:
  --sender <s>       Sender name (default: "cli")
  --task <id>        Associate with a task ID
  --ttl <seconds>    Time-to-live in seconds
  --correlation <id> Correlation ID for request/reply
  --metadata '{}'    JSON metadata object
  --json             Output as JSON

Examples:
  tx send worker-3 "Review PR #42" --sender orchestrator
  tx send broadcast "v2.3.0 deployed" --sender ci --ttl 3600
  tx send errors "OOM at step 4" --sender worker-3 --task tx-abc123
  tx send orchestrator "Done" --correlation 550e8400-e29b`,

  inbox: `tx inbox - Read messages from a channel

Usage: tx inbox <channel> [options]

Read-only: does NOT modify message status. Use tx ack to acknowledge.
Use --after for cursor-based reading (each reader tracks their own position).

Options:
  --after <id>       Only messages with ID > this value (cursor)
  --limit <n>        Max messages to return (default: 50)
  --sender <s>       Filter by sender
  --correlation <id> Filter by correlation ID
  --include-acked    Include already-acknowledged messages
  --json             Output as JSON

Examples:
  tx inbox worker-3                    # Read pending messages
  tx inbox broadcast --after 42        # Cursor-based fan-out
  tx inbox orchestrator --json         # JSON output
  tx inbox errors --include-acked      # Include acked messages`,

  ack: `tx ack - Acknowledge a message

Usage: tx ack <message-id> [--json]

Transitions a message from pending to acked.

Examples:
  tx ack 42
  tx ack 42 --json`,

  "ack all": `tx ack all - Acknowledge all pending messages on a channel

Usage: tx ack all <channel> [--json]

Examples:
  tx ack all worker-3
  tx ack all errors --json`,

  "outbox pending": `tx outbox pending - Count pending messages

Usage: tx outbox pending <channel> [--json]

Examples:
  tx outbox pending errors
  tx outbox pending worker-3 --json`,

  "outbox gc": `tx outbox gc - Garbage collect old messages

Usage: tx outbox gc [--acked-older-than <hours>] [--json]

Deletes expired messages (past TTL) and optionally old acked messages.

Options:
  --acked-older-than <hours>  Delete acked messages older than N hours

Examples:
  tx outbox gc                         # Delete expired only
  tx outbox gc --acked-older-than 24   # Also clean acked > 24h old`,

  doc: `tx doc - Manage docs-as-primitives

Usage: tx doc [subcommand] [options]

Subcommands:
  add <kind> <name>         Create a new doc (overview, prd, design)
  edit <name>               Open doc YAML in $EDITOR
  show <name>               Show doc details
  list                      List all docs
  render [name]             Render YAML to Markdown (all docs if no name)
  lock <name>               Lock a doc version (immutable)
  version <name>            Create new version from locked doc
  link <from> <to>          Link two docs
  attach <task-id> <name>   Attach a doc to a task
  patch <design> <patch>    Create a design patch doc
  validate                  Check all tasks are linked to docs
  drift <name>              Detect hash/link drift for a doc
  lint-ears <target>        Validate PRD EARS requirements (doc name or YAML path)

Run 'tx doc <subcommand> --help' for subcommand-specific help.
Running 'tx doc' with no subcommand defaults to 'tx doc list'.

Examples:
  tx doc add prd auth-flow --title "Authentication Flow"
  tx doc show auth-flow --json
  tx doc list --kind design --status changing
  tx doc lock auth-flow
  tx doc version auth-flow
  tx doc render
  tx doc attach tx-abc123 auth-flow
  tx doc drift auth-flow
  tx doc lint-ears auth-flow`,

  "doc add": `tx doc add - Create a new doc

Usage: tx doc add <kind> <name> [--title <title>] [--json]

Creates a new doc with generated YAML template on disk and metadata in DB.

Arguments:
  <kind>    Required. Doc kind: overview, prd, or design
  <name>    Required. Doc name (alphanumeric with dashes/dots)

Options:
  --title, -t <title>  Doc title (defaults to name)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx doc add prd auth-flow --title "Authentication Flow"
  tx doc add design auth-impl -t "Auth Implementation"
  tx doc add overview system-overview`,

  "doc edit": `tx doc edit - Open doc YAML in editor

Usage: tx doc edit <name>

Opens the doc's YAML file in $EDITOR (defaults to vi).

Arguments:
  <name>    Required. Doc name

Examples:
  tx doc edit auth-flow
  EDITOR=code tx doc edit auth-flow`,

  "doc show": `tx doc show - Show doc details

Usage: tx doc show <name> [--md] [--json]

Shows doc metadata. With --md, renders and displays Markdown content.

Arguments:
  <name>    Required. Doc name

Options:
  --md      Render and display Markdown content
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc show auth-flow
  tx doc show auth-flow --md
  tx doc show auth-flow --json`,

  "doc list": `tx doc list - List all docs

Usage: tx doc list [--kind <kind>] [--status <status>] [--json]

Lists all docs, optionally filtered by kind or status.

Options:
  --kind, -k <kind>      Filter by kind (overview, prd, design)
  --status, -s <status>  Filter by status (changing, locked)
  --json                 Output as JSON
  --help                 Show this help

Examples:
  tx doc list
  tx doc list --kind design
  tx doc list --status locked --json`,

  "doc render": `tx doc render - Render YAML to Markdown

Usage: tx doc render [name] [--json]

Renders doc YAML to Markdown files. If no name given, renders all docs.
Also regenerates index.yml and index.md.

Arguments:
  [name]    Optional. Doc name (renders all if omitted)

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc render                # Render all docs
  tx doc render auth-flow      # Render specific doc
  tx doc render --json`,

  "doc lock": `tx doc lock - Lock a doc version

Usage: tx doc lock <name> [--json]

Locks a doc, making it immutable. Also renders final Markdown.
Use 'tx doc version' to create a new editable version from a locked doc.

Arguments:
  <name>    Required. Doc name

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc lock auth-flow
  tx doc lock auth-flow --json`,

  "doc version": `tx doc version - Create new version from locked doc

Usage: tx doc version <name> [--json]

Creates a new editable version of a locked doc. The doc must be locked first.

Arguments:
  <name>    Required. Doc name (must be locked)

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc version auth-flow`,

  "doc link": `tx doc link - Link two docs

Usage: tx doc link <from-name> <to-name> [--type <link-type>]

Creates a directed link between two docs. Link type is auto-inferred
from doc kinds if not specified.

Arguments:
  <from-name>    Required. Source doc name
  <to-name>      Required. Target doc name

Options:
  --type <type>  Link type (overview_to_prd, overview_to_design, prd_to_design, design_patch)
  --json         Output as JSON
  --help         Show this help

Examples:
  tx doc link system-overview auth-prd
  tx doc link auth-prd auth-impl --type prd_to_design`,

  "doc attach": `tx doc attach - Attach a doc to a task

Usage: tx doc attach <task-id> <doc-name> [--type implements|references]

Creates a link between a task and a doc.

Arguments:
  <task-id>     Required. Task ID (e.g., tx-a1b2c3d4)
  <doc-name>    Required. Doc name

Options:
  --type <type>  Link type: implements (default) or references
  --json         Output as JSON
  --help         Show this help

Examples:
  tx doc attach tx-abc123 auth-flow
  tx doc attach tx-abc123 auth-flow --type references`,

  "doc patch": `tx doc patch - Create a design patch doc

Usage: tx doc patch <design-name> <patch-name> [--title <title>]

Creates a new design doc that patches an existing design doc.

Arguments:
  <design-name>  Required. Parent design doc name
  <patch-name>   Required. New patch doc name

Options:
  --title, -t <title>  Patch title (defaults to patch name)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx doc patch auth-impl auth-impl-v2 --title "Auth v2 Migration"`,

  "doc validate": `tx doc validate - Check task-doc coverage

Usage: tx doc validate [--json]

Checks that all tasks are linked to at least one doc.

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc validate
  tx doc validate --json`,

  "doc drift": `tx doc drift - Detect drift for a doc

Usage: tx doc drift <name> [--json]

Checks for drift between the DB metadata and the YAML file on disk.
Reports hash mismatches, missing files, and unlinked design docs.

Arguments:
  <name>    Required. Doc name

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc drift auth-flow
  tx doc drift auth-flow --json`,

  "doc lint-ears": `tx doc lint-ears - Validate PRD EARS requirements

Usage: tx doc lint-ears <doc-name-or-yaml-path> [--json]

Validates the mandatory \`ears_requirements\` section in PRD YAML.
Returns non-zero exit code when EARS entries are invalid.

Arguments:
  <doc-name-or-yaml-path>  Required. Doc name in tx DB or direct YAML file path

Options:
  --json    Output validation result as JSON
  --help    Show this help

Examples:
  tx doc lint-ears PRD-031-ears-requirements
  tx doc lint-ears .tx/docs/prd/PRD-031-ears-requirements.yml
  tx doc lint-ears PRD-031-ears-requirements --json`,

  invariant: `tx invariant - Advanced tooling for doc-derived invariants

Usage: tx invariant <subcommand> [options]

Subcommands:
  list                List all invariants
  show <id>           Show invariant details
  record <id>         Record a check result (--passed or --failed)
  sync                Sync invariants from doc YAML files into DB

Use this when you need to inspect, repair, or directly record checks for
derived invariants. Normal docs-first workflows usually start with
\`tx spec discover\`.

Run 'tx invariant <subcommand> --help' for subcommand-specific help.

Examples:
  tx invariant list
  tx invariant list --subsystem auth --enforcement integration_test
  tx invariant show INV-AUTH-001
  tx invariant record INV-AUTH-001 --passed
  tx invariant sync
  tx invariant sync --doc auth-flow`,

  "invariant list": `tx invariant list - List all invariants

Usage: tx invariant list [options]

Lists all invariants, optionally filtered by subsystem or enforcement type.

Options:
  --subsystem, -s <name>      Filter by subsystem
  --enforcement, -e <type>    Filter by enforcement (integration_test, linter, llm_as_judge)
  --json                      Output as JSON
  --help                      Show this help

Examples:
  tx invariant list
  tx invariant list --subsystem auth
  tx invariant list --enforcement linter --json`,

  "invariant show": `tx invariant show - Show invariant details

Usage: tx invariant show <id> [--json]

Shows full details for an invariant including rule, enforcement type,
subsystem, test/lint/prompt references, and creation date.

Arguments:
  <id>    Required. Invariant ID (e.g., INV-AUTH-001)

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx invariant show INV-AUTH-001
  tx invariant show INV-AUTH-001 --json`,

  "invariant record": `tx invariant record - Record a check result

Usage: tx invariant record <id> --passed|--failed [--details <text>] [--json]

Records whether an invariant check passed or failed. Creates an audit
trail entry for compliance tracking.

Arguments:
  <id>    Required. Invariant ID (e.g., INV-AUTH-001)

Flags (one required):
  --passed     Record a passing check
  --failed     Record a failing check

Options:
  --details, -d <text>  Additional details about the check result
  --json                Output as JSON
  --help                Show this help

Examples:
  tx invariant record INV-AUTH-001 --passed
  tx invariant record INV-AUTH-001 --failed --details "Missing null check"
  tx invariant record INV-AUTH-001 --passed --json`,

  "invariant sync": `tx invariant sync - Sync doc-derived invariants from YAML

Usage: tx invariant sync [--doc <name>] [--json]

Syncs invariants from doc YAML files into the database. Sources include:
- explicit \`invariants\` arrays on docs
- PRD \`ears_requirements\` and \`requirements\`
- design \`goals\`
If a doc name is given, syncs only that doc's invariants. Otherwise syncs all docs.

Most users do not need to run this directly: \`tx spec discover\` refreshes
doc-derived invariants automatically before scanning tests.

Options:
  --doc <name>  Sync invariants from a specific doc only
  --json        Output as JSON
  --help        Show this help

Examples:
  tx invariant sync                  # Sync all docs
  tx invariant sync --doc auth-flow  # Sync specific doc
  tx invariant sync --json`,

  spec: `tx spec - Docs-first spec-to-test traceability primitives

Usage: tx spec <subcommand> [options]

Subcommands:
  discover                     Refresh doc-derived invariants and discover test mappings
  run <test-id>                Record pass/fail run result for mapped test id
  batch                        Import batch run results from stdin JSON
  fci                          Compute Feature Completion Index
  status                       Quick phase + blocker summary
  complete                     Record human sign-off (HARDEN -> COMPLETE)
  health                       Repo rollup for closure, decisions, and drift
  link <inv-id> <file> [name]  Manually link invariant to test
  unlink <inv-id> <test-id>    Remove invariant/test link
  tests <inv-id>               List tests linked to an invariant
  gaps                         List uncovered invariants
  matrix                       Show full traceability matrix

Run 'tx spec <subcommand> --help' for subcommand-specific help.

Examples:
  tx spec discover
  tx spec discover --doc PRD-033-spec-test-traceability
  tx spec gaps --doc PRD-033-spec-test-traceability
  tx spec fci --doc PRD-033-spec-test-traceability
  tx spec run test/core.test.ts::"ready returns unblocked" --passed
  vitest run --reporter=json | tx spec batch --from vitest
  tx spec complete --doc PRD-033-spec-test-traceability --by james
  tx spec health`,

  "spec discover": `tx spec discover - Refresh doc-derived invariants and upsert test mappings

Usage: tx spec discover [--doc <name>] [--patterns <glob1,glob2,...>] [--json]

Refreshes derived invariants from docs first, then scans configured test
patterns for [INV-*], _INV_*, and @spec annotations. Also imports
.tx/spec-tests.yml manifest mappings.

Without \`--doc\`, refreshes all docs before scanning. With \`--doc\`,
refreshes and discovers for that doc scope.

Options:
  --doc <name>                 Sync/discover with doc focus
  --patterns, -p <csv>         Override pattern list for this run
  --json                       Output as JSON

Examples:
  tx spec discover
  tx spec discover --doc auth-flow
  tx spec discover --patterns "test/**/*.test.ts,spec/**/*.py" --json`,

  "spec link": `tx spec link - Manually link an invariant to a test

Usage: tx spec link <inv-id> <file> [name] [--framework <name>] [--json]

Creates or updates a manual mapping in spec_tests.

Examples:
  tx spec link INV-EARS-FL-001 test/integration/core.test.ts "ready detection returns unblocked tasks"
  tx spec link INV-EARS-FL-001 tests/test_ready.py test_ready_inv --framework pytest`,

  "spec unlink": `tx spec unlink - Remove an invariant/test mapping

Usage: tx spec unlink <inv-id> <test-id> [--json]

Examples:
  tx spec unlink INV-EARS-FL-001 test/integration/core.test.ts::ready detection returns unblocked tasks`,

  "spec tests": `tx spec tests - List tests linked to an invariant

Usage: tx spec tests <inv-id> [--json]

Examples:
  tx spec tests INV-EARS-FL-001
  tx spec tests INV-EARS-FL-001 --json`,

  "spec gaps": `tx spec gaps - List uncovered invariants (no linked tests)

Usage: tx spec gaps [--doc <name>] [--sub <name>] [--json]

Examples:
  tx spec gaps
  tx spec gaps --doc PRD-033-spec-test-traceability
  tx spec gaps --sub core`,

  "spec fci": `tx spec fci - Compute Feature Completion Index

Usage: tx spec fci [--doc <name>] [--sub <name>] [--json]

Returns:
  total, covered, uncovered, passing, failing, untested, fci, phase

Phase logic:
  BUILD    fci < 100
  HARDEN   fci = 100 and no sign-off
  COMPLETE fci = 100 and signed off

Options:
  --doc <name>                 Scope by doc
  --sub, --subsystem <name>    Scope by subsystem
  --json                       Output as JSON`,

  "spec batch": `tx spec batch - Import test run results from stdin

Usage: tx spec batch [--from generic|vitest|pytest|go] [--json]

Input must be piped via stdin. Generic format:
  [{"testId":"file::name", "passed":true, "durationMs":12, "details":"..."}]

Examples:
  echo '[{"testId":"test/a.test.ts::works","passed":true}]' | tx spec batch
  vitest run --reporter=json | tx spec batch --from vitest
  pytest --json-report | tx spec batch --from pytest
  go test -json ./... | tx spec batch --from go`,

  "spec matrix": `tx spec matrix - Full invariant-to-test traceability matrix

Usage: tx spec matrix [--doc <name>] [--sub <name>] [--json]

Examples:
  tx spec matrix
  tx spec matrix --doc PRD-033-spec-test-traceability --json`,

  "spec run": `tx spec run - Record a pass/fail run result for a canonical test ID

Usage: tx spec run <test-id> --passed|--failed [--duration <ms>] [--details <text>] [--json]

Exactly one of --passed or --failed must be provided.

Examples:
  tx spec run test/integration/core.test.ts::ready detection returns unblocked tasks --passed
  tx spec run tests/test_ready.py::test_ready_inv --failed --details "assertion failed"`,

  "spec complete": `tx spec complete - Record human completion sign-off

Usage: tx spec complete [--doc <name> | --sub <name>] --by <human> [--notes <text>] [--json]

Records sign-off only when phase is HARDEN (FCI must be 100).
Rejects requests while phase is BUILD.

Options:
  --doc <name>                 Scope by doc
  --sub, --subsystem <name>    Scope by subsystem
  --by <human>                 Required human identifier
  --notes <text>               Optional sign-off notes
  --json                       Output as JSON`,

  "spec status": `tx spec status - Explain scope closure state

Usage: tx spec status [--doc <name>] [--sub <name>] [--json]

Returns:
  phase, fci, total, covered, uncovered, passing, failing, untested,
  signedOff, blockers

Examples:
  tx spec status
  tx spec status --doc auth-flow
  tx spec status --json`,

  cycle: `tx cycle - Cycle-based issue discovery with sub-agent swarms

Usage: tx cycle --task-prompt <text|file> [options]

Dispatches parallel sub-agent swarms to scan for codebase issues,
deduplicates findings across rounds, and optionally fixes them.
Uses a convergence loop: scan → dedup → score → repeat until no new
issues are found (loss stabilizes).

Arguments:
  --task-prompt <text|file>  Required. Area/work being reviewed

Options:
  --scan-prompt <text|file>  What sub-agents look for (default: bugs, anti-patterns, security)
  --name <text>              Cycle name (shown in dashboard)
  --description <text>       Cycle description
  --cycles <N>               Number of cycles (default: 1)
  --max-rounds <N>           Max rounds per cycle (default: 10)
  --agents <N>               Parallel scan agents per round (default: 3)
  --model <model>            LLM model (default: claude-opus-4-6)
  --fix                      Enable fix agent between scan rounds
  --scan-only                Skip fix phase (explicit default)
  --dry-run                  Report only, no DB writes
  --score <N>                Base score for new tasks (default: 500)
  --json                     Output as JSON
  --help                     Show this help

Loss Calculation:
  loss = 3 * HIGH + 2 * MEDIUM + 1 * LOW
  Convergence: loss drops to 0 or stops decreasing between rounds

Examples:
  tx cycle --task-prompt "Review core services"
  tx cycle --task-prompt "Review auth module" --scan-prompt "Find security issues"
  tx cycle --task-prompt "Audit API" --agents 5 --max-rounds 5 --fix
  tx cycle --task-prompt prompt.md --dry-run --json`,

  // Memory commands

  memory: `tx memory - Filesystem-backed memory with search over .md files

Usage: tx memory <subcommand> [options]

Subcommands:
  source add <dir>        Register a directory for indexing
  source rm <dir>         Unregister a directory
  source list             List registered directories
  add <title>             Create a new memory document (.md file)
  tag <id> <tags...>      Add tags to document frontmatter
  untag <id> <tags...>    Remove tags from frontmatter
  relate <id> <target>    Add to frontmatter.related
  set <id> <key> <value>  Set a key-value property
  unset <id> <key>        Remove a property
  props <id>              Show properties for a document
  index                   Index all registered sources
  search <query>          Search memory documents
  show <id>               Display a document
  links <id>              Show outgoing links
  backlinks <id>          Show incoming links
  list                    List all indexed documents
  link <src> <target>     Create explicit edge
  context <task-id>       Get task-relevant memory for prompt injection
  learn <path> <note>     Attach a learning to a file/glob pattern
  recall [path]           Query file-specific learnings by path

Run 'tx memory <subcommand> --help' for subcommand-specific help.

Examples:
  tx memory source add ./docs
  tx memory index
  tx memory search "authentication patterns"
  tx memory add "JWT Best Practices" --tags auth,security
  tx memory tag mem-a7f3bc12 production
  tx memory context tx-a1b2c3d4
  tx memory learn "src/db.ts" "Always use transactions"
  tx memory recall "src/db.ts"`,

  "memory source": `tx memory source - Manage indexed directories

Usage: tx memory source <add|rm|list> [options]

Subcommands:
  add <dir> [--label name]  Register a directory for indexing
  rm <dir>                  Unregister and remove indexed docs
  list                      Show registered directories

Examples:
  tx memory source add ./docs --label "Project docs"
  tx memory source add ~/vault --label "Obsidian vault"
  tx memory source list
  tx memory source rm ./docs`,

  "memory add": `tx memory add - Create a new memory document

Usage: tx memory add <title> [options]

Creates a .md file with optional frontmatter in the first registered source
directory (or --dir).

Arguments:
  <title>                  Document title (used for filename + H1 heading)

Options:
  --content, -c <text>     Initial body content
  --tags, -t <t1,t2>       Comma-separated frontmatter tags
  --prop <k=v,k2=v2>       Comma-separated key=value properties
  --dir, -d <path>         Target directory (default: first source)
  --json                   Output as JSON

Examples:
  tx memory add "Auth Patterns"
  tx memory add "JWT Guide" --content "Use RS256 for production" --tags auth,jwt
  tx memory add "Meeting Notes" --dir ~/vault/meetings`,

  "memory tag": `tx memory tag - Add tags to a memory document

Usage: tx memory tag <id> <tag1> [tag2...] [--json]

Adds tags to the document's frontmatter and re-indexes.

Examples:
  tx memory tag mem-a7f3bc12 security production
  tx memory tag mem-a7f3bc12 reviewed --json`,

  "memory untag": `tx memory untag - Remove tags from a memory document

Usage: tx memory untag <id> <tag1> [tag2...] [--json]

Removes tags from the document's frontmatter and re-indexes.

Examples:
  tx memory untag mem-a7f3bc12 draft`,

  "memory index": `tx memory index - Index all registered source directories

Usage: tx memory index [options]

Scans all registered source directories for .md files and indexes them
into the SQLite database for search.

Options:
  --incremental, -i   Only re-index changed files (hash comparison)
  --status             Show index coverage report instead of indexing
  --json               Output as JSON

Examples:
  tx memory index                    # Full reindex
  tx memory index --incremental      # Only changed files
  tx memory index --status           # Show coverage report`,

  "memory search": `tx memory search - Search memory documents

Usage: tx memory search <query> [options]

Searches indexed memory documents using BM25 text search by default.
Add --semantic for vector similarity and --expand for graph expansion.

Arguments:
  <query>                  Search query

Options:
  --semantic, -s           Enable vector similarity search
  --expand, -e             Enable graph expansion via wikilinks
  --tags, -t <t1,t2>       Filter by tags (comma-separated)
  --prop <key=value>       Filter by property (key=value or key for existence)
  --limit, -n <N>          Max results (default: 10)
  --min-score <N>          Minimum relevance score (default: 0)
  --json                   Output as JSON

Examples:
  tx memory search "authentication"
  tx memory search "auth" --semantic --expand
  tx memory search "auth" --tags security,jwt
  tx memory search "deploy" --prop status=reviewed --limit 5`,

  "memory show": `tx memory show - Display a memory document

Usage: tx memory show <id> [--json]

Shows full document content, metadata, and indexing status.

Examples:
  tx memory show mem-a7f3bc12
  tx memory show mem-a7f3bc12 --json`,

  "memory links": `tx memory links - Show outgoing links from a document

Usage: tx memory links <id> [--json]

Lists wikilinks, frontmatter.related, and explicit edges from the document.

Examples:
  tx memory links mem-a7f3bc12`,

  "memory backlinks": `tx memory backlinks - Show incoming links to a document

Usage: tx memory backlinks <id> [--json]

Lists all documents that link to this document.

Examples:
  tx memory backlinks mem-a7f3bc12`,

  "memory list": `tx memory list - List indexed memory documents

Usage: tx memory list [options]

Options:
  --source <dir>       Filter by source directory
  --tags, -t <t1,t2>   Filter by tags
  --json               Output as JSON

Examples:
  tx memory list
  tx memory list --source ./docs
  tx memory list --tags auth,security --json`,

  "memory link": `tx memory link - Create an explicit edge between documents

Usage: tx memory link <source-id> <target-ref>

Creates a programmatic link between two documents in the SQLite graph.
Unlike wikilinks (parsed from markdown), explicit links are stored
only in the database.

Examples:
  tx memory link mem-a7f3bc12 mem-b8e4cd56
  tx memory link mem-a7f3bc12 "JWT Auth Patterns"`,

  "memory set": `tx memory set - Set a key-value property on a document

Usage: tx memory set <id> <key> <value>

Sets a structured property on the document. Properties are written to
both frontmatter (filesystem) and the database index.

Reserved keys (tags, related, created) cannot be set via this command;
use 'tx memory tag' or 'tx memory relate' instead.

Examples:
  tx memory set mem-a7f3bc12 status reviewed
  tx memory set mem-a7f3bc12 confidence high`,

  "memory unset": `tx memory unset - Remove a property from a document

Usage: tx memory unset <id> <key>

Removes a property from both frontmatter and the database.

Examples:
  tx memory unset mem-a7f3bc12 status`,

  "memory props": `tx memory props - Show properties for a document

Usage: tx memory props <id> [--json]

Lists all key-value properties on a memory document.

Examples:
  tx memory props mem-a7f3bc12
  tx memory props mem-a7f3bc12 --json`,

  "memory relate": `tx memory relate - Add a related reference to a document

Usage: tx memory relate <id> <target-ref>

Adds a reference to frontmatter.related and re-indexes.
Links are tracked in the graph for --expand search.

Examples:
  tx memory relate mem-a7f3bc12 "JWT Auth Patterns"
  tx memory relate mem-a7f3bc12 mem-b8e4cd56`,

  "memory context": `tx memory context - Get task-relevant memory for prompt injection

Usage: tx memory context <task-id> [options]

Retrieves context relevant to a specific task by searching all memory
documents (including learnings). Uses hybrid BM25 + recency scoring.

Arguments:
  <task-id>  Required. The task to get context for

Options:
  -n, --limit <n>      Maximum results (default: 10)
  --semantic            Enable vector similarity search
  --expand              Enable graph expansion via wikilinks
  --inject              Write to .tx/context.md for injection
  --json                Output as JSON

Examples:
  tx memory context tx-a1b2c3d4
  tx memory context tx-a1b2c3d4 --json
  tx memory context tx-a1b2c3d4 --inject
  tx memory context tx-a1b2c3d4 --expand --semantic`,

  "memory learn": `tx memory learn - Attach a learning to a file path or glob pattern

Usage: tx memory learn <path> <note> [options]

Stores a file-specific note that can be recalled when working on matching files.

Arguments:
  <path>    Required. File path or glob pattern (e.g., "src/db.ts", "*.test.ts")
  <note>    Required. The note/learning to attach

Options:
  --task <id>   Associate with a task
  --json        Output as JSON

Examples:
  tx memory learn "src/db.ts" "Always run migrations in a transaction"
  tx memory learn "src/services/*.ts" "Services must use Effect-TS patterns"
  tx memory learn "*.test.ts" "Use vitest describe/it syntax" --task tx-abc123`,

  "memory recall": `tx memory recall - Query file learnings by path

Usage: tx memory recall [path] [options]

Retrieves file-specific learnings. If a path is provided, returns learnings
matching that path (using glob patterns). Without a path, returns all learnings.

Arguments:
  [path]    Optional. File path to match against stored patterns

Options:
  --json    Output as JSON

Examples:
  tx memory recall                           # List all file learnings
  tx memory recall "src/db.ts"               # Learnings for specific file
  tx memory recall "src/services/task.ts"    # Matches patterns like src/services/*.ts
  tx memory recall --json`,

  // Pin commands (context pins for agent memory injection)
  pin: `tx pin - Context pins for agent memory injection

Usage: tx pin <subcommand> [options]

Manage named content blocks ("pins") that are synchronized to agent context
files (CLAUDE.md, AGENTS.md) as <tx-pin id="..."> XML-tagged sections.

Subcommands:
  set <id> [content]    Create or update a pin
  get <id>              Show pin content
  rm <id>               Remove a pin from DB and target files
  list                  List all pins
  sync                  Re-sync all pins to target files
  targets [files...]    Show or set target files

Options:
  --json                Output as JSON
  --file, -f <path>     Read content from file (for set)

Examples:
  tx pin set auth-patterns "Always use JWT with refresh tokens"
  tx pin set coding-standards --file ./standards.md
  echo "Use Effect-TS" | tx pin set effect-rules
  tx pin get auth-patterns
  tx pin list
  tx pin targets CLAUDE.md AGENTS.md
  tx pin sync
  tx pin rm auth-patterns`,

  "pin set": `tx pin set - Create or update a context pin

Usage: tx pin set <id> [content] [--file <path>]

Creates or updates a named content block. The pin is stored in the database
and synchronized to all configured target files as a <tx-pin> XML block.

Arguments:
  <id>        Pin ID (kebab-case: lowercase, numbers, dots, hyphens, underscores)
  [content]   Pin content (optional if using --file or stdin)

Options:
  --file, -f <path>   Read content from a file
  --json              Output as JSON

Content is read from: positional argument > --file > stdin (piped input).

Examples:
  tx pin set auth-patterns "Always use JWT"
  tx pin set coding-standards --file ./standards.md
  echo "Use Effect-TS for all services" | tx pin set effect-rules`,

  "pin get": `tx pin get - Show a pin's content

Usage: tx pin get <id> [--json]

Examples:
  tx pin get auth-patterns
  tx pin get auth-patterns --json`,

  "pin rm": `tx pin rm - Remove a context pin

Usage: tx pin rm <id>

Removes the pin from the database and all target files.
Alias: tx pin remove

Examples:
  tx pin rm auth-patterns`,

  "pin remove": `tx pin remove - Remove a context pin

Usage: tx pin remove <id>

Removes the pin from the database and all target files.
Alias: tx pin rm

Examples:
  tx pin remove auth-patterns`,

  "pin list": `tx pin list - List all context pins

Usage: tx pin list [--json]

Examples:
  tx pin list
  tx pin list --json`,

  "pin sync": `tx pin sync - Re-sync all pins to target files

Usage: tx pin sync [--json]

Reads all pins from the database and writes them to each configured target file.
Adds missing pins, updates changed pins, and removes stale pins from files.
This operation is idempotent.

Examples:
  tx pin sync`,

  "pin targets": `tx pin targets - Show or set target files

Usage: tx pin targets [files...]

With no arguments, shows current target files.
With arguments, sets the target files list.

Examples:
  tx pin targets                       # Show current targets
  tx pin targets CLAUDE.md             # Set single target
  tx pin targets CLAUDE.md AGENTS.md   # Set multiple targets`,

  // --- Utils commands ---

  utils: `tx utils - Utility commands for external tool integration

Usage: tx utils <subcommand> [options]

Subcommands:
  claude-usage    Show Claude Code rate limit usage (% remaining, reset times)
  codex-usage     Show Codex rate limit usage (% remaining, reset times)

Options:
  --json          Output as JSON
  --help          Show this help

Run 'tx utils <subcommand> --help' for subcommand-specific help.`,

  "utils claude-usage": `tx utils claude-usage - Show Claude Code usage

Usage: tx utils claude-usage [--json]

Reads OAuth credentials from ~/.claude/.credentials.json and queries
the Anthropic usage API. Shows utilization percentages for 5-hour and
7-day rate limit windows, with time until reset.

Options:
  --json          Output raw API response as JSON
  --help          Show this help

Examples:
  tx utils claude-usage
  tx utils claude-usage --json`,

  "utils codex-usage": `tx utils codex-usage - Show Codex usage

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
  tx utils codex-usage --json`,

  // --- Bounded Autonomy Primitives ---

  guard: `tx guard - Task creation guards

Usage: tx guard <subcommand> [options]

Subcommands:
  set       Set guard limits (--max-pending, --max-children, --max-depth)
  show      Show current guard configuration
  clear     Clear all guards or a specific scope

Guards limit task creation to prevent unbounded proliferation. Advisory
mode (default) prints warnings; enforce mode blocks task creation.

Run 'tx guard <subcommand> --help' for subcommand-specific help.

Examples:
  tx guard set --max-pending 50 --max-depth 4
  tx guard set --max-pending 30 --enforce
  tx guard set --scope parent:tx-abc123 --max-children 5
  tx guard show --json
  tx guard clear`,

  "guard set": `tx guard set - Set task creation guards

Usage: tx guard set [options]

Options:
  --max-pending <n>       Maximum non-done tasks globally (>= 1)
  --max-children <n>      Maximum direct children per parent (>= 1)
  --max-depth <n>         Maximum hierarchy nesting depth (>= 1)
  --scope <scope>         Guard scope (default: "global", or "parent:<id>")
  --enforce               Enable enforce mode (block task creation on violation)
  --advisory              Enable advisory mode (warn but allow, default)
  --json                  Output as JSON
  --help                  Show this help

At least one limit or mode flag is required.

Examples:
  tx guard set --max-pending 50
  tx guard set --max-pending 30 --max-depth 3 --enforce
  tx guard set --scope parent:tx-abc123 --max-children 5`,

  "guard show": `tx guard show - Show current guard configuration

Usage: tx guard show [--json]

Displays all configured guards with their limits and mode.

Options:
  --json          Output as JSON
  --help          Show this help`,

  "guard clear": `tx guard clear - Clear guards

Usage: tx guard clear [--scope <scope>] [--json]

Removes all guards, or a specific scope if --scope is provided.

Options:
  --scope <scope>   Clear only this scope (e.g., "global", "parent:tx-abc123")
  --json            Output as JSON
  --help            Show this help`,

  gate: `tx gate - Human-in-the-loop phase gates (pin wrapper)

Usage: tx gate <subcommand> [options]

Subcommands:
  create <name>              Create gate.<name> with default state
  approve <name> --by <who>  Approve the gate
  revoke <name> --by <who>   Revoke the gate
  check <name>               Exit 0 if approved, 1 otherwise
  status <name>              Show full gate state
  list                       List all gate.* pins
  rm <name>                  Remove gate pin

Run 'tx gate <subcommand> --help' for subcommand-specific help.`,

  "gate create": `tx gate create - Create a phase gate

Usage: tx gate create <name> [--phase-from <phase>] [--phase-to <phase>] [--task-id <id>] [--force] [--json]

Examples:
  tx gate create docs-to-build --phase-from docs_harden --phase-to feature_build
  tx gate create docs-to-build --task-id tx-a1b2c3d4`,

  "gate approve": `tx gate approve - Approve a phase gate

Usage: tx gate approve <name> --by <approver> [--note <text>] [--json]

Examples:
  tx gate approve docs-to-build --by james`,

  "gate revoke": `tx gate revoke - Revoke a phase gate

Usage: tx gate revoke <name> --by <approver> [--reason <text>] [--json]

Examples:
  tx gate revoke docs-to-build --by james --reason "needs more review"`,

  "gate check": `tx gate check - Check gate approval state

Usage: tx gate check <name> [--json]

Exit codes:
  0  Gate approved
  1  Gate missing or not approved`,

  "gate status": `tx gate status - Show gate state

Usage: tx gate status <name> [--json]`,

  "gate list": `tx gate list - List all gates

Usage: tx gate list [--json]`,

  "gate rm": `tx gate rm - Remove a gate

Usage: tx gate rm <name> [--json]`,

  verify: `tx verify - Machine-checkable verification

Usage: tx verify <subcommand> [options]

Subcommands:
  set <id> <cmd>   Attach a shell command to verify task completion
  show <id>        Show the verify command for a task
  run <id>         Execute the verify command and report pass/fail
  clear <id>       Remove the verify command from a task

Verification commands define machine-checkable "done" criteria. Exit code
0 = pass, non-zero = fail.

Run 'tx verify <subcommand> --help' for subcommand-specific help.

Examples:
  tx verify set tx-abc123 "bun run test:unit"
  tx verify run tx-abc123
  tx verify run tx-abc123 --json
  tx verify run tx-abc123 && tx done tx-abc123`,

  "verify set": `tx verify set - Attach a verify command

Usage: tx verify set <id> <command> [--schema <path>] [--json]

Attaches a shell command that defines "done" for a task. The command
should exit 0 for pass and non-zero for fail.

Arguments:
  <id>            Task ID
  <command>       Shell command to run for verification

Options:
  --schema <path>   JSON Schema file for structured output validation
  --json            Output as JSON
  --help            Show this help

Examples:
  tx verify set tx-abc123 "bun run test:unit"
  tx verify set tx-abc123 "bun run test:auth --json" --schema verify-schema.json`,

  "verify show": `tx verify show - Show verify command

Usage: tx verify show <id> [--json]

Shows the verification command and optional schema for a task.

Options:
  --json          Output as JSON
  --help          Show this help`,

  "verify run": `tx verify run - Run verification

Usage: tx verify run <id> [--timeout <seconds>] [--json]

Executes the verify command attached to the task and reports pass/fail.
Exit code 0 from the command = pass, non-zero = fail.

Options:
  --timeout <seconds>   Command timeout (default: 300)
  --json                Output structured result as JSON
  --help                Show this help

Examples:
  tx verify run tx-abc123
  tx verify run tx-abc123 --timeout 60 --json`,

  "verify clear": `tx verify clear - Remove verify command

Usage: tx verify clear <id> [--json]

Removes the verification command from a task.

Options:
  --json          Output as JSON
  --help          Show this help`,

  label: `tx label - Label management

Usage: tx label <subcommand> [options]

Subcommands:
  add <name>             Create a new label
  list                   List all labels
  assign <id> <label>    Assign a label to a task
  unassign <id> <label>  Remove a label from a task
  delete <name>          Delete a label

Labels enable phase-based scoping of the ready queue:
  tx ready --label "phase:implement"
  tx list --label "sprint:w10" --exclude-label "blocked"

Run 'tx label <subcommand> --help' for subcommand-specific help.`,

  "label add": `tx label add - Create a label

Usage: tx label add <name> [--color <hex>] [--json]

Options:
  --color <hex>   Label color (e.g., "#3b82f6")
  --json          Output as JSON
  --help          Show this help

Examples:
  tx label add "phase:discovery"
  tx label add "phase:implement" --color "#22c55e"`,

  "label list": `tx label list - List all labels

Usage: tx label list [--json]

Options:
  --json          Output as JSON
  --help          Show this help`,

  "label assign": `tx label assign - Assign a label to a task

Usage: tx label assign <task-id> <label-name> [--json]

The label must exist (create it first with 'tx label add').

Options:
  --json          Output as JSON
  --help          Show this help

Examples:
  tx label assign tx-abc123 "phase:discovery"`,

  "label unassign": `tx label unassign - Remove a label from a task

Usage: tx label unassign <task-id> <label-name> [--json]

Options:
  --json          Output as JSON
  --help          Show this help`,

  "label delete": `tx label delete - Delete a label

Usage: tx label delete <name> [--json]

Alias: tx label remove

Options:
  --json          Output as JSON
  --help          Show this help`,

  "label remove": `tx label remove - Delete a label (alias for "tx label delete")

Usage: tx label remove <name> [--json]

Options:
  --json          Output as JSON
  --help          Show this help`,

  reflect: `tx reflect - Session retrospective

Usage: tx reflect [options]

Aggregates session data, throughput, proliferation metrics, stuck tasks,
and signals into a structured retrospective. Use this to assess what's
working and tune your agent orchestration.

Options:
  --sessions <n>    Number of recent sessions to analyze (default: 10)
  --hours <n>       Time window in hours (supports decimals, e.g., 0.5)
  --analyze         Enable LLM analysis tier (requires ANTHROPIC_API_KEY)
  --json            Output as JSON (machine-readable for orchestrators)
  --help            Show this help

Signals (machine-readable flags):
  HIGH_PROLIFERATION   More tasks created than completed
  STUCK_TASKS          Tasks with 3+ failed attempts
  DEPTH_WARNING        Max depth exceeds guard limit
  PENDING_HIGH         Pending tasks near guard limit

Examples:
  tx reflect                  # last 10 sessions
  tx reflect --sessions 5     # last 5 sessions
  tx reflect --hours 1        # last hour's activity
  tx reflect --analyze        # with LLM analysis (requires ANTHROPIC_API_KEY)
  tx reflect --json           # machine-readable for orchestrators`,

  decision: `tx decision - Manage decisions as first-class artifacts

Usage: tx decision <subcommand> [options]

Subcommands:
  add <content>       Add a decision manually
  list                List decisions (default if no subcommand)
  show <id>           Show decision details
  approve <id>        Approve a pending decision
  reject <id>         Reject a pending decision (--reason required)
  edit <id> <content> Edit a pending decision's content
  pending             Shorthand for list --status pending

Options (where applicable):
  --question <q>      Question this decision answers (add)
  --task <id>         Link to a task (add)
  --doc <id>          Link to a doc (add)
  --commit <sha>      Git commit (add)
  --reviewer <name>   Reviewer name (approve/reject/edit)
  --note <text>       Approval note (approve)
  --reason <text>     Rejection reason (reject, required)
  --status <s>        Filter by status (list)
  --source <s>        Filter by source: manual, diff, transcript, agent (list)
  --limit <n>         Maximum results (list)
  --json              Output as JSON
  --help              Show this help

Examples:
  tx decision add "Use WAL mode for SQLite" --question "Which journal mode?"
  tx decision list --status pending
  tx decision approve dec-abc123 --reviewer james --note "Good call"
  tx decision reject dec-abc123 --reviewer james --reason "Too complex"
  tx decision edit dec-abc123 "Use WAL mode with 64MB cache"
  tx decision pending`,

  "spec health": `tx spec health - Repo-level spec-driven development rollup

Usage: tx spec health [--json]

Aggregates spec trace closure, decision status, and doc drift into a
single health view. Shows overall status: SYNCED, DRIFTING, or BROKEN.
This is an operations view for the repo, not part of the minimum day-1 loop.

Dimensions:
  Spec -> Test    Linked coverage across active invariants
  Spec State      Passing, failing, untested, uncovered invariants
  Doc Closure     COMPLETE vs HARDEN vs BUILD across docs with invariants
  Decisions       Pending and approved-but-unsynced decisions
  Doc Drift       Docs with YAML hash mismatches
  Doc hierarchy   Count of docs by tier (REQ, PRD, DD, SD)

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx spec health
  tx spec health --json`,

  triangle: `tx triangle is a deprecated alias for 'tx spec health'.

Run 'tx spec health --help' for full usage.`,
}
