#!/bin/bash
# Install the three publishable packages from tarballs, without mutating the checkout.
# Usage: bash test/integration/cli-npm-binary-setup.sh [output-dir]
# stdout contains only the fixture directory; diagnostics go to stderr.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SETUP_DIR="${1:-$(mktemp -d /tmp/tx-npm-binary-XXXXXX)}"
mkdir -p "$SETUP_DIR"
SETUP_DIR="$(cd "$SETUP_DIR" && pwd)"
STAGING_DIR="$(mktemp -d /tmp/tx-npm-pack-XXXXXX)"
trap 'rm -rf "$STAGING_DIR"' EXIT

for pkg in packages/core apps/agent-sdk apps/cli; do
  pkg_stage="$STAGING_DIR/$pkg"
  mkdir -p "$pkg_stage"
  cp "$PROJECT_DIR/$pkg/package.json" "$pkg_stage/package.json"
  cp -R "$PROJECT_DIR/$pkg/dist" "$pkg_stage/dist"
  cp "$PROJECT_DIR/$pkg/README.md" "$pkg_stage/README.md"
  if [ -d "$PROJECT_DIR/$pkg/migrations" ]; then
    cp -R "$PROJECT_DIR/$pkg/migrations" "$pkg_stage/migrations"
  fi
  node --input-type=module - "$pkg_stage/package.json" <<'JS'
import {readFileSync, writeFileSync} from "node:fs"
const path = process.argv[2]
const pkg = JSON.parse(readFileSync(path, "utf8"))
for (const conditions of Object.values(pkg.exports ?? {})) {
  if (conditions && typeof conditions === "object") delete conditions.bun
}
writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
JS
  (cd "$pkg_stage" && npm pack --ignore-scripts --pack-destination "$SETUP_DIR" >&2)
done
npm install --ignore-scripts --prefix "$SETUP_DIR" "$SETUP_DIR"/*.tgz >&2
printf '%s\n' "$SETUP_DIR"
