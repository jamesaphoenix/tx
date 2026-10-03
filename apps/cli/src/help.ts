export const HELP_TEXT = `tx - Tasks and spec-driven development

Usage: tx <command> [options]

Commands:
  task      Create, organise and complete tasks
  doc       Create specs and plans
  spec      Map invariants, lint specs and inspect evidence
  decision  Record spec decisions
  sync      Git-backed state
  diag      Diagnostics and dashboard
  skills    Four authoring and verification guides
  init      Initialise a project
  schema    Inspect command contracts

Run tx help <command> for details.
`

export const commandHelp: Record<string, string> = {
  "task": `tx task - Task management

Usage:
  tx task <command>

Subcommands:
  add  Create a task
  list  List tasks
  ready  Find unblocked tasks
  show  Show a task
  update  Update a task
  done  Complete a task
  reset  Reset a task
  delete  Delete a task
  dep  Dependencies and hierarchy
  bulk  Bulk task actions
  label  Task labels
`,
  "schema": `tx schema - Show machine-readable CLI command schemas

Usage: tx schema [command] [subcommand]

Returns structured JSON describing the tx command catalog or a specific
command's usage, arguments, options, subcommands, examples, aliases, and
deprecation mapping.

Examples:
  tx schema
  tx schema task dep
  tx schema task dep block`,
  "init": `tx init - Initialize task database


Initializes the tx database and required tables. Creates .tx/tasks.db
by default. Safe to run multiple times (idempotent).

Interactive tx init lets the user choose the exact Claude/Codex tx skills
to install during onboarding. Passing --claude or --codex installs the
full default bundle non-interactively.

Options:
  --db <path>   Database path (default: .tx/tasks.db)
  --claude      Scaffold Claude Code integration (.claude/skills; no CLAUDE.md by default)
  --codex       Scaffold Codex integration (.codex/skills; no AGENTS.md by default)
  --help        Show this help

Examples:
  tx init                     # Initialize database + choose skills interactively
  tx init --claude            # Database + four Claude Code guides
  tx init --codex             # Database + four Codex guides
  tx init --claude --codex    # Database + both integrations
  tx init --db ~/my-tasks.db  # Use custom path`,
  "skills": `tx skills - Generate or sync installable tx skill bundles

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
  tx skills sync --project-dir ../my-project --target codex`,
  "skills generate": `tx skills generate - Generate tx skill bundles

Usage: tx skills generate [options]

Renders deterministic skill bundles for Claude Code and/or Codex from the
four guides: tx-tasks, tx-docs, tx-plan and verify-invariants. They consult live CLI help
and configured document templates. Output is install-ready:

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
  tx skills generate --target codex --json`,
  "skills sync": `tx skills sync - Sync generated tx skill bundles into a project

Usage: tx skills sync [options]

Generates the canonical tx skill bundles in a temp directory, then syncs them
into the target project's install roots:

  .claude/skills/<skill-id>/
  .codex/skills/<skill-id>/

Retired skill directories listed in a valid tx manifest are removed. Changed
tx-managed skill files are updated in place. Unrelated custom skills are
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
  tx skills sync --project-dir ../my-project --json`,
  "task add": `tx task add - Create a new task

Usage: tx task add <title> [options]

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
  tx task add "Implement auth"
  tx task add "Login page" --parent tx-a1b2c3d4 --score 600
  tx task add "Fix bug" -s 800 -d "Urgent fix for login"`,
  "task dep": `tx task dep - Dependencies & hierarchy

Usage: tx task dep <subcommand> [arguments] [options]

Subcommands:
  block <id> <blocker>    Add blocking dependency
  unblock <id> <blocker>  Remove blocking dependency
  children <id>           List child tasks
  tree <id>               Show task subtree

Run 'tx task dep <subcommand> --help' for subcommand-specific help.

Examples:
  tx task dep block tx-abc123 tx-def456
  tx task dep unblock tx-abc123 tx-def456
  tx task dep children tx-abc123
  tx task dep tree tx-abc123`,
  "task dep block": `tx task dep block - Add blocking dependency

Usage: tx task dep block <task-id> <blocker-id> [options]

Makes one task block another. The blocked task cannot be ready until
the blocker is marked done. Circular dependencies are not allowed.

Arguments:
  <task-id>     Required. The task that will be blocked
  <blocker-id>  Required. The task that blocks it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx task dep block tx-abc123 tx-def456`,
  "task dep unblock": `tx task dep unblock - Remove blocking dependency

Usage: tx task dep unblock <task-id> <blocker-id> [options]

Removes a blocking dependency between two tasks.

Arguments:
  <task-id>     Required. The task that was blocked
  <blocker-id>  Required. The task that was blocking it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx task dep unblock tx-abc123 tx-def456`,
  "task dep children": `tx task dep children - List child tasks

Usage: tx task dep children <id> [options]

Lists all direct children of a task (tasks with this task as parent).

Arguments:
  <id>    Required. Parent task ID

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx task dep children tx-a1b2c3d4`,
  "task dep tree": `tx task dep tree - Show task subtree

Usage: tx task dep tree <id> [options]

Shows a task and all its descendants in a tree view.

Arguments:
  <id>    Required. Root task ID

Options:
  --json  Output as JSON (nested structure)
  --help  Show this help

Examples:
  tx task dep tree tx-a1b2c3d4`,
  "diag": `tx diag - Diagnostics

Usage: tx diag <subcommand> [options]

Subcommands:
  stats       Show queue metrics and health overview
  doctor      Run system health checks (DB validation + diagnostics)
  dashboard   Start API server + dashboard UI

Run 'tx diag <subcommand> --help' for subcommand-specific help.

Examples:
  tx diag stats
  tx diag doctor --verbose
  tx diag dashboard`,
  "diag stats": `tx diag stats - Show queue metrics and health overview

Usage: tx diag stats [options]

Displays aggregate statistics about the task queue including:
- Task counts by status with percentages
- Ready tasks grouped by priority (score range)
- Completion activity (last 24h, 7d, avg per day)
- Active and expired claim counts

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx diag stats
  tx diag stats --json`,
  "diag doctor": `tx diag doctor - Check task and spec storage

Usage: tx diag doctor [options]

Reports integrity, schema, WAL mode, service wiring, task counts and worktree spec state.

Options:
  --verbose, -v  Show details
  --fix  Repair supported integrity issues
  --json  Structured output
`,
  "diag dashboard": `tx diag dashboard - Start API server + dashboard UI

Usage: tx diag dashboard [options]

Starts the API server and Vite dev server, then opens the dashboard in a browser.

Options:
  --port <n>    Custom API port (default: 3001)
  --no-open     Start without opening browser
  --help        Show this help

Examples:
  tx diag dashboard
  tx diag dashboard --port 3002 --no-open`,
  "task label": `tx task label - Label management

Usage: tx task label <subcommand> [options]

Subcommands:
  add <name>             Create a new label
  list                   List all labels
  assign <id> <label>    Assign a label to a task
  unassign <id> <label>  Remove a label from a task
  delete <name>          Delete a label

Labels enable phase-based scoping of the ready queue:
  tx task ready --label "phase:implement"
  tx task list --label "sprint:w10" --exclude-label "blocked"

Run 'tx task label <subcommand> --help' for subcommand-specific help.`,
  "sync migrate": `tx sync migrate - Show database migration status

Usage: tx sync migrate status [--json]

Shows current schema version, latest available version, and pending migrations.

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx sync migrate status`,
  "task list": `tx task list - List tasks

Usage: tx task list [options]

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
  tx task list                          # List all tasks
  tx task list --status backlog,ready   # Only backlog and ready tasks
  tx task list -n 10 --json             # Top 10 as JSON
  tx task list --label "phase:implement"  # Tasks with specific label`,
  "task ready": `tx task ready - List ready tasks

Usage: tx task ready [options]

Lists tasks that are ready to work on (status is workable and all blockers
are done). Sorted by score, highest first.

Options:
  --limit, -n <n>            Maximum tasks to show (default: 10)
  --label <name,...>         Filter to tasks with these labels (comma-separated)
  --exclude-label <name,...> Exclude tasks with these labels (comma-separated)
  --json                     Output as JSON
  --help                     Show this help

Examples:
  tx task ready                                # Top 10 ready tasks
  tx task ready -n 5                           # Top 5 ready tasks
  tx task ready --json                         # Output as JSON for scripting
  tx task ready --label "phase:implement"      # Only implementation-phase tasks
  tx task ready --exclude-label "needs-review" # Skip tasks needing review`,
  "task show": `tx task show - Show task details

Usage: tx task show <id> [options]

Shows full details for a single task including title, status, score,
description, parent, blockers, blocks, children, timestamps, and
orchestration status (claim info, failed attempts).

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx task show tx-a1b2c3d4
  tx task show tx-a1b2c3d4 --json`,
  "task update": `tx task update - Update a task

Usage: tx task update <id> [options]

Updates one or more fields on an existing task.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --status <s>          New status (backlog|ready|planning|active|blocked|review|needs_review|done)
  --title <t>           New title
  --score <n>           New score (0-1000)
  --description, -d <text>  New description
  --parent, -p <id>     New parent task ID
  --human               Treat completion-style updates as human initiated
  --json                Output as JSON
  --help                Show this help

Examples:
  tx task update tx-a1b2c3d4 --status active
  tx task update tx-a1b2c3d4 --score 900 --title "High priority bug"`,
  "task done": `tx task done - Mark task complete

Usage: tx task done <id> [options]

Marks a task as complete (status = done). Also reports any tasks
that become unblocked as a result.

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --human  Treat completion as human initiated
  --json  Output as JSON (includes task and newly unblocked task IDs)
  --help  Show this help

Examples:
  tx task done tx-a1b2c3d4
  tx task done tx-a1b2c3d4 --human
  tx task done tx-a1b2c3d4 --json`,
  "task reset": `tx task reset - Reset task to ready status

Usage: tx task reset <id> [options]

Resets a task back to ready status, regardless of current status.
Use this to recover from stuck tasks (e.g., worker killed mid-task).

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx task reset tx-a1b2c3d4              # Reset stuck active task
  tx task reset tx-a1b2c3d4 --json`,
  "task delete": `tx task delete - Delete a task

Usage: tx task delete <id> [options]

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
  tx task delete tx-a1b2c3d4
  tx task delete tx-a1b2c3d4 --cascade   # Delete task and all children`,
  "md-export": `tx md-export - Export tasks to markdown

Usage: tx md-export [options]

Options:
  --path, -p <path>  Output file (default: .tx/tasks.md)
  --filter, -f <filter>  ready|open|all or a status
  --include-done <n>  Completed tasks to include
  --watch, -w  Refresh when tasks change
  --interval <seconds>  Refresh interval
  --json  Output metadata
`,
  "sync": `tx sync - Git-backed state

Usage: tx sync <export|import|status|stream|hydrate|auto|migrate> [options]

Export and import stream events. Hydrate reapplies retained projections without truncation.
Recognised retired events are validated and reported as ignored.

Examples:
  tx sync export
  tx sync import --json
  tx sync hydrate
  tx sync migrate status
`,
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
  "task bulk": `tx task bulk - Batch operations on multiple tasks

Usage: tx task bulk <subcommand> <args...> [options]

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
  tx task bulk done tx-abc123 tx-def456 tx-ghi789
  tx task bulk score 900 tx-abc123 tx-def456
  tx task bulk reset tx-abc123 tx-def456
  tx task bulk delete tx-abc123 tx-def456 --json`,
  "doc": `tx doc - Manage docs-as-primitives

Usage: tx doc [subcommand] [options]

Subcommands:
  add <kind> <name>         Create a new doc (overview, prd, design)
  edit <name>               Open doc in $EDITOR
  show <name>               Show doc details
  list                      List all docs
  rm <name>                 Remove latest mutable doc version
  lock <name>               Lock a doc version (immutable)
  version <name>            Create new version from locked doc
  link <from> <to>          Link two docs
  attach <task-id> <name>   Attach a doc to a task
  patch <design> <patch>    Create a design patch doc
  validate                  Check task-doc coverage + searchable index metadata
  drift <name>              Detect file-vs-DB drift for a doc
  lint-ears <name|path>     Validate PRD EARS requirements
  sync [name]               Re-sync doc hashes from disk

Run 'tx doc <subcommand> --help' for subcommand-specific help.
Running 'tx doc' with no subcommand defaults to 'tx doc list'.

Use 'tx spec lint' for comprehensive doc/spec checking (drift, EARS, coverage).

Examples:
  tx doc add prd auth-flow --title "Authentication Flow"
  tx doc show auth-flow --json
  tx doc list --kind design --status changing
  tx doc rm auth-flow
  tx doc lock auth-flow
  tx doc version auth-flow
  tx doc attach tx-abc123 auth-flow`,
  "doc add": `tx doc add - Create a new doc

Usage: tx doc add <kind> <name> [--title <title>] [--json]

Creates a new doc with generated YAML template on disk and metadata in DB.
The generated frontmatter includes searchable index metadata:
  - summary   -> Description in generated specs/index.md
  - domain    -> included in Search Keywords in generated specs/index.md
  - tags      -> included in Search Keywords in generated specs/index.md

Replace generic placeholders with subsystem-specific language. 'tx spec lint'
and 'tx doc validate' will explain exactly how to fix missing search metadata.

Arguments:
  <kind>    Required. Any spec type from 'tx spec types' (built-ins:
            overview, prd, design, plan, runbook, decision; plus any custom type
            defined under [spec.types.*] in .tx/config.toml)
  <name>    Required. Doc name (alphanumeric with dashes/dots)

Options:
  --title, -t <title>  Doc title (defaults to name)
  --json               Output as JSON
  --help               Show this help

Examples:
  tx doc add prd auth-flow --title "Authentication Flow"
  tx doc add design auth-impl -t "Auth Implementation"
  tx doc add overview system-overview`,
  "doc template": `tx doc template - Print the scaffold for a spec type

Usage: tx doc template <type> [--name <name>] [--title <title>]

Prints the exact markdown 'tx doc add <type>' would scaffold, without writing
anything to disk or the database. Use it to preview the sections that
'tx spec lint' will check for a given spec type.

Arguments:
  <type>    Required. Any type listed by 'tx spec types'

Options:
  --name, -n <name>    Doc name used in the template (default: example-<type>)
  --title, -t <title>  Doc title (defaults to name)
  --help               Show this help

Examples:
  tx doc template prd
  tx doc template rfc --name my-rfc --title "My RFC"`,
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
  "doc rm": `tx doc rm - Remove latest mutable doc version

Usage: tx doc rm <name> [--json]

Removes the latest mutable doc version from the database and deletes its
markdown file from disk. Locked docs cannot be removed.

Arguments:
  <name>    Required. Doc name

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc rm auth-flow
  tx doc rm auth-flow --json`,
  "doc remove": `tx doc remove - Alias for tx doc rm

Usage: tx doc remove <name> [--json]

Alias: 'tx doc remove <name>'

Removes the latest mutable doc version from the database and deletes its
markdown file from disk. Locked docs cannot be removed.

Arguments:
  <name>    Required. Doc name

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx doc remove auth-flow --json`,
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
  "doc validate": `tx doc validate - Validate doc/task coverage and index search metadata

Usage: tx doc validate [--json]

Checks:
  - Tasks linked to docs
  - Searchable index metadata used by generated specs/index.md
    - summary -> Description
    - domain + tags -> Search Keywords

Warnings explain the exact frontmatter field to edit and show an example fix.

Options:
  --json               Output result as JSON
  --help               Show this help

Examples:
  tx doc validate
  tx doc validate --json`,
  "doc sync": `tx doc sync - Atomically refresh docs, invariants, and index

Usage: tx doc sync [name] [--json]

Validates all selected markdown first, then refreshes document hashes,
checkout-scoped document-derived invariants, and specs/index.md as one unit.
If any selected document or index write fails, database and generated-file
changes are rolled back. Use this after editing specs directly.

Arguments:
  [name]  Optional. Sync a single doc by name. Omit to sync all docs.

Options:
  --json               Output result as JSON
  --help               Show this help

Examples:
  tx doc sync                  # sync all docs
  tx doc sync auth-flow        # sync one doc
  tx doc sync --json`,
  "invariant": `tx invariant is deprecated. Use 'tx spec' instead.

Run 'tx spec --help' for full usage.`,
  "spec": `tx spec - Docs-first spec-to-test traceability primitives

Usage: tx spec <subcommand> [options]

Subcommands:
  lint                         All-in-one check (drift, EARS, coverage, spec-test status)
  discover                     Refresh doc-derived invariants and discover test mappings
  health                       Repo rollup for closure, decisions, and drift
  fci                          Compute Feature Completion Index
  status                       Quick phase + blocker summary
  complete                     Record human sign-off (HARDEN -> COMPLETE)
  run <test-id>                Record pass/fail run result for mapped test id
  batch                        Import batch run results from stdin JSON
  link <inv-id> <file> [name]  Manually link invariant to test
  unlink <inv-id> <test-id>    Remove invariant/test link
  tests <inv-id>               List tests linked to an invariant
  gaps                         List uncovered invariants
  matrix                       Show full traceability matrix

Run 'tx spec <subcommand> --help' for subcommand-specific help.

Examples:
  tx spec lint
  tx spec lint --json
  tx spec discover
  tx spec health
  tx spec fci --doc auth-flow
  tx spec run test/core.test.ts::"ready returns unblocked" --passed
  vitest run --reporter=json | tx spec batch --from vitest
  tx spec complete --doc auth-flow --by james`,
  "spec discover": `tx spec discover - Refresh doc-derived invariants and upsert test mappings

Usage: tx spec discover [--doc <name>] [--patterns <glob1,glob2,...>] [--dry-run] [--prune] [--json]

Refreshes derived invariants from docs first, then scans configured test
patterns for [INV-*], _INV_*, and @spec annotations. Also imports
.tx/spec-tests.yml manifest mappings.

Without \`--doc\`, refreshes all docs before scanning. With \`--doc\`,
refreshes and discovers for that doc scope.

Stale auto-discovered mappings are always reported by identity. They are only
deleted when \`--prune\` is supplied. \`--dry-run\` performs no invariant or
mapping writes.

Options:
  --doc <name>                 Sync/discover with doc focus
  --patterns, -p <csv>         Override pattern list for this run
  --dry-run                    Preview mappings and prospective pruning only
  --prune                      Delete stale auto-discovered mappings explicitly
  --no-prune                   Explicitly retain stale mappings (the default)
  --json                       Output as JSON

Examples:
  tx spec discover --dry-run
  tx spec discover --prune
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
  "task label add": `tx task label add - Create a label

Usage: tx task label add <name> [--color <hex>] [--json]

Options:
  --color <hex>   Label color (e.g., "#3b82f6")
  --json          Output as JSON
  --help          Show this help

Examples:
  tx task label add "phase:discovery"
  tx task label add "phase:implement" --color "#22c55e"`,
  "task label list": `tx task label list - List all labels

Usage: tx task label list [--json]

Options:
  --json          Output as JSON
  --help          Show this help`,
  "task label assign": `tx task label assign - Assign a label to a task

Usage: tx task label assign <task-id> <label-name> [--json]

The label must exist (create it first with 'tx task label add').

Options:
  --json          Output as JSON
  --help          Show this help

Examples:
  tx task label assign tx-abc123 "phase:discovery"`,
  "task label unassign": `tx task label unassign - Remove a label from a task

Usage: tx task label unassign <task-id> <label-name> [--json]

Options:
  --json          Output as JSON
  --help          Show this help`,
  "task label delete": `tx task label delete - Delete a label

Usage: tx task label delete <name> [--json]

Alias: tx task label remove

Options:
  --json          Output as JSON
  --help          Show this help`,
  "task label remove": `tx task label remove - Delete a label (alias for "tx task label delete")

Usage: tx task label remove <name> [--json]

Options:
  --json          Output as JSON
  --help          Show this help`,
  "decision": `tx decision - Manage decisions as first-class artifacts

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
  "spec lint": `tx spec lint - All-in-one spec and doc checker

Usage: tx spec lint [--json]

Runs all doc and spec checks in a single pass:
  - Doc drift: hash mismatch between disk and DB
  - Task-doc coverage: tasks not linked to any doc
  - Index searchability: validates frontmatter used to build Description and
    Search Keywords in generated specs/index.md
  - Spec type config: advisory warnings about [spec.types.*] in .tx/config.toml
  - Required sections: missing sections per the configured spec type
  - EARS lint: validates PRD requirements syntax
  - Spec-test status: uncovered or failing invariants

Section checks are lint-only: a missing heading never blocks tx doc add,
tx doc update, tx doc sync, or drift detection. Configure required sections,
their descriptions, per-section lint prompts, and severity (error|warn|off)
under [spec.types.*] in .tx/config.toml. Run 'tx spec types' to see them.

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx spec lint
  tx spec lint --json`,
  "spec types": `tx spec types - Show the configured spec types

Usage: tx spec types [--json]

Prints the effective spec-type registry resolved from [spec.types.*] in
.tx/config.toml: required sections, what belongs under each heading, the lint
prompt emitted when one is missing, the target subdirectory, and severity.

Spec structure is user-configurable. Built-in types (prd, design, overview,
runbook, decision) ship with defaults that are written into .tx/config.toml by
'tx init'; edit them freely, or define a new type by adding a
[spec.types.<name>] section. Custom types are scaffolded and linted like
built-ins.

Not configurable: the frontmatter contract and the embedded yaml block schemas
(ears_requirements with REQ-* ids, invariants with INV-* ids, verification,
interfaces, failure_modes, acceptance_criteria). Those blocks are located
anywhere in the body, so renaming a heading never breaks 'tx spec discover'.

The --json output is the machine-readable contract that generated skills and
agents consume.

Options:
  --json    Output as JSON
  --help    Show this help

Examples:
  tx spec types
  tx spec types --json`,
  "triangle": `tx triangle is a deprecated alias for 'tx spec health'.

Run 'tx spec health --help' for full usage.`,
}
