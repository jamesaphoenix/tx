#!/bin/bash
# .claude/hooks/pre-compact.sh
# Archive learnings before context is compacted
# Hook: PreCompact

set -e

# Load shared artifact utilities
source "$(dirname "$0")/hooks-common.sh"

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
if ! tx_available; then
  exit 0
fi

if [ -n "$SESSION_ID" ] && [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  # Create session archive directory
  ARCHIVE_DIR="$PROJECT_DIR/.tx/archive/$SESSION_ID"
  mkdir -p "$ARCHIVE_DIR"

  # Copy transcript for future analysis
  cp "$TRANSCRIPT_PATH" "$ARCHIVE_DIR/transcript.jsonl" 2>/dev/null || true

  # Export recent learnings
  tx_cmd learning:recent -n 10 --json > "$ARCHIVE_DIR/recent-learnings.json" 2>/dev/null || true

  # Record archive time
  echo "{\"archived_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"session_id\": \"$SESSION_ID\"}" > "$ARCHIVE_DIR/metadata.json"

  save_hook_artifact "pre-compact" "{\"_meta\":{\"hook\":\"pre-compact\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"trigger\":\"$TRIGGER\"},\"session_id\":\"$SESSION_ID\",\"archive_dir\":\"$ARCHIVE_DIR\"}"
  echo "Archived session to $ARCHIVE_DIR" >&2
fi

exit 0
