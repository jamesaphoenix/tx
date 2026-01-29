#!/bin/bash
# ralph.sh — RALPH loop orchestrator for tx
#
# Spawns fresh Claude agent instances per task.
# Memory persists through CLAUDE.md + .tx/tasks.db + git, not conversation history.
#
# Usage:
#   ./scripts/ralph.sh              # Run until all tasks done
#   ./scripts/ralph.sh --max 10     # Run at most 10 iterations
#   ./scripts/ralph.sh --agent tx-implementer  # Force a specific agent
#   ./scripts/ralph.sh --dry-run    # Show what would be dispatched

set -euo pipefail

# --- Configuration ---
MAX_ITERATIONS=${MAX_ITERATIONS:-100}
MAX_FAILURES=3
SLEEP_BETWEEN=2
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/.tx/ralph.log"
LOCK_FILE="$PROJECT_DIR/.tx/ralph.lock"
FORCED_AGENT=""
DRY_RUN=false

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --max) MAX_ITERATIONS="$2"; shift 2 ;;
    --agent) FORCED_AGENT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Lock file (prevent multiple instances) ---
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
}
trap cleanup EXIT
echo $$ > "$LOCK_FILE"

# --- Logging ---
mkdir -p "$(dirname "$LOG_FILE")"
log() {
  local msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

# --- Agent selection ---
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

# --- Main loop ---
cd "$PROJECT_DIR"

iteration=0
consecutive_failures=0

log "RALPH started. Max iterations: $MAX_ITERATIONS"

while [ $iteration -lt $MAX_ITERATIONS ]; do
  iteration=$((iteration + 1))
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

  # Spawn fresh agent instance
  AGENT_PROMPT="Read .claude/agents/${AGENT}.md for your instructions.

Your assigned task: $TASK_ID
Task title: $TASK_TITLE

Run \`tx show $TASK_ID\` to get full details, then follow your agent instructions.
When done, run \`tx done $TASK_ID\` to mark the task complete.
If you discover new work, create subtasks with \`tx add\`.
If you hit a blocker, update the task status: \`tx update $TASK_ID --status blocked\`."

  log "Dispatching to Claude..."

  if claude --print "$AGENT_PROMPT" 2>>"$LOG_FILE"; then
    log "Agent completed successfully"
    consecutive_failures=0
  else
    log "Agent failed"
    consecutive_failures=$((consecutive_failures + 1))

    # Circuit breaker
    if [ $consecutive_failures -ge $MAX_FAILURES ]; then
      log "CIRCUIT BREAKER: $MAX_FAILURES consecutive failures. Stopping."
      break
    fi
  fi

  # Checkpoint: commit if there are changes
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A
    git commit -m "ralph: $AGENT completed $TASK_ID — $TASK_TITLE

Co-Authored-By: Claude <noreply@anthropic.com>" 2>>"$LOG_FILE" || true
    log "Changes committed"
  fi

  sleep "$SLEEP_BETWEEN"
done

log "RALPH finished. $iteration iteration(s) completed."
