/**
 * Integration test for install.sh — validates the install script downloads
 * and installs a working tx binary.
 *
 * Requires network access to GitHub. Excluded from default vitest runs.
 * Run explicitly: bunx --bun vitest run test/integration/install-script.test.ts
 */
import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, existsSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const INSTALL_SCRIPT = join(ROOT, "install.sh")
const VERSION = "0.5.9"

const tmpDir = mkdtempSync(join(tmpdir(), "tx-install-test-"))

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("install.sh", () => {
  it("is valid POSIX sh syntax", () => {
    const result = spawnSync("sh", ["-n", INSTALL_SCRIPT])
    expect(result.status).toBe(0)
  })

  it("is valid bash syntax", () => {
    const result = spawnSync("bash", ["-n", INSTALL_SCRIPT])
    expect(result.status).toBe(0)
  })

  it("downloads and installs the binary", () => {
    const result = spawnSync("sh", [INSTALL_SCRIPT], {
      env: {
        ...process.env,
        TX_INSTALL_DIR: tmpDir,
        TX_VERSION: VERSION,
      },
      timeout: 60_000,
    })

    expect(result.status).toBe(0)
    expect(result.stdout.toString()).toContain(`Installed tx v${VERSION}`)

    const binaryPath = join(tmpDir, "tx")
    expect(existsSync(binaryPath)).toBe(true)
  })

  it("installed binary is executable", () => {
    const binaryPath = join(tmpDir, "tx")
    const stat = statSync(binaryPath)
    // Check executable bit (owner)
    expect(stat.mode & 0o100).toBeGreaterThan(0)
  })
})
