import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  readTxConfig,
  writeDashboardDefaultTaskAssigmentType,
  DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY,
} from "../../packages/core/src/utils/toml-config"

const tempDirs: string[] = []
const DEFAULTS = {
  docs: { path: ".tx/docs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
  dashboard: { defaultTaskAssigmentType: "human" },
} as const

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tx-toml-config-"))
  tempDirs.push(dir)
  return dir
}

function writeConfig(cwd: string, content: string): void {
  const path = join(cwd, ".tx", "config.toml")
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("toml-config", () => {
  it("returns defaults when config is missing", () => {
    const cwd = makeTempDir()
    const config = readTxConfig(cwd)
    expect(config).toEqual(DEFAULTS)
  })

  it("returns defaults when config exists but cannot be read", () => {
    const cwd = makeTempDir()
    const invalidPath = join(cwd, ".tx", "config.toml")
    mkdirSync(invalidPath, { recursive: true })

    const config = readTxConfig(cwd)
    expect(config).toEqual(DEFAULTS)
  })

  it("parses dashboard assignment type from canonical key", () => {
    const cwd = makeTempDir()
    writeConfig(cwd, [
      "[dashboard]",
      `${DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY} = "agent"`,
    ].join("\n"))

    const parsed = readTxConfig(cwd)
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("agent")
  })

  it("defaults dashboard assignment when [dashboard] section is absent", () => {
    const cwd = makeTempDir()
    writeConfig(cwd, [
      "[docs]",
      'path = "custom/docs"',
      "",
      "[cycles]",
      "agents = 7",
    ].join("\n"))

    const parsed = readTxConfig(cwd)
    expect(parsed.docs.path).toBe("custom/docs")
    expect(parsed.cycles.agents).toBe(7)
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("human")
  })

  it("writes dashboard default assignment type to config.toml", () => {
    const cwd = makeTempDir()

    const updated = writeDashboardDefaultTaskAssigmentType("agent", cwd)
    expect(updated.dashboard.defaultTaskAssigmentType).toBe("agent")

    const raw = readFileSync(join(cwd, ".tx", "config.toml"), "utf8")
    expect(raw).toContain("[dashboard]")
    expect(raw).toContain(`${DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY} = "agent"`)
  })

  it("patches existing dashboard key and preserves unrelated sections", () => {
    const cwd = makeTempDir()
    writeConfig(cwd, [
      "# keep file header",
      "[docs]",
      'path = "custom/docs"',
      "",
      "[dashboard]",
      '# keep dashboard comment',
      'default_task_assigment_type = "human"',
      'ui_mode = "compact"',
      "",
      "[cycles]",
      'model = "claude-opus-4-6"',
    ].join("\n"))

    writeDashboardDefaultTaskAssigmentType("agent", cwd)

    const raw = readFileSync(join(cwd, ".tx", "config.toml"), "utf8")
    expect(raw).toContain("# keep file header")
    expect(raw).toContain('# keep dashboard comment')
    expect(raw).toContain('[docs]\npath = "custom/docs"')
    expect(raw).toContain('ui_mode = "compact"')
    expect(raw).toContain('[cycles]\nmodel = "claude-opus-4-6"')
    expect(raw).toContain('default_task_assigment_type = "agent"')
  })

  it("falls back to human when dashboard assignment type is invalid", () => {
    const cwd = makeTempDir()
    writeConfig(cwd, [
      "[dashboard]",
      'default_task_assigment_type = "bot"',
    ].join("\n"))

    const parsed = readTxConfig(cwd)
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("human")
  })

  it("ignores non-canonical dashboard key names", () => {
    const cwd = makeTempDir()
    writeConfig(cwd, [
      "[dashboard]",
      'default_task_assignment_type = "agent"',
    ].join("\n"))

    const parsed = readTxConfig(cwd)
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("human")
  })
})
