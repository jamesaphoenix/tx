#!/bin/bash
# ralph.sh — RALPH Loop for tx
#
# Spawns fresh Claude agent instances per task. Memory persists through
# CLAUDE.md + .tx/tasks.db + git, not conversation history.
#
# Based on Geoffrey Huntley's RALPH technique: https://ghuntley.com/ralph
#
# Usage:
#   ./scripts/ralph.sh                  # Run with defaults (3 hours)
#   ./scripts/ralph.sh --max 50         # Run for 50 iterations max
#   ./scripts/ralph.sh --max-hours 8    # Run for 8 hours max
#   ./scripts/ralph.sh --dry-run        # Show what would be dispatched

set -euo pipefail

MAX_ITERATIONS=${MAX_ITERATIONS:-100}
MAX_HOURS=${MAX_HOURS:-3}
SLEEP_BETWEEN=${SLEEP_BETWEEN:-5}
TASK_TIMEOUT=${TASK_TIMEOUT:-1800}  # 30 minutes max per task
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/.tx/ralph.log"
LOCK_FILE="$PROJECT_DIR/.tx/ralph.lock"
DRY_RUN=false

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --max) MAX_ITERATIONS="$2"; shift 2 ;;
    --max-hours) MAX_HOURS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

MAX_SECONDS=$((MAX_HOURS * 3600))
START_TIME=$(date +%s)

cd "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/.tx"

log() {
  local msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

# Lock file to prevent multiple instances
if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "RALPH already running (PID $PID). Exiting."
    exit 1
  else
    rm "$LOCK_FILE"
  fi
fi

CURRENT_TASK_ID=""

cleanup() {
  rm -f "$LOCK_FILE"
  if [ -n "${CURRENT_TASK_ID:-}" ]; then
    tx reset "$CURRENT_TASK_ID" 2>/dev/null || true
  fi
  log "RALPH shutdown"
}

trap cleanup EXIT INT TERM HUP
echo $$ > "$LOCK_FILE"

# Circuit breaker
CONSECUTIVE_FAILURES=0
MAX_FAILURES=3

check_time_limit() {
  if [ $(( $(date +%s) - START_TIME )) -ge $MAX_SECONDS ]; then
    log "TIME LIMIT REACHED: $MAX_HOURS hours"
    return 1
  fi
  return 0
}

log "========================================"
log "RALPH Loop Started"
log "========================================"
log "Project: $PROJECT_DIR"
log "Max iterations: $MAX_ITERATIONS"
log "Max runtime: $MAX_HOURS hours"
log ""

iteration=0

while [ $iteration -lt $MAX_ITERATIONS ]; do
  iteration=$((iteration + 1))

  check_time_limit || break
  [ $CONSECUTIVE_FAILURES -ge $MAX_FAILURES ] && { log "CIRCUIT BREAKER: $MAX_FAILURES consecutive failures"; break; }

  log "--- Iteration $iteration ---"

  # Get highest-priority ready task
  READY_JSON=$(tx ready --json --limit 1 2>/dev/null || echo "[]")
  TASK_ID=$(echo "$READY_JSON" | jq -r '.[0].id // empty' 2>/dev/null)

  if [ -z "$TASK_ID" ] || [ "$TASK_ID" = "null" ]; then
    log "No ready tasks. All done."
    break
  fi

  TASK_TITLE=$(echo "$READY_JSON" | jq -r '.[0].title // "Unknown"' 2>/dev/null)
  log "Task: $TASK_ID — $TASK_TITLE"

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would dispatch $TASK_ID"
    continue
  fi

  # Mark active and track for cleanup
  CURRENT_TASK_ID="$TASK_ID"
  tx update "$TASK_ID" --status active 2>/dev/null || true

  # Fetch context
  CONTEXT=$(tx context "$TASK_ID" 2>/dev/null || echo "")
  CONTEXT_BLOCK=""
  if [ -n "$CONTEXT" ]; then
    CONTEXT_BLOCK="

## Relevant Learnings
$CONTEXT
"
  fi

  # Dispatch to Claude
  PROMPT="Your task ID is: $TASK_ID
$CONTEXT_BLOCK
Run \`tx show $TASK_ID\` to see full details, then implement the task.
When complete, run \`tx done $TASK_ID\` to mark it done.
If you discover new work, create subtasks with \`tx add \"title\" --parent $TASK_ID\`.
If blocked, use \`tx update $TASK_ID --status blocked\`."

  EXIT_CODE=0
  timeout "$TASK_TIMEOUT" claude --print --dangerously-skip-permissions "$PROMPT" 2>>"$LOG_FILE" || EXIT_CODE=$?

  # Check outcome
  TASK_STATUS=$(tx show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"')

  if [ "$TASK_STATUS" = "done" ]; then
    log "Task completed successfully"
    CONSECUTIVE_FAILURES=0

    # Auto-commit
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      git add -A
      git commit -m "feat: $TASK_TITLE

Task: $TASK_ID

Co-Authored-By: Claude <noreply@anthropic.com>" 2>>"$LOG_FILE" || true
    fi
  else
    log "Task not done (status: $TASK_STATUS, exit: $EXIT_CODE) — resetting"
    tx reset "$TASK_ID" 2>/dev/null || true
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
  fi

  CURRENT_TASK_ID=""
  sleep "$SLEEP_BETWEEN"
done

log "========================================"
log "RALPH Loop Finished"
log "========================================"
log "Iterations completed: $iteration"
