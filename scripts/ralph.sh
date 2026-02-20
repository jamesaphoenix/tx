#!/bin/bash
# ralph.sh — Enhanced RALPH Loop for tx
#
# Spawns fresh agent instances per task with periodic adversarial review.
# Memory persists through AGENTS/CLAUDE docs + .tx/tasks.db + git, not conversation history.
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
#   ./scripts/ralph.sh --workers 4          # Run 4 parallel workers
#   ./scripts/ralph.sh --runtime codex     # Force Codex runtime
#   ./scripts/ralph.sh --runtime claude    # Force Claude runtime
#   ./scripts/ralph.sh --task-timeout 2700 # 45 minutes max per task
#   ./scripts/ralph.sh --verify-timeout 180 --learnings-timeout 180
#   ./scripts/ralph.sh --no-commit         # Never auto-commit changes
#   ./scripts/ralph.sh --agent-cmd "codex" # Custom command (prompt passed as final arg)
#   ./scripts/ralph.sh --dry-run           # Show what would be dispatched

set -euo pipefail

# ==============================================================================
# Configuration
# ==============================================================================

MAX_ITERATIONS=${MAX_ITERATIONS:-100}
MAX_HOURS=${MAX_HOURS:-3}
REVIEW_EVERY=${REVIEW_EVERY:-25}
REVIEW_TIMEOUT=${REVIEW_TIMEOUT:-300}  # 5 minutes max per review agent
SLEEP_BETWEEN=${SLEEP_BETWEEN:-2}
TASK_TIMEOUT=${TASK_TIMEOUT:-1800}  # 30 minutes max per task
VERIFY_TIMEOUT=${VERIFY_TIMEOUT:-180}
LEARNINGS_TIMEOUT=${LEARNINGS_TIMEOUT:-180}
WORKERS=${WORKERS:-1}
CLAIM_LEASE_MINUTES=${CLAIM_LEASE_MINUTES:-30}
MAX_IDLE_ROUNDS=${MAX_IDLE_ROUNDS:-6}
WORKER_PREFIX=${WORKER_PREFIX:-ralph}
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
LOG_FILE="$PROJECT_DIR/.tx/ralph.log"
LOCK_SCOPE=${LOCK_SCOPE:-runtime_worker}
LOCK_KEY_OVERRIDE="${LOCK_KEY_OVERRIDE:-}"
LOCK_FILE=""
PID_FILE=""
STATE_FILE=""
FORCED_AGENT=""
DRY_RUN=false
CHILD_MODE=false
REVIEW_ENABLED=true
WORKER_ID=""
CURRENT_RUN_ID=""
CLAUDE_PID=""
LAST_TRANSCRIPT_PATH=""
RUNTIME_MODE=${RUNTIME_MODE:-auto}
AGENT_COMMAND_OVERRIDE="${AGENT_COMMAND_OVERRIDE:-}"
AGENT_PROFILE_DIR_OVERRIDE="${AGENT_PROFILE_DIR_OVERRIDE:-}"
ACTIVE_RUNTIME=""
ACTIVE_RUNTIME_LABEL=""
ACTIVE_AGENT_PROFILE_DIR=""
COAUTHOR_LINE=""
CUSTOM_AGENT_CMD_PARTS=()
CHILD_PIDS=()
WORKER_TABLE_AVAILABLE=false
WORKER_REGISTERED=false
LAST_BACKGROUND_PID=""
AUTO_COMMIT=${AUTO_COMMIT:-true}

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --max) MAX_ITERATIONS="$2"; shift 2 ;;
    --max-hours) MAX_HOURS="$2"; shift 2 ;;
    --review-every) REVIEW_EVERY="$2"; shift 2 ;;
    --agent) FORCED_AGENT="$2"; shift 2 ;;
    --workers) WORKERS="$2"; shift 2 ;;
    --claim-lease) CLAIM_LEASE_MINUTES="$2"; shift 2 ;;
    --idle-rounds) MAX_IDLE_ROUNDS="$2"; shift 2 ;;
    --worker-prefix) WORKER_PREFIX="$2"; shift 2 ;;
    --worker-id) WORKER_ID="$2"; shift 2 ;;
    --runtime) RUNTIME_MODE="$2"; shift 2 ;;
    --lock-scope) LOCK_SCOPE="$2"; shift 2 ;;
    --lock-key) LOCK_KEY_OVERRIDE="$2"; shift 2 ;;
    --task-timeout) TASK_TIMEOUT="$2"; shift 2 ;;
    --verify-timeout) VERIFY_TIMEOUT="$2"; shift 2 ;;
    --learnings-timeout) LEARNINGS_TIMEOUT="$2"; shift 2 ;;
    --no-commit) AUTO_COMMIT=false; shift ;;
    --agent-cmd) AGENT_COMMAND_OVERRIDE="$2"; shift 2 ;;
    --agent-dir) AGENT_PROFILE_DIR_OVERRIDE="$2"; shift 2 ;;
    --no-review) REVIEW_ENABLED=false; shift ;;
    --child) CHILD_MODE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --resume) RESUME=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if ! [[ "$WORKERS" =~ ^[0-9]+$ ]] || [ "$WORKERS" -lt 1 ]; then
  echo "Invalid --workers value: $WORKERS (must be a positive integer)" >&2
  exit 1
fi

if ! [[ "$CLAIM_LEASE_MINUTES" =~ ^[0-9]+$ ]] || [ "$CLAIM_LEASE_MINUTES" -lt 1 ]; then
  echo "Invalid --claim-lease value: $CLAIM_LEASE_MINUTES (must be a positive integer)" >&2
  exit 1
fi

if ! [[ "$MAX_IDLE_ROUNDS" =~ ^[0-9]+$ ]] || [ "$MAX_IDLE_ROUNDS" -lt 1 ]; then
  echo "Invalid --idle-rounds value: $MAX_IDLE_ROUNDS (must be a positive integer)" >&2
  exit 1
fi

if ! [[ "$TASK_TIMEOUT" =~ ^[0-9]+$ ]] || [ "$TASK_TIMEOUT" -lt 1 ]; then
  echo "Invalid --task-timeout value: $TASK_TIMEOUT (must be a positive integer in seconds)" >&2
  exit 1
fi

if ! [[ "$VERIFY_TIMEOUT" =~ ^[0-9]+$ ]] || [ "$VERIFY_TIMEOUT" -lt 1 ]; then
  echo "Invalid --verify-timeout value: $VERIFY_TIMEOUT (must be a positive integer in seconds)" >&2
  exit 1
fi

if ! [[ "$LEARNINGS_TIMEOUT" =~ ^[0-9]+$ ]] || [ "$LEARNINGS_TIMEOUT" -lt 1 ]; then
  echo "Invalid --learnings-timeout value: $LEARNINGS_TIMEOUT (must be a positive integer in seconds)" >&2
  exit 1
fi

case "$LOCK_SCOPE" in
  global|runtime|worker|runtime_worker) ;;
  *)
    echo "Invalid --lock-scope value: $LOCK_SCOPE (expected: global|runtime|worker|runtime_worker)" >&2
    exit 1
    ;;
esac

if [ -z "$WORKER_ID" ]; then
  if [ "$CHILD_MODE" = true ]; then
    WORKER_ID="${WORKER_PREFIX}-child"
  else
    WORKER_ID="${WORKER_PREFIX}-main"
  fi
fi

# Calculate max runtime
MAX_SECONDS=$((MAX_HOURS * 3600))
START_TIME=$(date +%s)

cd "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/.tx"

# Define tx function to run CLI source directly via tsx
# This ensures changes are immediately reflected without rebuilding
tx() {
  bun "$PROJECT_DIR/apps/cli/src/cli.ts" "$@"
}

# ==============================================================================
# Runtime Selection (Claude / Codex / Custom)
# ==============================================================================

resolve_runtime() {
  case "$RUNTIME_MODE" in
    auto|claude|codex) ;;
    *)
      echo "Invalid --runtime value: $RUNTIME_MODE (expected: auto|claude|codex)" >&2
      exit 1
      ;;
  esac

  if [ -n "$AGENT_COMMAND_OVERRIDE" ]; then
    read -r -a CUSTOM_AGENT_CMD_PARTS <<< "$AGENT_COMMAND_OVERRIDE"
    if [ ${#CUSTOM_AGENT_CMD_PARTS[@]} -eq 0 ]; then
      echo "--agent-cmd was provided but no executable could be parsed" >&2
      exit 1
    fi
    ACTIVE_RUNTIME="custom"
    ACTIVE_RUNTIME_LABEL="${CUSTOM_AGENT_CMD_PARTS[0]}"
  elif [ "$RUNTIME_MODE" = "claude" ]; then
    if ! command -v claude >/dev/null 2>&1; then
      echo "Claude CLI not found in PATH. Install it or use --runtime codex / --agent-cmd." >&2
      exit 1
    fi
    ACTIVE_RUNTIME="claude"
    ACTIVE_RUNTIME_LABEL="Claude"
  elif [ "$RUNTIME_MODE" = "codex" ]; then
    if ! command -v codex >/dev/null 2>&1; then
      echo "Codex CLI not found in PATH. Install it or use --runtime claude / --agent-cmd." >&2
      exit 1
    fi
    ACTIVE_RUNTIME="codex"
    ACTIVE_RUNTIME_LABEL="Codex"
  elif command -v claude >/dev/null 2>&1; then
    ACTIVE_RUNTIME="claude"
    ACTIVE_RUNTIME_LABEL="Claude"
  elif command -v codex >/dev/null 2>&1; then
    ACTIVE_RUNTIME="codex"
    ACTIVE_RUNTIME_LABEL="Codex"
  else
    echo "No supported agent runtime found. Install claude or codex, or pass --agent-cmd." >&2
    exit 1
  fi

  if [ "$ACTIVE_RUNTIME" = "claude" ]; then
    COAUTHOR_LINE="Co-Authored-By: Claude <noreply@anthropic.com>"
  else
    COAUTHOR_LINE="Co-Authored-By: Codex <noreply@openai.com>"
  fi

  if [ -n "$AGENT_PROFILE_DIR_OVERRIDE" ]; then
    ACTIVE_AGENT_PROFILE_DIR="$AGENT_PROFILE_DIR_OVERRIDE"
  elif [ "$ACTIVE_RUNTIME" = "claude" ]; then
    ACTIVE_AGENT_PROFILE_DIR="$PROJECT_DIR/.claude/agents"
  else
    ACTIVE_AGENT_PROFILE_DIR="$PROJECT_DIR/.codex/agents"
  fi

  if [ ! -d "$ACTIVE_AGENT_PROFILE_DIR" ]; then
    echo "Agent profile directory does not exist: $ACTIVE_AGENT_PROFILE_DIR" >&2
    exit 1
  fi
}

resolve_agent_profile_path() {
  local agent="$1"
  local primary="$ACTIVE_AGENT_PROFILE_DIR/${agent}.md"
  if [ -f "$primary" ]; then
    echo "$primary"
    return
  fi

  # Runtime-aware fallback so mixed repos can still run.
  local fallback=""
  if [ "$ACTIVE_RUNTIME" = "claude" ]; then
    fallback="$PROJECT_DIR/.codex/agents/${agent}.md"
  else
    fallback="$PROJECT_DIR/.claude/agents/${agent}.md"
  fi

  if [ -f "$fallback" ]; then
    echo "$fallback"
    return
  fi

  # Return the primary path for clearer downstream errors.
  echo "$primary"
}

invoke_runtime_sync() {
  local prompt="$1"

  case "$ACTIVE_RUNTIME" in
    claude)
      claude --dangerously-skip-permissions --print "$prompt"
      ;;
    codex)
      codex exec --skip-git-repo-check --full-auto "$prompt"
      ;;
    custom)
      "${CUSTOM_AGENT_CMD_PARTS[@]}" "$prompt"
      ;;
    *)
      echo "Unsupported runtime: $ACTIVE_RUNTIME" >&2
      return 1
      ;;
  esac
}

run_runtime_sync_with_timeout() {
  local prompt="$1"
  local timeout_seconds="${2:-120}"
  local label="${3:-Runtime sync call}"
  local waited=0
  local check_interval=2

  invoke_runtime_sync "$prompt" 2>>"$LOG_FILE" &
  local runtime_pid=$!

  while kill -0 "$runtime_pid" 2>/dev/null; do
    if [ "$waited" -ge "$timeout_seconds" ]; then
      log "$label timed out after ${timeout_seconds}s - terminating"
      terminate_pid_tree "$runtime_pid" TERM
      sleep 1
      if kill -0 "$runtime_pid" 2>/dev/null; then
        terminate_pid_tree "$runtime_pid" KILL
      fi
      wait "$runtime_pid" 2>/dev/null || true
      return 124
    fi
    sleep "$check_interval"
    waited=$((waited + check_interval))
  done

  if wait "$runtime_pid" 2>/dev/null; then
    return 0
  fi
  return $?
}

invoke_runtime_background() {
  local prompt="$1"
  local stdout_path="$2"
  local stderr_path="$3"
  local session_id="${4:-}"

  case "$ACTIVE_RUNTIME" in
    claude)
      if [ -n "$session_id" ]; then
        claude --dangerously-skip-permissions --session-id "$session_id" \
          --print "$prompt" \
          > "$stdout_path" \
          2> >(tee -a "$LOG_FILE" > "$stderr_path") &
      else
        claude --dangerously-skip-permissions --print "$prompt" \
          > "$stdout_path" \
          2> >(tee -a "$LOG_FILE" > "$stderr_path") &
      fi
      ;;
    codex)
      codex exec --skip-git-repo-check --full-auto "$prompt" \
        > "$stdout_path" \
        2> >(tee -a "$LOG_FILE" > "$stderr_path") &
      ;;
    custom)
      "${CUSTOM_AGENT_CMD_PARTS[@]}" "$prompt" \
        > "$stdout_path" \
        2> >(tee -a "$LOG_FILE" > "$stderr_path") &
      ;;
    *)
      echo "Unsupported runtime: $ACTIVE_RUNTIME" >&2
      return 1
      ;;
  esac

  LAST_BACKGROUND_PID=$!
  return 0
}

invoke_runtime_review_background() {
  local prompt="$1"

  case "$ACTIVE_RUNTIME" in
    claude)
      claude --dangerously-skip-permissions --print "$prompt" 2>>"$LOG_FILE" &
      ;;
    codex)
      codex exec --skip-git-repo-check --full-auto "$prompt" 2>>"$LOG_FILE" &
      ;;
    custom)
      "${CUSTOM_AGENT_CMD_PARTS[@]}" "$prompt" 2>>"$LOG_FILE" &
      ;;
    *)
      echo "Unsupported runtime: $ACTIVE_RUNTIME" >&2
      return 1
      ;;
  esac

  LAST_BACKGROUND_PID=$!
  return 0
}

configure_lock_paths() {
  local lock_key="$LOCK_KEY_OVERRIDE"

  if [ -z "$lock_key" ]; then
    case "$LOCK_SCOPE" in
      global) lock_key="global" ;;
      runtime) lock_key="$ACTIVE_RUNTIME" ;;
      worker) lock_key="$WORKER_PREFIX" ;;
      runtime_worker) lock_key="${ACTIVE_RUNTIME}-${WORKER_PREFIX}" ;;
      *) lock_key="${ACTIVE_RUNTIME}-${WORKER_PREFIX}" ;;
    esac
  fi

  lock_key=$(echo "$lock_key" | tr -c 'a-zA-Z0-9._-' '-')
  LOCK_FILE="$PROJECT_DIR/.tx/ralph-${lock_key}.lock"
  PID_FILE="$PROJECT_DIR/.tx/ralph-${lock_key}.pid"
  STATE_FILE="$PROJECT_DIR/.tx/ralph-state-${lock_key}"
}

# ==============================================================================
# Lock File (Prevent Multiple Instances)
# ==============================================================================

resolve_runtime
configure_lock_paths

# Guard against recursive/nested top-level loop launches from agent subprocesses.
if [ -n "${RALPH_LOOP_PID:-}" ] && [ "${RALPH_LOOP_PID}" != "$$" ] && [ "$CHILD_MODE" = false ]; then
  echo "Nested RALPH invocation detected (parent loop PID ${RALPH_LOOP_PID}). Exiting." >&2
  exit 1
fi
export RALPH_LOOP_PID=$$

if [ "$CHILD_MODE" = false ]; then
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
fi

cleanup() {
  if [ "$WORKER_REGISTERED" = true ]; then
    mark_worker_dead "$WORKER_ID"
    WORKER_REGISTERED=false
  fi
  if [ "$CHILD_MODE" = false ]; then
    rm -f "$LOCK_FILE"
    rm -f "$PID_FILE"
    set_orchestrator_stopped
  fi
  log "RALPH shutdown"
}

# Track current task for cleanup
CURRENT_TASK_ID=""

# Terminate a PID and any descendants. Best-effort; never throws.
terminate_pid_tree() {
  local pid="$1"
  local signal="${2:-TERM}"

  [ -z "$pid" ] && return 0

  if command -v pgrep >/dev/null 2>&1; then
    local children=""
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    if [ -n "$children" ]; then
      while IFS= read -r child_pid; do
        [ -z "$child_pid" ] && continue
        terminate_pid_tree "$child_pid" "$signal"
      done <<< "$children"
    fi
  fi

  kill "-$signal" "$pid" 2>/dev/null || true
}

# Cancel current run if RALPH is terminated unexpectedly
cancel_current_run() {
  if [ -n "${CURRENT_RUN_ID:-}" ]; then
    log "Cancelling current run $CURRENT_RUN_ID due to unexpected termination"
    complete_run "$CURRENT_RUN_ID" "cancelled" 130 "RALPH process terminated"
  fi
  if [ -n "${CLAUDE_PID:-}" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then
    log "Terminating agent subprocess (PID $CLAUDE_PID)"
    terminate_pid_tree "$CLAUDE_PID" TERM
    sleep 1
    if kill -0 "$CLAUDE_PID" 2>/dev/null; then
      terminate_pid_tree "$CLAUDE_PID" KILL
    fi
  fi
  # Reset current task back to ready so it can be picked up again
  if [ -n "${CURRENT_TASK_ID:-}" ]; then
    log "Resetting task $CURRENT_TASK_ID to ready"
    tx reset "$CURRENT_TASK_ID" 2>/dev/null || true
    tx claim:release "$CURRENT_TASK_ID" "$WORKER_ID" 2>/dev/null || true
    set_worker_status "$WORKER_ID" "idle"
  fi

  if [ "$CHILD_MODE" = false ] && [ ${#CHILD_PIDS[@]} -gt 0 ]; then
    for child_pid in "${CHILD_PIDS[@]}"; do
      if kill -0 "$child_pid" 2>/dev/null; then
        kill "$child_pid" 2>/dev/null || true
      fi
    done
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
if [ "$CHILD_MODE" = false ]; then
  echo $$ > "$LOCK_FILE"
  echo $$ > "$PID_FILE"
fi

# ==============================================================================
# Orchestrator State (for dashboard)
# ==============================================================================

set_orchestrator_running() {
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE orchestrator_state SET status='running', pid=$$, started_at=datetime('now') WHERE id=1;"
  fi
}

set_orchestrator_stopped() {
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE orchestrator_state SET status='stopped', pid=NULL WHERE id=1;"
  fi
}

# ==============================================================================
# Orphan Run Cleanup
# ==============================================================================

# Kill any Claude processes that have been running too long (zombie detection)
kill_zombie_claude_processes() {
  log "Checking for zombie Claude processes..."

  # Find Claude processes running longer than 2 hours (7200 seconds)
  local max_age=7200
  local now
  now=$(date +%s)
  local killed=0

  # Get all claude --print processes
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue

    # Calculate age (macOS ps shows elapsed time differently, so we check the lstart)
    local process_start
    process_start=$(ps -o lstart= -p "$pid" 2>/dev/null || echo "")
    [ -z "$process_start" ] && continue

    # Convert to epoch (macOS compatible)
    local start_epoch
    start_epoch=$(date -j -f "%c" "$process_start" +%s 2>/dev/null || echo "0")
    [ "$start_epoch" = "0" ] && continue

    local age=$((now - start_epoch))

    if [ $age -gt $max_age ]; then
      log "Found zombie Claude process $pid (age: ${age}s, max: ${max_age}s)"
      terminate_pid_tree "$pid" TERM
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        terminate_pid_tree "$pid" KILL
      fi
      killed=$((killed + 1))
    fi
  done < <(pgrep -f "claude.*--print" 2>/dev/null || true)

  if [ $killed -gt 0 ]; then
    log "Killed $killed zombie Claude process(es)"
  fi
}

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
      # Process is still alive - check if it's an orphaned agent process
      # (parent ralph.sh died but child kept running)
      local parent_pid
      parent_pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')

      # If parent is init (PID 1) or launchd, it's orphaned
      if [ "$parent_pid" = "1" ]; then
        log "Found orphaned agent process $pid (parent died, run $run_id)"
        log "Terminating orphaned agent process..."
        terminate_pid_tree "$pid" TERM
        # Give it a moment to exit gracefully
        sleep 1
        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
          terminate_pid_tree "$pid" KILL
        fi
        local escaped_run_id=$(sql_escape "$run_id")
        sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
          "UPDATE runs SET status='cancelled', ended_at='$now', exit_code=137, error_message='Orphaned agent process terminated (parent RALPH died)' WHERE id='$escaped_run_id';"
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

  # In multi-loop mode, only reset truly orphaned active tasks:
  # tasks marked active that do not have any currently running run record.
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    active_tasks=$(sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "SELECT t.id
       FROM tasks t
       WHERE t.status = 'active'
         AND NOT EXISTS (
           SELECT 1
           FROM runs r
           WHERE r.task_id = t.id
             AND r.status = 'running'
         );" 2>/dev/null || echo "")
  else
    active_tasks=$(tx list --status active --json 2>/dev/null | jq -r '.[].id' 2>/dev/null || echo "")
  fi

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
# Worker Registration / Heartbeat (for claim FK support)
# ==============================================================================

detect_worker_table() {
  WORKER_TABLE_AVAILABLE=false

  if ! command -v sqlite3 >/dev/null 2>&1; then
    return
  fi

  if [ ! -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    return
  fi

  local table_exists
  table_exists=$(sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workers';" \
    2>/dev/null || echo "0")

  if [ "$table_exists" = "1" ]; then
    WORKER_TABLE_AVAILABLE=true
  fi
}

register_worker() {
  local worker_id="$1"

  if [ "$WORKER_TABLE_AVAILABLE" != true ]; then
    return
  fi

  local escaped_worker_id
  escaped_worker_id=$(sql_escape "$worker_id")
  local escaped_name
  escaped_name=$(sql_escape "$worker_id")
  local escaped_hostname
  escaped_hostname=$(sql_escape "$(hostname 2>/dev/null || echo unknown)")

  if sqlite3 "$PROJECT_DIR/.tx/tasks.db" <<EOF >/dev/null 2>&1
INSERT INTO workers (
  id, name, hostname, pid, status, registered_at, last_heartbeat_at, current_task_id, capabilities, metadata
) VALUES (
  '$escaped_worker_id', '$escaped_name', '$escaped_hostname', $$, 'idle',
  datetime('now'), datetime('now'), NULL, '[]', '{"source":"ralph.sh"}'
)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  hostname=excluded.hostname,
  pid=$$,
  status='idle',
  last_heartbeat_at=datetime('now'),
  current_task_id=NULL,
  metadata='{"source":"ralph.sh"}';
EOF
  then
    WORKER_REGISTERED=true
  else
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [$worker_id] Failed to register worker row; claims may fail" | tee -a "$LOG_FILE" >/dev/null
  fi
}

set_worker_status() {
  local worker_id="$1"
  local status="$2"
  local task_id="${3:-}"

  if [ "$WORKER_TABLE_AVAILABLE" != true ]; then
    return
  fi

  local escaped_worker_id
  escaped_worker_id=$(sql_escape "$worker_id")

  if [ -n "$task_id" ]; then
    local escaped_task_id
    escaped_task_id=$(sql_escape "$task_id")
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE workers SET status='$(sql_escape "$status")', current_task_id='$escaped_task_id', pid=$$, last_heartbeat_at=datetime('now') WHERE id='$escaped_worker_id';" \
      >/dev/null 2>&1 || true
  else
    sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "UPDATE workers SET status='$(sql_escape "$status")', current_task_id=NULL, pid=$$, last_heartbeat_at=datetime('now') WHERE id='$escaped_worker_id';" \
      >/dev/null 2>&1 || true
  fi
}

mark_worker_dead() {
  local worker_id="$1"

  if [ "$WORKER_TABLE_AVAILABLE" != true ]; then
    return
  fi

  local escaped_worker_id
  escaped_worker_id=$(sql_escape "$worker_id")
  sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
    "UPDATE workers SET status='dead', current_task_id=NULL, last_heartbeat_at=datetime('now') WHERE id='$escaped_worker_id';" \
    >/dev/null 2>&1 || true
}

# ==============================================================================
# Time & State Helpers
# ==============================================================================

get_elapsed_seconds() {
  echo $(( $(date +%s) - START_TIME ))
}

check_time_limit() {
  local elapsed
  elapsed=$(get_elapsed_seconds)
  if [ "$elapsed" -ge "$MAX_SECONDS" ]; then
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
SCORE_PENALTY=100         # Reduce score by this much per failure
MAX_TASK_FAILURES=3       # Block task after this many failures

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

# Demote a task after failure: increment fail count, lower score, block after MAX_TASK_FAILURES
demote_task() {
  local task_id="$1"
  local reason="$2"

  # Get current fail count from runs table (count failed/cancelled runs for this task)
  local fail_count=0
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    fail_count=$(sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
      "SELECT COUNT(*) FROM runs WHERE task_id='$(sql_escape "$task_id")' AND status IN ('failed', 'cancelled');" 2>/dev/null || echo "0")
  fi

  log "Task $task_id has $fail_count failed attempts"

  if [ "$fail_count" -ge "$MAX_TASK_FAILURES" ]; then
    # Block the task — it needs human review
    log "BLOCKING task $task_id after $fail_count failures — needs human review"
    tx update "$task_id" --status blocked 2>/dev/null || true

    # Store the reason in metadata via sqlite
    if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
      local escaped_reason=$(sql_escape "$reason")
      local escaped_id=$(sql_escape "$task_id")
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE tasks SET metadata = json_set(COALESCE(metadata, '{}'), '$.blockedReason', 'Auto-blocked after $fail_count failures: $escaped_reason', '$.failedAttemptCount', $fail_count) WHERE id='$escaped_id';"
    fi
  else
    # Demote: reset to ready with lower score
    local current_score=$(tx show "$task_id" --json 2>/dev/null | jq -r '.score // 50')
    local new_score=$((current_score - SCORE_PENALTY))
    # Floor at 1 (never go to 0 or negative)
    [ "$new_score" -lt 1 ] && new_score=1

    log "Demoting task $task_id: score $current_score -> $new_score (attempt $fail_count/$MAX_TASK_FAILURES)"
    tx reset "$task_id" 2>/dev/null || true
    tx update "$task_id" --score "$new_score" 2>/dev/null || true

    # Update metadata with fail count
    if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
      local escaped_id=$(sql_escape "$task_id")
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE tasks SET metadata = json_set(COALESCE(metadata, '{}'), '$.failedAttemptCount', $fail_count, '$.lastFailReason', '$(sql_escape "$reason")') WHERE id='$escaped_id';"
    fi
  fi
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

generate_run_id() {
  local seed="$1"
  local entropy=""

  if command -v uuidgen >/dev/null 2>&1; then
    entropy=$(uuidgen | tr '[:upper:]' '[:lower:]')
  else
    entropy="$(date +%s)-$$-$RANDOM-$RANDOM"
  fi

  printf "run-%s" "$(printf '%s' "$seed-$entropy" | shasum -a 256 | cut -c 1-8)"
}

# Create a run record and return the run ID
create_run() {
  local task_id="$1"
  local agent="$2"
  local metadata="$3"

  local now=""
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  local run_id=""
  local inserted=false
  local attempt=0

  while [ "$attempt" -lt 5 ]; do
    run_id=$(generate_run_id "$task_id-$agent-$WORKER_ID")

    # Insert into database (if tx supports it, otherwise just track in file)
    if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
      # Escape variables to prevent SQL injection
      local escaped_task_id=""
      local escaped_agent=""
      local escaped_metadata=""
      escaped_task_id=$(sql_escape "$task_id")
      escaped_agent=$(sql_escape "$agent")
      escaped_metadata=$(sql_escape "$metadata")
      if sqlite3 "$PROJECT_DIR/.tx/tasks.db" <<EOF
INSERT INTO runs (id, task_id, agent, started_at, status, pid, metadata)
VALUES ('$run_id', '$escaped_task_id', '$escaped_agent', '$now', 'running', $$, '$escaped_metadata');
EOF
      then
        inserted=true
        break
      fi
    else
      inserted=true
      break
    fi

    attempt=$((attempt + 1))
    sleep 0.05
  done

  if [ "$inserted" != true ]; then
    echo "Failed to create run row after 5 attempts" >&2
    return 1
  fi

  # Also write to runs log for dashboard
  echo "$run_id" > "$PROJECT_DIR/.tx/current-run"
  printf '{"id":"%s","task_id":"%s","agent":"%s","started_at":"%s","status":"running","pid":%s}\n' \
    "$run_id" "$task_id" "$agent" "$now" "$$" >> "$PROJECT_DIR/.tx/runs.jsonl"

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
# Run Task Agent
# ==============================================================================

run_agent() {
  local agent="$1"
  local task_id="$2"
  local task_title="$3"
  local worker_id="${4:-$WORKER_ID}"
  local profile_path
  profile_path=$(resolve_agent_profile_path "$agent")

  if [ ! -f "$profile_path" ]; then
    log "Agent profile not found: $profile_path"
    return 1
  fi

  local profile_display="$profile_path"
  if [[ "$profile_path" == "$PROJECT_DIR/"* ]]; then
    profile_display="${profile_path#"$PROJECT_DIR"/}"
  fi

  local prompt="Read $profile_display for your instructions.

Your assigned task: $task_id
Task title: $task_title

Follow the profile instructions first.
Helpful commands if needed:
- \`tx show $task_id\` for full task details
- \`tx context $task_id\` for related learnings

When complete, run \`tx done $task_id\`.
If you discover new work, create subtasks with \`tx add\`.
If blocked, run \`tx update $task_id --status blocked\`.
Optionally record useful insights with \`tx learning:add \"<what you learned>\" --source-ref $task_id\`."

  log "Dispatching to $ACTIVE_RUNTIME_LABEL..."

  # Create run record
  local metadata=""
  metadata="{\"iteration\":$iteration,\"worker\":\"$worker_id\",\"git_sha\":\"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\",\"runtime\":\"$ACTIVE_RUNTIME\"}"
  if ! CURRENT_RUN_ID=$(create_run "$task_id" "$agent" "$metadata"); then
    log "Failed to create run record for task $task_id"
    return 1
  fi
  log "Run: $CURRENT_RUN_ID"

  # Create per-run log directory
  local run_dir="$PROJECT_DIR/.tx/runs/$CURRENT_RUN_ID"
  mkdir -p "$run_dir"

  # Save injected context
  echo "$prompt" > "$run_dir/context.md"

  LAST_TRANSCRIPT_PATH="$run_dir/stdout.log"
  local session_uuid=""

  if [ "$ACTIVE_RUNTIME" = "claude" ]; then
    # Generate a UUID for Claude's session so we can find the transcript.
    session_uuid=$(uuidgen | tr '[:upper:]' '[:lower:]')

    # Claude stores sessions in ~/.claude/projects/<escaped-cwd>/<session-uuid>.jsonl
    local escaped_cwd
    escaped_cwd=${PROJECT_DIR//[^a-zA-Z0-9]/-}
    LAST_TRANSCRIPT_PATH="$HOME/.claude/projects/$escaped_cwd/$session_uuid.jsonl"
  fi

  # Export env vars so hooks can detect ralph mode and correlate artifacts
  export RALPH_MODE=true
  export RALPH_RUN_ID="$CURRENT_RUN_ID"
  export CLAUDE_CODE_DEBUG_LOGS_DIR="$PROJECT_DIR/.tx/debug"
  mkdir -p "$CLAUDE_CODE_DEBUG_LOGS_DIR"

  if ! invoke_runtime_background "$prompt" "$run_dir/stdout.log" "$run_dir/stderr.log" "$session_uuid"; then
    complete_run "$CURRENT_RUN_ID" "failed" 1 "Failed to start $ACTIVE_RUNTIME_LABEL process"
    CURRENT_RUN_ID=""
    return 1
  fi
  CLAUDE_PID="$LAST_BACKGROUND_PID"

  # Update run record with PID and log/transcript paths
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$PROJECT_DIR/.tx/tasks.db" ]; then
    local escaped_run_id=$(sql_escape "$CURRENT_RUN_ID")
    local escaped_stdout_path=$(sql_escape "$run_dir/stdout.log")
    local escaped_stderr_path=$(sql_escape "$run_dir/stderr.log")
    local escaped_context_path=$(sql_escape "$run_dir/context.md")

    if [ -n "$LAST_TRANSCRIPT_PATH" ]; then
      local escaped_transcript_path=$(sql_escape "$LAST_TRANSCRIPT_PATH")
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE runs SET
          pid=$CLAUDE_PID,
          stdout_path='$escaped_stdout_path',
          stderr_path='$escaped_stderr_path',
          context_injected='$escaped_context_path',
          transcript_path='$escaped_transcript_path'
        WHERE id='$escaped_run_id';"
    else
      sqlite3 "$PROJECT_DIR/.tx/tasks.db" \
        "UPDATE runs SET
          pid=$CLAUDE_PID,
          stdout_path='$escaped_stdout_path',
          stderr_path='$escaped_stderr_path',
          context_injected='$escaped_context_path'
        WHERE id='$escaped_run_id';"
    fi
  fi

  if [ -n "$session_uuid" ]; then
    log "$ACTIVE_RUNTIME_LABEL PID: $CLAUDE_PID, session: $session_uuid (timeout: ${TASK_TIMEOUT}s)"
  else
    log "$ACTIVE_RUNTIME_LABEL PID: $CLAUDE_PID (timeout: ${TASK_TIMEOUT}s)"
  fi

  # Wait for agent with timeout
  local exit_code=0
  local waited=0
  local check_interval=10
  if [ "$TASK_TIMEOUT" -lt "$check_interval" ]; then
    check_interval=1
  fi

  while kill -0 "$CLAUDE_PID" 2>/dev/null; do
    if [ "$waited" -ge "$TASK_TIMEOUT" ]; then
      log "Task timeout after ${TASK_TIMEOUT}s - killing $ACTIVE_RUNTIME_LABEL process"
      terminate_pid_tree "$CLAUDE_PID" TERM
      sleep 2
      # Force kill if still running
      if kill -0 "$CLAUDE_PID" 2>/dev/null; then
        terminate_pid_tree "$CLAUDE_PID" KILL
      fi
      CLAUDE_PID=""
      complete_run "$CURRENT_RUN_ID" "failed" 124 "Task timed out after ${TASK_TIMEOUT}s"
      CURRENT_RUN_ID=""
      return 1
    fi
    sleep "$check_interval"
    waited=$((waited + check_interval))
  done

  # Process exited; capture exit code without tripping `set -e`.
  # `wait` can return non-zero for expected agent failures/timeouts and
  # must not crash the orchestrator loop before run/task reconciliation.
  if wait "$CLAUDE_PID" 2>/dev/null; then
    exit_code=0
  else
    exit_code=$?
  fi

  if [ $exit_code -eq 0 ]; then
    CLAUDE_PID=""
    complete_run "$CURRENT_RUN_ID" "completed" 0
    CURRENT_RUN_ID=""
    return 0
  fi

  CLAUDE_PID=""
  complete_run "$CURRENT_RUN_ID" "failed" "$exit_code" "$ACTIVE_RUNTIME_LABEL exited with code $exit_code"
  CURRENT_RUN_ID=""
  return 1
}

# ==============================================================================
# Review Agents (Adversarial Loop)
# ==============================================================================

# Run a review agent with a timeout to prevent hanging
run_review_agent() {
  local agent_name="$1"
  local prompt="$2"

  log "Running $agent_name..."

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would run $agent_name"
    return 0
  fi

  # Run review prompt in background with timeout
  if ! invoke_runtime_review_background "$prompt"; then
    log "$agent_name failed to start in $ACTIVE_RUNTIME_LABEL"
    return 1
  fi
  local agent_pid="$LAST_BACKGROUND_PID"
  local waited=0
  local check_interval=5

  while kill -0 "$agent_pid" 2>/dev/null; do
    if [ "$waited" -ge "$REVIEW_TIMEOUT" ]; then
      log "$agent_name timed out after ${REVIEW_TIMEOUT}s — killing"
      terminate_pid_tree "$agent_pid" TERM
      sleep 2
      if kill -0 "$agent_pid" 2>/dev/null; then
        terminate_pid_tree "$agent_pid" KILL
      fi
      return 1
    fi
    sleep $check_interval
    waited=$((waited + check_interval))
  done

  wait "$agent_pid" 2>/dev/null || { log "$agent_name had issues"; return 1; }
  return 0
}

run_review_cycle() {
  local iteration=$1

  log "=== REVIEW CYCLE (iteration $iteration) ==="

  # 1. Doctrine Checker
  local doctrine_profile
  doctrine_profile=$(resolve_agent_profile_path "tx-doctrine-checker")
  local doctrine_display="$doctrine_profile"
  [[ "$doctrine_profile" == "$PROJECT_DIR/"* ]] && doctrine_display="${doctrine_profile#"$PROJECT_DIR"/}"
  run_review_agent "doctrine-checker" "Read $doctrine_display for your instructions.

Review recent changes and check for doctrine violations.
This is iteration $iteration of the RALPH loop."

  # 2. Test Runner
  local test_runner_profile
  test_runner_profile=$(resolve_agent_profile_path "tx-test-runner")
  local test_runner_display="$test_runner_profile"
  [[ "$test_runner_profile" == "$PROJECT_DIR/"* ]] && test_runner_display="${test_runner_profile#"$PROJECT_DIR"/}"
  run_review_agent "test-runner" "Read $test_runner_display for your instructions.

Run ONLY targeted tests for recently changed files. Do NOT run the full test suite.
This is iteration $iteration of the RALPH loop."

  # 3. Quality Checker
  local quality_profile
  quality_profile=$(resolve_agent_profile_path "tx-quality-checker")
  local quality_display="$quality_profile"
  [[ "$quality_profile" == "$PROJECT_DIR/"* ]] && quality_display="${quality_profile#"$PROJECT_DIR"/}"
  run_review_agent "quality-checker" "Read $quality_display for your instructions.

Review recent code changes for quality issues.
This is iteration $iteration of the RALPH loop."

  # Commit any review findings
  if [ "$AUTO_COMMIT" = true ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A
    git commit -m "chore(ralph): review cycle at iteration $iteration

Co-Authored-By: jamesaphoenix <jamesaphoenix@googlemail.com>
$COAUTHOR_LINE" 2>>"$LOG_FILE" || true
    log "Review changes committed"
  elif [ "$AUTO_COMMIT" = false ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    log "Review changes detected; skipping auto-commit (--no-commit)"
  fi

  log "=== REVIEW CYCLE COMPLETE ==="
}

# ==============================================================================
# Main Loop
# ==============================================================================

acquire_claim() {
  local task_id="$1"
  local worker_id="$2"
  tx claim "$task_id" "$worker_id" --lease "$CLAIM_LEASE_MINUTES" >/dev/null 2>&1
}

release_claim() {
  local task_id="$1"
  local worker_id="$2"
  tx claim:release "$task_id" "$worker_id" >/dev/null 2>&1 || true
}

run_worker_loop() {
  local worker_id="$1"
  local worker_review_enabled="$2"
  local worker_state_file="$STATE_FILE"
  local idle_rounds=0

  if [ "$CHILD_MODE" = true ] || [ "$WORKERS" -gt 1 ]; then
    worker_state_file="${STATE_FILE}-${worker_id}"
  fi

  if [ "${RESUME:-false}" = true ] && [ -f "$worker_state_file" ]; then
    iteration=$(cat "$worker_state_file")
  else
    iteration=0
  fi
  LAST_REVIEW=0
  register_worker "$worker_id"
  set_worker_status "$worker_id" "idle"

  while [ "$iteration" -lt "$MAX_ITERATIONS" ]; do
    iteration=$((iteration + 1))
    echo "$iteration" > "$worker_state_file"

    # Check limits
    check_time_limit || break
    check_circuit_breaker || break

    set_worker_status "$worker_id" "idle"
    log "[$worker_id] --- Iteration $iteration ---"

    # Get highest-priority ready task
    READY_JSON=$(tx ready --json --limit 1 2>/dev/null || echo "[]")
    TASK=$(echo "$READY_JSON" | jq '.[0] // empty' 2>/dev/null)

    if [ -z "$TASK" ] || [ "$TASK" = "null" ]; then
      idle_rounds=$((idle_rounds + 1))
      if [ "$idle_rounds" -ge "$MAX_IDLE_ROUNDS" ]; then
        log "[$worker_id] No ready tasks after $MAX_IDLE_ROUNDS checks. Worker exiting."
        break
      fi
      log "[$worker_id] No ready tasks. Sleeping (${idle_rounds}/${MAX_IDLE_ROUNDS})..."
      sleep "$SLEEP_BETWEEN"
      continue
    fi
    idle_rounds=0

    TASK_ID=$(echo "$TASK" | jq -r '.id')
    TASK_TITLE=$(echo "$TASK" | jq -r '.title')
    AGENT=$(select_agent "$TASK")

    log "[$worker_id] Task: $TASK_ID — $TASK_TITLE"
    log "[$worker_id] Agent: $AGENT"

    if [ "$DRY_RUN" = true ]; then
      log "[$worker_id] [DRY RUN] Would dispatch $TASK_ID to $AGENT"
      sleep "$SLEEP_BETWEEN"
      continue
    fi

    if ! acquire_claim "$TASK_ID" "$worker_id"; then
      log "[$worker_id] Claim failed for $TASK_ID (already claimed)."
      sleep "$SLEEP_BETWEEN"
      continue
    fi

    # Mark task as active and track it for signal handling
    CURRENT_TASK_ID="$TASK_ID"
    tx update "$TASK_ID" --status active 2>/dev/null || true
    set_worker_status "$worker_id" "busy" "$TASK_ID"

    # Run the agent
    AGENT_EXIT_CODE=0
    if run_agent "$AGENT" "$TASK_ID" "$TASK_TITLE" "$worker_id"; then
      log "[$worker_id] Agent process exited successfully"
    else
      AGENT_EXIT_CODE=$?
      log "[$worker_id] Agent process failed (exit code: $AGENT_EXIT_CODE)"
    fi

    # Verify task actually completed - this is the key reliability check
    TASK_STATUS=$(tx show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"')
    log "[$worker_id] Task status after agent: $TASK_STATUS"
    TASK_SUCCEEDED=false

    if [ "$TASK_STATUS" = "done" ]; then
      log "[$worker_id] ✓ Task completed successfully"
      on_success
      TASK_SUCCEEDED=true
    elif [ "$TASK_STATUS" = "blocked" ]; then
      log "[$worker_id] Task is blocked (likely decomposed into subtasks)"
      on_success
      TASK_SUCCEEDED=true
    elif [ "$AGENT_EXIT_CODE" -ne 0 ]; then
      log "[$worker_id] ✗ Agent failed and task not done - demoting"
      demote_task "$TASK_ID" "Agent failed (exit code: $AGENT_EXIT_CODE)"
      record_failure
    else
      # Agent exited 0 but task not done - ask a verification agent to check
      log "[$worker_id] ⚠ Agent exited cleanly but task not marked done (status: $TASK_STATUS)"
      log "[$worker_id] Running verification agent..."

      VERIFY_PROMPT="Task $TASK_ID was just worked on but is still status '$TASK_STATUS'.

Run \`tx show $TASK_ID\` to see the task details.

Check if the task is actually complete:
1. If the work IS done, run \`tx done $TASK_ID\` to mark it complete
2. If more work is needed, explain what's missing and leave status as-is
3. If it's blocked on something, run \`tx update $TASK_ID --status blocked\`

Be honest - only mark done if the acceptance criteria are met."

      # Quick verification check (no run tracking for this)
      local verify_exit_code=0
      if run_runtime_sync_with_timeout "$VERIFY_PROMPT" "$VERIFY_TIMEOUT" "Verification agent"; then
        # Re-check status after verification
        FINAL_STATUS=$(tx show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"')
        log "[$worker_id] Status after verification: $FINAL_STATUS"

        if [ "$FINAL_STATUS" = "done" ]; then
          log "[$worker_id] ✓ Verification agent marked task complete"
          on_success
          TASK_SUCCEEDED=true
        elif [ "$FINAL_STATUS" = "blocked" ]; then
          log "[$worker_id] Task marked as blocked by verification agent"
          on_success
          TASK_SUCCEEDED=true
        else
          log "[$worker_id] ✗ Task still not done after verification - demoting"
          demote_task "$TASK_ID" "Not done after verification (status: $FINAL_STATUS)"
          record_failure
        fi
      else
        verify_exit_code=$?
        if [ "$verify_exit_code" -eq 124 ]; then
          log "[$worker_id] Verification agent timed out - demoting task"
          demote_task "$TASK_ID" "Verification agent timed out after ${VERIFY_TIMEOUT}s"
        else
          log "[$worker_id] Verification agent failed - demoting task"
          demote_task "$TASK_ID" "Verification agent failed (exit code: $verify_exit_code)"
        fi
        record_failure
      fi
    fi

    release_claim "$TASK_ID" "$worker_id"

    # Clear current task tracking
    CURRENT_TASK_ID=""
    set_worker_status "$worker_id" "idle"

    # Extract learnings only after a successful task outcome.
    if [ "$TASK_SUCCEEDED" = true ] && [ -n "$LAST_TRANSCRIPT_PATH" ] && [ -f "$LAST_TRANSCRIPT_PATH" ]; then
      log "[$worker_id] Extracting learnings from session transcript..."
      local learnings_exit=0
      if run_runtime_sync_with_timeout \
        "You are a learnings extractor. Read the transcript at $LAST_TRANSCRIPT_PATH.

Extract all key learnings — things that would help a future agent working on this codebase. Focus on:
- Bugs discovered and their root causes
- Patterns that worked or failed
- Codebase-specific knowledge (file locations, gotchas, conventions)
- Tool/API quirks encountered

For each learning, record it with:
  tx learning:add \"<learning>\" --source-ref $TASK_ID

Skip obvious or generic observations. Only record insights specific to this project." \
        "$LEARNINGS_TIMEOUT" \
        "Learnings extractor"
      then
        :
      else
        learnings_exit=$?
        if [ "$learnings_exit" -eq 124 ]; then
          log "[$worker_id] Learnings extraction timed out after ${LEARNINGS_TIMEOUT}s"
        else
          log "[$worker_id] Learnings extraction had issues (exit code: $learnings_exit)"
        fi
      fi
    elif [ "$TASK_SUCCEEDED" != true ]; then
      log "[$worker_id] Skipping learnings extraction because task did not complete successfully"
    fi

    # Checkpoint: commit only on successful outcomes
    if [ "$TASK_SUCCEEDED" = true ] && [ "$AUTO_COMMIT" = true ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      git add -A
      git commit -m "chore(ralph): $AGENT completed $TASK_ID - $TASK_TITLE

Co-Authored-By: jamesaphoenix <jamesaphoenix@googlemail.com>
$COAUTHOR_LINE" 2>>"$LOG_FILE" || true
      log "[$worker_id] Changes committed"
    elif [ "$AUTO_COMMIT" = false ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      log "[$worker_id] Changes detected; skipping auto-commit (--no-commit)"
    elif [ "$TASK_SUCCEEDED" != true ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      log "[$worker_id] Changes detected after failed task; not committing"
    fi

    # Review cycle every N iterations (only on review-enabled workers)
    if [ "$worker_review_enabled" = true ] && [ $((iteration - LAST_REVIEW)) -ge "$REVIEW_EVERY" ]; then
      run_review_cycle $iteration
      LAST_REVIEW=$iteration
    fi

    sleep "$SLEEP_BETWEEN"
  done

  set_worker_status "$worker_id" "idle"
  log "[$worker_id] Worker finished after $iteration iteration(s)"
}

spawn_parallel_workers() {
  local i=1
  while [ "$i" -le "$WORKERS" ]; do
    local child_worker_id="${WORKER_PREFIX}-${i}"
    local child_args=(
      --child
      --workers 1
      --worker-id "$child_worker_id"
      --max "$MAX_ITERATIONS"
      --max-hours "$MAX_HOURS"
      --review-every "$REVIEW_EVERY"
      --task-timeout "$TASK_TIMEOUT"
      --verify-timeout "$VERIFY_TIMEOUT"
      --learnings-timeout "$LEARNINGS_TIMEOUT"
      --claim-lease "$CLAIM_LEASE_MINUTES"
      --idle-rounds "$MAX_IDLE_ROUNDS"
      --worker-prefix "$WORKER_PREFIX"
    )

    if [ -n "$FORCED_AGENT" ]; then
      child_args+=(--agent "$FORCED_AGENT")
    fi

    if [ "$RUNTIME_MODE" != "auto" ]; then
      child_args+=(--runtime "$RUNTIME_MODE")
    fi

    if [ -n "$AGENT_COMMAND_OVERRIDE" ]; then
      child_args+=(--agent-cmd "$AGENT_COMMAND_OVERRIDE")
    fi

    if [ -n "$AGENT_PROFILE_DIR_OVERRIDE" ]; then
      child_args+=(--agent-dir "$AGENT_PROFILE_DIR_OVERRIDE")
    fi

    if [ "${RESUME:-false}" = true ]; then
      child_args+=(--resume)
    fi

    if [ "$DRY_RUN" = true ]; then
      child_args+=(--dry-run)
    fi

    if [ "$AUTO_COMMIT" = false ]; then
      child_args+=(--no-commit)
    fi

    if [ $i -ne 1 ]; then
      child_args+=(--no-review)
    fi

    "$SCRIPT_PATH" "${child_args[@]}" >>"$LOG_FILE" 2>&1 &
    CHILD_PIDS+=($!)
    log "Spawned worker $child_worker_id (pid ${CHILD_PIDS[$((i - 1))]})"
    i=$((i + 1))
  done

  local failed=0
  for child_pid in "${CHILD_PIDS[@]}"; do
    if ! wait "$child_pid"; then
      failed=1
    fi
  done

  return $failed
}

detect_worker_table

log "========================================"
log "RALPH Loop Started"
log "========================================"
log "Project: $PROJECT_DIR"
log "Runtime: $ACTIVE_RUNTIME ($ACTIVE_RUNTIME_LABEL)"
log "Agent profiles: $ACTIVE_AGENT_PROFILE_DIR"
log "Worker mode: workers=$WORKERS worker_id=$WORKER_ID child=$CHILD_MODE"
log "Max iterations: $MAX_ITERATIONS"
log "Max runtime: $MAX_HOURS hours"
log "Task timeout: ${TASK_TIMEOUT}s (verify: ${VERIFY_TIMEOUT}s, learnings: ${LEARNINGS_TIMEOUT}s)"
log "Review every: $REVIEW_EVERY iterations"
log "Auto-commit: $AUTO_COMMIT"
log ""

if [ "$CHILD_MODE" = false ]; then
  # Kill zombie Claude processes (Claude runtime only)
  if [ "$ACTIVE_RUNTIME" = "claude" ]; then
    kill_zombie_claude_processes
  fi

  # Clean up any orphaned runs from previous crashed sessions
  cancel_orphaned_runs

  # Reset any orphaned active tasks from previous sessions
  reset_orphaned_tasks

  # Mark orchestrator as running in database (for dashboard)
  set_orchestrator_running
fi

if [ "$CHILD_MODE" = false ] && [ "$WORKERS" -gt 1 ]; then
  log "Starting parallel ralph workers: $WORKERS"
  if ! spawn_parallel_workers; then
    log "One or more workers failed"
    exit 1
  fi
else
  run_worker_loop "$WORKER_ID" "$REVIEW_ENABLED"
fi

log "========================================"
log "RALPH Loop Finished"
log "========================================"
log "Consecutive failures: $CONSECUTIVE_FAILURES"
