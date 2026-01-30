#!/bin/bash
# Context-efficient backpressure hook
# Intercepts test/lint/build commands and suggests using run_silent wrapper
#
# This is a PreToolUse hook that modifies Bash commands to reduce context bloat

set -e

# Read hook input from stdin
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only process Bash tool
if [ "$TOOL_NAME" != "Bash" ]; then
    exit 0
fi

# Patterns that generate verbose output
VERBOSE_PATTERNS=(
    "npm test"
    "npm run test"
    "npx vitest"
    "npx jest"
    "pytest"
    "go test"
    "cargo test"
    "npm run lint"
    "npx eslint"
    "npm run build"
    "npx tsc"
    "make test"
    "make build"
)

# Check if command matches a verbose pattern
should_wrap=false
for pattern in "${VERBOSE_PATTERNS[@]}"; do
    if [[ "$COMMAND" == *"$pattern"* ]]; then
        should_wrap=true
        break
    fi
done

if [ "$should_wrap" = true ]; then
    # Check if already using our wrapper
    if [[ "$COMMAND" == *"run-silent"* ]] || [[ "$COMMAND" == *"scripts/check.sh"* ]]; then
        exit 0
    fi

    # Suggest using the wrapper via additionalContext
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "TIP: Use scripts/check.sh instead of raw test/lint/build commands to reduce context bloat. Example: ./scripts/check.sh --test (shows ✓ on success, full errors on failure)"
  }
}
EOF
fi

exit 0
