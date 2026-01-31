#!/bin/bash
# .claude/hooks/pre-safety.sh
# Comprehensive safety guardrails for Claude Code PreToolUse
# Blocks dangerous operations that could cause data loss, security issues, or unintended side effects

set -e

# Get project directory from environment or use current directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROJECT_DIR_ABS=$(cd "$PROJECT_DIR" 2>/dev/null && pwd || echo "$PROJECT_DIR")

# Read input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# Output functions for consistent JSON responses
deny() {
  local reason="$1"
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "$reason"
  }
}
EOF
  exit 0
}

allow() {
  local reason="$1"
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "$reason"
  }
}
EOF
  exit 0
}

warn() {
  local reason="$1"
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "## Safety Warning\n\n$reason"
  }
}
EOF
  exit 0
}

# ============================================================================
# BASH TOOL SAFETY CHECKS
# ============================================================================

check_bash_safety() {
  local cmd="$1"

  # Skip empty commands
  if [ -z "$cmd" ]; then
    return 0
  fi

  # Block: rm -rf (unless targeting node_modules or dist)
  if echo "$cmd" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)'; then
    # Check if it's targeting safe directories
    if echo "$cmd" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+.*\bnode_modules\b'; then
      allow "Auto-approved: rm -rf on node_modules is safe cleanup"
    elif echo "$cmd" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+.*\bdist\b'; then
      allow "Auto-approved: rm -rf on dist is safe cleanup"
    elif echo "$cmd" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+.*\bbuild\b'; then
      allow "Auto-approved: rm -rf on build directory is safe cleanup"
    elif echo "$cmd" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+.*\bcoverage\b'; then
      allow "Auto-approved: rm -rf on coverage directory is safe cleanup"
    elif echo "$cmd" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+.*\.cache'; then
      allow "Auto-approved: rm -rf on cache directory is safe cleanup"
    else
      deny "Blocked: rm -rf is not allowed. Use targeted deletion instead, or limit to node_modules/dist/build directories."
    fi
  fi

  # Block: git push --force (any variant)
  if echo "$cmd" | grep -qE 'git\s+push\s+.*--force'; then
    deny "Blocked: git push --force can destroy remote history. Use git push --force-with-lease for safer force pushes, or avoid force pushing entirely."
  fi
  if echo "$cmd" | grep -qE 'git\s+push\s+-f\b'; then
    deny "Blocked: git push -f can destroy remote history. Use git push --force-with-lease for safer force pushes."
  fi

  # Block: git reset --hard
  if echo "$cmd" | grep -qE 'git\s+reset\s+--hard'; then
    deny "Blocked: git reset --hard discards all uncommitted changes permanently. Use git stash to save changes first, or git reset --soft to keep changes staged."
  fi

  # Block: Operations outside CLAUDE_PROJECT_DIR (cd to outside directories)
  if echo "$cmd" | grep -qE '^cd\s+(/|~|\$HOME)' && ! echo "$cmd" | grep -qE "cd\s+['\"]?$PROJECT_DIR_ABS"; then
    # Allow cd to project dir or subdirectories
    local target=$(echo "$cmd" | sed -n 's/^cd\s\+\([^ ]*\).*/\1/p' | head -1)
    if [ -n "$target" ]; then
      target=$(eval echo "$target" 2>/dev/null || echo "$target")
      if [[ "$target" != "$PROJECT_DIR_ABS"* ]]; then
        deny "Blocked: cd to directories outside project. Operations should stay within CLAUDE_PROJECT_DIR ($PROJECT_DIR_ABS)."
      fi
    fi
  fi

  # Block: curl/wget piped to sh/bash
  if echo "$cmd" | grep -qE 'curl\s+.*\|\s*(bash|sh|zsh|source)'; then
    deny "Blocked: Piping curl output to shell is dangerous. Download the script first, review it, then execute."
  fi
  if echo "$cmd" | grep -qE 'wget\s+.*(-O\s*-|--output-document=-).*\|\s*(bash|sh|zsh)'; then
    deny "Blocked: Piping wget output to shell is dangerous. Download the script first, review it, then execute."
  fi
  if echo "$cmd" | grep -qE '\$\(curl'; then
    deny "Blocked: Executing curl output via command substitution is dangerous. Download and review scripts first."
  fi

  # Block: chmod 777 (world-writable is a security risk)
  if echo "$cmd" | grep -qE 'chmod\s+777\b'; then
    deny "Blocked: chmod 777 makes files world-writable, which is a security risk. Use more restrictive permissions like 755 or 644."
  fi
  if echo "$cmd" | grep -qE 'chmod\s+-R\s+777\b'; then
    deny "Blocked: Recursive chmod 777 is extremely dangerous. Never make directories world-writable."
  fi

  # Block: sudo commands (agents shouldn't need elevated privileges)
  if echo "$cmd" | grep -qE '^\s*sudo\s'; then
    deny "Blocked: sudo commands require elevated privileges. Agents should not run with root access. Perform system administration manually."
  fi

  # Block: Deleting .git directory
  if echo "$cmd" | grep -qE 'rm\s+.*\.git\b'; then
    deny "Blocked: Deleting .git directory destroys version control history. This is almost never the right thing to do."
  fi

  # Block: Dangerous system directories
  if echo "$cmd" | grep -qE 'rm\s+.*(/etc|/usr|/var|/bin|/sbin|/lib|/boot|/root)\b'; then
    deny "Blocked: Operations targeting system directories are not allowed."
  fi

  # Block: Writing to /etc or other system locations
  if echo "$cmd" | grep -qE '>\s*/etc/|>>\s*/etc/'; then
    deny "Blocked: Writing to /etc or system directories is not allowed."
  fi

  # Warn about potentially risky operations
  if echo "$cmd" | grep -qE 'npm\s+publish'; then
    warn "npm publish will publish to the public registry. Ensure this is intentional."
  fi

  if echo "$cmd" | grep -qE 'git\s+clean\s+-f'; then
    warn "git clean -f will permanently delete untracked files."
  fi

  if echo "$cmd" | grep -qE '(DROP\s+TABLE|TRUNCATE\s+TABLE|DROP\s+DATABASE)'; then
    warn "Database destructive operations detected. Verify before proceeding."
  fi
}

# ============================================================================
# WRITE/EDIT TOOL SAFETY CHECKS
# ============================================================================

check_write_safety() {
  local path="$1"
  local content="$2"

  if [ -z "$path" ]; then
    return 0
  fi

  # Resolve the file path to absolute
  local abs_path
  if [[ "$path" = /* ]]; then
    abs_path="$path"
  else
    abs_path="$PROJECT_DIR_ABS/$path"
  fi

  # Normalize the path
  local resolved_path
  resolved_path=$(realpath -m "$abs_path" 2>/dev/null || echo "$abs_path")

  # Block: Operations outside project directory
  if [[ "$resolved_path" != "$PROJECT_DIR_ABS"* ]]; then
    deny "Blocked: File path is outside the project directory. Path: $path. Operations must stay within $PROJECT_DIR_ABS."
  fi

  # Block: Writing to .env files (may contain secrets)
  local basename
  basename=$(basename "$path")
  if echo "$basename" | grep -qE '^\.env(\..*)?$'; then
    # Check if content contains potential secrets
    if [ -n "$content" ]; then
      if echo "$content" | grep -qiE '(API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY|CREDENTIAL).*=.*[A-Za-z0-9]'; then
        deny "Blocked: Writing secrets to .env file. Never commit secrets to version control. Use environment variables or secure secret management."
      fi
    fi
    warn "Writing to .env file. Ensure no secrets are being committed to version control."
  fi

  # Block: Modifications to .git/ directory
  if echo "$resolved_path" | grep -qE '/\.git(/|$)'; then
    deny "Blocked: Direct modifications to .git directory are not allowed. Use git commands instead."
  fi

  # Block: Writing to node_modules
  if echo "$resolved_path" | grep -qE '/node_modules(/|$)'; then
    deny "Blocked: Writing to node_modules is not allowed. Modify node_modules through package.json and npm/yarn."
  fi

  # Warn: Writing executable scripts
  if echo "$basename" | grep -qE '\.(sh|bash|zsh|fish|py|rb|pl)$'; then
    if [ -n "$content" ]; then
      # Check for shebang indicating executable
      if echo "$content" | head -1 | grep -qE '^#!'; then
        warn "Creating/modifying executable script: $basename. Review the script content before execution."
      fi
    fi
  fi

  # Warn: Writing to sensitive config files
  if echo "$basename" | grep -qiE '^(credentials|secrets|private|password)'; then
    warn "Writing to potentially sensitive file: $basename. Ensure no credentials are being exposed."
  fi

  # Warn: Writing SSH keys or certificates
  if echo "$resolved_path" | grep -qE '\.ssh/|\.pem$|\.key$|_rsa$|_ed25519$'; then
    deny "Blocked: Writing to SSH keys or certificate files is not allowed."
  fi
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

case "$TOOL_NAME" in
  Bash)
    check_bash_safety "$COMMAND"
    ;;
  Write|Edit)
    check_write_safety "$FILE_PATH" "$CONTENT"
    ;;
  *)
    # Unknown tool - allow by default
    ;;
esac

# If we get here, the operation is allowed (no explicit deny/allow/warn was called)
exit 0
