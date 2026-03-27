# tx Autonomy Controls Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx auto

```text
tx auto - Bounded autonomy primitives

Usage: tx auto <subcommand> [arguments] [options]

Subcommands:
  guard <set|show|clear>            Task creation limits
  gate <create|approve|revoke|...>  Human-in-the-loop phase gates
  verify <set|show|run|clear>       Machine-checkable done criteria
  label <add|delete|assign|...>     Ready queue scoping labels
  reflect                           Session retrospective

Run 'tx auto <subcommand> --help' for subcommand-specific help.

Examples:
  tx auto guard set --max-pending 10
  tx auto gate create deploy-gate
  tx auto verify set tx-abc123 "bun run test"
  tx auto label add phase:implement
  tx auto reflect --sessions 5
```

## tx auto gate

```text
tx auto gate - Human-in-the-loop phase gates

Usage: tx auto gate <create|approve|revoke|check|status|list|rm> [options]

Gates stored as context pins with prefix "gate.".

Examples:
  tx auto gate create deploy-gate --phase-from implement --phase-to deploy
  tx auto gate approve deploy-gate --by james
  tx auto gate check deploy-gate
  tx auto gate list
```

## tx auto guard

```text
tx auto guard - Task creation limits

Usage: tx auto guard [set|show|clear] [options]

Set limits on task creation to prevent agent proliferation.

Subcommands:
  set     Set guard limits (--max-pending, --max-children, --max-depth)
  show    Show current guard configuration
  clear   Clear guards (optionally by --scope)

Examples:
  tx auto guard set --max-pending 10 --enforce
  tx auto guard show
  tx auto guard clear
```

## tx auto label

```text
tx auto label - Ready queue scoping labels

Usage: tx auto label <add|delete|assign|unassign|list> [options]

Create labels and assign them to tasks for queue filtering.

Examples:
  tx auto label add phase:implement
  tx auto label assign tx-abc123 phase:implement
  tx auto label list
```

## tx auto reflect

```text
tx auto reflect - Session retrospective

Usage: tx auto reflect [options]

Aggregates session data, throughput, proliferation, stuck tasks, and signals.

Options:
  --sessions <n>   Number of recent sessions (default: 10)
  --hours <n>      Time window in hours
  --analyze        Enable LLM-powered analysis
  --json           Output as JSON

Examples:
  tx auto reflect
  tx auto reflect --sessions 5 --analyze
```

## tx auto verify

```text
tx auto verify - Machine-checkable done criteria

Usage: tx auto verify <set|show|run|clear> <id> [options]

Attach shell commands to tasks as done criteria.

Examples:
  tx auto verify set tx-abc123 bun run test:auth
  tx auto verify run tx-abc123
  tx auto verify show tx-abc123
```

## tx gate

```text
tx gate - Phase gates (approval checkpoints, pin wrapper)

Usage: tx gate <subcommand> [options]

Subcommands:
  create <name>              Create gate.<name> with default state
  approve <name> --by <who>  Approve the gate
  revoke <name> --by <who>   Revoke the gate
  check <name>               Exit 0 if approved, 1 otherwise
  status <name>              Show full gate state
  list                       List all gate.* pins
  rm <name>                  Remove gate pin

Run 'tx gate <subcommand> --help' for subcommand-specific help.
```

## tx gate approve

```text
tx gate approve - Approve a phase gate

Usage: tx gate approve <name> --by <approver> [--note <text>] [--json]

Examples:
  tx gate approve docs-to-build --by james
```

## tx gate check

```text
tx gate check - Check gate approval state

Usage: tx gate check <name> [--json]

Exit codes:
  0  Gate approved
  1  Gate missing or not approved
```

## tx gate create

```text
tx gate create - Create a phase gate

Usage: tx gate create <name> [--phase-from <phase>] [--phase-to <phase>] [--task-id <id>] [--force] [--json]

Examples:
  tx gate create docs-to-build --phase-from docs_harden --phase-to feature_build
  tx gate create docs-to-build --task-id tx-a1b2c3d4
```

## tx gate list

```text
tx gate list - List all gates

Usage: tx gate list [--json]
```

## tx gate revoke

```text
tx gate revoke - Revoke a phase gate

Usage: tx gate revoke <name> --by <approver> [--reason <text>] [--json]

Examples:
  tx gate revoke docs-to-build --by james --reason "needs more review"
```

## tx gate rm

```text
tx gate rm - Remove a gate

Usage: tx gate rm <name> [--json]
```

## tx gate status

```text
tx gate status - Show gate state

Usage: tx gate status <name> [--json]
```

## tx guard

```text
tx guard - Task creation guards

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
  tx guard clear
```

## tx guard clear

```text
tx guard clear - Clear guards

Usage: tx guard clear [--scope <scope>] [--json]

Removes all guards, or a specific scope if --scope is provided.

Options:
  --scope <scope>   Clear only this scope (e.g., "global", "parent:tx-abc123")
  --json            Output as JSON
  --help            Show this help
```

## tx guard set

```text
tx guard set - Set task creation guards

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
  tx guard set --scope parent:tx-abc123 --max-children 5
```

## tx guard show

```text
tx guard show - Show current guard configuration

Usage: tx guard show [--json]

Displays all configured guards with their limits and mode.

Options:
  --json          Output as JSON
  --help          Show this help
```

## tx label

```text
tx label - Label management

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

Run 'tx label <subcommand> --help' for subcommand-specific help.
```

## tx label add

```text
tx label add - Create a label

Usage: tx label add <name> [--color <hex>] [--json]

Options:
  --color <hex>   Label color (e.g., "#3b82f6")
  --json          Output as JSON
  --help          Show this help

Examples:
  tx label add "phase:discovery"
  tx label add "phase:implement" --color "#22c55e"
```

## tx label assign

```text
tx label assign - Assign a label to a task

Usage: tx label assign <task-id> <label-name> [--json]

The label must exist (create it first with 'tx label add').

Options:
  --json          Output as JSON
  --help          Show this help

Examples:
  tx label assign tx-abc123 "phase:discovery"
```

## tx label delete

```text
tx label delete - Delete a label

Usage: tx label delete <name> [--json]

Alias: tx label remove

Options:
  --json          Output as JSON
  --help          Show this help
```

## tx label list

```text
tx label list - List all labels

Usage: tx label list [--json]

Options:
  --json          Output as JSON
  --help          Show this help
```

## tx label remove

```text
tx label remove - Delete a label (alias for "tx label delete")

Usage: tx label remove <name> [--json]

Options:
  --json          Output as JSON
  --help          Show this help
```

## tx label unassign

```text
tx label unassign - Remove a label from a task

Usage: tx label unassign <task-id> <label-name> [--json]

Options:
  --json          Output as JSON
  --help          Show this help
```

## tx reflect

```text
tx reflect - Session retrospective

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
  tx reflect --json           # machine-readable for orchestrators
```

## tx verify

```text
tx verify - Machine-checkable verification

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
  tx verify run tx-abc123 && tx done tx-abc123
```

## tx verify clear

```text
tx verify clear - Remove verify command

Usage: tx verify clear <id> [--json]

Removes the verification command from a task.

Options:
  --json          Output as JSON
  --help          Show this help
```

## tx verify run

```text
tx verify run - Run verification

Usage: tx verify run <id> [--timeout <seconds>] [--json]

Executes the verify command attached to the task and reports pass/fail.
Exit code 0 from the command = pass, non-zero = fail.

Options:
  --timeout <seconds>   Command timeout (default: 300)
  --json                Output structured result as JSON
  --help                Show this help

Examples:
  tx verify run tx-abc123
  tx verify run tx-abc123 --timeout 60 --json
```

## tx verify set

```text
tx verify set - Attach a verify command

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
  tx verify set tx-abc123 "bun run test:auth --json" --schema verify-schema.json
```

## tx verify show

```text
tx verify show - Show verify command

Usage: tx verify show <id> [--json]

Shows the verification command and optional schema for a task.

Options:
  --json          Output as JSON
  --help          Show this help
```
