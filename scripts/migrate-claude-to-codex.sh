#!/usr/bin/env bash
# Convert Claude-native repo artifacts into Codex artifacts.
#
# Creates:
#   - AGENTS.md (from CLAUDE.md)
#   - .codex/agents/*.md (from .claude/agents/*.md)
#
# Usage:
#   ./scripts/migrate-claude-to-codex.sh
#   ./scripts/migrate-claude-to-codex.sh --force
#   ./scripts/migrate-claude-to-codex.sh --project-dir /path/to/repo

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FORCE=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: migrate-claude-to-codex.sh [options]

Options:
  --project-dir <path>  Repository root (default: script parent)
  --force               Overwrite existing AGENTS.md and .codex/agents/*.md
  --dry-run             Print what would be written without writing files
  --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
SOURCE_CLAUDE_MD="$PROJECT_DIR/CLAUDE.md"
SOURCE_CLAUDE_AGENTS_DIR="$PROJECT_DIR/.claude/agents"
TARGET_AGENTS_MD="$PROJECT_DIR/AGENTS.md"
TARGET_CODEX_AGENTS_DIR="$PROJECT_DIR/.codex/agents"

if [[ ! -f "$SOURCE_CLAUDE_MD" ]]; then
  echo "Missing source file: $SOURCE_CLAUDE_MD" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_CLAUDE_AGENTS_DIR" ]]; then
  echo "Missing source directory: $SOURCE_CLAUDE_AGENTS_DIR" >&2
  exit 1
fi

transform_file() {
  local input="$1"
  perl -0pe '
    s/\bCLAUDE\.md\b/AGENTS.md/g;
    s#\.claude/#.codex/#g;
    s/\btx sync claude\b/tx sync codex/g;
    s/\bClaude Code\b/Codex/g;
    s/\bclaude\b/codex/g;
    s/\bClaude\b/Codex/g;
  ' "$input"
}

write_transformed_file() {
  local source="$1"
  local target="$2"

  if [[ -f "$target" && "$FORCE" != true ]]; then
    echo "skip: $target (exists; use --force to overwrite)"
    return 0
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "write: $target (dry-run)"
    return 0
  fi

  mkdir -p "$(dirname "$target")"
  transform_file "$source" > "$target"
  echo "write: $target"
}

echo "project: $PROJECT_DIR"
write_transformed_file "$SOURCE_CLAUDE_MD" "$TARGET_AGENTS_MD"

agent_count=0
while IFS= read -r -d '' source_agent; do
  base_name="$(basename "$source_agent")"
  target_agent="$TARGET_CODEX_AGENTS_DIR/$base_name"
  write_transformed_file "$source_agent" "$target_agent"
  agent_count=$((agent_count + 1))
done < <(find "$SOURCE_CLAUDE_AGENTS_DIR" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

echo "converted agent profiles: $agent_count"
