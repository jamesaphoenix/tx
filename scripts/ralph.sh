#!/bin/bash
# ralph.sh — Enhanced RALPH Loop for tx
#
# Spawns fresh Claude agent instances per task with periodic adversarial review.
# Memory persists through CLAUDE.md + .tx/tasks.db + git, not conversation history.
#
# Based on:
# - Geoffrey Huntley's RALPH technique: https://ghuntley.com/ralph
# - Anthropic's long-running agent harness
#
# Usage:
#   ./scripts/ralph.sh                     # Run with defaults
#   ./scripts/ralph.sh --max 50            # Run for 50 iterations max
#   ./scripts/ralph.sh --max-hours 8       # Run for 8 hours max
#   ./scripts/ralph.sh --review-every 10   # Review every 10 iterations
#   ./scripts/ralph.sh --agent tx-implementer  # Force a specific agent
#   ./scripts/ralph.sh --dry-run           # Show what would be dispatched

set -euo pipefail

# ==============================================================================
# Configuration
# ==============================================================================

MAX_ITERATIONS=${MAX_ITERATIONS:-100}
MAX_HOURS=${MAX_HOURS:-3}
REVIEW_EVERY=${REVIEW_EVERY:-10}
SLEEP_BETWEEN=${SLEEP_BETWEEN:-2}
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/.tx/ralph.log"
LOCK_FILE="$PROJECT_DIR/.tx/ralph.lock"
STATE_FILE="$PROJECT_DIR/.tx/ralph-state"
FORCED_AGENT=""
DRY_RUN=false
CURRENT_RUN_ID=""
CLAUDE_PID=""

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --max) MAX_ITERATIONS="$2"; shift 2 ;;
    --max-hours) MAX_HOURS="$2"; shift 2 ;;
    --review-every) REVIEW_EVERY="$2"; shift 2 ;;
    --agent) FORCED_AGENT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --resume) RESUME=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Calculate max runtime
MAX_SECONDS=$((MAX_HOURS * 3600))
START_TIME=$(date +%s)

cd "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/.tx"

# Define tx function to run CLI source directly via tsx
# This ensures changes are immediately reflected without rebuilding
tx() {
  npx tsx "$PROJECT_DIR/apps/cli/src/cli.ts" "$@"
}

# ==============================================================================
# Lock File (Prevent Multiple Instances)
# ==============================================================================

if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "RALPH already running (PID $PID). Exiting."
    exit 1
  else
    echo "Stale lock file found. Removing."
    rm "$LOCK_FILE"
  fi
fi

cleanup() {
  rm -f "$LOCK_FILE"
  log "RALPH shutdown"
}

# Track current task for cleanup
CURRENT_TASK_ID=""

# Cancel current run if RALPH is terminated unexpectedly
cancel_current_run() {
  if [ -n "${CURRENT_RUN_ID:-}" ]; then
    log "Cancelling current run $CURRENT_RUN_ID due to unexpected termination"
    complete_run "$CURRENT_RUN_ID" "cancelled" 130 "RALPH process terminated"
  fi
  if [ -n "${CLAUDE_PID:-}" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then
    log "Terminating Claude subprocess (PID $CLAUDE_PID)"
    kill "$CLAUDE_PID" 2>/dev/null || true
  fi
  # Reset current task back to ready so it can be picked up again
  if [ -n "${CURRENT_TASK_ID:-}" ]; then
    log "Resetting task $CURRENT_TASK_ID to ready"
    tx reset "$CURRENT_TASK_ID" 2>/dev/null || true
  fi
}

# Handle termination signals
handle_signal() {
  local signal=$1
  log "Received $signal signal"
  cancel_current_run
  cleanup
  exit 130
}

trap 'handle_signal SIGTERM' TERM
trap 'handle_signal SIGINT' INT
trap 'handle_signal SIGHUP' HUP
trap cleanup EXIT
echo $$ > "$LOCK_FILE"

# ==============================================================================
# Orphan Run Cleanup
# ==============================================================================

# Cancel runs from previous sessions where RALPH died unexpectedly
cancel_orphaned_runs() {
  if ! command -v sqlite3 >/dev/null 2>&1 || [ ! -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    return
  fi

  # Find all running runs and check if their PIDs are still alive
  local orphaned_runs
  orphaned_runs=$(sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
    "SELECT id, pid FROM runs WHERE status = 'running' AND pid IS NOT NULL;" 2>/dev/null || echo "")

  if [ -z "$orphaned_runs" ]; then
    return
  fi

  local now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  local count=0

  while IFS='|' read -r run_id pid; do
    # Skip empty lines
    [ -z "$run_id" ] && continue

    if kill -0 "$pid" 2>/dev/null; then
      # Process is still alive - check if it's an orphaned Claude process
      # (parent ralph.sh died but Claude kept running)
      local parent_pid
      parent_pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')

      # If parent is init (PID 1) or launchd, it's orphaned
      if [ "$parent_pid" = "1" ]; then
        log "Found orphaned Claude process $pid (parent died, run $run_id)"
        log "Terminating orphaned Claude process..."
        kill "$pid" 2>/dev/null || true
        # Give it a moment to exit gracefully
        sleep 1
        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
          kill -9 "$pid" 2>/dev/null || true
        fi
        local escaped_run_id=$(sql_escape "$run_id")
        sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
          "UPDATE runs SET status='cancelled', ended_at='$now', exit_code=137, error_message='Orphaned Claude process terminated (parent RALPH died)' WHERE id='$escaped_run_id';"
        count=$((count + 1))
      fi
      # Otherwise it's a run from a different, still-active ralph instance - leave it
      continue
    fi

    # PID is dead - this run is orphaned
    log "Found orphaned run $run_id (PID $pid is dead)"
    local escaped_run_id=$(sql_escape "$run_id")
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE runs SET status='cancelled', ended_at='$now', exit_code=137, error_message='RALPH process died unexpectedly (orphaned)' WHERE id='$escaped_run_id';"
    count=$((count + 1))
  done <<< "$orphaned_runs"

  if [ $count -gt 0 ]; then
    log "Cancelled $count orphaned run(s)"
  fi
}

# Reset orphaned active tasks from previous sessions
reset_orphaned_tasks() {
  local active_tasks
  active_tasks=$(tx list --status active --json 2>/dev/null | jq -r '.[].id' 2>/dev/null || echo "")

  if [ -z "$active_tasks" ]; then
    return
  fi

  local count=0
  while IFS= read -r task_id; do
    [ -z "$task_id" ] && continue
    log "Resetting orphaned active task: $task_id"
    tx reset "$task_id" 2>/dev/null || true
    count=$((count + 1))
  done <<< "$active_tasks"

  if [ $count -gt 0 ]; then
    log "Reset $count orphaned active task(s)"
  fi
}

# ==============================================================================
# Logging
# ==============================================================================

log() {
  local msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ==============================================================================
# SQL Escaping
# ==============================================================================

# Escape single quotes for SQL strings to prevent SQL injection
sql_escape() {
  echo "${1//\'/\'\'}"
}

# ==============================================================================
# Time & State Helpers
# ==============================================================================

get_elapsed_seconds() {
  echo $(( $(date +%s) - START_TIME ))
}

check_time_limit() {
  if [ $(get_elapsed_seconds) -ge $MAX_SECONDS ]; then
    log "TIME LIMIT REACHED: $MAX_HOURS hours"
    return 1
  fi
  return 0
}

save_state() {
  echo "$iteration" > "$STATE_FILE"
}

load_state() {
  if [ "${RESUME:-false}" = true ] && [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
  else
    echo 0
  fi
}

# ==============================================================================
# Circuit Breaker
# ==============================================================================

CONSECUTIVE_FAILURES=0
MAX_FAILURES=3

record_failure() {
  CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
  log "FAILURE recorded ($CONSECUTIVE_FAILURES/$MAX_FAILURES)"
}

on_success() {
  CONSECUTIVE_FAILURES=0
}

check_circuit_breaker() {
  if [ $CONSECUTIVE_FAILURES -ge $MAX_FAILURES ]; then
    log "CIRCUIT BREAKER: $MAX_FAILURES consecutive failures. Stopping."
    return 1
  fi
  return 0
}

# ==============================================================================
# Agent Selection
# ==============================================================================

select_agent() {
  local task_json="$1"

  if [ -n "$FORCED_AGENT" ]; then
    echo "$FORCED_AGENT"
    return
  fi

  local title=$(echo "$task_json" | jq -r '.title // ""' 2>/dev/null)
  local score=$(echo "$task_json" | jq -r '.score // 0' 2>/dev/null)
  local children=$(echo "$task_json" | jq -r '.children | length // 0' 2>/dev/null)

  # Large task with no children → decompose first
  if [ "$score" -ge 800 ] && [ "$children" -eq 0 ]; then
    echo "tx-decomposer"
    return
  fi

  # Test tasks
  if echo "$title" | grep -qi -E "test|integration|fixture"; then
    echo "tx-tester"
    return
  fi

  # Review tasks
  if echo "$title" | grep -qi -E "review|audit|check"; then
    echo "tx-reviewer"
    return
  fi

  # Default: implement
  echo "tx-implementer"
}

# ==============================================================================
# Run Tracking
# ==============================================================================

# Create a run record and return the run ID
create_run() {
  local task_id="$1"
  local agent="$2"
  local metadata="$3"

  # Generate run ID
  local run_id="run-$(date +%s | shasum | head -c 8)"
  local now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  # Insert into database (if tx supports it, otherwise just track in file)
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    # Escape variables to prevent SQL injection
    local escaped_task_id=$(sql_escape "$task_id")
    local escaped_agent=$(sql_escape "$agent")
    local escaped_metadata=$(sql_escape "$metadata")
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" <<EOF
INSERT INTO runs (id, task_id, agent, started_at, status, pid, metadata)
VALUES ('$run_id', '$escaped_task_id', '$escaped_agent', '$now', 'running', $$, '$escaped_metadata');
EOF
  fi

  # Also write to runs log for dashboard
  echo "$run_id" > "$PROJECT_DIR/.tx/current-run"
  echo "{\"id\":\"$run_id\",\"task_id\":\"$task_id\",\"agent\":\"$agent\",\"started_at\":\"$now\",\"status\":\"running\",\"pid\":$$}" >> "$PROJECT_DIR/.tx/runs.jsonl"

  echo "$run_id"
}

# Update run status
complete_run() {
  local run_id="$1"
  local status="$2"
  local exit_code="$3"
  local error_message="${4:-}"

  local now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  # Validate exit_code is an integer
  [[ $exit_code =~ ^[0-9]+$ ]] || exit_code=1

  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    # Escape variables to prevent SQL injection
    local escaped_run_id=$(sql_escape "$run_id")
    local escaped_status=$(sql_escape "$status")
    local escaped_error_message=$(sql_escape "$error_message")

    if [ -n "$error_message" ]; then
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE runs SET status='$escaped_status', ended_at='$now', exit_code=$exit_code, error_message='$escaped_error_message' WHERE id='$escaped_run_id';"
    else
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE runs SET status='$escaped_status', ended_at='$now', exit_code=$exit_code WHERE id='$escaped_run_id';"
    fi
  fi

  rm -f "$PROJECT_DIR/.tx/current-run"
}

# ==============================================================================
# Run Claude Agent
# ==============================================================================

run_agent() {
  local agent="$1"
  local task_id="$2"
  local task_title="$3"

  local prompt="Read .claude/agents/${agent}.md for your instructions.

Your assigned task: $task_id
Task title: $task_title

Run \`tx show $task_id\` to get full details, then follow your agent instructions.
When done, run \`tx done $task_id\` to mark the task complete.
If you discover new work, create subtasks with \`tx add\`.
If you hit a blocker, update the task status: \`tx update $task_id --status blocked\`."

  log "Dispatching to Claude..."

  # Create run record
  local metadata="{\"iteration\":$iteration,\"git_sha\":\"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\"}"
  CURRENT_RUN_ID=$(create_run "$task_id" "$agent" "$metadata")
  log "Run: $CURRENT_RUN_ID"

  # Run Claude in background to capture its PID for signal handling
  claude --dangerously-skip-permissions --print "$prompt" 2>>"$LOG_FILE" &
  CLAUDE_PID=$!

  # Update run record with Claude's PID for accurate orphan detection
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    local escaped_run_id=$(sql_escape "$CURRENT_RUN_ID")
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE runs SET pid=$CLAUDE_PID WHERE id='$escaped_run_id';"
  fi
  log "Claude PID: $CLAUDE_PID"

  # Wait for Claude to complete
  local exit_code=0
  if wait "$CLAUDE_PID"; then
    CLAUDE_PID=""
    complete_run "$CURRENT_RUN_ID" "completed" 0
    CURRENT_RUN_ID=""
    return 0
  else
    exit_code=$?
    CLAUDE_PID=""
    complete_run "$CURRENT_RUN_ID" "failed" "$exit_code" "Claude exited with code $exit_code"
    CURRENT_RUN_ID=""
    return 1
  fi
}

# ==============================================================================
# Review Agents (Adversarial Loop)
# ==============================================================================

run_review_cycle() {
  local iteration=$1

  log "=== REVIEW CYCLE (iteration $iteration) ==="

  # 1. Doctrine Checker
  log "Running doctrine-checker..."
  local doctrine_prompt="Read .claude/agents/tx-doctrine-checker.md for your instructions.

Review recent changes and check for doctrine violations.
This is iteration $iteration of the RALPH loop."

  if [ "$DRY_RUN" = false ]; then
    claude --dangerously-skip-permissions --print "$doctrine_prompt" 2>>"$LOG_FILE" || log "doctrine-checker had issues"
  else
    log "[DRY RUN] Would run doctrine-checker"
  fi

  # 2. Test Runner
  log "Running test-runner..."
  local test_prompt="Read .claude/agents/tx-test-runner.md for your instructions.

Run the test suite and report results.
This is iteration $iteration of the RALPH loop."

  if [ "$DRY_RUN" = false ]; then
    claude --dangerously-skip-permissions --print "$test_prompt" 2>>"$LOG_FILE" || log "test-runner had issues"
  else
    log "[DRY RUN] Would run test-runner"
  fi

  # 3. Quality Checker
  log "Running quality-checker..."
  local quality_prompt="Read .claude/agents/tx-quality-checker.md for your instructions.

Review recent code changes for quality issues.
This is iteration $iteration of the RALPH loop."

  if [ "$DRY_RUN" = false ]; then
    claude --dangerously-skip-permissions --print "$quality_prompt" 2>>"$LOG_FILE" || log "quality-checker had issues"
  else
    log "[DRY RUN] Would run quality-checker"
  fi

  # Commit any review findings
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A
    git commit -m "ralph: review cycle at iteration $iteration

Co-Authored-By: jamesaphoenix <jamesaphoenix@googlemail.com>
Co-Authored-By: Claude <noreply@anthropic.com>" 2>>"$LOG_FILE" || true
    log "Review changes committed"
  fi

  log "=== REVIEW CYCLE COMPLETE ==="
}

# ==============================================================================
# Main Loop
# ==============================================================================

log "========================================"
log "RALPH Loop Started"
log "========================================"
log "Project: $PROJECT_DIR"
log "Max iterations: $MAX_ITERATIONS"
log "Max runtime: $MAX_HOURS hours"
log "Review every: $REVIEW_EVERY iterations"
log ""

# Clean up any orphaned runs from previous crashed sessions
cancel_orphaned_runs

# Reset any orphaned active tasks from previous sessions
reset_orphaned_tasks

iteration=$(load_state)
LAST_REVIEW=0

while [ $iteration -lt $MAX_ITERATIONS ]; do
  iteration=$((iteration + 1))
  save_state

  # Check limits
  check_time_limit || break
  check_circuit_breaker || break

  log "--- Iteration $iteration ---"

  # Get highest-priority ready task
  READY_JSON=$(tx ready --json --limit 1 2>/dev/null || echo "[]")
  TASK=$(echo "$READY_JSON" | jq '.[0] // empty' 2>/dev/null)

  if [ -z "$TASK" ] || [ "$TASK" = "null" ]; then
    log "No ready tasks. All done."
    break
  fi

  TASK_ID=$(echo "$TASK" | jq -r '.id')
  TASK_TITLE=$(echo "$TASK" | jq -r '.title')
  AGENT=$(select_agent "$TASK")

  log "Task: $TASK_ID — $TASK_TITLE"
  log "Agent: $AGENT"

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would dispatch $TASK_ID to $AGENT"
    sleep "$SLEEP_BETWEEN"
    continue
  fi

  # Mark task as active and track it for signal handling
  CURRENT_TASK_ID="$TASK_ID"
  tx update "$TASK_ID" --status active 2>/dev/null || true

  # Run the agent
  AGENT_EXIT_CODE=0
  if run_agent "$AGENT" "$TASK_ID" "$TASK_TITLE"; then
    log "Agent process exited successfully"
  else
    AGENT_EXIT_CODE=$?
    log "Agent process failed (exit code: $AGENT_EXIT_CODE)"
  fi

  # Verify task actually completed - this is the key reliability check
  TASK_STATUS=$(tx show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"')
  log "Task status after agent: $TASK_STATUS"

  if [ "$TASK_STATUS" = "done" ]; then
    log "✓ Task completed successfully"
    on_success
  elif [ "$TASK_STATUS" = "blocked" ]; then
    log "Task is blocked (likely decomposed into subtasks)"
    on_success
  elif [ "$AGENT_EXIT_CODE" -ne 0 ]; then
    log "✗ Agent failed and task not done - resetting to ready"
    tx reset "$TASK_ID" 2>/dev/null || true
    record_failure
  else
    # Agent exited 0 but task not done - ask a verification agent to check
    log "⚠ Agent exited cleanly but task not marked done (status: $TASK_STATUS)"
    log "Running verification agent..."

    VERIFY_PROMPT="Task $TASK_ID was just worked on but is still status '$TASK_STATUS'.

Run \`tx show $TASK_ID\` to see the task details.

Check if the task is actually complete:
1. If the work IS done, run \`tx done $TASK_ID\` to mark it complete
2. If more work is needed, explain what's missing and leave status as-is
3. If it's blocked on something, run \`tx update $TASK_ID --status blocked\`

Be honest - only mark done if the acceptance criteria are met."

    # Quick verification check (no run tracking for this)
    if claude --dangerously-skip-permissions --print "$VERIFY_PROMPT" 2>>"$LOG_FILE"; then
      # Re-check status after verification
      FINAL_STATUS=$(tx show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"')
      log "Status after verification: $FINAL_STATUS"

      if [ "$FINAL_STATUS" = "done" ]; then
        log "✓ Verification agent marked task complete"
        on_success
      elif [ "$FINAL_STATUS" = "blocked" ]; then
        log "Task marked as blocked by verification agent"
        on_success
      else
        log "✗ Task still not done after verification - resetting for retry"
        tx reset "$TASK_ID" 2>/dev/null || true
        record_failure
      fi
    else
      log "Verification agent failed - resetting task"
      tx reset "$TASK_ID" 2>/dev/null || true
      record_failure
    fi
  fi

  # Clear current task tracking
  CURRENT_TASK_ID=""

  # Checkpoint: commit if there are changes
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A
    git commit -m "ralph: $AGENT completed $TASK_ID — $TASK_TITLE

Co-Authored-By: jamesaphoenix <jamesaphoenix@googlemail.com>
Co-Authored-By: Claude <noreply@anthropic.com>" 2>>"$LOG_FILE" || true
    log "Changes committed"
  fi

  # Review cycle every N iterations
  if [ $((iteration - LAST_REVIEW)) -ge $REVIEW_EVERY ]; then
    run_review_cycle $iteration
    LAST_REVIEW=$iteration
  fi

  sleep "$SLEEP_BETWEEN"
done

log "========================================"
log "RALPH Loop Finished"
log "========================================"
log "Iterations completed: $iteration"
log "Consecutive failures: $CONSECUTIVE_FAILURES"
