#!/bin/bash
# watchdog-launcher.sh - start/stop/status wrapper for ralph-watchdog.sh
#
# Defaults:
# - Loads .tx/watchdog.env
# - Starts detached when WATCHDOG_DETACHED=1
# - Validates runtime availability before launch

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.tx/watchdog.env"
WATCHDOG_SCRIPT="$PROJECT_DIR/scripts/ralph-watchdog.sh"
PID_FILE="$PROJECT_DIR/.tx/ralph-watchdog.pid"
OUT_FILE="$PROJECT_DIR/.tx/ralph-watchdog.daemon.out"

usage() {
  cat <<USAGE
Usage: ./scripts/watchdog-launcher.sh <start|stop|restart|status> [--foreground]
USAGE
}

require_file() {
  local path="$1"
  local label="$2"
  if [ ! -f "$path" ]; then
    echo "$label not found: $path" >&2
    exit 1
  fi
}

bool_or_default() {
  local value="$1"
  local default_value="$2"
  if [ -z "$value" ]; then
    printf '%s' "$default_value"
    return
  fi
  case "$value" in
    0|1) printf '%s' "$value" ;;
    *)
      echo "Invalid boolean value: $value (expected 0 or 1)" >&2
      exit 1
      ;;
  esac
}

int_or_default() {
  local key="$1"
  local value="$2"
  local default_value="$3"
  local min_value="$4"

  if [ -z "$value" ]; then
    printf '%s' "$default_value"
    return
  fi

  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt "$min_value" ]; then
    echo "Invalid $key value: $value (must be an integer >= $min_value)" >&2
    exit 1
  fi

  printf '%s' "$value"
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

pid_is_live() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

pid_is_watchdog() {
  local pid="$1"
  local cmd=""
  if ! pid_is_live "$pid"; then
    return 1
  fi
  cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
  [ -n "$cmd" ] || return 1
  echo "$cmd" | grep -q "ralph-watchdog.sh"
}

guard_runtime() {
  local missing=()

  if [ "$WATCHDOG_ENABLED" != "1" ]; then
    echo "Watchdog is disabled (WATCHDOG_ENABLED=0). Update $ENV_FILE to enable it." >&2
    exit 1
  fi

  if [ "$WATCHDOG_CODEX_ENABLED" = "0" ] && [ "$WATCHDOG_CLAUDE_ENABLED" = "0" ]; then
    echo "No watchdog runtimes enabled. Set WATCHDOG_CODEX_ENABLED=1 and/or WATCHDOG_CLAUDE_ENABLED=1 in $ENV_FILE." >&2
    exit 1
  fi

  if [ "$WATCHDOG_CODEX_ENABLED" = "1" ] && ! command -v codex >/dev/null 2>&1; then
    missing+=("codex")
  fi
  if [ "$WATCHDOG_CLAUDE_ENABLED" = "1" ] && ! command -v claude >/dev/null 2>&1; then
    missing+=("claude")
  fi

  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Configured watchdog runtime(s) unavailable in PATH: ${missing[*]}. Install missing runtime(s) or disable them in $ENV_FILE." >&2
    exit 1
  fi
}

build_args() {
  WATCHDOG_ARGS=(
    --interval "$WATCHDOG_POLL_SECONDS"
    --transcript-idle-seconds "$WATCHDOG_TRANSCRIPT_IDLE_SECONDS"
    --claude-stall-grace-seconds "$WATCHDOG_CLAUDE_STALL_GRACE_SECONDS"
    --heartbeat-lag-seconds "$WATCHDOG_HEARTBEAT_LAG_SECONDS"
    --run-stale-seconds "$WATCHDOG_RUN_STALE_SECONDS"
    --idle-rounds "$WATCHDOG_IDLE_ROUNDS"
    --error-window-minutes "$WATCHDOG_ERROR_BURST_WINDOW_MINUTES"
    --error-threshold "$WATCHDOG_ERROR_BURST_THRESHOLD"
    --error-burst-grace-seconds "$WATCHDOG_ERROR_BURST_GRACE_SECONDS"
    --restart-cooldown-seconds "$WATCHDOG_RESTART_COOLDOWN_SECONDS"
  )

  if [ "$WATCHDOG_CODEX_ENABLED" != "1" ]; then
    WATCHDOG_ARGS+=(--no-codex)
  fi
  if [ "$WATCHDOG_CLAUDE_ENABLED" != "1" ]; then
    WATCHDOG_ARGS+=(--no-claude)
  fi
}

start_watchdog() {
  local force_foreground="$1"

  mkdir -p "$PROJECT_DIR/.tx"

  if [ -f "$PID_FILE" ]; then
    local existing_pid=""
    existing_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if pid_is_watchdog "$existing_pid"; then
      echo "Watchdog already running (pid=$existing_pid)"
      return
    fi
    rm -f "$PID_FILE"
  fi

  guard_runtime
  build_args

  if [ "$force_foreground" = "1" ] || [ "$WATCHDOG_DETACHED" = "0" ]; then
    echo "Starting watchdog in foreground"
    exec /bin/bash "$WATCHDOG_SCRIPT" "${WATCHDOG_ARGS[@]}"
  fi

  trap '' HUP
  nohup /bin/bash "$WATCHDOG_SCRIPT" "${WATCHDOG_ARGS[@]}" > "$OUT_FILE" 2>&1 < /dev/null &

  /bin/sleep 1

  local pid=""
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if pid_is_watchdog "$pid"; then
    echo "Watchdog started (pid=$pid, out=$OUT_FILE)"
    return
  fi

  echo "Watchdog failed to start. Inspect $OUT_FILE for details." >&2
  exit 1
}

stop_watchdog() {
  if [ ! -f "$PID_FILE" ]; then
    echo "Watchdog is not running"
    return
  fi

  local pid=""
  pid=$(cat "$PID_FILE" 2>/dev/null || true)

  if ! pid_is_watchdog "$pid"; then
    rm -f "$PID_FILE"
    echo "Removed stale watchdog pid file"
    return
  fi

  kill "$pid" 2>/dev/null || true

  local attempts=0
  while pid_is_live "$pid" && [ "$attempts" -lt 10 ]; do
    /bin/sleep 1
    attempts=$((attempts + 1))
  done

  if pid_is_live "$pid"; then
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo "Watchdog stopped"
}

status_watchdog() {
  if [ ! -f "$PID_FILE" ]; then
    echo "Watchdog status: stopped"
    return
  fi

  local pid=""
  pid=$(cat "$PID_FILE" 2>/dev/null || true)

  if pid_is_watchdog "$pid"; then
    echo "Watchdog status: running (pid=$pid)"
    return
  fi

  echo "Watchdog status: stale pid file"
}

ACTION="${1:-}"
FOREGROUND=0

if [ -z "$ACTION" ]; then
  usage
  exit 1
fi

if [ "${2:-}" = "--foreground" ]; then
  FOREGROUND=1
elif [ -n "${2:-}" ]; then
  echo "Unknown option: $2" >&2
  usage
  exit 1
fi

if [ "$#" -gt 2 ]; then
  usage
  exit 1
fi

require_file "$ENV_FILE" "Watchdog env"
require_file "$WATCHDOG_SCRIPT" "Watchdog script"

load_env

WATCHDOG_ENABLED=$(bool_or_default "${WATCHDOG_ENABLED:-}" "0")
WATCHDOG_DETACHED=$(bool_or_default "${WATCHDOG_DETACHED:-}" "1")
WATCHDOG_CODEX_ENABLED=$(bool_or_default "${WATCHDOG_CODEX_ENABLED:-}" "0")
WATCHDOG_CLAUDE_ENABLED=$(bool_or_default "${WATCHDOG_CLAUDE_ENABLED:-}" "0")
WATCHDOG_POLL_SECONDS=$(int_or_default "WATCHDOG_POLL_SECONDS" "${WATCHDOG_POLL_SECONDS:-}" "300" "1")
WATCHDOG_TRANSCRIPT_IDLE_SECONDS=$(int_or_default "WATCHDOG_TRANSCRIPT_IDLE_SECONDS" "${WATCHDOG_TRANSCRIPT_IDLE_SECONDS:-}" "600" "60")
WATCHDOG_CLAUDE_STALL_GRACE_SECONDS=$(int_or_default "WATCHDOG_CLAUDE_STALL_GRACE_SECONDS" "${WATCHDOG_CLAUDE_STALL_GRACE_SECONDS:-}" "900" "0")
WATCHDOG_HEARTBEAT_LAG_SECONDS=$(int_or_default "WATCHDOG_HEARTBEAT_LAG_SECONDS" "${WATCHDOG_HEARTBEAT_LAG_SECONDS:-}" "180" "1")
WATCHDOG_RUN_STALE_SECONDS=$(int_or_default "WATCHDOG_RUN_STALE_SECONDS" "${WATCHDOG_RUN_STALE_SECONDS:-}" "5400" "60")
WATCHDOG_IDLE_ROUNDS=$(int_or_default "WATCHDOG_IDLE_ROUNDS" "${WATCHDOG_IDLE_ROUNDS:-}" "300" "1")
WATCHDOG_ERROR_BURST_WINDOW_MINUTES=$(int_or_default "WATCHDOG_ERROR_BURST_WINDOW_MINUTES" "${WATCHDOG_ERROR_BURST_WINDOW_MINUTES:-}" "20" "1")
WATCHDOG_ERROR_BURST_THRESHOLD=$(int_or_default "WATCHDOG_ERROR_BURST_THRESHOLD" "${WATCHDOG_ERROR_BURST_THRESHOLD:-}" "4" "1")
WATCHDOG_ERROR_BURST_GRACE_SECONDS=$(int_or_default "WATCHDOG_ERROR_BURST_GRACE_SECONDS" "${WATCHDOG_ERROR_BURST_GRACE_SECONDS:-}" "600" "1")
WATCHDOG_RESTART_COOLDOWN_SECONDS=$(int_or_default "WATCHDOG_RESTART_COOLDOWN_SECONDS" "${WATCHDOG_RESTART_COOLDOWN_SECONDS:-}" "900" "1")

case "$ACTION" in
  start)
    start_watchdog "$FOREGROUND"
    ;;
  stop)
    stop_watchdog
    ;;
  restart)
    stop_watchdog
    start_watchdog "$FOREGROUND"
    ;;
  status)
    status_watchdog
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage
    exit 1
    ;;
esac
