import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, symlinkSync, existsSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"

interface Sandbox {
  dir: string
}

const REPO_ROOT = resolve(__dirname, "..", "..")
const sandboxes: Sandbox[] = []

function createSandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "tx-init-onboarding-"))
  symlinkSync(resolve(REPO_ROOT, "apps"), join(dir, "apps"), "dir")
  symlinkSync(resolve(REPO_ROOT, "packages"), join(dir, "packages"), "dir")
  symlinkSync(resolve(REPO_ROOT, "migrations"), join(dir, "migrations"), "dir")
  symlinkSync(resolve(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir")
  const sandbox = { dir }
  sandboxes.push(sandbox)
  return sandbox
}

function runInit(sandbox: Sandbox, args: string[]) {
  return spawnSync("bun", ["apps/cli/src/cli.ts", "init", ...args], {
    cwd: sandbox.dir,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 90000,
  })
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0, sandboxes.length)) {
    if (existsSync(sandbox.dir)) {
      rmSync(sandbox.dir, { recursive: true, force: true })
    }
  }
})

describe("tx init onboarding edge cases", () => {
  it("init --codex creates AGENTS.md and codex agent profiles", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--codex"])
    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "AGENTS.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "agents", "tx-implementer.md"))).toBe(true)
  })

  it("init --claude creates CLAUDE.md and claude skills", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--claude"])
    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "CLAUDE.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".claude", "skills", "tx-workflow", "SKILL.md"))).toBe(true)
  })

  it("init --claude --codex creates both integrations", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--claude", "--codex"])
    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "CLAUDE.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, "AGENTS.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".claude", "skills", "tx-workflow", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "agents", "tx-implementer.md"))).toBe(true)
  })

  it("does not duplicate AGENTS tx section when heading uses hyphen variant", () => {
    const sandbox = createSandbox()
    writeFileSync(join(sandbox.dir, "AGENTS.md"), "# tx - Headless, Local Infra for AI Agents\n\ncustom\n")

    const result = runInit(sandbox, ["--codex"])
    expect(result.status).toBe(0)

    const agents = readFileSync(join(sandbox.dir, "AGENTS.md"), "utf-8")
    expect(agents.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
  })

  it("fails with a clear error when .codex path collides with a file", () => {
    const sandbox = createSandbox()
    writeFileSync(join(sandbox.dir, ".codex"), "not-a-directory")

    const result = runInit(sandbox, ["--codex"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("parent path exists as a file")
  })
})

