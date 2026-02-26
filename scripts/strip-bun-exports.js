#!/usr/bin/env node
/**
 * strip-bun-exports.js
 *
 * Removes the "bun" export condition from published packages before npm publish.
 * The "bun" condition points to src/*.ts files which aren't in the npm tarball
 * (only dist/ is published). Without stripping, bun resolves the missing src/
 * files and throws an ESM loader error.
 *
 * Usage:
 *   node scripts/strip-bun-exports.js            # Strip "bun" conditions, save backups
 *   node scripts/strip-bun-exports.js --restore   # Restore from backups
 */

import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

const PACKAGES = [
  "packages/types",
  "packages/core",
  "packages/test-utils",
  "packages/tx",
]

const restore = process.argv.includes("--restore")

let changed = 0

for (const pkg of PACKAGES) {
  const pkgJsonPath = resolve(ROOT, pkg, "package.json")
  const backupPath = pkgJsonPath + ".bak"

  if (restore) {
    if (!existsSync(backupPath)) {
      console.log(`  skip ${pkg} (no backup found)`)
      continue
    }
    copyFileSync(backupPath, pkgJsonPath)
    unlinkSync(backupPath)
    console.log(`  restored ${pkg}/package.json`)
    changed++
  } else {
    // Backup original
    copyFileSync(pkgJsonPath, backupPath)

    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
    let stripped = 0

    if (pkgJson.exports && typeof pkgJson.exports === "object") {
      for (const [, conditions] of Object.entries(pkgJson.exports)) {
        if (conditions && typeof conditions === "object" && "bun" in conditions) {
          delete conditions.bun
          stripped++
        }
      }
    }

    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n")
    console.log(`  stripped ${stripped} "bun" conditions from ${pkg}/package.json`)
    changed++
  }
}

console.log(`\n${restore ? "Restored" : "Stripped"} ${changed} packages.`)
