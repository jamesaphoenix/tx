#!/bin/bash
# .claude/hooks/post-test-failure.sh
# Auto-create tx task when tests fail in autonomous RALPH mode
# Hook: PostToolUse (Bash) - called from post-bash.sh

set -e

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Read input from stdin (passed from post-bash.sh)
# Expected: { "command": "...", "exit_code": N, "output": "..." }
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.command // empty')
EXIT_CODE=$(echo "$INPUT" | jq -r '.exit_code // 0')
OUTPUT=$(echo "$INPUT" | jq -r '.output // empty')

# Only process if tests failed
if [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

# Check if tx is available
if ! command -v tx &> /dev/null; then
  exit 0
fi

# Check if we're in RALPH autonomous mode (indicated by RALPH_MODE env var)
if [ "${RALPH_MODE:-}" != "true" ]; then
  # Not in RALPH mode, just provide context but don't auto-create task
  FAILED_TESTS=""

  # Extract failed test names from vitest output
  if echo "$OUTPUT" | grep -qE '(FAIL|FAILED|Error:)'; then
    FAILED_TESTS=$(echo "$OUTPUT" | grep -E '^\s*(FAIL|×)' | head -5 || true)
  fi

  if [ -n "$FAILED_TESTS" ]; then
    ESCAPED=$(echo "$FAILED_TESTS" | jq -Rs '.')
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "## Test Failures Detected\n\nFailed tests:\n\`\`\`\n${ESCAPED:1:-1}\n\`\`\`\n\nFix these before proceeding."
  }
}
EOF
  fi
  exit 0
fi

# RALPH mode: auto-create task for test failures

# Get current task if one is active
CURRENT_TASK=""
if [ -f "$PROJECT_DIR/.tx/current-task" ]; then
  CURRENT_TASK=$(cat "$PROJECT_DIR/.tx/current-task")
fi

# Extract first failing test name for the task title
FIRST_FAILURE=$(echo "$OUTPUT" | grep -E '(FAIL|×)' | head -1 | sed 's/^[[:space:]]*//' || echo "Test failure")

# Truncate to reasonable length
FIRST_FAILURE=$(echo "$FIRST_FAILURE" | head -c 80)

# Create remediation task
if [ -n "$CURRENT_TASK" ]; then
  # Create as subtask of current task
  TASK_OUTPUT=$(tx add "Fix: $FIRST_FAILURE" --parent "$CURRENT_TASK" --score 900 --json 2>/dev/null || echo "")
else
  # Create standalone task
  TASK_OUTPUT=$(tx add "Fix: $FIRST_FAILURE" --score 900 --json 2>/dev/null || echo "")
fi

NEW_TASK_ID=""
if [ -n "$TASK_OUTPUT" ]; then
  NEW_TASK_ID=$(echo "$TASK_OUTPUT" | jq -r '.id // empty' 2>/dev/null || true)
fi

# Record that we created a fix task
if [ -n "$NEW_TASK_ID" ]; then
  mkdir -p "$PROJECT_DIR/.tx"
  echo "$NEW_TASK_ID" >> "$PROJECT_DIR/.tx/pending-fixes"

  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "## Auto-created Fix Task\n\nTest failure detected. Created task: $NEW_TASK_ID\n\nRun \`tx show $NEW_TASK_ID\` to see details.\n\nYou should fix this before proceeding with the original task."
  }
}
EOF
else
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "## Test Failures Detected\n\nFailed to auto-create fix task. Please fix the tests manually before proceeding."
  }
}
EOF
fi

exit 0
