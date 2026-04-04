import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun"
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 60000 : 30000))

type ExecResult = {
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

describe("CLI help and schema discovery", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-cli-help-schema-"))
    dbPath = join(tmpDir, ".tx", "tasks.db")
    const init = runTx(["init"], tmpDir, dbPath)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("returns an agent-clean root command catalog for help --json", () => {
    const result = runTx(["help", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      kind: string
      help: {
        commands: Array<{ key: string }>
      }
    }

    const keys = parsed.help.commands.map((entry) => entry.key)

    expect(parsed.kind).toBe("catalog")
    expect(keys).toContain("ready")
    expect(keys).toContain("schema")
    expect(keys).not.toContain("block")
    expect(keys).not.toContain("claim:release")
  })

  it("returns structured command help for help --json lookups", () => {
    const result = runTx(["help", "dep", "block", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      kind: string
      help: {
        key: string
        commandLabel: string
        usage: string[]
        examples: string[]
      }
    }

    expect(parsed.kind).toBe("command")
    expect(parsed.help.key).toBe("dep block")
    expect(parsed.help.commandLabel).toBe("tx dep block")
    expect(parsed.help.usage).toContain("tx dep block <task-id> <blocker-id> [options]")
    expect(parsed.help.examples.length).toBeGreaterThan(0)
  })

  it("supports command-local help via --help --json", () => {
    const result = runTx(["ready", "--help", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      kind: string
      help: { key: string; usage: string[] }
    }

    expect(parsed.kind).toBe("command")
    expect(parsed.help.key).toBe("ready")
    expect(parsed.help.usage).toContain("tx ready [options]")
  })

  it("returns machine-readable schema output", () => {
    const result = runTx(["schema", "dep", "block"], tmpDir, dbPath)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      kind: string
      schema: {
        key: string
        arguments: Array<{ name: string }>
        options: Array<{ flags: string[] }>
      }
    }

    expect(parsed.kind).toBe("command")
    expect(parsed.schema.key).toBe("dep block")
    expect(parsed.schema.arguments.map((argument) => argument.name)).toEqual(["<task-id>", "<blocker-id>"])
    expect(parsed.schema.options.some((option) => option.flags.includes("--json"))).toBe(true)
  })

  it("fails unknown help lookups with actionable structured errors", () => {
    const result = runTx(["help", "raedy", "--json"], tmpDir, dbPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")

    const parsed = JSON.parse(result.stdout) as {
      ok: boolean
      error: { code: string; details?: { suggestions?: string[] } }
    }

    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe("cli/unknown-command")
    expect(parsed.error.details?.suggestions).toContain("ready")
  })
})
