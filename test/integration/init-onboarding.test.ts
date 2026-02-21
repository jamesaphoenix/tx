import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, symlinkSync, existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"

interface Sandbox {
  dir: string
}

const REPO_ROOT = resolve(__dirname, "..", "..")
const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun"
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

function runInit(
  sandbox: Sandbox,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; input?: string }
) {
  return spawnSync(BUN_BIN, ["apps/cli/src/cli.ts", "init", ...args], {
    cwd: sandbox.dir,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 90000,
    input: options?.input,
    env: {
      ...process.env,
      ...options?.env,
    },
  })
}

function createMockRuntime(sandbox: Sandbox, name: string): string {
  const binDir = join(sandbox.dir, ".bin")
  mkdirSync(binDir, { recursive: true })
  const runtimePath = join(binDir, name)
  writeFileSync(runtimePath, "#!/bin/bash\nexit 0\n")
  chmodSync(runtimePath, 0o755)
  return binDir
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

  it("init --watchdog scaffolds watchdog assets with runtime auto-detect", () => {
    const sandbox = createSandbox()
    const binDir = createMockRuntime(sandbox, "codex")
    const result = runInit(
      sandbox,
      ["--watchdog", "--watchdog-runtime", "auto"],
      { env: { PATH: `${binDir}:/usr/bin:/bin` } },
    )
    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "scripts", "watchdog-launcher.sh"))).toBe(true)
    expect(existsSync(join(sandbox.dir, "scripts", "ralph-watchdog.sh"))).toBe(true)
    expect(existsSync(join(sandbox.dir, "scripts", "ralph-hourly-supervisor.sh"))).toBe(true)
    expect(existsSync(join(sandbox.dir, "ops", "watchdog", "com.tx.ralph-watchdog.plist"))).toBe(true)
    expect(existsSync(join(sandbox.dir, "ops", "watchdog", "tx-ralph-watchdog.service"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".tx", "watchdog.env"))).toBe(true)

    const envContent = readFileSync(join(sandbox.dir, ".tx", "watchdog.env"), "utf-8")
    expect(envContent).toContain("WATCHDOG_ENABLED=1")
    expect(envContent).toContain("WATCHDOG_CODEX_ENABLED=1")
    expect(envContent).toContain("WATCHDOG_CLAUDE_ENABLED=0")
    expect(envContent).toContain("WATCHDOG_TRANSCRIPT_IDLE_SECONDS=600")
    expect(envContent).toContain("WATCHDOG_CLAUDE_STALL_GRACE_SECONDS=900")
    expect(envContent).toContain("WATCHDOG_ERROR_BURST_GRACE_SECONDS=600")
  })

  it("init --watchdog preserves existing watchdog files without overwrite", () => {
    const sandbox = createSandbox()
    mkdirSync(join(sandbox.dir, "scripts"), { recursive: true })
    mkdirSync(join(sandbox.dir, ".tx"), { recursive: true })
    writeFileSync(join(sandbox.dir, "scripts", "ralph-watchdog.sh"), "# sentinel-watchdog\n")
    writeFileSync(join(sandbox.dir, ".tx", "watchdog.env"), "WATCHDOG_ENABLED=0\n")

    const binDir = createMockRuntime(sandbox, "codex")
    const result = runInit(
      sandbox,
      ["--watchdog", "--watchdog-runtime", "auto"],
      { env: { PATH: `${binDir}:/usr/bin:/bin` } },
    )

    expect(result.status).toBe(0)
    expect(readFileSync(join(sandbox.dir, "scripts", "ralph-watchdog.sh"), "utf-8")).toBe("# sentinel-watchdog\n")
    expect(readFileSync(join(sandbox.dir, ".tx", "watchdog.env"), "utf-8")).toBe("WATCHDOG_ENABLED=0\n")

    const output = `${result.stdout}\n${result.stderr}`
    expect(output).toContain("scripts/ralph-watchdog.sh (exists)")
    expect(output).toContain(".tx/watchdog.env (exists)")
  })

  it("init --codex keeps watchdog onboarding default-off", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--codex"])
    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "scripts", "watchdog-launcher.sh"))).toBe(false)
    expect(existsSync(join(sandbox.dir, ".tx", "watchdog.env"))).toBe(false)
  })

  it("fails with actionable error when explicit watchdog runtime is missing", () => {
    const sandbox = createSandbox()
    const emptyBin = join(sandbox.dir, "empty-bin")
    mkdirSync(emptyBin, { recursive: true })
    const result = runInit(
      sandbox,
      ["--watchdog", "--watchdog-runtime", "codex"],
      { env: { PATH: `${emptyBin}:/usr/bin:/bin` } },
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Watchdog runtime 'codex' unavailable")
  })

  it("rejects --watchdog-runtime when --watchdog is not set", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--watchdog-runtime", "auto", "--codex"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("--watchdog-runtime requires --watchdog")
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
