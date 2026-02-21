import { describe, it, expect, afterEach } from "vitest"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { normalizeClaudeDebugLogPath } from "../../packages/core/src/utils/claude-debug-log.js"

const ENV_KEY = "CLAUDE_CODE_DEBUG_LOGS_DIR"
const originalEnvValue = process.env[ENV_KEY]
const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "tx-debug-log-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  if (originalEnvValue === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = originalEnvValue
  }

  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe("normalizeClaudeDebugLogPath", () => {
  it("rewrites existing directory paths to a file path inside that directory", () => {
    const debugDir = makeTempDir()
    process.env[ENV_KEY] = debugDir

    normalizeClaudeDebugLogPath()

    const normalized = process.env[ENV_KEY]
    expect(normalized).toBeDefined()
    expect(normalized).not.toBe(debugDir)
    expect(dirname(normalized!)).toBe(debugDir)
    expect(normalized).toContain("tx-claude-debug-")
  })

  it("leaves file paths unchanged", () => {
    const debugDir = makeTempDir()
    const debugFile = join(debugDir, "agent-debug.log")
    process.env[ENV_KEY] = debugFile

    normalizeClaudeDebugLogPath()

    expect(process.env[ENV_KEY]).toBe(debugFile)
  })

  it("treats trailing slash paths as directories", () => {
    const baseDir = makeTempDir()
    const debugDirWithSlash = join(baseDir, "debug") + "/"
    process.env[ENV_KEY] = debugDirWithSlash

    normalizeClaudeDebugLogPath()

    const normalized = process.env[ENV_KEY]
    expect(normalized).toBeDefined()
    expect(dirname(normalized!)).toBe(join(baseDir, "debug"))
  })
})
