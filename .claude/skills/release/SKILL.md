---
name: release
description: Release a new lockstep version of tx to GitHub and npm with preflight validation, workflow monitoring, and registry verification.
disable-model-invocation: true
argument-hint: [version]
---

# Release tx

Use this skill when cutting a real workspace release.

The version argument is required, for example:

```bash
/release 0.9.3
```

## Rules

1. Use a fresh version every time. If a publish partially failed, do not reuse that version.
2. Treat the workspace as lockstep versioned.
3. Publish every non-private package.
4. Do not stop at tag creation. Wait for `publish.yml` and verify npm.

## Release Surface

Lockstep bump these workspace versions:

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

Published packages:

- `@jamesaphoenix/tx-types`
- `@jamesaphoenix/tx-core`
- `@jamesaphoenix/tx-test-utils`
- `@jamesaphoenix/tx`
- `@jamesaphoenix/tx-agent-sdk`
- `@jamesaphoenix/tx-api-server`
- `@jamesaphoenix/tx-mcp-server`
- `@jamesaphoenix/tx-cli`

## Preflight

Run the enforced local preflight first:

```bash
node scripts/release-preflight.mjs "$ARGUMENTS"
```

Then run the release gates:

```bash
bun run sync-readme
bun run test:packages
bunx eslint apps/ packages/ --max-warnings 0
bun run typecheck
```

Also confirm the target version is not already live:

```bash
npm view @jamesaphoenix/tx version
```

## Version Bump

Update all 11 workspace `package.json` files to the target version.

Do not leave private apps behind on old versions. Keep the repo in lockstep.

## Commit, Tag, Push

Use a conventional commit:

```bash
git add package.json packages/*/package.json apps/*/package.json
git commit -m "chore(release): $ARGUMENTS"
git push origin main
git tag v$ARGUMENTS
git push origin v$ARGUMENTS
```

## Create GitHub Release

```bash
gh release create v$ARGUMENTS --title "v$ARGUMENTS" --generate-notes
```

If this is a recovery release, replace generated notes with a short explicit summary of the recovery reason.

## Monitor Publish

Poll the publish workflow until it reaches a terminal state:

```bash
gh run list --workflow publish.yml --limit 5
gh run watch <run-id> --exit-status
```

If it fails:

```bash
gh run view <run-id> --json jobs
gh run view <run-id> --job <job-id> --log
```

Fix forward with a fresh patch version. Do not mutate a failed public version.

## Verify npm

Confirm all published packages reached the target version:

```bash
npm view @jamesaphoenix/tx version
npm view @jamesaphoenix/tx-types version
npm view @jamesaphoenix/tx-core version
npm view @jamesaphoenix/tx-test-utils version
npm view @jamesaphoenix/tx-agent-sdk version
npm view @jamesaphoenix/tx-api-server version
npm view @jamesaphoenix/tx-mcp-server version
npm view @jamesaphoenix/tx-cli version
```

## Failure Patterns This Skill Guards Against

- publish workflow missing a non-private package
- provenance failure from missing package metadata
- partial publish followed by an attempted version reuse
- cutting a tag without checking the actual publish run
- docs/SDK mismatch because the package never shipped
- release noise from local `.tx/` runtime state
