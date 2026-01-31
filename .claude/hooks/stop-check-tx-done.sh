#!/bin/bash
# .claude/hooks/stop-check-tx-done.sh
# Block stop if assigned tx task is not marked done
# Hook: Stop

set -e

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Read input from stdin
INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

# Avoid infinite loop - if we're already in a stop hook, exit
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

# Only enforce in RALPH autonomous mode
if [ "${RALPH_MODE:-}" != "true" ]; then
  exit 0
fi

# Check if tx is available
if ! command -v tx &> /dev/null; then
  exit 0
fi

# Get current task
TASK_FILE="$PROJECT_DIR/.tx/current-task"

if [ ! -f "$TASK_FILE" ]; then
  # No assigned task, allow exit
  exit 0
fi

TASK_ID=$(cat "$TASK_FILE")

if [ -z "$TASK_ID" ]; then
  exit 0
fi

# Check task status
TASK_STATUS=$(tx show "$TASK_ID" --json 2>/dev/null | jq -r '.status // empty' || true)

if [ -z "$TASK_STATUS" ]; then
  # Task not found, allow exit (might have been deleted)
  rm -f "$TASK_FILE"
  exit 0
fi

if [ "$TASK_STATUS" = "done" ]; then
  # Task is done, clean up and allow exit
  rm -f "$TASK_FILE"
  exit 0
fi

# Task is not done
cat << EOF
{
  "decision": "block",
  "reason": "Your assigned task ($TASK_ID) is not marked as done.\n\nCurrent status: $TASK_STATUS\n\nIf the task is complete, run:\n\n  tx done $TASK_ID\n\nIf you're blocked, update the status:\n\n  tx update $TASK_ID --status blocked"
}
EOF

exit 0
