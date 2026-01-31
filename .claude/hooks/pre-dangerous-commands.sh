#!/bin/bash
# .claude/hooks/pre-dangerous-commands.sh
# Block dangerous commands that could cause data loss or security issues
# Hook: PreToolUse (Bash)

set -e

# Read input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process Bash tool
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Dangerous patterns to block
BLOCKED_REASON=""

# rm -rf with dangerous targets
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(/|~|\$HOME|\.\.|/etc|/usr|/var|/bin|/sbin)'; then
  BLOCKED_REASON="Blocked: rm -rf targeting system directories or parent paths"
fi

# rm -rf /* or rm -rf ./*
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\./\*|/\*|\*)'; then
  BLOCKED_REASON="Blocked: rm -rf with wildcard patterns that could delete everything"
fi

# git push --force to main/master
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*--force.*\s+(origin\s+)?(main|master)'; then
  BLOCKED_REASON="Blocked: Force push to main/master is dangerous and can destroy history"
fi

# git push -f to main/master
if echo "$COMMAND" | grep -qE 'git\s+push\s+-f\s+.*\s+(origin\s+)?(main|master)'; then
  BLOCKED_REASON="Blocked: Force push to main/master is dangerous"
fi

# git reset --hard on main/master (without being on a branch)
if echo "$COMMAND" | grep -qE 'git\s+reset\s+--hard'; then
  BLOCKED_REASON="Warning: git reset --hard discards uncommitted changes. Use with caution."
fi

# chmod/chown with recursive on root
if echo "$COMMAND" | grep -qE '(chmod|chown)\s+.*-[rR].*\s+/[^.]'; then
  BLOCKED_REASON="Blocked: Recursive chmod/chown on system directories"
fi

# dd command (disk destroyer)
if echo "$COMMAND" | grep -qE '^dd\s+.*of=/dev/'; then
  BLOCKED_REASON="Blocked: dd to device files can destroy disk data"
fi

# mkfs/format commands
if echo "$COMMAND" | grep -qE '(mkfs|format)\s+/dev/'; then
  BLOCKED_REASON="Blocked: Formatting disk devices"
fi

# curl piped to bash/sh
if echo "$COMMAND" | grep -qE 'curl\s+.*\|\s*(bash|sh|zsh)'; then
  BLOCKED_REASON="Warning: Piping curl to shell is risky. Review the script first."
fi

# wget piped to bash/sh
if echo "$COMMAND" | grep -qE 'wget\s+.*-O\s*-.*\|\s*(bash|sh|zsh)'; then
  BLOCKED_REASON="Warning: Piping wget to shell is risky. Review the script first."
fi

# Deleting git history
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+\.git'; then
  BLOCKED_REASON="Blocked: Deleting .git directory destroys version history"
fi

# npm publish without intent
if echo "$COMMAND" | grep -qE '^npm\s+publish'; then
  BLOCKED_REASON="Warning: npm publish will publish to the public registry. Ensure this is intentional."
fi

# Dropping/truncating database tables
if echo "$COMMAND" | grep -qiE '(DROP\s+TABLE|TRUNCATE\s+TABLE|DROP\s+DATABASE)'; then
  BLOCKED_REASON="Warning: Database destructive operations detected. Verify before proceeding."
fi

if [ -n "$BLOCKED_REASON" ]; then
  # Check if it's a hard block or a warning
  if echo "$BLOCKED_REASON" | grep -q "^Blocked:"; then
    cat << EOF
{
  "decision": "block",
  "reason": "$BLOCKED_REASON\n\nCommand: $COMMAND\n\nIf you need to perform this operation, please do it manually."
}
EOF
  else
    # Warning - provide context but don't block
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "## $BLOCKED_REASON\n\nCommand: \`$COMMAND\`\n\nProceed with caution."
  }
}
EOF
  fi
fi

exit 0
