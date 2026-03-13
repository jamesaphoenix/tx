# DD-020: Run Observability & Logging

## Overview

Wire up per-run log capture in the orchestrator scripts, serve logs through the API, and display them in the dashboard. Add task demotion logic so stuck tasks don't loop forever.

The `runs` table already has `stdout_path`, `stderr_path`, and `transcript_path` columns. The work is connecting orchestrator output to these columns and building the UI to display them.

-> [PRD-020](../prd/PRD-020-run-observability.md)

## Design

### 1. Per-Run Log Directory

Each run gets an isolated directory under `.tx/runs/`:

```
.tx/runs/
  run-e811b998/
    stdout.log          # Claude's stdout (the --print output)
    stderr.log          # Claude's stderr (errors, warnings)
    context.md          # Context injected into the prompt
  run-8cd32c3b/
    stdout.log
    stderr.log
    context.md
```

### 2. Orchestrator Script Changes

#### Directory Setup (in `run_agent`)

```bash
run_agent() {
  local agent="$1"
  local task_id="$2"
  local task_title="$3"

  # ... existing prompt construction ...

  # Create run record (existing)
  local metadata="{\"iteration\":$iteration,\"git_sha\":\"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\"}"
  CURRENT_RUN_ID=$(create_run "$task_id" "$agent" "$metadata")

  # NEW: Create per-run log directory
  local run_dir="$PROJECT_DIR/.tx/runs/$CURRENT_RUN_ID"
  mkdir -p "$run_dir"

  # NEW: Save injected context
  echo "$prompt" > "$run_dir/context.md"

  # CHANGED: Redirect stdout AND stderr to per-run files
  claude --dangerously-skip-permissions --print "$prompt" \
    > "$run_dir/stdout.log" \
    2> "$run_dir/stderr.log" &
  CLAUDE_PID=$!

  # NEW: Update run record with log paths
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    local escaped_run_id=$(sql_escape "$CURRENT_RUN_ID")
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE runs SET
        pid=$CLAUDE_PID,
        stdout_path='$run_dir/stdout.log',
        stderr_path='$run_dir/stderr.log',
        context_injected='$run_dir/context.md'
      WHERE id='$escaped_run_id';"
  fi

  # ... rest of existing timeout/wait logic ...
}
```

Key change: `claude --print` currently only captures stderr (`2>>"$LOG_FILE"`). We change to capture both stdout and stderr to per-run files. The shared orchestrator log still gets orchestration-level logging via the `log()` function.

#### Also append stderr to shared log for orchestration visibility

```bash
claude --dangerously-skip-permissions --print "$prompt" \
  > "$run_dir/stdout.log" \
  2> >(tee -a "$LOG_FILE" > "$run_dir/stderr.log") &
```

This uses process substitution to tee stderr to both the per-run file and the shared orchestrator log.

#### Task Demotion (new `demote_task` function)

```bash
SCORE_PENALTY=100
MAX_TASK_FAILURES=3

demote_task() {
  local task_id="$1"
  local reason="$2"

  # Count failed runs for this task
  local fail_count=$(sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
    "SELECT COUNT(*) FROM runs WHERE task_id='$(sql_escape "$task_id")'
     AND status IN ('failed', 'cancelled', 'timeout');" 2>/dev/null || echo "0")

  if [ "$fail_count" -ge "$MAX_TASK_FAILURES" ]; then
    # Block — needs human review
    log "BLOCKING task $task_id after $fail_count failures"
    tx update "$task_id" --status blocked 2>/dev/null || true
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE tasks SET metadata = json_set(
        COALESCE(metadata, '{}'),
        '$.blockedReason', 'Auto-blocked after $fail_count failures: $(sql_escape "$reason")',
        '$.failedAttemptCount', $fail_count
      ) WHERE id='$(sql_escape "$task_id")';"
  else
    # Demote — lower score, reset to ready
    local current_score=$(tx show "$task_id" --json 2>/dev/null | jq -r '.score // 50')
    local new_score=$((current_score - SCORE_PENALTY))
    [ "$new_score" -lt 1 ] && new_score=1

    log "Demoting task $task_id: score $current_score -> $new_score (attempt $fail_count/$MAX_TASK_FAILURES)"
    tx reset "$task_id" 2>/dev/null || true
    tx update "$task_id" --score "$new_score" 2>/dev/null || true
  fi
}
```

Replace existing failure handlers in the main loop:

```bash
# BEFORE (line 666-668):
log "✗ Agent failed and task not done - resetting to ready"
tx reset "$TASK_ID" 2>/dev/null || true
record_failure

# AFTER:
log "✗ Agent failed and task not done - demoting"
demote_task "$TASK_ID" "Agent failed (exit code: $AGENT_EXIT_CODE)"
record_failure
```

Same pattern for timeout (return 1 from `run_agent`) and verification failure paths.

### 3. API Routes

New routes in `apps/api-server/src/routes/runs.ts`:

#### GET /api/runs/:id/stdout

```typescript
// Read stdout log file for a run
app.get("/api/runs/:id/stdout", async (req, res) => {
  const run = await getRunById(req.params.id)
  if (!run?.stdout_path) return res.status(404).json({ error: "No stdout log" })

  const tail = parseInt(req.query.tail as string) || 0
  const content = await readLogFile(run.stdout_path, tail)
  res.type("text/plain").send(content)
})
```

#### GET /api/runs/:id/stderr

Same pattern as stdout but reads `stderr_path`.

#### GET /api/runs/:id/context

Same pattern but reads `context_injected` path.

#### Helper: readLogFile

```typescript
async function readLogFile(path: string, tailLines: number = 0): Promise<string> {
  if (!existsSync(path)) throw new NotFoundError("Log file not found")

  // Security: ensure path is under .tx/runs/
  const resolved = resolve(path)
  if (!resolved.startsWith(resolve(".tx/runs/"))) {
    throw new ForbiddenError("Path traversal attempt")
  }

  const content = await readFile(path, "utf-8")
  if (tailLines > 0) {
    return content.split("\n").slice(-tailLines).join("\n")
  }
  return content
}
```

### 4. Dashboard Log Viewer

Add a "Logs" tab to the existing run detail view in `apps/dashboard/src/App.tsx`.

#### Component: RunLogs

```tsx
function RunLogs({ runId, status }: { runId: string; status: string }) {
  const [activeTab, setActiveTab] = useState<"stdout" | "stderr">("stdout")
  const [content, setContent] = useState("")

  // Poll when running
  useEffect(() => {
    const fetch = () =>
      fetchApi(`/api/runs/${runId}/${activeTab}?tail=500`)
        .then(r => r.text())
        .then(setContent)
        .catch(() => setContent("(no log file)"))

    fetch()
    if (status === "running") {
      const interval = setInterval(fetch, 5000)
      return () => clearInterval(interval)
    }
  }, [runId, activeTab, status])

  return (
    <div>
      <div className="tabs">
        <button onClick={() => setActiveTab("stdout")}>stdout</button>
        <button onClick={() => setActiveTab("stderr")}>stderr</button>
      </div>
      <pre className="log-viewer">{content}</pre>
    </div>
  )
}
```

#### UI Layout

```
┌─────────────────────────────────────────┐
│  Run: run-e811b998  │ Status: failed    │
│  Agent: tx-implementer  │ Duration: 30m │
│  Exit: 124  │ Error: Timed out          │
├──────────┬──────────┬───────────────────┤
│ Transcript│  Logs   │  Context          │
├──────────┴──────────┴───────────────────┤
│                                         │
│  [stdout] [stderr]                      │
│                                         │
│  $ Reading task tx-0eb161b9...          │
│  $ Analyzing dep-service.ts...          │
│  $ Running tests...                     │
│  ERROR: Test suite timeout              │
│  ...                                    │
│                                         │
└─────────────────────────────────────────┘
```

### 5. Transcript Discovery Fixes (DONE)

Two bugs prevented transcripts from appearing in the dashboard:

**Bug 1: Incorrect directory escaping** (`transcript-parser.ts:190`)

Claude's CLI replaces ALL non-alphanumeric characters with dashes, not just slashes:

```typescript
// BEFORE (broken): underscores preserved → wrong directory
const escapedCwd = cwd.replace(/\//g, "-").replace(/^-/, "")

// AFTER (fixed): matches Claude CLI behavior
const escapedCwd = cwd.replace(/[^a-zA-Z0-9]/g, "-")
```

**Bug 2: Wrong cwd when API server runs from subdirectory** (`runs.ts:122`)

The API server is started from `apps/api-server/`, so `process.cwd()` doesn't match the project root:

```typescript
// BEFORE: uses api-server's cwd (wrong directory)
const cwd = process.cwd()

// AFTER: derive project root from DB path
const dbPath = process.env.TX_DB_PATH ?? ""
const projectRoot = dbPath.includes("/.tx/")
  ? dbPath.slice(0, dbPath.indexOf("/.tx/"))
  : process.cwd()
```

### 6. tmux Integration

Run each Claude agent inside a named tmux session for live observability.

#### Orchestrator Changes

```bash
run_agent() {
  local agent="$1"
  local task_id="$2"
  local task_title="$3"
  local run_dir="$PROJECT_DIR/.tx/runs/$CURRENT_RUN_ID"

  mkdir -p "$run_dir"

  if command -v tmux >/dev/null 2>&1; then
    # Create named tmux session for this run
    local session_name="tx-$CURRENT_RUN_ID"

    # Start tmux session with Claude, pipe output to log files
    tmux new-session -d -s "$session_name" \
      "claude --dangerously-skip-permissions --print '$prompt' 2>'$run_dir/stderr.log' | tee '$run_dir/stdout.log'; echo \$? > '$run_dir/exit_code'"

    # Store session name in DB for dashboard
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE runs SET metadata = json_set(metadata, '$.tmuxSession', '$session_name')
       WHERE id='$(sql_escape "$CURRENT_RUN_ID")';"

    CLAUDE_PID=$(tmux list-panes -t "$session_name" -F '#{pane_pid}' 2>/dev/null | head -1)
    log "tmux session: $session_name (PID: $CLAUDE_PID)"

    # ... timeout/wait logic using tmux has-session ...
  else
    # Fallback: direct file redirection (no live attach)
    claude --dangerously-skip-permissions --print "$prompt" \
      > "$run_dir/stdout.log" \
      2> "$run_dir/stderr.log" &
    CLAUDE_PID=$!
  fi
}
```

#### CLI: tx runs:attach

```bash
tx runs:attach <run-id>          # Attach to a running agent's tmux session
tx runs:attach --latest          # Attach to the most recent running session
```

Implementation:
```typescript
// Look up tmux session name from run metadata
const run = yield* runRepo.findById(runId)
const session = run.metadata?.tmuxSession
if (!session) return yield* Effect.fail(new NotFoundError("No tmux session"))

// Exec into the session
execSync(`tmux attach-session -t ${session}`, { stdio: 'inherit' })
```

#### Dashboard "Attach" Button

For runs with status `running` and a `tmuxSession` in metadata, show:

```
┌─────────────────────────────────────────────┐
│ Run: run-abc123  │ Status: 🟢 running       │
│ Agent: tx-implementer  │ Duration: 5m       │
│                                             │
│ [📺 Attach Live]  tmux attach -t tx-run-abc │
│                   ^^^^^^^^^^^^^^^^^^^^^^^^^ │
│                   (click to copy)            │
└─────────────────────────────────────────────┘
```

#### Cleanup

```bash
# After run completes, optionally keep session for 5 minutes for debugging
if [ "${TX_KEEP_TMUX_SESSION:-0}" -eq 0 ]; then
  tmux kill-session -t "$session_name" 2>/dev/null || true
else
  log "Keeping tmux session $session_name alive for debugging"
  (sleep 300 && tmux kill-session -t "$session_name" 2>/dev/null) &
fi
```

### 7. Log Retention

#### CLI Command: tx runs:clean

```bash
tx runs:clean                    # Delete logs older than 7 days
tx runs:clean --days 30          # Custom retention
tx runs:clean --dry-run          # Show what would be deleted
```

Implementation:
```sql
-- Find runs with logs older than retention period
SELECT id, stdout_path, stderr_path, context_injected
FROM runs
WHERE ended_at < datetime('now', '-7 days')
  AND status != 'running'
  AND (stdout_path IS NOT NULL OR stderr_path IS NOT NULL);
```

Then `rm -rf .tx/runs/<run-id>/` for each and set paths to NULL in the DB.

## Implementation Plan

| Phase | Files | Changes | Status |
|-------|-------|---------|--------|
| 0a | `apps/api-server/src/utils/transcript-parser.ts` | Fix directory escaping regex | DONE |
| 0b | `apps/api-server/src/routes/runs.ts` | Derive project root from `TX_DB_PATH` | DONE |
| 1 | `scripts/ralph.sh` | Per-run log directory, stdout/stderr capture, populate DB paths | |
| 2 | `scripts/ralph.sh` | Task demotion function (`demote_task`), wire into failure paths | Partial |
| 3 | `scripts/ralph.sh` | tmux session per run, fallback to direct redirection | |
| 4 | `apps/api-server/src/routes/runs.ts` | Add GET endpoints for stdout, stderr, context | |
| 5 | `apps/api-server/src/utils/log-reader.ts` | Helper for safe log file reading with tail support | |
| 6 | `apps/dashboard/src/components/RunLogs.tsx` | Log viewer component + tmux attach button | |
| 7 | `apps/dashboard/src/App.tsx` | Add Logs tab to run detail view | |
| 8 | `apps/cli/src/commands/runs-attach.ts` | `tx runs:attach <run-id>` command | |
| 9 | `apps/cli/src/commands/runs-clean.ts` | Log retention cleanup command | |

## Testing Strategy

### Integration Tests
- Create a run with log paths, verify API returns log content
- Verify path traversal protection (reject paths outside `.tx/runs/`)
- Verify `?tail=N` returns correct number of lines
- Verify 404 when log file doesn't exist

### Manual Testing
- Run the orchestrator for 1 iteration and verify `.tx/runs/<run-id>/` is created with logs
- Trigger a timeout and verify demotion logic (score reduced, metadata updated)
- Trigger 3 failures and verify task is blocked
- Open dashboard, navigate to a failed run, verify logs are visible

## Migration

No schema migration needed — `stdout_path`, `stderr_path`, `transcript_path`, and `context_injected` columns already exist in the `runs` table.

The `.tx/runs/` directory will be created on first orchestrator run. Existing runs will show "no log file" in the dashboard (graceful degradation).

## Related Documents

- [PRD-020](../prd/PRD-020-run-observability.md) — Requirements
- [DD-002](DD-002-effect-ts-service-layer.md) — Effect-TS patterns (for API routes)
- [DD-012](DD-012-dashboard-ux.md) — Dashboard architecture
- [DD-019](DD-019-execution-tracing.md) — Execution tracing (complementary)
