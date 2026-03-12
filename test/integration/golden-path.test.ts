import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 120000 : 60000))

type ExecResult = {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

const runTx = (cwd: string, args: string[]): ExecResult => {
  const result = spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: CLI_TIMEOUT,
  })

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  }
}

const expectOk = (result: ExecResult, context: string): ExecResult => {
  expect(result.status, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
  return result
}

const parseJson = <T>(result: ExecResult): T => JSON.parse(result.stdout) as T

const writeRelative = (cwd: string, relativePath: string, content: string): void => {
  const absPath = join(cwd, relativePath)
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content, "utf-8")
}

describe("CLI golden path", () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "tx-golden-path-"))
  })

  afterEach(() => {
    if (existsSync(cwd)) {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it("supports the recommended first task loop and docs-first spec loop", () => {
    expectOk(runTx(cwd, ["init", "--codex"]), "tx init --codex")
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true)

    writeRelative(cwd, ".tx/config.toml", [
      "[docs]",
      'path = ".tx/docs"',
      "require_ears = false",
      "",
      "[spec]",
      'test_patterns = ["test/**/*.test.ts"]',
    ].join("\n"))

    const prdTask = parseJson<{ id: string }>(
      expectOk(runTx(cwd, ["add", "Write auth PRD", "--json"]), 'tx add "Write auth PRD"'),
    )
    const implementTask = parseJson<{ id: string }>(
      expectOk(runTx(cwd, ["add", "Implement auth flow", "--json"]), 'tx add "Implement auth flow"'),
    )

    expectOk(runTx(cwd, ["block", implementTask.id, prdTask.id]), "tx block implement -> prd")

    const readyBefore = parseJson<Array<{ id: string }>>(
      expectOk(runTx(cwd, ["ready", "--json"]), "tx ready before completion"),
    )
    expect(readyBefore.map((task) => task.id)).toContain(prdTask.id)
    expect(readyBefore.map((task) => task.id)).not.toContain(implementTask.id)

    const prdTaskDetails = parseJson<{ id: string; title: string }>(
      expectOk(runTx(cwd, ["show", prdTask.id, "--json"]), "tx show prd task"),
    )
    expect(prdTaskDetails.id).toBe(prdTask.id)
    expect(prdTaskDetails.title).toBe("Write auth PRD")

    expectOk(runTx(cwd, ["done", prdTask.id]), "tx done prd task")

    const readyAfter = parseJson<Array<{ id: string }>>(
      expectOk(runTx(cwd, ["ready", "--json"]), "tx ready after completion"),
    )
    expect(readyAfter.map((task) => task.id)).toContain(implementTask.id)

    expectOk(runTx(cwd, ["doc", "add", "prd", "auth-flow", "--title", "Auth Flow"]), "tx doc add prd auth-flow")
    writeRelative(cwd, ".tx/docs/prd/auth-flow.yml", [
      "kind: prd",
      "name: auth-flow",
      'title: "Auth Flow"',
      "status: changing",
      "",
      "problem: |",
      "  Password validation must reject short passwords.",
      "",
      "solution: |",
      "  Track the auth invariant and map it to an executable test.",
      "",
      "invariants:",
      "  - id: INV-AUTH-FLOW-001",
      "    rule: reject short passwords",
      "    enforcement: integration_test",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/auth-flow.test.ts", [
      'import { describe, expect, it } from "vitest"',
      "",
      'const acceptsPassword = (value: string): boolean => value.length >= 12',
      "",
      'describe("auth flow", () => {',
      '  it("[INV-AUTH-FLOW-001] rejects short passwords", () => {',
      '    expect(acceptsPassword("too-short")).toBe(false)',
      "  })",
      "})",
      "",
    ].join("\n"))

    const discover = parseJson<{ discoveredLinks: number; tagLinks: number }>(
      expectOk(runTx(cwd, ["spec", "discover", "--doc", "auth-flow", "--json"]), "tx spec discover --doc auth-flow"),
    )
    expect(discover.discoveredLinks).toBe(1)
    expect(discover.tagLinks).toBe(1)

    const beforeRun = parseJson<{ phase: string; blockers: string[] }>(
      expectOk(runTx(cwd, ["spec", "status", "--doc", "auth-flow", "--json"]), "tx spec status before run"),
    )
    expect(beforeRun.phase).toBe("BUILD")
    expect(beforeRun.blockers).toEqual(["1 untested invariant(s)"])

    expectOk(
      runTx(cwd, ["spec", "run", 'test/auth-flow.test.ts::[INV-AUTH-FLOW-001] rejects short passwords', "--passed"]),
      "tx spec run auth-flow test",
    )

    const hardened = parseJson<{ phase: string; blockers: string[] }>(
      expectOk(runTx(cwd, ["spec", "status", "--doc", "auth-flow", "--json"]), "tx spec status hardened"),
    )
    expect(hardened.phase).toBe("HARDEN")
    expect(hardened.blockers).toEqual(["Human COMPLETE sign-off not recorded"])

    expectOk(
      runTx(cwd, ["spec", "complete", "--doc", "auth-flow", "--by", "james", "--json"]),
      "tx spec complete --doc auth-flow",
    )

    const complete = parseJson<{ phase: string; blockers: string[]; signedOff: boolean }>(
      expectOk(runTx(cwd, ["spec", "status", "--doc", "auth-flow", "--json"]), "tx spec status complete"),
    )
    expect(complete.phase).toBe("COMPLETE")
    expect(complete.blockers).toEqual([])
    expect(complete.signedOff).toBe(true)

    expectOk(runTx(cwd, ["sync", "export"]), "tx sync export")
    expect(existsSync(join(cwd, ".tx", "stream.json"))).toBe(true)
    expect(existsSync(join(cwd, ".tx", "streams"))).toBe(true)

    const agentsContent = readFileSync(join(cwd, "AGENTS.md"), "utf-8")
    expect(agentsContent).toContain("Start Here")
    expect(agentsContent).toContain("tx spec discover")
  })
})
