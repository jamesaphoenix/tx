#!/bin/bash
# .claude/hooks/post-bash.sh
# Track when working on a task to enable learning capture
# Hook: PostToolUse (Bash)

set -e

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Read input from stdin
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Detect tx show or tx done commands that indicate task context
if echo "$COMMAND" | grep -qE '^tx (show|done) tx-[a-z0-9]+'; then
  TASK_ID=$(echo "$COMMAND" | grep -oE 'tx-[a-z0-9]{6,8}' || true)
  if [ -n "$TASK_ID" ]; then
    mkdir -p "$PROJECT_DIR/.tx"
    echo "$TASK_ID" > "$PROJECT_DIR/.tx/current-task"
  fi
fi

exit 0
