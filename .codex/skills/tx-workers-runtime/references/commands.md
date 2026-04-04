# tx Workers And Runtime Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx coordinator

```text
tx coordinator - Worker coordination primitives

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
  tx coordinator reconcile           # Force orphan detection
```

## tx coordinator reconcile

```text
tx coordinator reconcile - Force reconciliation pass

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
  tx coordinator reconcile --json
```

## tx coordinator start

```text
tx coordinator start - Start the coordinator

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
  tx coordinator start -w 5 --daemon    # 5 workers in background
```

## tx coordinator status

```text
tx coordinator status - Show coordinator status

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
  tx coordinator status --json
```

## tx coordinator stop

```text
tx coordinator stop - Stop the coordinator

Usage: tx coordinator stop [options]

Stops the running coordinator. By default, immediately marks all workers
as dead. With --graceful, signals workers to finish current tasks first.

Options:
  --graceful, -g  Wait for workers to finish current tasks
  --json          Output as JSON
  --help          Show this help

Examples:
  tx coordinator stop               # Immediate stop
  tx coordinator stop --graceful    # Wait for workers to finish
```

## tx cycle

```text
tx cycle - Cycle-based issue discovery with sub-agent swarms

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
  tx cycle --task-prompt prompt.md --dry-run --json
```

## tx daemon

```text
tx daemon - Background daemon for learning extraction

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
  tx daemon list                # List tracked projects
```

## tx daemon list

```text
tx daemon list - List tracked projects

Usage: tx daemon list [options]

Lists all projects currently being tracked by the daemon.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon list
  tx daemon list --json
```

## tx daemon process

```text
tx daemon process - Process JSONL files for learning candidates

Usage: tx daemon process [options]

Processes JSONL files to extract learning candidates. By default, processes
files from tracked projects. Use --path to specify a custom glob pattern.

Options:
  --path, -p <glob>  Glob pattern for JSONL files to process
  --json             Output as JSON
  --help             Show this help

Examples:
  tx daemon process                              # Process tracked projects
  tx daemon process --path ~/.claude/**/*.jsonl  # Process specific files
```

## tx daemon promote

```text
tx daemon promote - Promote a candidate to learning

Usage: tx daemon promote <candidate-id> [options]

Promotes a learning candidate to a permanent learning entry.

Arguments:
  <candidate-id>  Required. Candidate ID

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon promote 42
```

## tx daemon reject

```text
tx daemon reject - Reject a learning candidate

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
  tx daemon reject 42 --reason "Duplicate of existing learning"
```

## tx daemon review

```text
tx daemon review - List pending learning candidates

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
  tx daemon review --limit 10 --json
```

## tx daemon start

```text
tx daemon start - Start the background daemon

Usage: tx daemon start [options]

Starts the background daemon process that monitors tracked projects
for file changes and extracts learning candidates.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon start
```

## tx daemon status

```text
tx daemon status - Show daemon status

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
  tx daemon status --json
```

## tx daemon stop

```text
tx daemon stop - Stop the background daemon

Usage: tx daemon stop [options]

Stops the running background daemon process.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon stop
```

## tx daemon track

```text
tx daemon track - Track a project for learning extraction

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
  tx daemon track ~/projects/my-app
```

## tx daemon untrack

```text
tx daemon untrack - Stop tracking a project

Usage: tx daemon untrack <project-path> [options]

Removes a project from the daemon's watch list.

Arguments:
  <project-path>  Required. Path to the project directory

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx daemon untrack .
  tx daemon untrack ~/projects/my-app
```

## tx hooks:install

```text
tx hooks:install - Install post-commit hook

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
  tx hooks:install --json                    # JSON output for scripting
```

## tx hooks:status

```text
tx hooks:status - Show git hook status

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
  tx hooks:status --json
```

## tx hooks:uninstall

```text
tx hooks:uninstall - Remove post-commit hook

Usage: tx hooks:uninstall [options]

Removes the tx post-commit hook. Only removes hooks that were
installed by tx (identified by marker comment). Updates .txrc.json
to disable hook settings.

Options:
  --json   Output as JSON
  --help   Show this help

Examples:
  tx hooks:uninstall
  tx hooks:uninstall --json                  # JSON output for scripting
```

## tx worker

```text
tx worker - Worker process management

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
  tx worker list                            # List all workers
```

## tx worker list

```text
tx worker list - List all workers

Usage: tx worker list [options]

Lists all registered workers with their current status, name, and active task.

Options:
  --status, -s <list>   Filter by status (comma-separated: starting,idle,busy,stopping,dead)
  --json                Output as JSON
  --help                Show this help

Examples:
  tx worker list                    # List all workers
  tx worker list --status idle,busy # Only idle and busy workers
  tx worker list --json             # Output as JSON for scripting
```

## tx worker start

```text
tx worker start - Start a worker process

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
  tx worker start --heartbeat 15                     # Custom heartbeat interval
```

## tx worker status

```text
tx worker status - Show worker status

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
  tx worker status --json                 # Summary as JSON
```

## tx worker stop

```text
tx worker stop - Stop a worker process

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
  tx worker stop                   # Show stop instructions
```
