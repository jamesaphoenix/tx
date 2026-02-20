#!/bin/bash
# Enforce workflow policy: never bypass git hooks via --no-verify or git commit -n
#
# This protects both Claude and Codex automation workflows from silently skipping
# repo verification gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

SEARCH_PATHS=(
  "scripts"
  ".claude"
  ".codex"
  ".husky"
  "apps/cli/src/templates"
)

violations=""

# Detect concrete git commands that bypass hooks.
# Require `--no-verify` / `-n` to be followed by another option or end-of-command
# to avoid matching explanatory prose (for example: "git commit -n bypasses...").
if matches=$(rg -n --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!scripts/enforce-no-verify.sh' 'git[[:space:]]+(commit|push|merge|rebase|cherry-pick)\b[^\n]*--no-verify([[:space:]]+-|$)' "${SEARCH_PATHS[@]}" 2>/dev/null); then
  violations="${violations}${matches}"$'\n'
fi

if matches=$(rg -n --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!scripts/enforce-no-verify.sh' 'git[[:space:]]+commit\b[^\n]*[[:space:]]-n([[:space:]]+-|$)' "${SEARCH_PATHS[@]}" 2>/dev/null); then
  violations="${violations}${matches}"$'\n'
fi

if [ -n "$violations" ]; then
  echo "Hook bypass policy violation detected:"
  echo "$violations"
  echo "Remove --no-verify / git commit -n usage from workflow files."
  exit 1
fi

exit 0
