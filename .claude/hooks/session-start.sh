#!/bin/bash
# .claude/hooks/session-start.sh
# Inject recent learnings when Claude starts a session
# Hook: SessionStart

set -e

# Check if tx is available
if ! command -v tx &> /dev/null; then
  exit 0
fi

# Get recent learnings (last 5)
LEARNINGS=$(tx learning:recent -n 5 --json 2>/dev/null || echo "[]")

if [ "$LEARNINGS" = "[]" ] || [ -z "$LEARNINGS" ]; then
  exit 0
fi

# Format learnings as markdown
FORMATTED=$(echo "$LEARNINGS" | jq -r '
  .[] | "- [\(.sourceType // "manual")] \(.content)"
' | head -10)

if [ -z "$FORMATTED" ]; then
  exit 0
fi

# Build JSON output using jq for proper escaping (bash 3.2 compatible)
HEADER="## Recent Learnings from Past Sessions\n\nThese learnings were captured from previous work:\n\n"
FULL_CONTENT="${HEADER}${FORMATTED}"

jq -n --arg content "$FULL_CONTENT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $content
  }
}'

exit 0
