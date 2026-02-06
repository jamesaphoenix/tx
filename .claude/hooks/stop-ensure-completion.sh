#!/bin/bash
# .claude/hooks/stop-ensure-completion.sh
# Observe-only Stop hook — logs session state as artifacts for debugging.
# NEVER blocks the agent from exiting. Agent instructions handle quality.
# Hook: Stop

source "$(dirname "$0")/hooks-common.sh"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Drain stdin (required by hook protocol)
cat > /dev/null

# Only collect data in RALPH mode
if [ "${RALPH_MODE:-}" != "true" ]; then
  exit 0
fi

# Collect session state for artifact (best-effort, never fail)
TASK_STATUS="unknown"
TASK_ID=""
if tx_available; then
  TASK_FILE="$PROJECT_DIR/.tx/current-task"
  if [ -f "$TASK_FILE" ]; then
    TASK_ID=$(cat "$TASK_FILE" 2>/dev/null || true)
    TASK_STATUS=$(tx_cmd show "$TASK_ID" --json 2>/dev/null | jq -r '.status // "unknown"' || echo "unknown")
    # Clean up if done
    [ "$TASK_STATUS" = "done" ] && rm -f "$TASK_FILE"
  fi
fi

TESTS_RAN=$(cat "$PROJECT_DIR/.tx/session-tests-ran" 2>/dev/null || echo "unknown")
UNCOMMITTED=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ' || echo "0")

save_hook_artifact "stop-ensure-completion" "$(cat <<ARTEOF
{
  "_meta": {
    "hook": "stop-ensure-completion",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "ralph_mode": "true"
  },
  "task_id": "$TASK_ID",
  "task_status": "$TASK_STATUS",
  "tests_passed": "$TESTS_RAN",
  "uncommitted_files": $UNCOMMITTED
}
ARTEOF
)"

# Always allow exit — never block
exit 0
