#!/bin/bash
# .claude/hooks/pre-compact.sh
# Archive learnings before context is compacted
# Hook: PreCompact

set -e

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Read input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TRIGGER=$(echo "$INPUT" | jq -r '.trigger // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Only archive on auto-compact
if [ "$TRIGGER" != "auto" ]; then
  exit 0
fi

# Check if tx is available
if ! command -v tx &> /dev/null; then
  exit 0
fi

if [ -n "$SESSION_ID" ] && [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  # Create session archive directory
  ARCHIVE_DIR="$PROJECT_DIR/.tx/archive/$SESSION_ID"
  mkdir -p "$ARCHIVE_DIR"

  # Copy transcript for future analysis
  cp "$TRANSCRIPT_PATH" "$ARCHIVE_DIR/transcript.jsonl" 2>/dev/null || true

  # Export recent learnings
  tx learning:recent -n 10 --json > "$ARCHIVE_DIR/recent-learnings.json" 2>/dev/null || true

  # Record archive time
  echo "{\"archived_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"session_id\": \"$SESSION_ID\"}" > "$ARCHIVE_DIR/metadata.json"

  echo "Archived session to $ARCHIVE_DIR" >&2
fi

exit 0
