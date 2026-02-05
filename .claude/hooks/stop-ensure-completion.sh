#!/bin/bash
# .claude/hooks/stop-ensure-completion.sh
# Comprehensive Stop hook to ensure task completion before RALPH exits
# This is the primary guardrail for autonomous agent completion
# Hook: Stop
#
# Checks:
# 1. Assigned tx task is marked done
# 2. Tests have been run and passed
# 3. No uncommitted changes that should be committed
# 4. No blocking errors detected

set -e

# Load shared artifact utilities
source "$(dirname "$0")/hooks-common.sh"

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

# Track all failures to provide comprehensive feedback
FAILURES=""

# ============================================
# Check 1: Task Completion
# ============================================
check_task_completion() {
  # Check if tx is available
  if ! tx_available; then
    return 0
  fi

  TASK_FILE="$PROJECT_DIR/.tx/current-task"

  if [ ! -f "$TASK_FILE" ]; then
    # No assigned task, skip this check
    return 0
  fi

  TASK_ID=$(cat "$TASK_FILE")

  if [ -z "$TASK_ID" ]; then
    return 0
  fi

  # Check task status
  TASK_STATUS=$(tx_cmd show "$TASK_ID" --json 2>/dev/null | jq -r '.status // empty' || true)

  if [ -z "$TASK_STATUS" ]; then
    # Task not found, might have been deleted - clean up
    rm -f "$TASK_FILE"
    return 0
  fi

  if [ "$TASK_STATUS" = "done" ]; then
    # Task is done, clean up tracking file
    rm -f "$TASK_FILE"
    return 0
  fi

  # Task is not done
  FAILURES="${FAILURES}TASK_NOT_DONE:$TASK_ID:$TASK_STATUS "
}

# ============================================
# Check 2: Tests Passed
# ============================================
check_tests_passed() {
  TESTS_RAN_FILE="$PROJECT_DIR/.tx/session-tests-ran"

  if [ ! -f "$TESTS_RAN_FILE" ]; then
    # Tests haven't been run this session
    FAILURES="${FAILURES}TESTS_NOT_RUN "
    return 0
  fi

  TESTS_PASSED=$(cat "$TESTS_RAN_FILE" 2>/dev/null || echo "false")

  if [ "$TESTS_PASSED" != "true" ]; then
    FAILURES="${FAILURES}TESTS_FAILED "
  fi
}

# ============================================
# Check 3: No Uncommitted Changes
# ============================================
check_uncommitted_changes() {
  # Check if we're in a git repository
  if ! git -C "$PROJECT_DIR" rev-parse --git-dir &>/dev/null; then
    return 0
  fi

  # Get git status
  GIT_STATUS=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null || true)

  if [ -z "$GIT_STATUS" ]; then
    # No changes, all good
    return 0
  fi

  # Count modified/added files (excluding untracked that might be intentional)
  TRACKED_CHANGES=$(echo "$GIT_STATUS" | grep -E '^[MADRC ]' | wc -l | tr -d ' ')

  if [ "$TRACKED_CHANGES" -gt 0 ]; then
    # There are uncommitted changes to tracked files
    FAILURES="${FAILURES}UNCOMMITTED_CHANGES:$TRACKED_CHANGES "
  fi
}

# ============================================
# Check 4: Build Success (optional check)
# ============================================
check_build_success() {
  BUILD_RAN_FILE="$PROJECT_DIR/.tx/session-build-ran"

  # If build was run and failed, that's a problem
  if [ -f "$BUILD_RAN_FILE" ]; then
    BUILD_PASSED=$(cat "$BUILD_RAN_FILE" 2>/dev/null || echo "true")
    if [ "$BUILD_PASSED" = "false" ]; then
      FAILURES="${FAILURES}BUILD_FAILED "
    fi
  fi
}

# ============================================
# Check 5: Coverage Threshold (optional check)
# ============================================
check_coverage() {
  # Coverage threshold (can be overridden via env var)
  local COVERAGE_THRESHOLD="${RALPH_COVERAGE_THRESHOLD:-70}"

  # Check if coverage report exists
  local COVERAGE_FILE="$PROJECT_DIR/coverage/coverage-summary.json"

  if [ ! -f "$COVERAGE_FILE" ]; then
    # No coverage report — that's fine, coverage is optional
    return 0
  fi

  # Parse coverage from vitest coverage summary
  local LINES_PCT STATEMENTS_PCT FUNCTIONS_PCT BRANCHES_PCT
  LINES_PCT=$(jq -r '.total.lines.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")
  STATEMENTS_PCT=$(jq -r '.total.statements.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")
  FUNCTIONS_PCT=$(jq -r '.total.functions.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")
  BRANCHES_PCT=$(jq -r '.total.branches.pct // 0' "$COVERAGE_FILE" 2>/dev/null || echo "0")

  # Check if any metric is below threshold
  local BELOW=""
  if (( $(echo "$LINES_PCT < $COVERAGE_THRESHOLD" | bc -l 2>/dev/null || echo "0") )); then
    BELOW="${BELOW}Lines: ${LINES_PCT}%, "
  fi
  if (( $(echo "$STATEMENTS_PCT < $COVERAGE_THRESHOLD" | bc -l 2>/dev/null || echo "0") )); then
    BELOW="${BELOW}Statements: ${STATEMENTS_PCT}%, "
  fi
  if (( $(echo "$FUNCTIONS_PCT < $COVERAGE_THRESHOLD" | bc -l 2>/dev/null || echo "0") )); then
    BELOW="${BELOW}Functions: ${FUNCTIONS_PCT}%, "
  fi
  if (( $(echo "$BRANCHES_PCT < $COVERAGE_THRESHOLD" | bc -l 2>/dev/null || echo "0") )); then
    BELOW="${BELOW}Branches: ${BRANCHES_PCT}%, "
  fi

  if [ -n "$BELOW" ]; then
    FAILURES="${FAILURES}COVERAGE_LOW:${COVERAGE_THRESHOLD}:${BELOW} "
  fi
}

# Run all checks
check_task_completion
check_tests_passed
check_uncommitted_changes
check_build_success
check_coverage

# Save artifact with check results (both pass and fail)
ARTIFACT=$(cat << ARTEOF
{
  "_meta": {
    "hook": "stop-ensure-completion",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "ralph_mode": "${RALPH_MODE:-false}"
  },
  "failures": "$(echo "$FAILURES" | tr -s ' ')",
  "passed": $([ -z "$FAILURES" ] && echo "true" || echo "false")
}
ARTEOF
)
save_hook_artifact "stop-ensure-completion" "$ARTIFACT"

# If no failures, allow exit
if [ -z "$FAILURES" ]; then
  exit 0
fi

# ============================================
# Build Comprehensive Error Message
# ============================================
build_error_message() {
  local REASON=""
  local FIRST=true

  for FAILURE in $FAILURES; do
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      REASON="$REASON\n\n---\n\n"
    fi

    case "$FAILURE" in
      TASK_NOT_DONE:*)
        TASK_ID=$(echo "$FAILURE" | cut -d: -f2)
        TASK_STATUS=$(echo "$FAILURE" | cut -d: -f3)
        REASON="${REASON}## Task Not Complete\n\nYour assigned task (\`$TASK_ID\`) is not marked as done.\n\nCurrent status: \`$TASK_STATUS\`\n\nTo complete the task:\n\`\`\`bash\ntx done $TASK_ID\n\`\`\`\n\nIf blocked, update the status:\n\`\`\`bash\ntx update $TASK_ID --status blocked\n\`\`\`"
        ;;
      TESTS_NOT_RUN)
        REASON="${REASON}## Tests Not Run\n\nTests have not been run during this session.\n\nBefore finishing, run:\n\`\`\`bash\nnpx vitest --run\n\`\`\`"
        ;;
      TESTS_FAILED)
        REASON="${REASON}## Tests Failed\n\nTests were run but failed.\n\nFix failing tests before finishing:\n\`\`\`bash\nnpx vitest --run\n\`\`\`"
        ;;
      UNCOMMITTED_CHANGES:*)
        COUNT=$(echo "$FAILURE" | cut -d: -f2)
        REASON="${REASON}## Uncommitted Changes\n\nThere are $COUNT uncommitted changes in the repository.\n\nReview and commit your changes:\n\`\`\`bash\ngit status\ngit add -A && git commit -m \"Complete task implementation\"\n\`\`\`\n\nOr if changes should not be committed, explicitly discard them."
        ;;
      BUILD_FAILED)
        REASON="${REASON}## Build Failed\n\nThe build failed during this session.\n\nFix build errors before finishing:\n\`\`\`bash\nnpm run build\n\`\`\`"
        ;;
      COVERAGE_LOW:*)
        local THRESHOLD=$(echo "$FAILURE" | cut -d: -f2)
        local DETAILS=$(echo "$FAILURE" | cut -d: -f3-)
        REASON="${REASON}## Coverage Below Threshold\n\nCoverage is below the ${THRESHOLD}% threshold:\n${DETAILS}\n\nAdd tests to improve coverage before finishing."
        ;;
    esac
  done

  echo "$REASON"
}

ERROR_MESSAGE=$(build_error_message)

# Output blocking response
cat << EOF
{
  "decision": "block",
  "reason": "$(echo "$ERROR_MESSAGE" | jq -Rs '.' | sed 's/^"//;s/"$//')"
}
EOF

exit 0
