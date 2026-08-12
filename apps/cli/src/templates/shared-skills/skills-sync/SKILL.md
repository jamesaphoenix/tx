---
name: skills-sync
description: Refresh bundled tx Claude Code and Codex skills in a project from the canonical tx source without manual copy and paste.
---

# Skills Sync

Use this skill when the user wants to install or refresh the tx-managed skills
for Claude Code, Codex, or both in a target project.

## Core Command

```bash
tx skills sync
```

## Common Variants

```bash
tx skills sync --target claude
tx skills sync --target codex
tx skills sync --project-dir /absolute/path/to/project
tx skills sync --project-dir /absolute/path/to/project --json
```

## Workflow

1. Pick the host surface to refresh: Claude Code, Codex, or both.
2. Run `tx skills sync` from the canonical tx checkout or any environment where
   the desired tx version is installed.
3. Review the summary for `added`, `updated`, and `unchanged` files.
4. If the target project has custom local skills, leave them in place.
   `tx skills sync` updates the tx-managed bundle and preserves unrelated skill
   directories.

## Practical Notes

- Use `--project-dir` when you want to sync another repo without changing the
  current working directory.
- Use `--target codex` or `--target claude` when only one host needs an update.
- When changing canonical tx source, invoke that checkout's source CLI (for
  example `bun apps/cli/src/cli.ts skills sync ...`). A globally installed
  `tx` only contains its published templates and cannot see unbuilt local edits.
- Sync into a clean target checkout or worktree. The command updates every
  tx-managed file for the selected target, so review the complete diff before
  committing it.
- Re-run the command after upgrading tx or after changing shared skill templates
  in the canonical tx repo.
