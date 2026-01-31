#!/bin/bash
# .claude/hooks/post-bash.sh
# Dispatcher for Bash post-tool hooks
# Handles: task tracking, test/build failure detection, session state
# Hook: PostToolUse (Bash)

set -e

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

    # Call test failure handler if it exists
    if [ -x "$HOOKS_DIR/post-test-failure.sh" ]; then
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

# ============================================
# Build Command Detection
# ============================================

IS_BUILD_COMMAND=false
if echo "$COMMAND" | grep -qE '(npm run build|npx tsc|tsc|vite build|rollup|webpack|cargo build|go build)'; then
  IS_BUILD_COMMAND=true
fi

if [ "$IS_BUILD_COMMAND" = true ] && [ "$EXIT_CODE" -ne 0 ]; then
  # Call build failure handler if it exists
  if [ -x "$HOOKS_DIR/post-build-failure.sh" ]; then
    HANDLER_INPUT=$(cat << EOF
{"command": $(echo "$COMMAND" | jq -Rs '.'), "exit_code": $EXIT_CODE, "output": $(echo "$TOOL_OUTPUT" | jq -Rs '.')}
EOF
)
    HANDLER_OUTPUT=$(echo "$HANDLER_INPUT" | "$HOOKS_DIR/post-build-failure.sh" 2>/dev/null || echo "")
    if [ -n "$HANDLER_OUTPUT" ]; then
      echo "$HANDLER_OUTPUT"
      exit 0
    fi
  fi
fi

# ============================================
# Lint Command Detection (captured in post-lint-check.sh for Write/Edit)
# For Bash-based lint commands, provide context on failure
# ============================================

IS_LINT_COMMAND=false
if echo "$COMMAND" | grep -qE '(eslint|prettier|stylelint|npm run lint|npx eslint)'; then
  IS_LINT_COMMAND=true
fi

if [ "$IS_LINT_COMMAND" = true ] && [ "$EXIT_CODE" -ne 0 ]; then
  # Extract lint errors for context
  LINT_ERRORS=$(echo "$TOOL_OUTPUT" | grep -E '(error|warning|Error:)' | head -10 || true)

  if [ -n "$LINT_ERRORS" ]; then
    ESCAPED=$(echo "$LINT_ERRORS" | jq -Rs '.')
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "## Lint Errors\n\n\`\`\`\n${ESCAPED:1:-1}\n\`\`\`\n\nFix these before proceeding."
  }
}
EOF
    exit 0
  fi
fi

exit 0
