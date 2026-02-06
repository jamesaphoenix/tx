#!/bin/bash
# .claude/hooks/stop-capture-learnings.sh
# Spawn a fresh Claude instance to extract learnings from the session transcript.
# Hook: Stop (command type)
#
# Interactive sessions: extracts learnings here.
# Ralph sessions: skipped (ralph.sh handles it with better context).

source "$(dirname "$0")/hooks-common.sh"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Drain stdin (required by hook protocol)
cat > /dev/null

# Ralph handles its own learnings extraction with task context
if [ "${RALPH_MODE:-}" = "true" ]; then
  exit 0
fi

# Need the session ID to find the transcript
SESSION_ID="${CLAUDE_SESSION_ID:-}"
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Find transcript file
TRANSCRIPT=""
PROJECTS_DIR="$HOME/.claude/projects"
if [ -d "$PROJECTS_DIR" ]; then
  TRANSCRIPT=$(find "$PROJECTS_DIR" -name "${SESSION_ID}.jsonl" -type f 2>/dev/null | head -1)
fi

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# Spawn a fresh Claude to extract learnings from the transcript
claude --print "You are a learnings extractor. Read the transcript at $TRANSCRIPT.

Extract all key learnings — things that would help a future agent working on this codebase. Focus on:
- Bugs discovered and their root causes
- Patterns that worked or failed
- Codebase-specific knowledge (file locations, gotchas, conventions)
- Tool/API quirks encountered

For each learning, record it with:
  bun $PROJECT_DIR/apps/cli/src/cli.ts learning:add \"<learning>\"

Skip obvious or generic observations. Only record insights specific to this project." \
  2>/dev/null &

# Don't block session exit — fire and forget
disown

exit 0
