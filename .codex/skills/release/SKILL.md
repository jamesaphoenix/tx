---
name: "release"
description: "Cut a lockstep tx release with enforced preflight validation, workflow monitoring, and npm verification. Use when bumping versions, tagging releases, repairing partial publishes, or checking publish readiness."
metadata:
  short-description: "Ship a verified tx release"
---

# Release

Use this skill when shipping a new `tx` version.

## Default Flow

1. Run the local preflight:

```bash
node scripts/release-preflight.mjs <version>
```

2. Run the release gates:

```bash
bun run sync-readme
bun run test:packages
bunx eslint apps/ packages/ --max-warnings 0
bun run typecheck
```

3. Bump all workspace versions in lockstep:

- `package.json`
- `packages/types/package.json`
- `packages/core/package.json`
- `packages/test-utils/package.json`
- `packages/tx/package.json`
- `apps/cli/package.json`
- `apps/agent-sdk/package.json`
- `apps/api-server/package.json`
- `apps/mcp-server/package.json`
- `apps/dashboard/package.json`
- `apps/docs/package.json`

4. Commit, push, tag, and create the GitHub release.
5. Watch `publish.yml` to completion.
6. Verify npm registry versions for every published package.

## In This Repo

- publish workflow: `.github/workflows/publish.yml`
- README sync: `scripts/sync-readme.sh`
- preflight guardrail: `scripts/release-preflight.mjs`

Published packages:

- `@jamesaphoenix/tx-types`
- `@jamesaphoenix/tx-core`
- `@jamesaphoenix/tx-test-utils`
- `@jamesaphoenix/tx`
- `@jamesaphoenix/tx-agent-sdk`
- `@jamesaphoenix/tx-api-server`
- `@jamesaphoenix/tx-mcp-server`
- `@jamesaphoenix/tx-cli`

## Rules

- Always use a fresh version. If a publish failed, ship a new patch version.
- Do not stop at tag creation. The release is not done until `publish.yml` succeeds.
- Treat the workspace as lockstep versioned, including private apps.
- Confirm npm moved, not just GitHub Actions.

## Commands

```bash
node scripts/release-preflight.mjs <version>
npm view @jamesaphoenix/tx version
git commit -m "chore(release): <version>"
git push origin main
git tag v<version>
git push origin v<version>
gh release create v<version> --title "v<version>" --generate-notes
gh run list --workflow publish.yml --limit 5
gh run watch <run-id> --exit-status
```

## Recovery

If publish fails:

1. Inspect the failing step with `gh run view`.
2. Fix the real issue locally.
3. Re-run the release gates.
4. Cut a fresh patch version.
5. Optionally delete the stale failed GitHub release and tag if they should not stay visible.
