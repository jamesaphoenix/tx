import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

function runTx(args: string[], cwd: string): ExecResult {
  const res = spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
  })
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

describe("tx doc command default behavior", () => {
  let tmpProjectDir: string

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-cli-"))
    const init = runTx(["init", "--codex"], tmpProjectDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("defaults to listing docs when no subcommand is provided", () => {
    const result = runTx(["doc"], tmpProjectDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No docs found")
  })

  it("lists docs from tx doc after creating one", () => {
    const addDoc = runTx(
      ["doc", "add", "overview", "doc-default-test", "--title", "Doc Default Test"],
      tmpProjectDir,
    )
    expect(addDoc.status).toBe(0)

    const result = runTx(["doc"], tmpProjectDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("doc-default-test")
    expect(result.stdout).toContain("doc(s):")
  })

  it("returns JSON list when using tx doc --json", () => {
    const addDoc = runTx(
      ["doc", "add", "overview", "doc-default-json", "--title", "Doc Default Json"],
      tmpProjectDir,
    )
    expect(addDoc.status).toBe(0)

    const result = runTx(["doc", "--json"], tmpProjectDir)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as Array<{ name: string }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.some((doc) => doc.name === "doc-default-json")).toBe(true)
  })
})

