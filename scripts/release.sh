#!/bin/bash
set -e

# Release script for @jamesaphoenix/tx
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.2.0

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.2.0"
  exit 1
fi

echo "🚀 Releasing @jamesaphoenix/tx v$VERSION"

# Keep every workspace package in lockstep. The published library now lives at
# packages/core; packages/tx was removed but this script still referenced it.
echo "📝 Updating version to $VERSION..."
node - "$VERSION" <<'NODE'
const fs = require("node:fs")

const version = process.argv[2]
const paths = [
  "package.json",
  "packages/core/package.json",
  "apps/agent-sdk/package.json",
  "apps/cli/package.json",
  "apps/docs/package.json",
  "apps/dashboard/package.json",
]

for (const path of paths) {
  const packageJson = JSON.parse(fs.readFileSync(path, "utf8"))
  packageJson.version = version
  fs.writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`)
}
NODE

# Build and test
echo "🔨 Building..."
bun run build

echo "🧪 Running package tests..."
# The publish workflow runs package tests; the root integration suite is a
# separate CI gate and can exceed local release timeouts.
bun run test:packages

# Commit the implementation and version bump. The release script is intended
# to run only from a clean checkout after the implementation has been reviewed.
echo "📦 Committing version bump..."
git add package.json packages/core/package.json apps/agent-sdk/package.json apps/cli/package.json apps/docs/package.json apps/dashboard/package.json
git commit -m "chore: release @jamesaphoenix/tx v$VERSION"

# Create and push tag
echo "🏷️  Creating tag v$VERSION..."
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"

echo ""
echo "✅ Tag pushed! Now create a GitHub release:"
echo "   https://github.com/jamesaphoenix/tx/releases/new?tag=v$VERSION"
echo ""
echo "The publish workflow will automatically publish to npm."
