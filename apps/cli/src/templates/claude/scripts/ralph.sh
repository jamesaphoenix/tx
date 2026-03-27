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
#   ./scripts/ralph.sh --all-tasks      # Run against the full repo queue (default)
#   ./scripts/ralph.sh --design-doc core-auth-design  # Scope to tasks linked to one design doc
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
LOCK_OWNED=false
TASK_SCOPE_MODE=${TASK_SCOPE_MODE:-all}
DESIGN_DOC_SCOPE="${DESIGN_DOC_SCOPE:-}"

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --max) MAX_ITERATIONS="$2"; shift 2 ;;
    --max-hours) MAX_HOURS="$2"; shift 2 ;;
    --scope) TASK_SCOPE_MODE="$2"; shift 2 ;;
    --design-doc) TASK_SCOPE_MODE="design-doc"; DESIGN_DOC_SCOPE="$2"; shift 2 ;;
    --all-tasks) TASK_SCOPE_MODE="all"; DESIGN_DOC_SCOPE=""; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

case "$TASK_SCOPE_MODE" in
  all|design-doc) ;;
  *)
    echo "Invalid --scope value: $TASK_SCOPE_MODE (expected: all|design-doc)" >&2
    exit 1
    ;;
esac

if [ "$TASK_SCOPE_MODE" = "design-doc" ] && [ -z "$DESIGN_DOC_SCOPE" ]; then
  echo "Missing design doc name: use --design-doc <name> or set DESIGN_DOC_SCOPE with --scope design-doc" >&2
  exit 1
fi

MAX_SECONDS=$((MAX_HOURS * 3600))
START_TIME=$(date +%s)

cd "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/.tx"

log() {
  local msg="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

scope_label() {
  if [ "$TASK_SCOPE_MODE" = "design-doc" ]; then
    printf 'design-doc:%s' "$DESIGN_DOC_SCOPE"
  else
    printf 'all-tasks'
  fi
}

# Lock file to prevent multiple instances
is_numeric_pid() {
  local pid="$1"
  [ -n "$pid" ] && [[ "$pid" =~ ^[0-9]+$ ]]
}

pid_is_live() {
  local pid="$1"
  is_numeric_pid "$pid" || return 1
  kill -0 "$pid" 2>/dev/null
}

read_pid_file() {
  local file_path="$1"
  local pid=""

  if [ ! -f "$file_path" ]; then
    echo ""
    return
  fi

  pid=$(cat "$file_path" 2>/dev/null | tr -d '[:space:]')
  if is_numeric_pid "$pid"; then
    echo "$pid"
  else
    echo ""
  fi
}

acquire_main_lock() {
  local attempts=0
  local max_attempts=8

  while [ "$attempts" -lt "$max_attempts" ]; do
    if ( set -o noclobber; printf '%s\n' "$$" > "$LOCK_FILE" ) 2>/dev/null; then
      LOCK_OWNED=true
      return 0
    fi

    local lock_pid=""
    lock_pid=$(read_pid_file "$LOCK_FILE")
    if pid_is_live "$lock_pid"; then
      echo "RALPH already running (PID $lock_pid). Exiting."
      return 1
    fi

    # Race-safe stale cleanup: remove only if contents are still what we observed.
    local latest_pid=""
    latest_pid=$(read_pid_file "$LOCK_FILE")
    if [ "$latest_pid" = "$lock_pid" ]; then
      rm -f "$LOCK_FILE" 2>/dev/null || true
    fi

    attempts=$((attempts + 1))
    sleep 0.02
  done

  local final_pid=""
  final_pid=$(read_pid_file "$LOCK_FILE")
  if pid_is_live "$final_pid"; then
    echo "RALPH already running (PID $final_pid). Exiting."
  else
    echo "Unable to acquire RALPH lock after retries. Exiting."
  fi
  return 1
}

remove_owned_lock_file() {
  local file_path="$1"
  if [ ! -f "$file_path" ]; then
    return 0
  fi

  local owner_pid=""
  owner_pid=$(read_pid_file "$file_path")
  if [ "$owner_pid" = "$$" ]; then
    rm -f "$file_path"
  fi
}

CURRENT_TASK_ID=""

cleanup() {
  if [ "$LOCK_OWNED" = true ]; then
    remove_owned_lock_file "$LOCK_FILE"
    LOCK_OWNED=false
  fi
  if [ -n "${CURRENT_TASK_ID:-}" ]; then
    tx reset "$CURRENT_TASK_ID" 2>/dev/null || true
  fi
  log "RALPH shutdown"
}

trap cleanup EXIT INT TERM HUP
acquire_main_lock || exit 1

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

capture_current_task_payload() {
  local task_id="$1"
  local output_path="$2"

  if ! tx show "$task_id" --json > "$output_path" 2>/dev/null; then
    printf '{}\n' > "$output_path"
  fi
}

filter_tasks_for_scope() {
  local input_path="$1"
  local output_path="$2"

  if [ "$TASK_SCOPE_MODE" = "all" ]; then
    cp "$input_path" "$output_path"
    return 0
  fi

  if ! jq --arg doc "$DESIGN_DOC_SCOPE" '
    map(select(any(.linkedDocs[]?; .kind == "design" and .name == $doc)))
  ' "$input_path" > "$output_path" 2>/dev/null; then
    printf '[]\n' > "$output_path"
    return 1
  fi

  return 0
}

capture_all_tasks_payload() {
  local output_path="$1"
  local raw_output_path="${output_path}.raw"

  if ! tx list --json > "$raw_output_path" 2>/dev/null; then
    printf '[]\n' > "$output_path"
    rm -f "$raw_output_path"
    return 0
  fi

  filter_tasks_for_scope "$raw_output_path" "$output_path" || true
  rm -f "$raw_output_path"
}

capture_ready_queue_payload() {
  if [ "$TASK_SCOPE_MODE" = "design-doc" ]; then
    tx ready --json 2>/dev/null || echo "[]"
  else
    tx ready --json --limit 1 2>/dev/null || echo "[]"
  fi
}

select_task_from_ready_queue() {
  local ready_json="$1"

  if [ "$TASK_SCOPE_MODE" = "design-doc" ]; then
    echo "$ready_json" | jq --arg doc "$DESIGN_DOC_SCOPE" '
      [ .[] | select(any(.linkedDocs[]?; .kind == "design" and .name == $doc)) ][0] // empty
    ' 2>/dev/null
  else
    echo "$ready_json" | jq '.[0] // empty' 2>/dev/null
  fi
}

capture_linked_design_docs() {
  local task_payload_path="$1"
  local output_path="$2"
  local doc_names=""

  doc_names=$(jq -r '.linkedDocs[]? | select(.kind == "design") | .name' "$task_payload_path" 2>/dev/null || true)

  if [ -z "$doc_names" ]; then
    printf '_No linked design docs found for this task._\n' > "$output_path"
    return 0
  fi

  : > "$output_path"

  while IFS= read -r doc_name; do
    [ -z "$doc_name" ] && continue
    {
      printf '## %s\n\n' "$doc_name"
      if ! tx doc show "$doc_name" --md 2>/dev/null; then
        printf '_Failed to load linked design doc: %s._\n' "$doc_name"
      fi
      printf '\n'
    } >> "$output_path"
  done <<EOF
$doc_names
EOF

  if [ ! -s "$output_path" ]; then
    printf '_No linked design docs found for this task._\n' > "$output_path"
  fi
}

build_prompt_context_bundle() {
  local current_task_path="$1"
  local design_docs_path="$2"
  local all_tasks_path="$3"
  local output_path="$4"
  local scope_path="$5"

  {
    printf '===== BEGIN RALPH TASK SCOPE =====\n'
    cat "$scope_path"
    printf '\n===== END RALPH TASK SCOPE =====\n\n'

    printf '===== BEGIN CURRENT TASK PAYLOAD (JSON) =====\n'
    cat "$current_task_path"
    printf '\n===== END CURRENT TASK PAYLOAD (JSON) =====\n\n'

    printf '===== BEGIN LINKED DESIGN DOCS (MARKDOWN) =====\n'
    cat "$design_docs_path"
    printf '\n===== END LINKED DESIGN DOCS (MARKDOWN) =====\n\n'

    printf '===== BEGIN ALL TASKS (JSON) =====\n'
    cat "$all_tasks_path"
    printf '\n===== END ALL TASKS (JSON) =====\n'
  } > "$output_path"
}

log "========================================"
log "RALPH Loop Started"
log "========================================"
log "Project: $PROJECT_DIR"
log "Task scope: $(scope_label)"
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
  READY_JSON=$(capture_ready_queue_payload)
  TASK=$(select_task_from_ready_queue "$READY_JSON")
  TASK_ID=$(echo "$TASK" | jq -r '.id // empty' 2>/dev/null)

  if [ -z "$TASK_ID" ] || [ "$TASK_ID" = "null" ]; then
    log "No ready tasks in scope $(scope_label). All done."
    break
  fi

  TASK_TITLE=$(echo "$TASK" | jq -r '.title // "Unknown"' 2>/dev/null)
  log "Task: $TASK_ID — $TASK_TITLE"

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would dispatch $TASK_ID"
    continue
  fi

  # Mark active and track for cleanup
  CURRENT_TASK_ID="$TASK_ID"
  tx update "$TASK_ID" --status active 2>/dev/null || true

  PROMPT_ARTIFACT_DIR="$PROJECT_DIR/.tx/ralph-prompt"
  mkdir -p "$PROMPT_ARTIFACT_DIR"
  CURRENT_TASK_PATH="$PROMPT_ARTIFACT_DIR/current-task.json"
  ALL_TASKS_PATH="$PROMPT_ARTIFACT_DIR/all-tasks.json"
  DESIGN_DOCS_PATH="$PROMPT_ARTIFACT_DIR/linked-design-docs.md"
  PROMPT_CONTEXT_PATH="$PROMPT_ARTIFACT_DIR/prompt-context.txt"
  SCOPE_PATH="$PROMPT_ARTIFACT_DIR/task-scope.txt"
  TASK_SCOPE_LABEL=$(scope_label)

  printf '%s\n' "$TASK_SCOPE_LABEL" > "$SCOPE_PATH"
  capture_current_task_payload "$TASK_ID" "$CURRENT_TASK_PATH"
  capture_all_tasks_payload "$ALL_TASKS_PATH"
  capture_linked_design_docs "$CURRENT_TASK_PATH" "$DESIGN_DOCS_PATH"
  build_prompt_context_bundle "$CURRENT_TASK_PATH" "$DESIGN_DOCS_PATH" "$ALL_TASKS_PATH" "$PROMPT_CONTEXT_PATH" "$SCOPE_PATH"
  PROMPT_CONTEXT=$(cat "$PROMPT_CONTEXT_PATH" 2>/dev/null || echo "")

  # Fetch context
  CONTEXT=$(tx memory context "$TASK_ID" 2>/dev/null || echo "")
  CONTEXT_BLOCK=""
  if [ -n "$CONTEXT" ]; then
    CONTEXT_BLOCK="

## Relevant Learnings
$CONTEXT
"
  fi

  # Dispatch to Claude
  PROMPT="Your task ID is: $TASK_ID
Task scope: $TASK_SCOPE_LABEL
$CONTEXT_BLOCK
You are given direct working context below. Read it before changing code:

$PROMPT_CONTEXT

Run \`tx show $TASK_ID\` to see full details, then implement the task.
When complete, run \`tx done $TASK_ID\` to mark it done.
If you discover new work, create follow-up tasks with \`tx add \"title\"\` and subtasks with \`tx add \"title\" --parent $TASK_ID\`.
If dependencies need to change, use \`tx dep block\` and \`tx dep unblock\`.
If the queue needs reordering, update scores with \`tx update <id> --score <n>\` or \`tx bulk score <n> <id...>\`.
If a non-trivial task needs specs, prefer a paired PRD/design doc: attach the PRD with \`tx doc attach $TASK_ID <prd-doc> --type implements\` and the design doc with \`tx doc attach $TASK_ID <design-doc> --type references\`.
If one half of the PRD/design pair is missing, create follow-up docs work or block the task before large implementation proceeds.
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
