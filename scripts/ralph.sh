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
trap cleanup EXIT
echo $$ > "$LOCK_FILE"

# ==============================================================================
# Logging
# ==============================================================================

log() {
  local msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
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
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" <<EOF
INSERT INTO runs (id, task_id, agent, started_at, status, pid, metadata)
VALUES ('$run_id', '$task_id', '$agent', '$now', 'running', $$, '$metadata');
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

  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    if [ -n "$error_message" ]; then
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE runs SET status='$status', ended_at='$now', exit_code=$exit_code, error_message='$error_message' WHERE id='$run_id';"
    else
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE runs SET status='$status', ended_at='$now', exit_code=$exit_code WHERE id='$run_id';"
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

  local exit_code=0
  if claude --dangerously-skip-permissions --print "$prompt" 2>>"$LOG_FILE"; then
    complete_run "$CURRENT_RUN_ID" "completed" 0
    return 0
  else
    exit_code=$?
    complete_run "$CURRENT_RUN_ID" "failed" "$exit_code" "Claude exited with code $exit_code"
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

  # Mark task as active
  tx update "$TASK_ID" --status active 2>/dev/null || true

  # Run the agent
  if run_agent "$AGENT" "$TASK_ID" "$TASK_TITLE"; then
    log "Agent completed successfully"
    on_success
  else
    log "Agent failed"
    record_failure
  fi

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
