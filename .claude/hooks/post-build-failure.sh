#!/bin/bash
# .claude/hooks/post-build-failure.sh
# Capture build errors and suggest fixes for autonomous RALPH mode
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

# Only process if build failed
if [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

# Extract TypeScript/build errors
ERRORS=""

# TypeScript errors (tsc output)
if echo "$OUTPUT" | grep -qE 'error TS[0-9]+:'; then
  ERRORS=$(echo "$OUTPUT" | grep -E 'error TS[0-9]+:' | head -10)
fi

# Vite/Rollup build errors
if [ -z "$ERRORS" ] && echo "$OUTPUT" | grep -qE '(Error:|BUILD FAILED|failed to resolve)'; then
  ERRORS=$(echo "$OUTPUT" | grep -E '(Error:|BUILD FAILED|failed to resolve|Cannot find module)' | head -10)
fi

# Effect-TS specific errors
if [ -z "$ERRORS" ] && echo "$OUTPUT" | grep -qE 'Effect\.|Layer\.|Context\.'; then
  ERRORS=$(echo "$OUTPUT" | grep -E '(Effect\.|Layer\.|Context\.)' | head -10)
fi

# Generic error extraction
if [ -z "$ERRORS" ]; then
  ERRORS=$(echo "$OUTPUT" | grep -iE '(error|failed|cannot)' | head -10)
fi

if [ -z "$ERRORS" ]; then
  # No specific errors found, provide generic message
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "## Build Failed\n\nThe build command failed with exit code $EXIT_CODE.\n\nCheck the full output for details."
  }
}
EOF
  exit 0
fi

# Build suggestions based on error type
SUGGESTIONS=""

if echo "$ERRORS" | grep -qE 'Cannot find module'; then
  SUGGESTIONS="### Possible Fixes\n\n- Check import paths are correct\n- Run \`npm install\` to ensure dependencies are installed\n- Verify tsconfig.json paths configuration"
elif echo "$ERRORS" | grep -qE 'TS2345|TS2322'; then
  SUGGESTIONS="### Possible Fixes\n\n- Type mismatch detected. Check function arguments match expected types\n- Consider using type assertions or generics"
elif echo "$ERRORS" | grep -qE 'TS2339'; then
  SUGGESTIONS="### Possible Fixes\n\n- Property does not exist on type\n- Check spelling of property name\n- Ensure interface/type includes the property"
elif echo "$ERRORS" | grep -qE 'Layer\.|Context\.'; then
  SUGGESTIONS="### Effect-TS Specific\n\n- Ensure all service dependencies are provided in the Layer\n- Check Layer composition order\n- Verify Context.Tag types match"
fi

# Escape for JSON
ESCAPED_ERRORS=$(echo "$ERRORS" | jq -Rs '.')
ESCAPED_SUGGESTIONS=$(echo "$SUGGESTIONS" | jq -Rs '.' | sed 's/^"//;s/"$//')

cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "## Build Errors\n\n\`\`\`\n${ESCAPED_ERRORS:1:-1}\n\`\`\`\n\n${ESCAPED_SUGGESTIONS}"
  }
}
EOF

exit 0
