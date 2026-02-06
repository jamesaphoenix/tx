#!/bin/bash
# .claude/hooks/prompt-context.sh
# Inject task-relevant learnings based on the user's prompt
# Hook: UserPromptSubmit

set -e

# Load shared artifact utilities
source "$(dirname "$0")/hooks-common.sh"

# Check if tx is available
if ! tx_available; then
  exit 0
fi

# Read input from stdin
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

if [ -z "$PROMPT" ]; then
  exit 0
fi

# Check if prompt mentions a task ID
TASK_ID=$(echo "$PROMPT" | grep -oE 'tx-[a-z0-9]{6,12}' | head -1 || true)

if [ -n "$TASK_ID" ]; then
  # Get contextual learnings for the specific task
  CONTEXT=$(tx_cmd context "$TASK_ID" --json 2>/dev/null || echo "")

  if [ -n "$CONTEXT" ]; then
    LEARNING_COUNT=$(echo "$CONTEXT" | jq '.learnings | length' 2>/dev/null || echo "0")

    if [ "$LEARNING_COUNT" -gt 0 ]; then
      FORMATTED=$(echo "$CONTEXT" | jq -r '
        .learnings[] | "- [\(.sourceType // "manual")] (score: \((.relevanceScore * 100) | floor)%) \(.content)"
      ')

      # Escape for JSON (strip surrounding quotes from jq -Rs output)
      ESCAPED=$(echo "$FORMATTED" | jq -Rs '.')
      INNER=$(echo "$ESCAPED" | sed 's/^"//;s/"$//')

      OUTPUT=$(cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "## Relevant Learnings for Task $TASK_ID\n\n${INNER}"
  }
}
EOF
)
      save_hook_artifact "prompt-context" "{\"_meta\":{\"hook\":\"prompt-context\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"task_id\":\"$TASK_ID\"},\"learnings\":$ESCAPED}"
      echo "$OUTPUT"
      exit 0
    fi
  fi
fi

# Fallback: search learnings based on prompt keywords
# Extract first 100 chars of prompt for search
SEARCH_QUERY=$(echo "$PROMPT" | head -c 100 | tr -d '"' | tr '\n' ' ')
SEARCH_RESULTS=$(tx_cmd learning:search "$SEARCH_QUERY" -n 3 --json 2>/dev/null || echo "[]")

if [ "$SEARCH_RESULTS" != "[]" ] && [ -n "$SEARCH_RESULTS" ]; then
  FORMATTED=$(echo "$SEARCH_RESULTS" | jq -r '.[] | "- \(.content)"' 2>/dev/null || true)

  if [ -n "$FORMATTED" ]; then
    # Escape for JSON (strip surrounding quotes from jq -Rs output)
    ESCAPED=$(echo "$FORMATTED" | jq -Rs '.')
    INNER=$(echo "$ESCAPED" | sed 's/^"//;s/"$//')

    OUTPUT=$(cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "## Potentially Relevant Learnings\n\n${INNER}"
  }
}
EOF
)
    save_hook_artifact "prompt-context" "{\"_meta\":{\"hook\":\"prompt-context\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"search\"},\"learnings\":$ESCAPED}"
    echo "$OUTPUT"
  fi
fi

exit 0
