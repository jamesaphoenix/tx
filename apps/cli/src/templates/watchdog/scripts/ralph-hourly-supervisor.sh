#!/bin/bash
# ralph-hourly-supervisor.sh — time-boxed health supervisor for RALPH loops.
#
# Purpose:
# - Poll queue/run health on a fixed cadence (default: every 10 minutes)
# - Reap stalled runs via tx primitive
# - Ensure watchdog stays alive
# - Recover from deadlocks (ready tasks with zero running runs)
#
# Usage:
#   ./scripts/ralph-hourly-supervisor.sh
#   ./scripts/ralph-hourly-supervisor.sh --duration-seconds 3600 --interval-seconds 600

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="$PROJECT_DIR/.tx/tasks.db"
LOG_FILE="$PROJECT_DIR/.tx/ralph-hourly-supervisor.log"
PID_FILE="$PROJECT_DIR/.tx/ralph-hourly-supervisor.pid"
WATCHDOG_PID_FILE="$PROJECT_DIR/.tx/ralph-watchdog.pid"
WATCHDOG_OUT="$PROJECT_DIR/.tx/ralph-watchdog.daemon.out"

DURATION_SECONDS=${DURATION_SECONDS:-3600}
INTERVAL_SECONDS=${INTERVAL_SECONDS:-600}
WATCHDOG_INTERVAL_SECONDS=${WATCHDOG_INTERVAL_SECONDS:-300}
TRANSCRIPT_IDLE_SECONDS=${TRANSCRIPT_IDLE_SECONDS:-600}
CLAUDE_STALL_GRACE_SECONDS=${CLAUDE_STALL_GRACE_SECONDS:-900}
HEARTBEAT_LAG_SECONDS=${HEARTBEAT_LAG_SECONDS:-180}
RUN_STALE_SECONDS=${RUN_STALE_SECONDS:-5400}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration-seconds) DURATION_SECONDS="$2"; shift 2 ;;
    --interval-seconds) INTERVAL_SECONDS="$2"; shift 2 ;;
    --watchdog-interval-seconds) WATCHDOG_INTERVAL_SECONDS="$2"; shift 2 ;;
    --transcript-idle-seconds) TRANSCRIPT_IDLE_SECONDS="$2"; shift 2 ;;
    --claude-stall-grace-seconds) CLAUDE_STALL_GRACE_SECONDS="$2"; shift 2 ;;
    --heartbeat-lag-seconds) HEARTBEAT_LAG_SECONDS="$2"; shift 2 ;;
    --run-stale-seconds) RUN_STALE_SECONDS="$2"; shift 2 ;;
    --log-file) LOG_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

is_positive_int() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -gt 0 ]
}

if ! is_positive_int "$DURATION_SECONDS"; then
  echo "Invalid --duration-seconds value: $DURATION_SECONDS" >&2
  exit 1
fi

if ! is_positive_int "$INTERVAL_SECONDS"; then
  echo "Invalid --interval-seconds value: $INTERVAL_SECONDS" >&2
  exit 1
fi

if ! is_positive_int "$WATCHDOG_INTERVAL_SECONDS"; then
  echo "Invalid --watchdog-interval-seconds value: $WATCHDOG_INTERVAL_SECONDS" >&2
  exit 1
fi

if ! is_positive_int "$TRANSCRIPT_IDLE_SECONDS"; then
  echo "Invalid --transcript-idle-seconds value: $TRANSCRIPT_IDLE_SECONDS" >&2
  exit 1
fi

if ! [[ "$CLAUDE_STALL_GRACE_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Invalid --claude-stall-grace-seconds value: $CLAUDE_STALL_GRACE_SECONDS" >&2
  exit 1
fi

if ! is_positive_int "$HEARTBEAT_LAG_SECONDS"; then
  echo "Invalid --heartbeat-lag-seconds value: $HEARTBEAT_LAG_SECONDS" >&2
  exit 1
fi

if ! is_positive_int "$RUN_STALE_SECONDS"; then
  echo "Invalid --run-stale-seconds value: $RUN_STALE_SECONDS" >&2
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/.tx"

log() {
  local msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

tx() {
  bun "$PROJECT_DIR/apps/cli/src/cli.ts" "$@"
}

pid_is_live() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

command_for_pid() {
  local pid="$1"
  /bin/ps -p "$pid" -o command= 2>/dev/null || true
}

watchdog_pid() {
  if [ ! -f "$WATCHDOG_PID_FILE" ]; then
    return 1
  fi
  local pid=""
  pid=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)
  [ -n "$pid" ] || return 1
  printf '%s' "$pid"
}

watchdog_is_live() {
  local pid=""
  local cmd=""
  pid=$(watchdog_pid 2>/dev/null || true)
  pid_is_live "$pid" || return 1
  cmd=$(command_for_pid "$pid")
  [ -n "$cmd" ] || return 1
  echo "$cmd" | grep -q "ralph-watchdog.sh"
}

start_watchdog() {
  nohup /bin/bash "$PROJECT_DIR/scripts/ralph-watchdog.sh" \
    --interval "$WATCHDOG_INTERVAL_SECONDS" \
    --transcript-idle-seconds "$TRANSCRIPT_IDLE_SECONDS" \
    --claude-stall-grace-seconds "$CLAUDE_STALL_GRACE_SECONDS" \
    --heartbeat-lag-seconds "$HEARTBEAT_LAG_SECONDS" \
    --run-stale-seconds "$RUN_STALE_SECONDS" \
    > "$WATCHDOG_OUT" 2>&1 < /dev/null &

  /bin/sleep 2

  if watchdog_is_live; then
    local pid=""
    pid=$(watchdog_pid)
    log "Watchdog started (pid=$pid)"
  else
    log "ERROR: watchdog failed to start"
  fi
}

ensure_watchdog() {
  if watchdog_is_live; then
    return
  fi
  log "Watchdog not running; starting"
  start_watchdog
}

count_scalar() {
  local sql="$1"
  sqlite3 "$DB_PATH" "$sql" 2>/dev/null || echo "0"
}

reap_stalled_runs() {
  local output="[]"
  output=$(tx trace stalled --reap --json \
    --transcript-idle-seconds "$TRANSCRIPT_IDLE_SECONDS" \
    --heartbeat-lag-seconds "$HEARTBEAT_LAG_SECONDS" 2>/dev/null || echo "[]")

  local reaped="0"
  if command -v jq >/dev/null 2>&1; then
    reaped=$(echo "$output" | jq 'length' 2>/dev/null || echo "0")
  fi

  if [ "$reaped" -gt 0 ]; then
    log "Reaped $reaped stalled run(s)"
  fi
}

reset_orphaned_active_tasks_if_needed() {
  local running ready active
  running=$(count_scalar "SELECT COUNT(*) FROM runs WHERE status='running';")
  ready=$(count_scalar "SELECT COUNT(*) FROM tasks WHERE status='ready';")
  active=$(count_scalar "SELECT COUNT(*) FROM tasks WHERE status='active';")

  if [ "$running" -eq 0 ] && [ "$ready" -gt 0 ]; then
    log "Detected zero running runs with $ready ready task(s); forcing watchdog sweep"
    /bin/bash "$PROJECT_DIR/scripts/ralph-watchdog.sh" \
      --once \
      --interval "$WATCHDOG_INTERVAL_SECONDS" \
      --transcript-idle-seconds "$TRANSCRIPT_IDLE_SECONDS" \
      --claude-stall-grace-seconds "$CLAUDE_STALL_GRACE_SECONDS" \
      --heartbeat-lag-seconds "$HEARTBEAT_LAG_SECONDS" \
      --run-stale-seconds "$RUN_STALE_SECONDS" \
      >> "$LOG_FILE" 2>&1 || true
  fi

  if [ "$running" -eq 0 ] && [ "$active" -gt 0 ]; then
    log "Detected $active orphan active task(s); resetting to ready"
    local tasks=""
    tasks=$(sqlite3 "$DB_PATH" "SELECT id FROM tasks WHERE status='active';" 2>/dev/null || echo "")
    while IFS= read -r task_id; do
      [ -z "$task_id" ] && continue
      tx reset "$task_id" >/dev/null 2>&1 || true
    done <<< "$tasks"
  fi
}

snapshot_health() {
  local total ready active done running
  total=$(count_scalar "SELECT COUNT(*) FROM tasks;")
  ready=$(count_scalar "SELECT COUNT(*) FROM tasks WHERE status='ready';")
  active=$(count_scalar "SELECT COUNT(*) FROM tasks WHERE status='active';")
  done=$(count_scalar "SELECT COUNT(*) FROM tasks WHERE status='done';")
  running=$(count_scalar "SELECT COUNT(*) FROM runs WHERE status='running';")

  local watchdog_state="down"
  if watchdog_is_live; then
    watchdog_state="up"
  fi

  log "Health snapshot watchdog=$watchdog_state tasks(total=$total ready=$ready active=$active done=$done) running_runs=$running"
}

acquire_supervisor_lock() {
  if [ -f "$PID_FILE" ]; then
    local existing_pid=""
    existing_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if pid_is_live "$existing_pid"; then
      local cmd=""
      cmd=$(command_for_pid "$existing_pid")
      if echo "$cmd" | grep -q "ralph-hourly-supervisor.sh"; then
        log "Another hourly supervisor is running (pid=$existing_pid). Exiting."
        exit 0
      fi
    fi
    rm -f "$PID_FILE"
  fi
  echo "$$" > "$PID_FILE"
}

release_supervisor_lock() {
  if [ -f "$PID_FILE" ]; then
    local owner=""
    owner=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ "$owner" = "$$" ]; then
      rm -f "$PID_FILE"
    fi
  fi
}

acquire_supervisor_lock
trap 'release_supervisor_lock' EXIT INT TERM
trap 'log "Received SIGHUP (ignored)"' HUP

start_epoch=$(date +%s)
deadline=$((start_epoch + DURATION_SECONDS))
iteration=0

log "Hourly supervisor started duration=${DURATION_SECONDS}s interval=${INTERVAL_SECONDS}s watchdog_interval=${WATCHDOG_INTERVAL_SECONDS}s transcript_idle=${TRANSCRIPT_IDLE_SECONDS}s claude_grace=${CLAUDE_STALL_GRACE_SECONDS}s"

while true; do
  iteration=$((iteration + 1))
  log "Poll iteration=$iteration"

  ensure_watchdog
  reap_stalled_runs
  reset_orphaned_active_tasks_if_needed
  snapshot_health

  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    break
  fi

  /bin/sleep "$INTERVAL_SECONDS"
done

log "Hourly supervisor finished"
