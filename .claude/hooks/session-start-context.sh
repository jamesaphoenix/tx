#!/bin/bash
# .claude/hooks/session-start-context.sh
# Load comprehensive tx context for fresh Claude instances
# Hook: SessionStart

set -e

# Load shared artifact utilities
source "$(dirname "$0")/hooks-common.sh"

# Check if tx is available
if ! tx_available; then
  exit 0
fi

# Build context sections
CONTEXT=""

# 1. Get current assigned task (highest priority ready task)
READY_TASK=$(tx_cmd ready --json --limit 1 2>/dev/null || echo "[]")
TASK_ID=""
TASK_TITLE=""
TASK_DESC=""

if [ "$READY_TASK" != "[]" ] && [ -n "$READY_TASK" ]; then
  TASK_ID=$(echo "$READY_TASK" | jq -r '.[0].id // empty')
  TASK_TITLE=$(echo "$READY_TASK" | jq -r '.[0].title // empty')
  TASK_DESC=$(echo "$READY_TASK" | jq -r '.[0].description // empty')
  TASK_STATUS=$(echo "$READY_TASK" | jq -r '.[0].status // empty')
  TASK_SCORE=$(echo "$READY_TASK" | jq -r '.[0].score // empty')
  BLOCKED_BY=$(echo "$READY_TASK" | jq -r '.[0].blockedBy | if length > 0 then join(", ") else "none" end')
  BLOCKS=$(echo "$READY_TASK" | jq -r '.[0].blocks | if length > 0 then join(", ") else "none" end')
  CHILDREN=$(echo "$READY_TASK" | jq -r '.[0].children | if length > 0 then join(", ") else "none" end')

  CONTEXT+="## Next Ready Task\n\n"
  CONTEXT+="**${TASK_ID}**: ${TASK_TITLE}\n"
  CONTEXT+="- Status: ${TASK_STATUS}\n"
  CONTEXT+="- Priority Score: ${TASK_SCORE}\n"
  CONTEXT+="- Blocked By: ${BLOCKED_BY}\n"
  CONTEXT+="- Blocks: ${BLOCKS}\n"
  CONTEXT+="- Children: ${CHILDREN}\n"

  if [ -n "$TASK_DESC" ] && [ "$TASK_DESC" != "null" ]; then
    # Truncate description to first 500 chars for context
    TASK_DESC_SHORT=$(echo "$TASK_DESC" | head -c 500)
    CONTEXT+="\n**Description:**\n${TASK_DESC_SHORT}\n"
  fi
  CONTEXT+="\n"
fi

# 2. Get relevant learnings for the task
if [ -n "$TASK_ID" ]; then
  TASK_CONTEXT=$(tx_cmd context "$TASK_ID" --json 2>/dev/null || echo "")

  if [ -n "$TASK_CONTEXT" ]; then
    LEARNING_COUNT=$(echo "$TASK_CONTEXT" | jq '.learnings | length' 2>/dev/null || echo "0")

    if [ "$LEARNING_COUNT" -gt 0 ]; then
      LEARNINGS=$(echo "$TASK_CONTEXT" | jq -r '
        .learnings[:15] | .[] | "- [\(.sourceType // "manual")] \(.content)"
      ' 2>/dev/null || true)

      if [ -n "$LEARNINGS" ]; then
        CONTEXT+="## Relevant Learnings\n\n"
        CONTEXT+="${LEARNINGS}\n\n"
      fi
    fi
  fi
fi

# 3. Check for blocked tasks that might need attention
BLOCKED_TASKS=$(tx_cmd list --status blocked --json 2>/dev/null || echo "[]")

if [ "$BLOCKED_TASKS" != "[]" ] && [ -n "$BLOCKED_TASKS" ]; then
  BLOCKED_COUNT=$(echo "$BLOCKED_TASKS" | jq 'length' 2>/dev/null || echo "0")

  if [ "$BLOCKED_COUNT" -gt 0 ]; then
    BLOCKED_LIST=$(echo "$BLOCKED_TASKS" | jq -r '
      .[:3] | .[] | "- \(.id): \(.title)"
    ' 2>/dev/null || true)

    if [ -n "$BLOCKED_LIST" ]; then
      CONTEXT+="## Blocked Tasks (${BLOCKED_COUNT} total)\n\n"
      CONTEXT+="${BLOCKED_LIST}\n\n"
      CONTEXT+="Consider if completing the ready task will unblock these.\n\n"
    fi
  fi
fi

# 4. Recent git changes (last 3 commits)
GIT_LOG=$(git log --oneline -3 2>/dev/null || true)

if [ -n "$GIT_LOG" ]; then
  CONTEXT+="## Recent Git Commits\n\n"
  CONTEXT+="\`\`\`\n${GIT_LOG}\n\`\`\`\n\n"
fi

# 5. Git status (uncommitted changes)
GIT_STATUS=$(git status --short 2>/dev/null | head -10 || true)

if [ -n "$GIT_STATUS" ]; then
  STATUS_COUNT=$(echo "$GIT_STATUS" | wc -l | tr -d ' ')
  CONTEXT+="## Uncommitted Changes (${STATUS_COUNT} files)\n\n"
  CONTEXT+="\`\`\`\n${GIT_STATUS}\n\`\`\`\n\n"
fi

# Exit if no context was gathered
if [ -z "$CONTEXT" ]; then
  exit 0
fi

# Escape for JSON (handle newlines and quotes)
ESCAPED=$(printf '%s' "$CONTEXT" | jq -Rs '.')

# Output JSON with additionalContext
OUTPUT=$(cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": ${ESCAPED}
  }
}
EOF
)

save_hook_artifact "session-start-context" "{\"_meta\":{\"hook\":\"session-start-context\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},\"context\":${ESCAPED}}"
echo "$OUTPUT"

exit 0
