#!/bin/bash
# .claude/hooks/hooks-common.sh
# Shared utilities for all hooks — artifact storage for LLM self-debugging
#
# Source this at the top of every hook:
#   source "$(dirname "$0")/hooks-common.sh"
#
# Then call save_hook_artifact before outputting JSON:
#   save_hook_artifact "hook-name" "$JSON_OUTPUT"

_HOOKS_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Resolve the tx CLI command. Hooks can't rely on `tx` being in PATH.
# Falls back to running via bun from the project directory.
# Uses separate variables (not a single string) to avoid word-splitting
# when paths contain spaces. Bash 3.2 compatible (no arrays needed).
_TX_CMD_BIN=""
_TX_CMD_ARG=""
tx_cmd() {
  if [ -n "$_TX_CMD_BIN" ]; then
    if [ -n "$_TX_CMD_ARG" ]; then
      "$_TX_CMD_BIN" "$_TX_CMD_ARG" "$@"
    else
      "$_TX_CMD_BIN" "$@"
    fi
    return $?
  fi

  # Try bare `tx` first
  if command -v tx >/dev/null 2>&1; then
    _TX_CMD_BIN="tx"
    "$_TX_CMD_BIN" "$@"
    return $?
  fi

  # Try bun with the CLI source
  local cli_path="$_HOOKS_PROJECT_DIR/apps/cli/src/cli.ts"
  if [ -f "$cli_path" ]; then
    if command -v bun >/dev/null 2>&1; then
      _TX_CMD_BIN="bun"
      _TX_CMD_ARG="$cli_path"
      "$_TX_CMD_BIN" "$_TX_CMD_ARG" "$@"
      return $?
    fi
  fi

  # tx not available
  return 127
}

# Check if tx CLI is available (without running a command)
tx_available() {
  command -v tx >/dev/null 2>&1 && return 0
  [ -f "$_HOOKS_PROJECT_DIR/apps/cli/src/cli.ts" ] && command -v bun >/dev/null 2>&1 && return 0
  return 1
}

# Save hook output as a JSONL line for post-mortem debugging.
# Artifacts are best-effort — failures are silently ignored.
#
# Usage: save_hook_artifact "hook-name" '{"key": "value"}'
#
# Artifacts are appended to:
#   .tx/hook-artifacts/<run-id>.jsonl
#
# One line per hook invocation. Atomic append on POSIX.
# Run ID comes from RALPH_RUN_ID (ralph mode), CLAUDE_SESSION_ID (interactive), or "default".
#
# Inspect with:
#   cat .tx/hook-artifacts/<run-id>.jsonl | jq .
#   grep "pre-safety" .tx/hook-artifacts/<run-id>.jsonl | jq .
save_hook_artifact() {
  local hook_name="$1"
  local artifact_json="$2"

  # Skip if no output to save
  if [ -z "$artifact_json" ]; then
    return 0
  fi

  local run_id="${RALPH_RUN_ID:-${CLAUDE_SESSION_ID:-default}}"
  local artifact_dir="$_HOOKS_PROJECT_DIR/.tx/hook-artifacts"
  mkdir -p "$artifact_dir" 2>/dev/null || true

  # Append as single JSONL line (atomic on POSIX)
  echo "$artifact_json" >> "$artifact_dir/${run_id}.jsonl" 2>/dev/null || true
}
