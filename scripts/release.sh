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

# Update version in packages/tx/package.json
echo "📝 Updating version to $VERSION..."
cd packages/tx
npm version "$VERSION" --no-git-tag-version
cd ../..

# Build and test
echo "🔨 Building..."
npm run build

echo "🧪 Running tests..."
npm test

# Commit version bump
echo "📦 Committing version bump..."
git add packages/tx/package.json
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
