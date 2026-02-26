#!/bin/bash
# Setup script for cli-npm-binary.test.ts
# Creates an isolated npm install of tx-cli from packed tarballs.
# Run BEFORE the vitest test (vitest workers can't run npm pack).
#
# Usage: bash test/integration/cli-npm-binary-setup.sh [output-dir]
# Output: prints the tmp directory path to stdout

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SETUP_DIR="${1:-$(mktemp -d /tmp/tx-npm-binary-XXXXXX)}"

echo "$SETUP_DIR"

cleanup() {
  cd "$ROOT"
  node scripts/strip-bun-exports.js --restore >&2 2>/dev/null || true
}
trap cleanup EXIT

cd "$ROOT"

# 1. Strip bun export conditions
node scripts/strip-bun-exports.js >&2

# 2. Pack each package
for pkg in packages/types packages/core packages/test-utils packages/tx apps/cli; do
  (cd "$pkg" && npm pack --pack-destination "$SETUP_DIR" >/dev/null 2>&1)
done

# 3. Install all tarballs
npm install --prefix "$SETUP_DIR" "$SETUP_DIR"/*.tgz >/dev/null 2>&1

# 4. Restore (also handled by trap)
node scripts/strip-bun-exports.js --restore >&2

echo "Setup complete" >&2
