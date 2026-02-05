#!/bin/bash
# .claude/hooks/pre-validate-paths.sh
# Ensure file operations stay within the project directory
# Hook: PreToolUse (Write|Edit|Read)

set -e

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Resolve to absolute path
PROJECT_DIR_ABS=$(cd "$PROJECT_DIR" && pwd)

# Read input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only process file operation tools
case "$TOOL_NAME" in
  Write|Edit|Read)
    ;;
  *)
    exit 0
    ;;
esac

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Resolve the file path to absolute
if [[ "$FILE_PATH" = /* ]]; then
  ABS_PATH="$FILE_PATH"
else
  ABS_PATH="$PROJECT_DIR_ABS/$FILE_PATH"
fi

# Resolve symlinks and normalize path
RESOLVED_PATH=$(realpath -m "$ABS_PATH" 2>/dev/null || echo "$ABS_PATH")

# Allowlisted paths outside project (Claude Code internal directories)
CLAUDE_DIR="$HOME/.claude"
if [[ "$RESOLVED_PATH" == "$CLAUDE_DIR"* ]]; then
  # Allow writes to ~/.claude/ (plans, settings, memory, etc.)
  exit 0
fi

# Check if path is within project directory
if [[ "$RESOLVED_PATH" != "$PROJECT_DIR_ABS"* ]]; then
  # Path is outside project
  cat << EOF
{
  "decision": "block",
  "reason": "File operation blocked: Path is outside the project directory.\n\nRequested path: $FILE_PATH\nResolved to: $RESOLVED_PATH\nProject directory: $PROJECT_DIR_ABS\n\nFile operations must stay within the project."
}
EOF
  exit 0
fi

# Check for sensitive paths within project
SENSITIVE_PATTERNS=(
  ".env"
  ".env.local"
  ".env.production"
  "credentials"
  "secrets"
  ".ssh"
  "private"
  "password"
)

BASENAME=$(basename "$FILE_PATH")
DIRNAME=$(dirname "$FILE_PATH")

for pattern in "${SENSITIVE_PATTERNS[@]}"; do
  if [[ "$BASENAME" == *"$pattern"* ]] || [[ "$DIRNAME" == *"$pattern"* ]]; then
    # Only warn for Write/Edit, allow Read
    if [ "$TOOL_NAME" != "Read" ]; then
      cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "## Sensitive File Warning\n\nPath contains '$pattern': \`$FILE_PATH\`\n\nEnsure you're not accidentally exposing secrets or credentials."
  }
}
EOF
    fi
    break
  fi
done

# Check for writing to node_modules (usually a mistake)
if [[ "$RESOLVED_PATH" == *"node_modules"* ]] && [[ "$TOOL_NAME" = "Write" || "$TOOL_NAME" = "Edit" ]]; then
  cat << EOF
{
  "decision": "block",
  "reason": "Blocked: Attempting to write to node_modules.\n\nPath: $FILE_PATH\n\nModifying node_modules is almost always unintentional. Install packages with npm/yarn instead."
}
EOF
  exit 0
fi

exit 0
