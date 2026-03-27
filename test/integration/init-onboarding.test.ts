import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "child_process"
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

interface Sandbox {
  dir: string
}

const REPO_ROOT = resolve(__dirname, "..", "..")
const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun"
const BUNDLED_SPEC_SKILLS = ["decompose-spec", "design-doc", "overview-spec", "prd", "verify-invariants"] as const
const sandboxes: Sandbox[] = []

function createSandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "tx-init-onboarding-"))
  const linkType = process.platform === "win32" ? "junction" : "dir"
  symlinkSync(resolve(REPO_ROOT, "apps"), join(dir, "apps"), linkType)
  symlinkSync(resolve(REPO_ROOT, "packages"), join(dir, "packages"), linkType)
  symlinkSync(resolve(REPO_ROOT, "migrations"), join(dir, "migrations"), linkType)
  symlinkSync(resolve(REPO_ROOT, "node_modules"), join(dir, "node_modules"), linkType)
  const sandbox = { dir }
  sandboxes.push(sandbox)
  return sandbox
}

function runInit(
  sandbox: Sandbox,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; input?: string },
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

function expectBundledSpecSkills(sandbox: Sandbox, target: "claude" | "codex") {
  const root = target === "claude"
    ? join(sandbox.dir, ".claude", "skills")
    : join(sandbox.dir, ".codex", "skills")

  for (const skillId of BUNDLED_SPEC_SKILLS) {
    expect(existsSync(join(root, skillId, "SKILL.md"))).toBe(true)
  }
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0, sandboxes.length)) {
    if (existsSync(sandbox.dir)) {
      rmSync(sandbox.dir, { recursive: true, force: true })
    }
  }
})

describe("tx init onboarding edge cases", () => {
  it("init --codex installs generated Codex skills and rules only", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--codex"])

    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "AGENTS.md"))).toBe(false)
    expect(existsSync(join(sandbox.dir, ".codex", "agents"))).toBe(false)
    expect(existsSync(join(sandbox.dir, ".codex", "skills", "manifest.json"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "skills", "tx-core-loop", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "skills", "skills-sync", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "rules", "default.rules"))).toBe(true)

    const designDocSkill = readFileSync(
      join(sandbox.dir, ".codex", "skills", "design-doc", "SKILL.md"),
      "utf-8",
    )
    expect(designDocSkill).toContain("~/.codex/plans/")
    expect(designDocSkill).not.toContain("~/.claude/plans/")
    expect(designDocSkill).toContain("project instructions")

    expectBundledSpecSkills(sandbox, "codex")
  })

  it("init --claude installs generated Claude skills only", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--claude"])

    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "CLAUDE.md"))).toBe(false)
    expect(existsSync(join(sandbox.dir, ".claude", "skills", "manifest.json"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".claude", "skills", "tx-core-loop", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".claude", "skills", "skills-sync", "SKILL.md"))).toBe(true)

    expectBundledSpecSkills(sandbox, "claude")
  })

  it("init --claude --codex installs both generated integrations without legacy markdown files", () => {
    const sandbox = createSandbox()
    const result = runInit(sandbox, ["--claude", "--codex"])

    expect(result.status).toBe(0)
    expect(existsSync(join(sandbox.dir, "CLAUDE.md"))).toBe(false)
    expect(existsSync(join(sandbox.dir, "AGENTS.md"))).toBe(false)
    expect(existsSync(join(sandbox.dir, ".claude", "skills", "tx-core-loop", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "skills", "tx-core-loop", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".claude", "skills", "skills-sync", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "skills", "skills-sync", "SKILL.md"))).toBe(true)
    expect(existsSync(join(sandbox.dir, ".codex", "rules", "default.rules"))).toBe(true)
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

  it("init --codex is idempotent and reports generated skills as existing on rerun", () => {
    const sandbox = createSandbox()
    const first = runInit(sandbox, ["--codex"])
    expect(first.status).toBe(0)

    const second = runInit(sandbox, ["--codex"])
    expect(second.status).toBe(0)

    const output = `${second.stdout}\n${second.stderr}`
    expect(output).toContain(".codex/skills/manifest.json (exists)")
    expect(output).toContain(".codex/rules/default.rules (exists)")
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

  it("fails with a clear error when .codex path collides with a file", () => {
    const sandbox = createSandbox()
    writeFileSync(join(sandbox.dir, ".codex"), "not-a-directory")

    const result = runInit(sandbox, ["--codex"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("parent path exists as a file")
  })
})
