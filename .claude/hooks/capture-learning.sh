#!/bin/bash
# .claude/hooks/capture-learning.sh
# Prompt Claude to capture learnings when stopping
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

# Check if there's a current task context
TASK_FILE="$PROJECT_DIR/.tx/current-task"

if [ -f "$TASK_FILE" ]; then
  TASK_ID=$(cat "$TASK_FILE")

  if [ -n "$TASK_ID" ]; then
    # Output JSON to make Claude continue and capture learnings
    cat << EOF
{
  "decision": "block",
  "reason": "Before finishing, please consider capturing any learnings from this session.\n\nIf you learned something useful that would help with similar tasks in the future, run:\n\n  tx learning:add \"your learning here\" --source-ref $TASK_ID\n\nIf no new learnings to capture, you can proceed to finish."
}
EOF

    # Clean up task file after prompting
    rm -f "$TASK_FILE"
  fi
else
  exit 0
fi
