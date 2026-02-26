/**
 * Integration test: npm binary distribution
 *
 * Simulates what happens when a user installs @jamesaphoenix/tx-cli from npm
 * and runs the tx binary with bun. Validates:
 * - Shebang is #!/usr/bin/env bun (not node)
 * - Published packages don't have "bun" export condition (which points to missing src/ files)
 * - The binary actually runs: tx help, tx init, tx add
 *
 * IMPORTANT: Bun vitest workers (--bun flag + fork pool) inject loader hooks
 * that break npm subprocesses with "BuildMessage {}" errors. The heavy setup
 * (npm pack + install) runs via an external bash script to avoid this.
 *
 * This test is SLOW and excluded from default vitest runs.
 * Run: bash test/integration/cli-npm-binary-setup.sh && \
 *      TX_NPM_BINARY_DIR=<dir> bunx --bun vitest run test/integration/cli-npm-binary.test.ts
 *
 * Or all-in-one:
 *   DIR=$(bash test/integration/cli-npm-binary-setup.sh) && \
 *   TX_NPM_BINARY_DIR="$DIR" bunx --bun vitest run test/integration/cli-npm-binary.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const TIMEOUT = process.env.CI ? 60000 : 30000

// Packages in dependency order
const PACK_ORDER = [
  { dir: "packages/types", name: "@jamesaphoenix/tx-types" },
  { dir: "packages/core", name: "@jamesaphoenix/tx-core" },
  { dir: "packages/test-utils", name: "@jamesaphoenix/tx-test-utils" },
  { dir: "packages/tx", name: "@jamesaphoenix/tx" },
  { dir: "apps/cli", name: "@jamesaphoenix/tx-cli" },
]

describe("CLI npm binary distribution", () => {
  let tmpDir: string

  beforeAll(() => {
    // Check for pre-built fixture dir from setup script
    const prebuilt = process.env.TX_NPM_BINARY_DIR
    if (prebuilt && existsSync(join(prebuilt, "node_modules"))) {
      tmpDir = prebuilt
      return
    }

    // Fallback: run setup script inline (works from shell, not from vitest --bun workers)
    const setupScript = resolve(__dirname, "cli-npm-binary-setup.sh")
    const result = spawnSync("/bin/bash", [setupScript], {
      encoding: "utf-8",
      timeout: TIMEOUT * 4,
    })

    if (result.status !== 0) {
      throw new Error(
        `Setup script failed (exit ${result.status}):\n${result.stderr}`
      )
    }

    tmpDir = result.stdout.trim().split("\n")[0]!
    if (!existsSync(join(tmpDir, "node_modules"))) {
      throw new Error(`Setup produced invalid dir: ${tmpDir}`)
    }
  }, TIMEOUT * 5)

  it("installed cli.js has bun shebang", () => {
    const cliPath = join(
      tmpDir,
      "node_modules/@jamesaphoenix/tx-cli/dist/cli.js"
    )
    expect(existsSync(cliPath)).toBe(true)
    const content = readFileSync(cliPath, "utf-8")
    expect(content.startsWith("#!/usr/bin/env bun")).toBe(true)
  })

  it("published packages do not have bun export condition", () => {
    for (const pkg of PACK_ORDER.filter((p) => p.dir.startsWith("packages/"))) {
      const pkgJsonPath = join(tmpDir, "node_modules", pkg.name, "package.json")
      if (!existsSync(pkgJsonPath)) continue

      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
      for (const [subpath, conditions] of Object.entries(
        (pkgJson.exports ?? {}) as Record<string, Record<string, unknown>>
      )) {
        if (conditions && typeof conditions === "object") {
          expect(
            conditions,
            `${pkg.name} export "${subpath}" should not have "bun" condition`
          ).not.toHaveProperty("bun")
        }
      }
    }
  })

  it("tx help runs successfully via bun", () => {
    const txBin = join(
      tmpDir,
      "node_modules/@jamesaphoenix/tx-cli/dist/cli.js"
    )
    const result = spawnSync("bun", [txBin, "help"], {
      encoding: "utf-8",
      timeout: TIMEOUT,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx")
  }, TIMEOUT)

  it("tx --version returns version string", () => {
    const txBin = join(
      tmpDir,
      "node_modules/@jamesaphoenix/tx-cli/dist/cli.js"
    )
    const result = spawnSync("bun", [txBin, "--version"], {
      encoding: "utf-8",
      timeout: TIMEOUT,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
  }, TIMEOUT)

  it("tx init + tx add works in isolated install", () => {
    const txBin = join(
      tmpDir,
      "node_modules/@jamesaphoenix/tx-cli/dist/cli.js"
    )
    const dbPath = join(tmpDir, "test-tasks.db")

    const init = spawnSync("bun", [txBin, "init", "--db", dbPath], {
      encoding: "utf-8",
      timeout: TIMEOUT,
    })
    expect(init.status).toBe(0)

    const add = spawnSync(
      "bun",
      [txBin, "add", "test task", "--db", dbPath, "--json"],
      { encoding: "utf-8", timeout: TIMEOUT }
    )
    expect(add.status).toBe(0)
    expect(add.stdout).toContain("test task")
  }, TIMEOUT)
})
