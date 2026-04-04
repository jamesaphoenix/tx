# tx Dependencies And Hierarchy Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx block

```text
tx block - Add blocking dependency

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
  tx block tx-abc123 tx-def456   # tx-def456 blocks tx-abc123
```

## tx children

```text
tx children - List child tasks

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
  tx children tx-a1b2c3d4 --json
```

## tx dep

```text
tx dep - Dependencies & hierarchy

Usage: tx dep <subcommand> [arguments] [options]

Subcommands:
  block <id> <blocker>    Add blocking dependency
  unblock <id> <blocker>  Remove blocking dependency
  children <id>           List child tasks
  tree <id>               Show task subtree

Run 'tx dep <subcommand> --help' for subcommand-specific help.

Examples:
  tx dep block tx-abc123 tx-def456
  tx dep unblock tx-abc123 tx-def456
  tx dep children tx-abc123
  tx dep tree tx-abc123
```

## tx dep block

```text
tx dep block - Add blocking dependency

Usage: tx dep block <task-id> <blocker-id> [options]

Makes one task block another. The blocked task cannot be ready until
the blocker is marked done. Circular dependencies are not allowed.

Arguments:
  <task-id>     Required. The task that will be blocked
  <blocker-id>  Required. The task that blocks it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx dep block tx-abc123 tx-def456
```

## tx dep children

```text
tx dep children - List child tasks

Usage: tx dep children <id> [options]

Lists all direct children of a task (tasks with this task as parent).

Arguments:
  <id>    Required. Parent task ID

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx dep children tx-a1b2c3d4
```

## tx dep tree

```text
tx dep tree - Show task subtree

Usage: tx dep tree <id> [options]

Shows a task and all its descendants in a tree view.

Arguments:
  <id>    Required. Root task ID

Options:
  --json  Output as JSON (nested structure)
  --help  Show this help

Examples:
  tx dep tree tx-a1b2c3d4
```

## tx dep unblock

```text
tx dep unblock - Remove blocking dependency

Usage: tx dep unblock <task-id> <blocker-id> [options]

Removes a blocking dependency between two tasks.

Arguments:
  <task-id>     Required. The task that was blocked
  <blocker-id>  Required. The task that was blocking it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx dep unblock tx-abc123 tx-def456
```

## tx group-context clear

```text
tx group-context clear - Clear task-group context on a task

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
  tx group-context clear tx-a1b2c3d4 --json
```

## tx group-context set

```text
tx group-context set - Set task-group context on a task

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
  tx group-context set tx-a1b2c3d4 "Phase 2 migration notes" --json
```

## tx tree

```text
tx tree - Show task subtree

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
  tx tree tx-a1b2c3d4 --json
```

## tx unblock

```text
tx unblock - Remove blocking dependency

Usage: tx unblock <task-id> <blocker-id> [options]

Removes a blocking dependency between two tasks.

Arguments:
  <task-id>     Required. The task that was blocked
  <blocker-id>  Required. The task that was blocking it

Options:
  --json  Output as JSON
  --help  Show this help

Examples:
  tx unblock tx-abc123 tx-def456
```
