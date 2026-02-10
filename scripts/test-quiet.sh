#!/bin/bash
# Thin wrapper — delegates to the Claude skill at .claude/skills/test-quiet/scripts/run.sh
# This file exists for backwards compatibility. Use the skill directly:
#   .claude/skills/test-quiet/scripts/run.sh [options] [test-path]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

exec "$PROJECT_DIR/.claude/skills/test-quiet/scripts/run.sh" "$@"
