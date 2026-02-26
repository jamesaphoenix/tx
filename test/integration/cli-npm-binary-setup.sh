#!/bin/bash
# Setup script for cli-npm-binary.test.ts
# Creates an isolated npm install of tx-cli from packed tarballs.
# Run BEFORE the vitest test (vitest workers can't run npm pack).
#
# Usage: bash test/integration/cli-npm-binary-setup.sh [output-dir]
# Output: prints the tmp directory path to stdout

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMPDIR="${1:-$(mktemp -d /tmp/tx-npm-binary-XXXXXX)}"

echo "$TMPDIR"

cd "$ROOT"

# 1. Strip bun export conditions
node scripts/strip-bun-exports.js >&2

# 2. Pack each package
for pkg in packages/types packages/core packages/test-utils packages/tx apps/cli; do
  (cd "$pkg" && npm pack --pack-destination "$TMPDIR" >/dev/null 2>&1)
done

# 3. Install all tarballs
npm install --prefix "$TMPDIR" "$TMPDIR"/*.tgz >/dev/null 2>&1

# 4. Restore
node scripts/strip-bun-exports.js --restore >&2

echo "Setup complete" >&2
