#!/bin/bash
# .claude/hooks/post-bash.sh
# Dispatcher for Bash post-tool hooks
# Handles: task tracking, test/build failure detection, session state
# Hook: PostToolUse (Bash)

set -e

# Load shared artifact utilities
source "$(dirname "$0")/hooks-common.sh"

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
HOOKS_DIR="$PROJECT_DIR/.claude/hooks"

# Ensure .tx directory exists
mkdir -p "$PROJECT_DIR/.tx"

# Read input from stdin
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_output.stdout // empty')
EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_output.exit_code // 0')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# ============================================
# Task Context Tracking
# ============================================

# Detect tx show or tx done commands that indicate task context
if echo "$COMMAND" | grep -qE '^tx (show|done) tx-[a-z0-9]+'; then
  TASK_ID=$(echo "$COMMAND" | grep -oE 'tx-[a-z0-9]{6,8}' || true)
  if [ -n "$TASK_ID" ]; then
    echo "$TASK_ID" > "$PROJECT_DIR/.tx/current-task"
  fi
fi

# ============================================
# Test Command Detection
# ============================================

IS_TEST_COMMAND=false
if echo "$COMMAND" | grep -qE '(vitest|jest|mocha|pytest|go test|cargo test|npm test|npm run test)'; then
  IS_TEST_COMMAND=true
fi

if [ "$IS_TEST_COMMAND" = true ]; then
  # Record that tests have been run
  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "true" > "$PROJECT_DIR/.tx/session-tests-ran"
  else
    echo "false" > "$PROJECT_DIR/.tx/session-tests-ran"
  fi
fi

# ============================================
# Unified Failure Recovery Handler
# Handles: test failures, build failures, lint failures
# Provides actionable context with file:line info
# ============================================

if [ "$EXIT_CODE" -ne 0 ]; then
  # Call the unified recovery handler if it exists
  if [ -x "$HOOKS_DIR/post-bash-recovery.sh" ]; then
    HANDLER_INPUT=$(cat << EOF
{"command": $(echo "$COMMAND" | jq -Rs '.'), "exit_code": $EXIT_CODE, "output": $(echo "$TOOL_OUTPUT" | jq -Rs '.')}
EOF
)
    HANDLER_OUTPUT=$(echo "$HANDLER_INPUT" | "$HOOKS_DIR/post-bash-recovery.sh" 2>/dev/null || echo "")
    if [ -n "$HANDLER_OUTPUT" ]; then
      save_hook_artifact "post-bash" "{\"_meta\":{\"hook\":\"post-bash\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"exit_code\":$EXIT_CODE,\"source\":\"recovery\"},\"command\":$(echo "$COMMAND" | head -c 200 | jq -Rs '.')}"
      echo "$HANDLER_OUTPUT"
      exit 0
    fi
  fi

  # Fallback: Call legacy handlers for RALPH mode task creation
  if [ "${RALPH_MODE:-}" = "true" ]; then
    if [ "$IS_TEST_COMMAND" = true ] && [ -x "$HOOKS_DIR/post-test-failure.sh" ]; then
      HANDLER_INPUT=$(cat << EOF
{"command": $(echo "$COMMAND" | jq -Rs '.'), "exit_code": $EXIT_CODE, "output": $(echo "$TOOL_OUTPUT" | jq -Rs '.')}
EOF
)
      HANDLER_OUTPUT=$(echo "$HANDLER_INPUT" | "$HOOKS_DIR/post-test-failure.sh" 2>/dev/null || echo "")
      if [ -n "$HANDLER_OUTPUT" ]; then
        echo "$HANDLER_OUTPUT"
        exit 0
      fi
    fi
  fi
fi

exit 0
