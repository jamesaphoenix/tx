#!/bin/bash
# .claude/hooks/post-bash-recovery.sh
# Auto-recovery hook for Bash command failures
# Provides actionable context for test, lint, and build failures
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

# Only process if command failed
if [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

# ============================================
# Detect failure type and provide recovery context
# ============================================

ADDITIONAL_CONTEXT=""
FAILURE_TYPE=""

# --------------------------------------------
# Test Failure Detection (vitest/jest/mocha)
# --------------------------------------------
if echo "$COMMAND" | grep -qE '(vitest|jest|mocha|pytest|npm test|npm run test)'; then
  FAILURE_TYPE="test"

  # Extract file:line from vitest output
  # Vitest format: "FAIL src/foo.test.ts > describe > test name"
  # or error stack: "at Object.<anonymous> (src/foo.test.ts:42:10)"

  FAILED_FILES=""
  ERROR_LINES=""

  # Parse vitest FAIL lines
  if echo "$OUTPUT" | grep -qE '(FAIL|FAILED)'; then
    FAILED_FILES=$(echo "$OUTPUT" | grep -E '^\s*(FAIL|×)' | head -5 || true)
  fi

  # Parse stack traces for file:line info
  if echo "$OUTPUT" | grep -qE '\.(test|spec)\.(ts|js):[0-9]+'; then
    ERROR_LINES=$(echo "$OUTPUT" | grep -oE '[^/[:space:]]+\.(test|spec)\.(ts|js):[0-9]+' | sort -u | head -5 || true)
  fi

  # Parse assertion errors
  ASSERTION_ERRORS=""
  if echo "$OUTPUT" | grep -qE '(AssertionError|Expected|Received|toBe|toEqual)'; then
    ASSERTION_ERRORS=$(echo "$OUTPUT" | grep -E '(Expected|Received|toHaveLength|toBe|toEqual|toMatch)' | head -5 || true)
  fi

  # Build context message
  CONTEXT_PARTS=""

  if [ -n "$ERROR_LINES" ]; then
    CONTEXT_PARTS="**Failure locations:**\n"
    while IFS= read -r line; do
      CONTEXT_PARTS="${CONTEXT_PARTS}- \`${line}\`\n"
    done <<< "$ERROR_LINES"
  fi

  if [ -n "$ASSERTION_ERRORS" ]; then
    ESCAPED_ASSERTIONS=$(echo "$ASSERTION_ERRORS" | head -c 500)
    CONTEXT_PARTS="${CONTEXT_PARTS}\n**Assertion details:**\n\`\`\`\n${ESCAPED_ASSERTIONS}\n\`\`\`\n"
  fi

  if [ -n "$FAILED_FILES" ]; then
    ESCAPED_FAILURES=$(echo "$FAILED_FILES" | head -c 300)
    CONTEXT_PARTS="${CONTEXT_PARTS}\n**Failed tests:**\n\`\`\`\n${ESCAPED_FAILURES}\n\`\`\`\n"
  fi

  # Add recovery suggestions
  SUGGESTIONS="**Recovery steps:**\n"
  if [ -n "$ERROR_LINES" ]; then
    FIRST_FILE=$(echo "$ERROR_LINES" | head -1)
    SUGGESTIONS="${SUGGESTIONS}1. Read the failing test at \`${FIRST_FILE}\`\n"
    SUGGESTIONS="${SUGGESTIONS}2. Check mock setup and test data\n"
    SUGGESTIONS="${SUGGESTIONS}3. Verify the implementation matches test expectations\n"
  else
    SUGGESTIONS="${SUGGESTIONS}1. Check the test output for specific failures\n"
    SUGGESTIONS="${SUGGESTIONS}2. Run tests with --reporter=verbose for more details\n"
  fi

  ADDITIONAL_CONTEXT="## Test Failure Recovery\n\n${CONTEXT_PARTS}\n${SUGGESTIONS}"
fi

# --------------------------------------------
# Lint Failure Detection (ESLint/prettier)
# --------------------------------------------
if [ -z "$FAILURE_TYPE" ] && echo "$COMMAND" | grep -qE '(eslint|prettier|stylelint|npm run lint|npx eslint)'; then
  FAILURE_TYPE="lint"

  # Extract ESLint errors with file:line
  LINT_ERRORS=""
  FIXABLE_COUNT=0

  # Parse standard ESLint output format: "file.ts:line:col error message rule-name"
  if echo "$OUTPUT" | grep -qE ':[0-9]+:[0-9]+'; then
    LINT_ERRORS=$(echo "$OUTPUT" | grep -E '^\s*[^:]+:[0-9]+:[0-9]+' | head -10 || true)
  fi

  # Check for fixable issues
  if echo "$OUTPUT" | grep -qE '(--fix|potentially fixable)'; then
    FIXABLE_COUNT=$(echo "$OUTPUT" | grep -oE '[0-9]+ potentially fixable' | grep -oE '[0-9]+' || echo "0")
  fi

  # Parse error vs warning counts
  ERROR_COUNT=$(echo "$OUTPUT" | grep -oE '[0-9]+ error' | head -1 | grep -oE '[0-9]+' || echo "0")
  WARNING_COUNT=$(echo "$OUTPUT" | grep -oE '[0-9]+ warning' | head -1 | grep -oE '[0-9]+' || echo "0")

  CONTEXT_PARTS="**Summary:** ${ERROR_COUNT} errors, ${WARNING_COUNT} warnings"

  if [ "$FIXABLE_COUNT" != "0" ]; then
    CONTEXT_PARTS="${CONTEXT_PARTS} (${FIXABLE_COUNT} auto-fixable)\n"
  else
    CONTEXT_PARTS="${CONTEXT_PARTS}\n"
  fi

  if [ -n "$LINT_ERRORS" ]; then
    ESCAPED_ERRORS=$(echo "$LINT_ERRORS" | head -c 500)
    CONTEXT_PARTS="${CONTEXT_PARTS}\n**Issues:**\n\`\`\`\n${ESCAPED_ERRORS}\n\`\`\`\n"
  fi

  # Add recovery suggestions
  SUGGESTIONS="**Recovery steps:**\n"
  if [ "$FIXABLE_COUNT" != "0" ]; then
    SUGGESTIONS="${SUGGESTIONS}1. Run \`npm run lint:fix\` to auto-fix ${FIXABLE_COUNT} issues\n"
    SUGGESTIONS="${SUGGESTIONS}2. Manually fix remaining issues\n"
  else
    SUGGESTIONS="${SUGGESTIONS}1. Read the error locations and fix each issue\n"
    SUGGESTIONS="${SUGGESTIONS}2. Common fixes: remove unused vars, add type annotations\n"
  fi

  ADDITIONAL_CONTEXT="## Lint Failure Recovery\n\n${CONTEXT_PARTS}\n${SUGGESTIONS}"
fi

# --------------------------------------------
# Build Failure Detection (tsc/vite/rollup)
# --------------------------------------------
if [ -z "$FAILURE_TYPE" ] && echo "$COMMAND" | grep -qE '(npm run build|npx tsc|tsc|vite build|rollup|webpack)'; then
  FAILURE_TYPE="build"

  BUILD_ERRORS=""

  # Parse TypeScript errors: "file.ts(line,col): error TSxxxx: message"
  if echo "$OUTPUT" | grep -qE 'error TS[0-9]+:'; then
    BUILD_ERRORS=$(echo "$OUTPUT" | grep -E 'error TS[0-9]+:' | head -10)
  fi

  # Parse file:line from TypeScript errors
  ERROR_LOCATIONS=""
  if [ -n "$BUILD_ERRORS" ]; then
    ERROR_LOCATIONS=$(echo "$BUILD_ERRORS" | grep -oE '^[^(]+\([0-9]+,[0-9]+\)' | head -5 || true)
  fi

  # Parse Vite/Rollup errors
  if [ -z "$BUILD_ERRORS" ]; then
    BUILD_ERRORS=$(echo "$OUTPUT" | grep -E '(Error:|BUILD FAILED|failed to resolve|Cannot find module)' | head -10 || true)
  fi

  CONTEXT_PARTS=""

  if [ -n "$ERROR_LOCATIONS" ]; then
    CONTEXT_PARTS="**Error locations:**\n"
    while IFS= read -r loc; do
      CONTEXT_PARTS="${CONTEXT_PARTS}- \`${loc}\`\n"
    done <<< "$ERROR_LOCATIONS"
    CONTEXT_PARTS="${CONTEXT_PARTS}\n"
  fi

  if [ -n "$BUILD_ERRORS" ]; then
    ESCAPED_ERRORS=$(echo "$BUILD_ERRORS" | head -c 600)
    CONTEXT_PARTS="${CONTEXT_PARTS}**Build errors:**\n\`\`\`\n${ESCAPED_ERRORS}\n\`\`\`\n"
  fi

  # Generate specific suggestions based on error type
  SUGGESTIONS="**Recovery steps:**\n"

  if echo "$BUILD_ERRORS" | grep -qE 'Cannot find module'; then
    SUGGESTIONS="${SUGGESTIONS}1. Check import paths are correct\n"
    SUGGESTIONS="${SUGGESTIONS}2. Run \`npm install\` to ensure dependencies\n"
    SUGGESTIONS="${SUGGESTIONS}3. Verify tsconfig.json paths configuration\n"
  elif echo "$BUILD_ERRORS" | grep -qE 'TS2345|TS2322'; then
    SUGGESTIONS="${SUGGESTIONS}1. Type mismatch - check function arguments match expected types\n"
    SUGGESTIONS="${SUGGESTIONS}2. Consider explicit type annotations or casts\n"
  elif echo "$BUILD_ERRORS" | grep -qE 'TS2339'; then
    SUGGESTIONS="${SUGGESTIONS}1. Property does not exist - check spelling\n"
    SUGGESTIONS="${SUGGESTIONS}2. Ensure interface/type includes the property\n"
  elif echo "$BUILD_ERRORS" | grep -qE 'TS2304'; then
    SUGGESTIONS="${SUGGESTIONS}1. Cannot find name - add import statement\n"
    SUGGESTIONS="${SUGGESTIONS}2. Check the type is exported from source\n"
  else
    SUGGESTIONS="${SUGGESTIONS}1. Read the first error and fix it\n"
    SUGGESTIONS="${SUGGESTIONS}2. Run build again - often fixing one error resolves others\n"
  fi

  ADDITIONAL_CONTEXT="## Build Failure Recovery\n\n${CONTEXT_PARTS}\n${SUGGESTIONS}"
fi

# --------------------------------------------
# Generic Command Failure (fallback)
# --------------------------------------------
if [ -z "$FAILURE_TYPE" ]; then
  # Extract any error-like output
  ERROR_OUTPUT=$(echo "$OUTPUT" | grep -iE '(error|failed|cannot|unable|exception)' | head -5 || true)

  if [ -n "$ERROR_OUTPUT" ]; then
    ESCAPED_OUTPUT=$(echo "$ERROR_OUTPUT" | head -c 400)
    ADDITIONAL_CONTEXT="## Command Failed\n\n**Exit code:** ${EXIT_CODE}\n\n**Errors:**\n\`\`\`\n${ESCAPED_OUTPUT}\n\`\`\`\n\n**Recovery:** Check the full output above for details."
  fi
fi

# ============================================
# Output JSON response if we have context
# ============================================

if [ -n "$ADDITIONAL_CONTEXT" ]; then
  # Escape for JSON
  ESCAPED_CONTEXT=$(echo -e "$ADDITIONAL_CONTEXT" | jq -Rs '.')

  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": ${ESCAPED_CONTEXT}
  }
}
EOF
fi

exit 0
