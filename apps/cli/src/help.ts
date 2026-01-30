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
  migrate status          Show database migration status
  learning:add            Add a learning
  learning:search         Search learnings
  learning:recent         List recent learnings
  learning:helpful        Record learning helpfulness
  context                 Get contextual learnings for a task
  learn                   Attach a learning to file/glob pattern
  recall                  Query learnings for a path
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

  sync: `tx sync - Manage JSONL sync for git-based task sharing

Usage: tx sync <subcommand> [options]

Subcommands:
  export    Export all tasks and dependencies to JSONL file
  import    Import tasks from JSONL file (timestamp-based merge)
  status    Show sync status and whether database has unexported changes
  auto      Enable or disable automatic sync on mutations
  compact   Compact JSONL file by deduplicating operations

Run 'tx sync <subcommand> --help' for subcommand-specific help.

Examples:
  tx sync export               # Export to .tx/tasks.jsonl
  tx sync import               # Import from .tx/tasks.jsonl
  tx sync status               # Show sync status
  tx sync auto --enable        # Enable auto-sync
  tx sync compact              # Compact JSONL file`,

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
relevance (BM25 score) and recency.

Arguments:
  <query>  Required. Search query (keywords or phrase)

Options:
  -n, --limit <n>      Maximum results (default: 10)
  --min-score <n>      Minimum relevance score 0-1 (default: 0.3)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx learning:search "database transactions"
  tx learning:search "authentication" -n 5 --json`,

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

  context: `tx context - Get contextual learnings for a task

Usage: tx context <task-id> [options]

Retrieves learnings relevant to a specific task based on its title and
description. Uses hybrid BM25 + recency scoring.

Arguments:
  <task-id>  Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json     Output as JSON
  --inject   Write to .tx/context.md for injection
  --help     Show this help

Examples:
  tx context tx-a1b2c3d4
  tx context tx-a1b2c3d4 --json
  tx context tx-a1b2c3d4 --inject`,

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
  tx add --help     # Same as above`
}
