---
name: release
description: Release a new version of tx to npm and GitHub
disable-model-invocation: true
argument-hint: [version]
---

# Release tx

Release a new version of tx. The version argument is required (e.g., `/release 0.5.2`).

## Pre-flight checks

1. Ensure the working tree is clean (`git status`). If there are uncommitted changes, ask the user whether to commit them first or abort.
2. Verify the current branch is `main`.
3. Check npm for the latest published version to confirm the new version hasn't already been published:
   ```bash
   npm view @jamesaphoenix/tx version
   ```

## Version bump

Update **all 9** package.json files (root + 4 packages + 4 apps) to the new version. The private apps (dashboard, docs) stay at their own versions and should NOT be bumped.

Files to update:
- `package.json` (root)
- `packages/tx/package.json`
- `packages/core/package.json`
- `packages/types/package.json`
- `packages/test-utils/package.json`
- `apps/cli/package.json`
- `apps/api-server/package.json`
- `apps/mcp-server/package.json`
- `apps/agent-sdk/package.json`

Use `sed` to replace the version string in all files at once.

## Commit, tag, push

1. Stage all updated package.json files.
2. Commit with message: `chore: release v$ARGUMENTS`
3. Create tag: `git tag v$ARGUMENTS`
4. Push both: `git push origin main && git push origin v$ARGUMENTS`

## Create GitHub release

Use `gh release create` with release notes summarizing what changed since the last tag:

```bash
gh release create v$ARGUMENTS --title "v$ARGUMENTS" --generate-notes
```

## Post-release monitoring

Watch all three CI workflows until they complete:
- **CI** (push to main)
- **Release Binaries** (tag push — builds platform binaries)
- **Publish to npm** (release event — publishes packages)

```bash
gh run list --limit 5
```

Report the final status of each workflow to the user. If any fail, investigate the logs with `gh run view --job=<id> --log-failed`.

## Verify npm publication

After the Publish workflow succeeds, confirm the new version is live:

```bash
npm view @jamesaphoenix/tx version
```
