#!/bin/bash
# .claude/hooks/stop-check-coverage.sh
# Block stop if test coverage is below threshold
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

# Coverage threshold (can be overridden via env var)
COVERAGE_THRESHOLD="${RALPH_COVERAGE_THRESHOLD:-70}"

# Check if coverage report exists
COVERAGE_FILE="$PROJECT_DIR/coverage/coverage-summary.json"

if [ ! -f "$COVERAGE_FILE" ]; then
  # No coverage report, suggest running with coverage
  cat << EOF
{
  "decision": "block",
  "reason": "No coverage report found.\n\nBefore finishing, please run tests with coverage:\n\n  npx vitest --run --coverage\n\nMinimum coverage threshold: ${COVERAGE_THRESHOLD}%"
}
EOF
  exit 0
fi

# Parse coverage from vitest coverage summary
LINES_PCT=$(jq -r '.total.lines.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")
STATEMENTS_PCT=$(jq -r '.total.statements.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")
FUNCTIONS_PCT=$(jq -r '.total.functions.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")
BRANCHES_PCT=$(jq -r '.total.branches.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")

# Check if any metric is below threshold
BELOW_THRESHOLD=""
if (( $(echo "$LINES_PCT < $COVERAGE_THRESHOLD" | bc -l) )); then
  BELOW_THRESHOLD="$BELOW_THRESHOLD\n- Lines: ${LINES_PCT}% (threshold: ${COVERAGE_THRESHOLD}%)"
fi
if (( $(echo "$STATEMENTS_PCT < $COVERAGE_THRESHOLD" | bc -l) )); then
  BELOW_THRESHOLD="$BELOW_THRESHOLD\n- Statements: ${STATEMENTS_PCT}% (threshold: ${COVERAGE_THRESHOLD}%)"
fi
if (( $(echo "$FUNCTIONS_PCT < $COVERAGE_THRESHOLD" | bc -l) )); then
  BELOW_THRESHOLD="$BELOW_THRESHOLD\n- Functions: ${FUNCTIONS_PCT}% (threshold: ${COVERAGE_THRESHOLD}%)"
fi
if (( $(echo "$BRANCHES_PCT < $COVERAGE_THRESHOLD" | bc -l) )); then
  BELOW_THRESHOLD="$BELOW_THRESHOLD\n- Branches: ${BRANCHES_PCT}% (threshold: ${COVERAGE_THRESHOLD}%)"
fi

if [ -n "$BELOW_THRESHOLD" ]; then
  cat << EOF
{
  "decision": "block",
  "reason": "Coverage is below the ${COVERAGE_THRESHOLD}% threshold:${BELOW_THRESHOLD}\n\nPlease add tests to improve coverage before finishing."
}
EOF
  exit 0
fi

# Coverage is acceptable
exit 0
