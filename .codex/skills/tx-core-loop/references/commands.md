# tx Core Loop Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx help

```text
tx v0.17.0 - Headless task infrastructure for AI agents

Usage: tx <command> [arguments] [options]

Start Here:
  init                    Initialize task database
  add <title>             Create a new task
  list                    List tasks
  ready                   List ready (unblocked) tasks
  show <id>               Show task details
  update <id>             Update task
  done <id>               Complete task
  reset <id>              Reset to ready
  delete <id>             Delete task

Dependencies:   tx dep <block|unblock|children|tree>
Messages:       tx msg <send|inbox|ack|pending|gc>
Memory:         tx memory <source|add|index|search|context|...>
Docs & Specs:   tx doc | tx spec <lint|discover|health|...>
Sync & Data:    tx sync <export|import|compact|history|migrate|...>
Traces:         tx trace <list|show|errors|...>
Bulk:           tx bulk <done|score|reset|delete>
Claims:         tx claim [release|renew]
Autonomy:       tx auto <guard|gate|verify|label|reflect>
Context:        tx pin <set|get|rm|list|sync>
Skills:         tx skills <generate|sync>
Diagnostics:    tx diag <stats|doctor|dashboard>
Other:          tx cycle, tx decompose, tx decision, tx utils, tx md-export, tx group-context

Options: --json, --db <path>, --state-root <dir>, --content-root <dir>, --help, --version
Run 'tx help <command>' for details.
Run 'tx help --json' or 'tx schema <command>' for machine-readable command discovery.

Examples:
  tx init
  tx add "Implement auth" --score 800
  tx ready --json
  tx help --json
  tx schema dep block
  tx dep block <task-id> <blocker-id>
  tx done <task-id>
  tx doc add prd auth-flow --title "Auth Flow"
  tx spec discover
  tx decompose auth-flow-design --runtime auto
  tx skills generate --output-dir .tx/generated-skills --clean
  tx skills sync --project-dir ../my-project --target codex
```

## tx add

```text
tx add - Create a new task

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
  tx add "Implement auth tests" --verify "bun run test:auth"
```

## tx bulk

```text
tx bulk - Batch operations on multiple tasks

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
  tx bulk delete tx-abc123 tx-def456 --json
```

## tx claim

```text
tx claim - Claim a task for a worker with a lease

Usage: tx claim <task-id> <worker-id> [options]

Claims a task for a worker, preventing other workers from claiming it.
Sets orchestrationStatus to "claimed" (or "running" if task is active).
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
  tx claim tx-abc123 worker-def456 --json       # JSON output
```

## tx claim release

```text
tx claim release - Release a claim on a task

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
  tx claim release tx-abc123 worker-def456 --json
```

## tx claim renew

```text
tx claim renew - Renew the lease on a claim

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
  tx claim renew tx-abc123 worker-def456 --json
```

## tx delete

```text
tx delete - Delete a task

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
  tx delete tx-a1b2c3d4 --cascade   # Delete task and all children
```

## tx done

```text
tx done - Mark task complete

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
  tx done tx-a1b2c3d4 --json
```

## tx help

```text
tx help - Show help

Usage: tx help [command]
       tx --help
       tx <command> --help

Shows general help or help for a specific command.

Examples:
  tx help           # General help
  tx help add       # Help for 'add' command
  tx add --help     # Same as above
```

## tx init

```text
tx init - Initialize task database

Usage: tx init [--db <path>] [--claude] [--codex] [--watchdog] [--watchdog-runtime <auto|codex|claude|both>]

Initializes the tx database and required tables. Creates .tx/tasks.db
by default. Safe to run multiple times (idempotent).

Interactive tx init lets the user choose the exact Claude/Codex tx skills
to install during onboarding. Passing --claude or --codex installs the
full default bundle non-interactively.

Options:
  --db <path>   Database path (default: .tx/tasks.db)
  --claude      Scaffold Claude Code integration (.claude/skills; no CLAUDE.md by default)
  --codex       Scaffold Codex integration (.codex/skills + .codex/rules; no AGENTS.md by default)
  --watchdog    Scaffold watchdog launcher/scripts/assets (optional later)
  --watchdog-runtime <mode>
                Runtime mode for watchdog: auto|codex|claude|both (default: auto, requires --watchdog)
  --help        Show this help

Examples:
  tx init                     # Initialize database + choose skills interactively
  tx init --claude            # Database + full generated Claude Code skills bundle
  tx init --codex             # Database + full generated Codex skills bundle + rules
  tx init --claude --codex    # Database + both integrations
  tx init --watchdog          # Optional later: watchdog scaffolding (runtime auto-detect)
  tx init --watchdog --watchdog-runtime both
                              # Require both codex and claude runtimes for watchdog
  tx init --db ~/my-tasks.db  # Use custom path
```

## tx list

```text
tx list - List tasks

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
  tx list --label "phase:implement"  # Tasks with specific label
```

## tx ready

```text
tx ready - List ready tasks

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
  tx ready --exclude-label "needs-review" # Skip tasks needing review
```

## tx reset

```text
tx reset - Reset task to ready status

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
  tx reset tx-a1b2c3d4 --json
```

## tx show

```text
tx show - Show task details

Usage: tx show <id> [options]

Shows full details for a single task including title, status, score,
description, parent, blockers, blocks, children, timestamps, and
orchestration status (claim info, failed attempts).

Arguments:
  <id>    Required. Task ID (e.g., tx-a1b2c3d4)

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx show tx-a1b2c3d4
  tx show tx-a1b2c3d4 --json
```

## tx update

```text
tx update - Update a task

Usage: tx update <id> [options]

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
  tx update tx-a1b2c3d4 --status active
  tx update tx-a1b2c3d4 --score 900 --title "High priority bug"
```
