import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun"
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 60000 : 30000))

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

function runTx(args: string[], cwd: string, dbPath: string): ExecResult {
  const result = spawnSync(BUN_BIN, [CLI_SRC, ...args, "--db", dbPath], {
    cwd,
    encoding: "utf-8",
    timeout: CLI_TIMEOUT,
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

describe("CLI user-facing error contract", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-cli-user-errors-"))
    dbPath = join(tmpDir, ".tx", "tasks.db")
    const init = runTx(["init"], tmpDir, dbPath)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("returns structured JSON for legacy sync export flags", () => {
    const result = runTx(["sync", "export", "--path", "legacy.json", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      ok: boolean
      error: { code: string; message: string; hint?: string; usage?: string }
    }

    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe("cli/legacy-option")
    expect(parsed.error.message).toContain("Legacy file options")
    expect(parsed.error.hint).toContain("tx sync export")
    expect(parsed.error.usage).toBe("tx sync export [--json]")
  })

  it("returns structured JSON for invalid flag values", () => {
    const result = runTx(["skills", "generate", "--target", "nope", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      ok: boolean
      error: { code: string; details?: { flag?: string; received?: string } }
    }

    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe("cli/invalid-flag-value")
    expect(parsed.error.details?.flag).toBe("target")
    expect(parsed.error.details?.received).toBe("nope")
  })

  it("returns structured JSON for unknown subcommands", () => {
    const result = runTx(["dep", "potato", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      ok: boolean
      error: { code: string; usage?: string; hint?: string }
    }

    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe("cli/unknown-subcommand")
    expect(parsed.error.usage).toBe("tx dep <block|unblock|children|tree>")
    expect(parsed.error.hint).toContain("tx help dep")
  })

  it("returns structured JSON for unknown commands with suggestions", () => {
    const result = runTx(["raedy", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      ok: boolean
      error: { code: string; details?: { suggestions?: string[] } }
    }

    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe("cli/unknown-command")
    expect(parsed.error.details?.suggestions?.length).toBeGreaterThan(0)
    expect(parsed.error.details?.suggestions).toContain("ready")
  })

  it("keeps text-mode errors actionable", () => {
    const result = runTx(["sync", "export", "--path", "legacy.json"], tmpDir, dbPath)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("Legacy file options")
    expect(result.stderr).toContain("Hint:")
    expect(result.stderr).toContain("Usage: tx sync export [--json]")
  })
})
