#!/bin/bash
# .claude/hooks/stop-check-tests.sh
# Block stop if tests haven't been run during this session
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

# Check if tests have been run this session
TESTS_RAN_FILE="$PROJECT_DIR/.tx/session-tests-ran"

if [ -f "$TESTS_RAN_FILE" ]; then
  # Tests have been run, check if they passed
  TESTS_PASSED=$(cat "$TESTS_RAN_FILE" 2>/dev/null || echo "false")

  if [ "$TESTS_PASSED" = "true" ]; then
    exit 0
  else
    cat << EOF
{
  "decision": "block",
  "reason": "Tests were run but failed. Please fix the failing tests before finishing.\n\nRun \`npx vitest --run\` to see failures."
}
EOF
    exit 0
  fi
fi

# Tests haven't been run
cat << EOF
{
  "decision": "block",
  "reason": "Tests have not been run during this session.\n\nBefore finishing, please run:\n\n  npx vitest --run\n\nThis ensures no regressions were introduced."
}
EOF

exit 0
