/**
 * CLI help text for all commands
 */

export const HELP_TEXT = `tx v0.1.0 - Task management for AI agents and humans

Usage: tx <command> [arguments] [options]

Commands:
  init                    Initialize task database
  add <title>             Create a new task
  list                    List tasks
  ready                   List ready tasks (no blockers)
  show <id>               Show task details
  update <id>             Update task
  done <id>               Mark task complete
  reset <id>              Reset task to ready (recover from stuck)
  delete <id>             Delete task
  block <id> <blocker>    Add blocking dependency
  unblock <id> <blocker>  Remove blocking dependency
  children <id>           List child tasks
  tree <id>               Show task subtree
  try <id> <approach>     Record an attempt on a task
  attempts <id>           List attempts for a task
  sync export             Export tasks to JSONL file
  sync import             Import tasks from JSONL file
  sync status             Show sync status
  sync claude             Sync tasks to Claude Code team directory
  sync codex              Sync tasks to Codex (coming soon)
  migrate status          Show database migration status
  learning:add            Add a learning
  learning:search         Search learnings
  learning:recent         List recent learnings
  learning:helpful        Record learning helpfulness
  learning:embed          Compute embeddings for learnings
  context                 Get contextual learnings for a task
  learn                   Attach a learning to file/glob pattern
  recall                  Query learnings for a path
  graph:verify            Verify anchor validity
  graph:invalidate        Manually invalidate an anchor
  graph:restore           Restore a soft-deleted anchor
  graph:prune             Hard delete old invalid anchors
  graph:status            Show graph health metrics
  graph:pin               Pin anchor to prevent auto-invalidation
  graph:unpin             Unpin anchor to allow auto-invalidation
  hooks:install           Install post-commit hook for verification
  hooks:uninstall         Remove post-commit hook
  hooks:status            Show git hook status
  test:cache-stats        Show LLM cache statistics
  test:clear-cache        Clear LLM cache entries
  daemon start            Start background daemon
  daemon stop             Stop background daemon
  daemon status           Show daemon status
  coordinator start      Start the coordinator
  coordinator stop       Stop the coordinator
  coordinator status     Show coordinator status
  coordinator reconcile  Force reconciliation pass
  worker start            Start a worker process
  worker stop             Stop a worker process
  worker status           Show worker status
  worker list             List all workers
  trace list              Show recent runs with event counts
  trace show              Show metrics events for a run
  trace transcript        Display raw transcript content
  trace stderr            Display stderr content
  trace errors            Show recent errors across all runs
  claim                   Claim a task with a lease
  claim:release           Release a claim on a task
  claim:renew             Renew the lease on a claim
  compact                 Compact completed tasks and export learnings
  history                 View compaction history
  validate                Run pre-flight database health checks
  bulk done <id...>       Complete multiple tasks
  bulk score <n> <id...>  Set score for multiple tasks
  bulk reset <id...>      Reset multiple tasks to ready
  bulk delete <id...>     Delete multiple tasks
  stats                   Show queue metrics and health overview
  doctor                  Run system diagnostics for troubleshooting
  daemon track            Track a project for learning extraction
  daemon untrack          Stop tracking a project
  daemon list             List tracked projects
  daemon process          Process learning candidates
  daemon review           List pending learning candidates
  daemon promote          Promote a candidate to learning
  daemon reject           Reject a learning candidate
  mcp-server              Start MCP server (JSON-RPC over stdio)

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
  tx done <task-id>`

export const commandHelp: Record<string, string> = {
  init: `tx init - Initialize task database

Usage: tx init [--db <path>]

Initializes the tx database and required tables. Creates .tx/tasks.db
by default. Safe to run multiple times (idempotent).

Options:
  --db <path>   Database path (default: .tx/tasks.db)
  --help        Show this help

Examples:
  tx init                     # Initialize in .tx/tasks.db
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
  --json                  Output as JSON
  --help                  Show this help

Examples:
  tx add "Implement auth"
  tx add "Login page" --parent tx-a1b2c3d4 --score 600
  tx add "Fix bug" -s 800 -d "Urgent fix for login"`,

  list: `tx list - List tasks

Usage: tx list [options]

Lists all tasks, optionally filtered by status. Shows task ID, status,
score, title, and ready indicator (+).

Options:
  --status <s>     Filter by status (comma-separated: backlog,ready,active,done)
  --limit, -n <n>  Maximum tasks to show
  --json           Output as JSON
  --help           Show this help

Examples:
  tx list                          # List all tasks
  tx list --status backlog,ready   # Only backlog and ready tasks
  tx list -n 10 --json             # Top 10 as JSON`,

  ready: `tx ready - List ready tasks

Usage: tx ready [options]

Lists tasks that are ready to work on (status is workable and all blockers
are done). Sorted by score, highest first.

Options:
  --limit, -n <n>  Maximum tasks to show (default: 10)
  --json           Output as JSON
  --help           Show this help

Examples:
  tx ready             # Top 10 ready tasks
  tx ready -n 5        # Top 5 ready tasks
  tx ready --json      # Output as JSON for scripting`,

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
  --json  Output as JSON (includes task and newly unblocked task IDs)
  --help  Show this help

Examples:
  tx done tx-a1b2c3d4
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
this task.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx delete tx-a1b2c3d4`,

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

  try: `tx try - Record an attempt on a task

Usage: tx try <task-id> <approach> --failed|--succeeded [reason]

Records an attempt made on a task. Useful for tracking what approaches
have been tried and their outcomes. Helps agents avoid repeating
failed approaches.

Arguments:
  <task-id>    Required. Task ID (e.g., tx-a1b2c3d4)
  <approach>   Required. Description of the approach tried

Flags (mutually exclusive, one required):
  --failed     Mark the attempt as failed
  --succeeded  Mark the attempt as succeeded

Options:
  [reason]     Optional reason/explanation after the flag
  --json       Output as JSON
  --help       Show this help

Examples:
  tx try tx-abc123 "Used Redux" --failed "Too complex for this use case"
  tx try tx-abc123 "Used Zustand" --succeeded
  tx try tx-abc123 "Direct state prop drilling" --failed --json`,

  attempts: `tx attempts - List attempts for a task

Usage: tx attempts <task-id> [--json]

Lists all attempts recorded for a task, sorted by most recent first.
Shows the approach tried, outcome (success/failure), reason if any,
and timestamp.

Arguments:
  <task-id>  Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json     Output as JSON (full attempt array)
  --help     Show this help

Examples:
  tx attempts tx-abc123
  tx attempts tx-abc123 --json`,

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

  sync: `tx sync - Manage JSONL sync and platform integrations

Usage: tx sync <subcommand> [options]

Subcommands:
  export    Export all tasks and dependencies to JSONL file
  import    Import tasks from JSONL file (timestamp-based merge)
  status    Show sync status and whether database has unexported changes
  auto      Enable or disable automatic sync on mutations
  compact   Compact JSONL file by deduplicating operations
  claude    Write tasks to Claude Code team task directory
  codex     Write tasks to Codex (coming soon)

Run 'tx sync <subcommand> --help' for subcommand-specific help.

Examples:
  tx sync export               # Export to .tx/tasks.jsonl
  tx sync import               # Import from .tx/tasks.jsonl
  tx sync status               # Show sync status
  tx sync auto --enable        # Enable auto-sync
  tx sync compact              # Compact JSONL file
  tx sync claude --team my-team  # Push tasks to Claude Code team`,

  "sync export": `tx sync export - Export tasks to JSONL

Usage: tx sync export [options]

Exports tasks and dependencies from the database to JSONL files.
The files can be committed to git for sharing across machines.

Options:
  --path <p>        Output file path for tasks (default: .tx/tasks.jsonl)
  --json            Output result as JSON
  --help            Show this help

Examples:
  tx sync export                    # Export tasks only
  tx sync export --json             # Export as JSON`,

  "sync import": `tx sync import - Import tasks from JSONL

Usage: tx sync import [options]

Imports tasks from JSONL files into the database. Uses timestamp-based
conflict resolution: newer records win. Safe to run multiple times.

Options:
  --path <p>        Input file path for tasks (default: .tx/tasks.jsonl)
  --json            Output result as JSON
  --help            Show this help

Examples:
  tx sync import                    # Import tasks only
  tx sync import --json             # Import as JSON`,

  "sync status": `tx sync status - Show sync status

Usage: tx sync status [--json]

Shows the current sync status including:
- Number of tasks in database
- Number of operations in JSONL file
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

Controls whether mutations automatically trigger JSONL export.
When auto-sync is enabled, any task create/update/delete will
automatically export to the JSONL file.

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

  "sync compact": `tx sync compact - Compact JSONL file

Usage: tx sync compact [--path <path>] [--json]

Compacts the JSONL file by:
- Keeping only the latest state for each entity
- Removing deleted tasks (tombstones)
- Removing removed dependencies

This reduces file size and improves import performance.

Options:
  --path <p>  JSONL file path (default: .tx/tasks.jsonl)
  --json      Output as JSON
  --help      Show this help

Examples:
  tx sync compact                       # Compact default file
  tx sync compact --path ~/shared.jsonl # Compact specific file`,

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

  "learning:add": `tx learning:add - Add a learning

Usage: tx learning:add <content> [options]

Creates a new learning entry. Learnings are pieces of knowledge that can
be retrieved based on task context.

Arguments:
  <content>  Required. The learning content/insight to store

Options:
  -c, --category <cat>     Category tag (e.g., database, auth, api)
  --source-ref <ref>       Reference to source (e.g., task ID, file path)
  --source-type <type>     Source type: manual, compaction, run, claude_md (default: manual)
  --json                   Output as JSON
  --help                   Show this help

Examples:
  tx learning:add "Always use transactions for multi-step DB operations"
  tx learning:add "Rate limit is 100 req/min" -c api
  tx learning:add "Migration requires downtime" --source-ref tx-abc123`,

  "learning:search": `tx learning:search - Search learnings

Usage: tx learning:search <query> [options]

Searches learnings using BM25 full-text search. Returns results ranked by
relevance (BM25 score) and recency. Supports graph expansion to discover
related learnings through the knowledge graph.

Arguments:
  <query>  Required. Search query (keywords or phrase)

Options:
  -n, --limit <n>      Maximum results (default: 10)
  --min-score <n>      Minimum relevance score 0-1 (default: 0.3)
  --expand             Enable graph expansion to find related learnings
  --depth <n>          Graph expansion depth (default: 2)
  --edge-types <types> Comma-separated edge types to traverse
  --json               Output as JSON
  --help               Show this help

Examples:
  tx learning:search "database transactions"
  tx learning:search "authentication" -n 5 --json
  tx learning:search "auth" --expand --depth 3`,

  "learning:recent": `tx learning:recent - List recent learnings

Usage: tx learning:recent [options]

Lists the most recently created learnings.

Options:
  -n, --limit <n>  Maximum results (default: 10)
  --json           Output as JSON
  --help           Show this help

Examples:
  tx learning:recent
  tx learning:recent -n 5 --json`,

  "learning:helpful": `tx learning:helpful - Record learning helpfulness

Usage: tx learning:helpful <id> [options]

Records whether a learning was helpful (outcome feedback). This improves
future retrieval by boosting helpful learnings in search results.

Arguments:
  <id>  Required. Learning ID (number)

Options:
  --score <n>  Helpfulness score 0-1 (default: 1.0)
  --json       Output as JSON
  --help       Show this help

Examples:
  tx learning:helpful 42
  tx learning:helpful 42 --score 0.8`,

  "learning:embed": `tx learning:embed - Compute embeddings for learnings

Usage: tx learning:embed [options]

Computes vector embeddings for learnings to enable semantic search.
Requires TX_EMBEDDINGS=1 environment variable to be set.

Options:
  --embedder <type>  Select embedder: auto (default), openai, local, noop
                     Overrides TX_EMBEDDER environment variable
  --all              Re-embed all learnings (default: only those without embeddings)
  --status           Show embedding coverage status
  --json             Output as JSON
  --help             Show this help

Embedder Types:
  auto     Auto-detect based on available API keys and packages
  openai   Use OpenAI text-embedding-3-small (requires OPENAI_API_KEY)
  local    Use local node-llama-cpp with embeddinggemma-300M
  noop     Disable embeddings (for testing)

Examples:
  TX_EMBEDDINGS=1 tx learning:embed                    # Embed with auto-detection
  TX_EMBEDDINGS=1 tx learning:embed --embedder openai  # Force OpenAI embedder
  TX_EMBEDDINGS=1 tx learning:embed --embedder local   # Force local embedder
  TX_EMBEDDINGS=1 tx learning:embed --all              # Re-embed all learnings
  tx learning:embed --status                           # Show embedding coverage
  tx learning:embed --status --embedder openai         # Show status with embedder info`,

  context: `tx context - Get contextual learnings for a task

Usage: tx context <task-id> [options]

Retrieves learnings relevant to a specific task based on its title and
description. Uses hybrid BM25 + recency scoring. Supports graph expansion
to discover related learnings through the knowledge graph.

Arguments:
  <task-id>  Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json               Output as JSON
  --inject             Write to .tx/context.md for injection
  --expand             Enable graph expansion to find related learnings
  --depth <n>          Graph expansion depth (default: 2)
  --edge-types <types> Comma-separated edge types to traverse
  --retriever <path>   Use custom retriever module (exports Layer<RetrieverService>)
  --help               Show this help

Custom Retriever Format:
  The module should export a default Layer that provides RetrieverService:

  // my-retriever.ts
  import { Layer, Effect } from "effect"
  import { RetrieverService } from "@jamesaphoenix/tx-core"

  export default Layer.succeed(RetrieverService, {
    search: (query, options) => Effect.gen(function* () {
      // Custom Pinecone/Weaviate/Chroma implementation
      return yield* myVectorSearch(query, options)
    }),
    isAvailable: () => Effect.succeed(true)
  })

Examples:
  tx context tx-a1b2c3d4
  tx context tx-a1b2c3d4 --json
  tx context tx-a1b2c3d4 --inject
  tx context tx-a1b2c3d4 --expand --depth 3
  tx context tx-a1b2c3d4 --retriever ./my-retriever.ts`,

  learn: `tx learn - Attach a learning to a file path or glob pattern

Usage: tx learn <path> <note> [options]

Stores a file-specific note that can be recalled when working on matching files.
Supports glob patterns for matching multiple files.

Arguments:
  <path>    Required. File path or glob pattern (e.g., src/services/*.ts)
  <note>    Required. The note/learning to attach

Options:
  --task <id>   Associate with a task ID
  --json        Output as JSON
  --help        Show this help

Examples:
  tx learn "src/db.ts" "Always run migrations in a transaction"
  tx learn "src/services/*.ts" "Services must use Effect-TS patterns"
  tx learn "*.test.ts" "Use vitest describe/it syntax" --task tx-abc123`,

  recall: `tx recall - Query file learnings by path

Usage: tx recall [path] [options]

Retrieves file-specific learnings. If a path is provided, returns learnings
matching that path (using glob patterns). Without a path, returns all learnings.

Arguments:
  [path]    Optional. File path to match against stored patterns

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx recall                           # List all file learnings
  tx recall "src/db.ts"               # Learnings for specific file
  tx recall "src/services/task.ts"    # Matches patterns like src/services/*.ts
  tx recall --json`,

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
  errors                Show recent errors across all runs

Run 'tx trace <subcommand> --help' for subcommand-specific help.

Examples:
  tx trace list                    # Recent runs with span counts
  tx trace list --hours 48         # Runs from last 48 hours
  tx trace show run-abc123         # Metrics events for a run
  tx trace show run-abc123 --full  # Combined events + tool calls timeline
  tx trace transcript run-abc123   # Raw JSONL transcript
  tx trace stderr run-abc123       # Stderr output for debugging
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

  "claim:release": `tx claim:release - Release a claim on a task

Usage: tx claim:release <task-id> <worker-id> [options]

Releases a worker's claim on a task, allowing other workers to claim it.
Only the worker holding the claim can release it.

Arguments:
  <task-id>     Required. Task ID (e.g., tx-a1b2c3d4)
  <worker-id>   Required. Worker ID that holds the claim

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx claim:release tx-abc123 worker-def456
  tx claim:release tx-abc123 worker-def456 --json`,

  "claim:renew": `tx claim:renew - Renew the lease on a claim

Usage: tx claim:renew <task-id> <worker-id> [options]

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
  tx claim:renew tx-abc123 worker-def456
  tx claim:renew tx-abc123 worker-def456 --json`,

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
  tx doctor --json       # Machine-readable output`
}
