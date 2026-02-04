#!/bin/bash
set -e

# Sync README.md to all publishable packages
# This ensures NPM packages have the README (symlinks don't work with npm publish)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
README_SRC="$ROOT_DIR/README.md"

# List of packages that get published to npm
PACKAGES=(
  "packages/core"
  "packages/types"
  "packages/test-utils"
  "packages/tx"
)

if [ ! -f "$README_SRC" ]; then
  echo "Error: README.md not found at $README_SRC"
  exit 1
fi

echo "Syncing README.md to packages..."

for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$ROOT_DIR/$pkg"
  if [ -d "$PKG_DIR" ]; then
    # Remove existing README (could be a symlink)
    rm -f "$PKG_DIR/README.md"
    # Copy fresh README
    cp "$README_SRC" "$PKG_DIR/README.md"
    echo "  ✓ $pkg/README.md"
  else
    echo "  ⚠ $pkg does not exist, skipping"
  fi
done

echo "Done!"
