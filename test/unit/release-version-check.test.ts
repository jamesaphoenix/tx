import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("release binary version check", () => {
  it("drains binary strings under pipefail without a false SIGPIPE failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "tx-release-version-"))
    directories.push(directory)
    const artifact = "tx-fixture"
    writeFileSync(join(directory, artifact), `0.20.0\n${"binary text\n".repeat(200_000)}`)
    const workflow = readFileSync(".github/workflows/release.yml", "utf8")
    const pipeline = workflow.match(/^\s*(strings .*?) \|\| \{/m)?.[1]
    expect(pipeline).toBeDefined()
    const result = spawnSync("bash", ["-o", "pipefail", "-c", pipeline!], {
      cwd: directory,
      env: { ...process.env, BUILD_ARTIFACT: artifact, TX_CLI_VERSION: "0.20.0" },
      encoding: "utf8",
    })
    expect(result.status, result.stderr).toBe(0)

    const missing = spawnSync("bash", ["-o", "pipefail", "-c", pipeline!], {
      cwd: directory,
      env: { ...process.env, BUILD_ARTIFACT: artifact, TX_CLI_VERSION: "9.99.99" },
      encoding: "utf8",
    })
    expect(missing.status).not.toBe(0)
  })
})
