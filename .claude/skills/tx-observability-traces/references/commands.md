# tx Observability And Traces Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx dashboard

```text
tx dashboard - Start API server + dashboard and open in browser

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
  tx dashboard --port 3002  # Custom API port
```

## tx diag

```text
tx diag - Diagnostics

Usage: tx diag <subcommand> [options]

Subcommands:
  stats       Show queue metrics and health overview
  doctor      Run system health checks (DB validation + diagnostics)
  dashboard   Start API server + dashboard UI

Run 'tx diag <subcommand> --help' for subcommand-specific help.

Examples:
  tx diag stats
  tx diag doctor --verbose
  tx diag dashboard
```

## tx diag dashboard

```text
tx diag dashboard - Start API server + dashboard UI

Usage: tx diag dashboard [options]

Starts the API server and Vite dev server, then opens the dashboard in a browser.

Options:
  --port <n>    Custom API port (default: 3001)
  --no-open     Start without opening browser
  --help        Show this help

Examples:
  tx diag dashboard
  tx diag dashboard --port 3002 --no-open
```

## tx diag doctor

```text
tx diag doctor - Run system health checks

Usage: tx diag doctor [options]

Runs database validation, schema version checks, WAL mode, service wiring,
stale claims, task counts, and API key detection.

Options:
  --verbose, -v  Show details for each check
  --fix          Attempt to auto-fix issues
  --json         Output as JSON
  --help         Show this help

Examples:
  tx diag doctor
  tx diag doctor --verbose --fix
```

## tx diag stats

```text
tx diag stats - Show queue metrics and health overview

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
  tx diag stats --json
```

## tx doctor

```text
tx doctor - System health checks

Usage: tx doctor [options]

Runs all system and database health checks in one pass:

Database validation (formerly 'tx validate'):
  - Database integrity (PRAGMA integrity_check)
  - Schema version verification
  - Foreign key constraint validation
  - Orphaned dependency detection
  - Invalid status values scan

System diagnostics:
  - Database file readable, WAL mode enabled
  - Schema version matches expected
  - Effect services wired correctly
  - Stale claims and workers
  - Task and learning counts
  - ANTHROPIC_API_KEY availability

Options:
  --fix          Auto-fix fixable DB issues (orphaned deps, invalid statuses)
  --verbose, -v  Include detailed output for each check
  --json         Output as JSON
  --help         Show this help

Exit Codes:
  0        All checks pass (healthy)
  1        One or more checks failed

Examples:
  tx doctor              # Run all checks
  tx doctor --fix        # Auto-fix fixable issues
  tx doctor --verbose    # Include detailed output
  tx doctor --json       # Machine-readable output
```

## tx stats

```text
tx stats - Show queue metrics and health overview

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
  tx stats --json       # Machine-readable output
```

## tx trace

```text
tx trace - Execution tracing for debugging run failures

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
  tx trace errors --hours 48       # Errors from last 48 hours
```

## tx trace errors

```text
tx trace errors - Show recent errors across all runs

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
  tx trace errors --json           # JSON output for scripting
```

## tx trace heartbeat

```text
tx trace heartbeat - Update run heartbeat state

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
  tx trace heartbeat run-abc123 --stdout-bytes 500 --stderr-bytes 120 --json
```

## tx trace list

```text
tx trace list - Show recent runs with event counts

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
  tx trace list --json             # JSON output for scripting
```

## tx trace show

```text
tx trace show - Show metrics events for a run

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
  tx trace show run-abc123 --json    # JSON output for scripting
```

## tx trace stalled

```text
tx trace stalled - List or reap stalled running runs

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
  tx trace stalled --reap --dry-run --json
```

## tx validate is a deprecated alias for 'tx doctor'.

```text
tx validate is a deprecated alias for 'tx doctor'.

Run 'tx doctor --help' for full usage.
```
