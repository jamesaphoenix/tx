# PRD-020: Run Observability & Logging

## Problem

When orchestrator runs fail, timeout, or get stuck, we have no way to understand why. The current system is flying blind:

1. **No stdout capture**: Claude's output goes nowhere — the orchestrator runs `claude --print` but only redirects stderr to a shared log file
2. **No per-run isolation**: All output is mixed into a single log file, making it impossible to debug a specific run
3. **No dashboard visibility**: The dashboard shows run status but has no log viewer — you can't see what happened
4. **Stuck tasks loop forever**: A task that times out gets reset to ready at the same priority and gets picked up again immediately
5. **Infrastructure exists but is unwired**: The `runs` table has `stdout_path`, `stderr_path`, `transcript_path` columns that are never populated

**Real-world impact**: Task `tx-0eb161b9` was stuck in a timeout loop — the orchestrator kept picking it up, timing out after 30 minutes, resetting it to ready, and picking it up again. No way to know what Claude was doing or why it couldn't complete.

## Solution

Per-run log capture with dashboard visibility and automatic task demotion for repeated failures.

Every run gets its own log directory with captured stdout, stderr, and injected context. The dashboard gets a log viewer. Tasks that repeatedly fail get demoted (lower score) and eventually blocked for human review.

## Requirements

### Per-Run Log Capture
- [ ] Each run creates a directory: `.tx/runs/<run-id>/`
- [ ] Claude's stdout is captured to `.tx/runs/<run-id>/stdout.log`
- [ ] Claude's stderr is captured to `.tx/runs/<run-id>/stderr.log`
- [ ] Injected context is saved to `.tx/runs/<run-id>/context.md`
- [ ] Paths are stored in the `runs` table (`stdout_path`, `stderr_path`, `context_injected`)
- [ ] Transcript path (Claude's `.jsonl`) is auto-discovered and stored in `transcript_path`

### API Endpoints
- [ ] `GET /api/runs/:id/stdout` — stream/return stdout log content
- [ ] `GET /api/runs/:id/stderr` — stream/return stderr log content
- [ ] `GET /api/runs/:id/context` — return injected context
- [ ] Support `?tail=N` query param to return last N lines (for large files)
- [ ] Return 404 if log file doesn't exist (run still in progress or logs cleaned up)

### Dashboard Log Viewer
- [ ] Run detail view gets a "Logs" tab alongside the existing "Transcript" view
- [ ] Logs tab shows stdout and stderr in a split or tabbed view
- [ ] Auto-refresh when run status is `running` (poll every 5s)
- [ ] Syntax highlighting for common patterns (errors, warnings, file paths)
- [ ] Show injected context in a collapsible section
- [ ] Show run metadata: duration, exit code, error message, agent, git SHA

### Task Demotion & Blocking
- [ ] On failure/timeout: increment failed attempt count (stored in task metadata)
- [ ] On failure/timeout: reduce task score by 100 per failure (floor at 1)
- [ ] After 3 failures: automatically block the task with reason "Auto-blocked after N failures"
- [ ] Store failure reason in task metadata (`blockedReason`, `lastFailReason`, `failedAttemptCount`)
- [ ] Dashboard shows failure count and blocked reason

### Log Retention
- [ ] Retain run logs for 7 days by default
- [ ] `tx runs:clean` CLI command to purge old logs
- [ ] Configurable retention period via env var `TX_LOG_RETENTION_DAYS`
- [ ] Never delete logs for runs that are still `running`

### Transcript Discovery Fixes (DONE)
- [x] Fix Claude project directory escaping — replace all non-alphanumeric chars, not just slashes
- [x] Fix `process.cwd()` mismatch — derive project root from `TX_DB_PATH` when API server runs from subdirectory

### tmux Integration
- [ ] Each orchestrator run spawns Claude in a named tmux session: `tmux new-session -d -s <run-id>`
- [ ] Live attach: `tx runs:attach <run-id>` opens the tmux session for real-time observation
- [ ] tmux `pipe-pane` captures output to `.tx/runs/<run-id>/stdout.log` automatically
- [ ] Dashboard shows "Attach" button with copy-able `tmux attach` command for running runs
- [ ] tmux sessions are cleaned up after run completes (configurable keep-alive for debugging)
- [ ] Graceful fallback: if tmux is not installed, fall back to direct file redirection

## Acceptance Criteria

1. Running the orchestrator produces per-run log files in `.tx/runs/<run-id>/`
2. After a failed run, `stdout.log` and `stderr.log` contain Claude's output
3. Dashboard shows transcripts for runs (auto-discovered from Claude session files)
4. Dashboard shows logs for any run (completed, failed, or running)
5. A task that times out 3 times is automatically blocked
6. A task that fails once drops 100 points in the queue
7. `tx runs:clean` removes logs older than retention period
8. `tx runs:attach <run-id>` opens a live tmux session to observe a running agent

## Out of Scope

- Real-time streaming (WebSocket) of logs to dashboard (polling is sufficient for v1)
- Log aggregation across multiple orchestrator instances
- Log shipping to external services (Datadog, etc.)
- Modifying Claude's internal logging format
- Changes to the OTEL/telemetry system (covered by PRD-008)

## Related Documents

- [DD-020](../design/DD-020-run-observability.md) — Technical design
- [PRD-008](PRD-008-observability-opentelemetry.md) — OpenTelemetry (complementary, not overlapping)
- [PRD-019](PRD-019-execution-tracing.md) — Execution tracing (trace spans, not raw logs)
- [PRD-013](PRD-013-dashboard-ux.md) — Dashboard UX (log viewer extends existing UI)
