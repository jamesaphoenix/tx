#!/bin/bash
# ralph-watchdog.sh — supervise Ralph loops and self-heal failures.
#
# Default behavior:
# - Poll health every 5 minutes
# - Keep one Codex loop and one Claude loop alive
# - Reconcile orphaned/stale runs
# - Reset active tasks that no longer have a running run
# - Restart loops after error bursts
#
# Usage:
#   ./scripts/ralph-watchdog.sh
#   ./scripts/ralph-watchdog.sh --once
#   ./scripts/ralph-watchdog.sh --interval 120
#   ./scripts/ralph-watchdog.sh --no-claude
#   ./scripts/ralph-watchdog.sh --no-start

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="$PROJECT_DIR/.tx/tasks.db"
LOG_FILE="$PROJECT_DIR/.tx/ralph-watchdog.log"

POLL_SECONDS=${POLL_SECONDS:-300}
RUN_STALE_SECONDS=${RUN_STALE_SECONDS:-5400}
ERROR_BURST_WINDOW_MINUTES=${ERROR_BURST_WINDOW_MINUTES:-20}
ERROR_BURST_THRESHOLD=${ERROR_BURST_THRESHOLD:-4}
RESTART_COOLDOWN_SECONDS=${RESTART_COOLDOWN_SECONDS:-900}

CODEX_ENABLED=true
CLAUDE_ENABLED=true
AUTO_START=true
RUN_ONCE=false

CODEX_PREFIX=${CODEX_PREFIX:-ralph-codex-live}
CLAUDE_PREFIX=${CLAUDE_PREFIX:-ralph-claude-live}

MAX_ITERATIONS=${MAX_ITERATIONS:-1000000}
MAX_HOURS=${MAX_HOURS:-24}
TASK_TIMEOUT=${TASK_TIMEOUT:-1800}
VERIFY_TIMEOUT=${VERIFY_TIMEOUT:-180}
LEARNINGS_TIMEOUT=${LEARNINGS_TIMEOUT:-180}
CLAIM_LEASE_MINUTES=${CLAIM_LEASE_MINUTES:-30}
CLAIM_RENEW_INTERVAL=${CLAIM_RENEW_INTERVAL:-300}
IDLE_ROUNDS=${IDLE_ROUNDS:-300}
AUTO_COMMIT=${AUTO_COMMIT:-true}
REVIEW_ENABLED=${REVIEW_ENABLED:-false}
WATCHDOG_PID_FILE="$PROJECT_DIR/.tx/ralph-watchdog.pid"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) POLL_SECONDS="$2"; shift 2 ;;
    --run-stale-seconds) RUN_STALE_SECONDS="$2"; shift 2 ;;
    --error-window-minutes) ERROR_BURST_WINDOW_MINUTES="$2"; shift 2 ;;
    --error-threshold) ERROR_BURST_THRESHOLD="$2"; shift 2 ;;
    --restart-cooldown-seconds) RESTART_COOLDOWN_SECONDS="$2"; shift 2 ;;
    --idle-rounds) IDLE_ROUNDS="$2"; shift 2 ;;
    --codex-prefix) CODEX_PREFIX="$2"; shift 2 ;;
    --claude-prefix) CLAUDE_PREFIX="$2"; shift 2 ;;
    --no-codex) CODEX_ENABLED=false; shift ;;
    --no-claude) CLAUDE_ENABLED=false; shift ;;
    --no-start) AUTO_START=false; shift ;;
    --once) RUN_ONCE=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if ! [[ "$POLL_SECONDS" =~ ^[0-9]+$ ]] || [ "$POLL_SECONDS" -lt 1 ]; then
  echo "Invalid --interval value: $POLL_SECONDS" >&2
  exit 1
fi

if ! [[ "$RUN_STALE_SECONDS" =~ ^[0-9]+$ ]] || [ "$RUN_STALE_SECONDS" -lt 60 ]; then
  echo "Invalid --run-stale-seconds value: $RUN_STALE_SECONDS" >&2
  exit 1
fi

if ! [[ "$ERROR_BURST_WINDOW_MINUTES" =~ ^[0-9]+$ ]] || [ "$ERROR_BURST_WINDOW_MINUTES" -lt 1 ]; then
  echo "Invalid --error-window-minutes value: $ERROR_BURST_WINDOW_MINUTES" >&2
  exit 1
fi

if ! [[ "$ERROR_BURST_THRESHOLD" =~ ^[0-9]+$ ]] || [ "$ERROR_BURST_THRESHOLD" -lt 1 ]; then
  echo "Invalid --error-threshold value: $ERROR_BURST_THRESHOLD" >&2
  exit 1
fi

if ! [[ "$RESTART_COOLDOWN_SECONDS" =~ ^[0-9]+$ ]] || [ "$RESTART_COOLDOWN_SECONDS" -lt 1 ]; then
  echo "Invalid --restart-cooldown-seconds value: $RESTART_COOLDOWN_SECONDS" >&2
  exit 1
fi

if ! [[ "$IDLE_ROUNDS" =~ ^[0-9]+$ ]] || [ "$IDLE_ROUNDS" -lt 1 ]; then
  echo "Invalid --idle-rounds value: $IDLE_ROUNDS" >&2
  exit 1
fi

if [ "$CODEX_ENABLED" = false ] && [ "$CLAUDE_ENABLED" = false ]; then
  echo "Both runtimes disabled (--no-codex and --no-claude). Nothing to supervise." >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/.tx"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found: $DB_PATH (run tx init first)" >&2
  exit 1
fi

tx() {
  bun "$PROJECT_DIR/apps/cli/src/cli.ts" "$@"
}

log() {
  local msg=""
  msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

acquire_watchdog_lock() {
  if [ -f "$WATCHDOG_PID_FILE" ]; then
    local existing_pid=""
    existing_pid=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
      log "Another watchdog is already running (pid=$existing_pid). Exiting."
      exit 0
    fi
  fi

  echo "$$" > "$WATCHDOG_PID_FILE"
}

release_watchdog_lock() {
  if [ -f "$WATCHDOG_PID_FILE" ]; then
    local owner_pid=""
    owner_pid=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)
    if [ "$owner_pid" = "$$" ]; then
      rm -f "$WATCHDOG_PID_FILE"
    fi
  fi
}

restart_stamp_file_for() {
  local runtime="$1"
  local prefix="$2"
  local key=""
  key=$(lock_key_for "$runtime" "$prefix")
  printf '%s/.tx/ralph-watchdog-restart-%s.stamp' "$PROJECT_DIR" "$key"
}

sql_escape() {
  echo "${1//\'/\'\'}"
}

lock_key_for() {
  local runtime="$1"
  local prefix="$2"
  printf '%s' "${runtime}-${prefix}" | tr -c 'a-zA-Z0-9._-' '-'
}

pid_file_for() {
  local runtime="$1"
  local prefix="$2"
  local key=""
  key=$(lock_key_for "$runtime" "$prefix")
  printf '%s/.tx/ralph-%s.pid' "$PROJECT_DIR" "$key"
}

loop_pid() {
  local runtime="$1"
  local prefix="$2"
  local pid_file=""
  pid_file=$(pid_file_for "$runtime" "$prefix")

  if [ ! -f "$pid_file" ]; then
    return 1
  fi

  local pid=""
  pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -z "$pid" ]; then
    return 1
  fi

  printf '%s' "$pid"
}

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

start_loop() {
  local runtime="$1"
  local prefix="$2"
  local out_log="$PROJECT_DIR/.tx/ralph-${runtime}-${prefix}.supervised.log"

  local cmd=(
    "$PROJECT_DIR/scripts/ralph.sh"
    --runtime "$runtime"
    --workers 1
    --max "$MAX_ITERATIONS"
    --max-hours "$MAX_HOURS"
    --worker-prefix "$prefix"
    --task-timeout "$TASK_TIMEOUT"
    --verify-timeout "$VERIFY_TIMEOUT"
    --learnings-timeout "$LEARNINGS_TIMEOUT"
    --claim-lease "$CLAIM_LEASE_MINUTES"
    --claim-renew-interval "$CLAIM_RENEW_INTERVAL"
    --idle-rounds "$IDLE_ROUNDS"
  )

  if [ "$AUTO_COMMIT" != true ]; then
    cmd+=(--no-commit)
  fi

  if [ "$REVIEW_ENABLED" != true ]; then
    cmd+=(--no-review)
  fi

  if [ "$AUTO_START" != true ]; then
    log "[dry] AUTO_START=false; would start runtime=$runtime prefix=$prefix"
    return 0
  fi

  "${cmd[@]}" >>"$out_log" 2>&1 &
  local launcher_pid="$!"
  sleep 1

  local pid=""
  pid=$(loop_pid "$runtime" "$prefix" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log "Started runtime=$runtime prefix=$prefix pid=$pid"
  else
    log "Start attempted runtime=$runtime prefix=$prefix launcher_pid=$launcher_pid"
  fi
}

restart_loop() {
  local runtime="$1"
  local prefix="$2"
  local reason="$3"
  local pid=""
  pid=$(loop_pid "$runtime" "$prefix" 2>/dev/null || true)

  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log "Restarting runtime=$runtime prefix=$prefix pid=$pid reason=$reason"
    terminate_pid_tree "$pid" TERM
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
      terminate_pid_tree "$pid" KILL
    fi
  else
    log "Restart runtime=$runtime prefix=$prefix reason=$reason (no live pid)"
  fi

  start_loop "$runtime" "$prefix"
}

restart_with_cooldown() {
  local runtime="$1"
  local prefix="$2"
  local reason="$3"
  local now=""
  now=$(date +%s)

  local stamp_file=""
  stamp_file=$(restart_stamp_file_for "$runtime" "$prefix")
  if [ -f "$stamp_file" ]; then
    local last_restart=""
    last_restart=$(cat "$stamp_file" 2>/dev/null || echo "0")
    if [[ "$last_restart" =~ ^[0-9]+$ ]]; then
      local elapsed=$((now - last_restart))
      if [ "$elapsed" -lt "$RESTART_COOLDOWN_SECONDS" ]; then
        log "Restart cooldown active runtime=$runtime prefix=$prefix elapsed=${elapsed}s threshold=${RESTART_COOLDOWN_SECONDS}s"
        return
      fi
    fi
  fi

  echo "$now" > "$stamp_file"
  restart_loop "$runtime" "$prefix" "$reason"
}

ensure_loop() {
  local runtime="$1"
  local prefix="$2"
  local enabled="$3"

  if [ "$enabled" != true ]; then
    return
  fi

  local pid=""
  pid=$(loop_pid "$runtime" "$prefix" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return
  fi

  log "Loop missing runtime=$runtime prefix=$prefix; starting"
  start_loop "$runtime" "$prefix"
}

reconcile_running_runs() {
  local rows=""
  rows=$(sqlite3 "$DB_PATH" \
    "SELECT id, COALESCE(task_id,''), COALESCE(pid,0), CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
     FROM runs
     WHERE status='running';" 2>/dev/null || echo "")

  [ -z "$rows" ] && return

  while IFS='|' read -r run_id task_id pid age; do
    [ -z "$run_id" ] && continue

    if [ "$pid" -le 0 ]; then
      sqlite3 "$DB_PATH" \
        "UPDATE runs SET status='cancelled', ended_at=datetime('now'), exit_code=137, error_message='Watchdog: missing PID for running run' WHERE id='$(sql_escape "$run_id")';" \
        >/dev/null 2>&1 || true
      [ -n "$task_id" ] && tx reset "$task_id" >/dev/null 2>&1 || true
      log "Reconciled run=$run_id (missing pid)"
      continue
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
      sqlite3 "$DB_PATH" \
        "UPDATE runs SET status='cancelled', ended_at=datetime('now'), exit_code=137, error_message='Watchdog: process not alive' WHERE id='$(sql_escape "$run_id")';" \
        >/dev/null 2>&1 || true
      [ -n "$task_id" ] && tx reset "$task_id" >/dev/null 2>&1 || true
      log "Reconciled run=$run_id (dead pid=$pid)"
      continue
    fi

    if [ "$age" -gt "$RUN_STALE_SECONDS" ]; then
      log "Stale run detected run=$run_id pid=$pid age=${age}s; terminating"
      terminate_pid_tree "$pid" TERM
      sleep 2
      if kill -0 "$pid" 2>/dev/null; then
        terminate_pid_tree "$pid" KILL
      fi
      sqlite3 "$DB_PATH" \
        "UPDATE runs SET status='cancelled', ended_at=datetime('now'), exit_code=137, error_message='Watchdog: stale running run killed (age ${age}s)' WHERE id='$(sql_escape "$run_id")';" \
        >/dev/null 2>&1 || true
      [ -n "$task_id" ] && tx reset "$task_id" >/dev/null 2>&1 || true
    fi
  done <<< "$rows"
}

reset_orphaned_active_tasks() {
  local tasks=""
  tasks=$(sqlite3 "$DB_PATH" \
    "SELECT t.id
     FROM tasks t
     WHERE t.status='active'
       AND NOT EXISTS (
         SELECT 1
         FROM runs r
         WHERE r.task_id=t.id
           AND r.status='running'
       );" 2>/dev/null || echo "")

  [ -z "$tasks" ] && return

  local count=0
  while IFS= read -r task_id; do
    [ -z "$task_id" ] && continue
    tx reset "$task_id" >/dev/null 2>&1 || true
    count=$((count + 1))
  done <<< "$tasks"

  if [ "$count" -gt 0 ]; then
    log "Reset $count orphaned active task(s)"
  fi
}

check_error_burst_for_worker() {
  local runtime="$1"
  local prefix="$2"
  local enabled="$3"

  if [ "$enabled" != true ]; then
    return
  fi

  local worker="${prefix}-main"
  local count="0"
  count=$(sqlite3 "$DB_PATH" \
    "SELECT COUNT(*)
     FROM runs
     WHERE status IN ('failed', 'cancelled')
       AND started_at >= datetime('now', '-${ERROR_BURST_WINDOW_MINUTES} minutes')
       AND json_extract(metadata, '$.worker') = '$(sql_escape "$worker")';" 2>/dev/null || echo "0")

  if [ "$count" -ge "$ERROR_BURST_THRESHOLD" ]; then
    local worker_running_count="0"
    worker_running_count=$(sqlite3 "$DB_PATH" \
      "SELECT COUNT(*)
       FROM runs
       WHERE status = 'running'
         AND json_extract(metadata, '$.worker') = '$(sql_escape "$worker")';" 2>/dev/null || echo "0")

    if [ "$worker_running_count" -gt 0 ]; then
      log "Error burst detected runtime=$runtime prefix=$prefix count=$count but worker has active run; skipping restart"
      return
    fi

    restart_with_cooldown "$runtime" "$prefix" "error-burst count=${count} window=${ERROR_BURST_WINDOW_MINUTES}m"
  fi
}

acquire_watchdog_lock
trap 'release_watchdog_lock' EXIT INT TERM

log "Watchdog started interval=${POLL_SECONDS}s codex=${CODEX_ENABLED} claude=${CLAUDE_ENABLED} auto_start=${AUTO_START} idle_rounds=${IDLE_ROUNDS}"

while true; do
  ensure_loop "codex" "$CODEX_PREFIX" "$CODEX_ENABLED"
  ensure_loop "claude" "$CLAUDE_PREFIX" "$CLAUDE_ENABLED"

  reconcile_running_runs
  reset_orphaned_active_tasks

  check_error_burst_for_worker "codex" "$CODEX_PREFIX" "$CODEX_ENABLED"
  check_error_burst_for_worker "claude" "$CLAUDE_PREFIX" "$CLAUDE_ENABLED"

  local_running="0"
  local_running=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM runs WHERE status='running';" 2>/dev/null || echo "0")
  log "Health check complete running_runs=$local_running"

  if [ "$RUN_ONCE" = true ]; then
    break
  fi

  sleep "$POLL_SECONDS"
done

log "Watchdog exiting"
