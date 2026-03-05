import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 120000 : 60000))

interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

const runTx = (cwd: string, dbPath: string, args: string[], input?: string): ExecResult => {
  const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
    cwd,
    encoding: "utf-8",
    timeout: CLI_TIMEOUT,
    input,
  })

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  }
}

const writeSpecDocYaml = (
  cwd: string,
  name: string,
  invariants: readonly { id: string; rule: string }[]
): void => {
  const lines = [
    "kind: prd",
    `name: ${name}`,
    `title: "${name}"`,
    "status: changing",
    "invariants:",
    ...invariants.flatMap((inv) => [
      `  - id: ${inv.id}`,
      `    rule: ${inv.rule}`,
      "    enforcement: integration_test",
    ]),
  ]

  writeFileSync(join(cwd, ".tx", "docs", "prd", `${name}.yml`), `${lines.join("\n")}\n`, "utf-8")
}

describe("CLI spec traceability", () => {
  let cwd: string
  let dbPath: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "tx-cli-spec-trace-"))
    mkdirSync(join(cwd, ".tx"), { recursive: true })
    dbPath = join(cwd, ".tx", "tasks.db")

    const init = runTx(cwd, dbPath, ["init", "--codex"])
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(cwd)) {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it("discovers mappings and reports BUILD gaps/fci for uncovered invariants", { timeout: 120_000 }, () => {
    expect(runTx(cwd, dbPath, ["doc", "add", "prd", "spec-cli-a", "--title", "Spec CLI A"]).status).toBe(0)
    writeSpecDocYaml(cwd, "spec-cli-a", [
      { id: "INV-CLI-SPEC-A-001", rule: "mapped by discovery" },
      { id: "INV-CLI-SPEC-A-002", rule: "left uncovered" },
    ])
    expect(runTx(cwd, dbPath, ["invariant", "sync", "--doc", "spec-cli-a"]).status).toBe(0)

    mkdirSync(join(cwd, "test", "spec"), { recursive: true })
    writeFileSync(
      join(cwd, "test", "spec", "discover.test.ts"),
      [
        'import { it } from "vitest"',
        'it("[INV-CLI-SPEC-A-001] discover works", () => {})',
      ].join("\n"),
      "utf-8",
    )

    const discover = runTx(
      cwd,
      dbPath,
      ["spec", "discover", "--doc", "spec-cli-a", "--patterns", "test/**/*.test.ts", "--json"],
    )
    expect(discover.status).toBe(0)
    const discoverJson = JSON.parse(discover.stdout) as { discoveredLinks: number; upserted: number }
    expect(discoverJson.discoveredLinks).toBe(1)
    expect(discoverJson.upserted).toBe(1)

    const gaps = runTx(cwd, dbPath, ["spec", "gaps", "--doc", "spec-cli-a", "--json"])
    expect(gaps.status).toBe(0)
    const gapsJson = JSON.parse(gaps.stdout) as Array<{ id: string }>
    expect(gapsJson.map((g) => g.id)).toEqual(["INV-CLI-SPEC-A-002"])

    const fci = runTx(cwd, dbPath, ["spec", "fci", "--doc", "spec-cli-a", "--json"])
    expect(fci.status).toBe(0)
    const fciJson = JSON.parse(fci.stdout) as { total: number; covered: number; fci: number; phase: string }
    expect(fciJson.total).toBe(2)
    expect(fciJson.covered).toBe(1)
    expect(fciJson.fci).toBe(0)
    expect(fciJson.phase).toBe("BUILD")

    const status = runTx(cwd, dbPath, ["spec", "status", "--doc", "spec-cli-a", "--json"])
    expect(status.status).toBe(0)
    const statusJson = JSON.parse(status.stdout) as { phase: string; fci: number; gaps: number; total: number }
    expect(statusJson.phase).toBe("BUILD")
    expect(statusJson.fci).toBe(0)
    expect(statusJson.gaps).toBe(1)
    expect(statusJson.total).toBe(2)
  })

  it("transitions HARDEN -> COMPLETE via spec run and complete", { timeout: 120_000 }, () => {
    expect(runTx(cwd, dbPath, ["doc", "add", "prd", "spec-cli-b", "--title", "Spec CLI B"]).status).toBe(0)
    writeSpecDocYaml(cwd, "spec-cli-b", [
      { id: "INV-CLI-SPEC-B-001", rule: "must pass" },
    ])
    expect(runTx(cwd, dbPath, ["invariant", "sync", "--doc", "spec-cli-b"]).status).toBe(0)

    mkdirSync(join(cwd, "test", "spec"), { recursive: true })
    writeFileSync(
      join(cwd, "test", "spec", "run.test.ts"),
      [
        'import { it } from "vitest"',
        'it("[INV-CLI-SPEC-B-001] run pass", () => {})',
      ].join("\n"),
      "utf-8",
    )

    expect(runTx(
      cwd,
      dbPath,
      ["spec", "discover", "--doc", "spec-cli-b", "--patterns", "test/**/*.test.ts", "--json"],
    ).status).toBe(0)

    const testId = "test/spec/run.test.ts::[INV-CLI-SPEC-B-001] run pass"
    const run = runTx(cwd, dbPath, ["spec", "run", testId, "--passed", "--json"])
    expect(run.status).toBe(0)
    const runJson = JSON.parse(run.stdout) as { recorded: number; unmatched: string[] }
    expect(runJson.recorded).toBe(1)
    expect(runJson.unmatched).toEqual([])

    const fci = runTx(cwd, dbPath, ["spec", "fci", "--doc", "spec-cli-b", "--json"])
    expect(fci.status).toBe(0)
    const fciJson = JSON.parse(fci.stdout) as { fci: number; phase: string }
    expect(fciJson.fci).toBe(100)
    expect(fciJson.phase).toBe("HARDEN")

    const complete = runTx(
      cwd,
      dbPath,
      ["spec", "complete", "--doc", "spec-cli-b", "--by", "cli-reviewer", "--json"],
    )
    expect(complete.status).toBe(0)
    const completeJson = JSON.parse(complete.stdout) as { scopeType: string; scopeValue: string; signedOffBy: string }
    expect(completeJson.scopeType).toBe("doc")
    expect(completeJson.scopeValue).toBe("spec-cli-b")
    expect(completeJson.signedOffBy).toBe("cli-reviewer")

    const status = runTx(cwd, dbPath, ["spec", "status", "--doc", "spec-cli-b", "--json"])
    expect(status.status).toBe(0)
    const statusJson = JSON.parse(status.stdout) as { phase: string; fci: number }
    expect(statusJson.phase).toBe("COMPLETE")
    expect(statusJson.fci).toBe(100)
  })

  it("supports link/tests/unlink + batch ingestion and blocks premature complete", { timeout: 120_000 }, () => {
    expect(runTx(cwd, dbPath, ["doc", "add", "prd", "spec-cli-c", "--title", "Spec CLI C"]).status).toBe(0)
    writeSpecDocYaml(cwd, "spec-cli-c", [
      { id: "INV-CLI-SPEC-C-001", rule: "batch mapped" },
    ])
    expect(runTx(cwd, dbPath, ["invariant", "sync", "--doc", "spec-cli-c"]).status).toBe(0)

    const linked = runTx(
      cwd,
      dbPath,
      ["spec", "link", "INV-CLI-SPEC-C-001", "test/spec/batch.test.ts", "batch case", "--framework", "vitest", "--json"],
    )
    expect(linked.status).toBe(0)
    const linkedJson = JSON.parse(linked.stdout) as { testId: string }
    expect(linkedJson.testId).toBe("test/spec/batch.test.ts::batch case")

    const blocked = runTx(cwd, dbPath, ["spec", "complete", "--doc", "spec-cli-c", "--by", "qa"])
    expect(blocked.status).toBe(1)
    expect(blocked.stderr).toContain("Cannot complete scope while phase is BUILD")

    const batchPayload = JSON.stringify({
      testResults: [
        {
          name: "test/spec/batch.test.ts",
          assertionResults: [
            {
              fullName: "batch case",
              status: "passed",
              duration: 6,
            },
          ],
        },
      ],
    })

    const batch = runTx(cwd, dbPath, ["spec", "batch", "--from", "vitest", "--json"], batchPayload)
    expect(batch.status).toBe(0)
    const batchJson = JSON.parse(batch.stdout) as { received: number; recorded: number; unmatched: string[] }
    expect(batchJson.received).toBe(1)
    expect(batchJson.recorded).toBe(1)
    expect(batchJson.unmatched).toEqual([])

    const tests = runTx(cwd, dbPath, ["spec", "tests", "INV-CLI-SPEC-C-001", "--json"])
    expect(tests.status).toBe(0)
    const testsJson = JSON.parse(tests.stdout) as Array<{ testId: string }>
    expect(testsJson).toHaveLength(1)
    expect(testsJson[0]!.testId).toBe("test/spec/batch.test.ts::batch case")

    const unlinked = runTx(
      cwd,
      dbPath,
      ["spec", "unlink", "INV-CLI-SPEC-C-001", "test/spec/batch.test.ts::batch case", "--json"],
    )
    expect(unlinked.status).toBe(0)
    const unlinkedJson = JSON.parse(unlinked.stdout) as { removed: boolean }
    expect(unlinkedJson.removed).toBe(true)

    const gaps = runTx(cwd, dbPath, ["spec", "gaps", "--doc", "spec-cli-c", "--json"])
    expect(gaps.status).toBe(0)
    const gapsJson = JSON.parse(gaps.stdout) as Array<{ id: string }>
    expect(gapsJson.map((g) => g.id)).toEqual(["INV-CLI-SPEC-C-001"])
  })

  it("ingests junit batch input with testcase file routing and excludes skipped status cases", { timeout: 120_000 }, () => {
    expect(runTx(cwd, dbPath, ["doc", "add", "prd", "spec-cli-junit", "--title", "Spec CLI JUnit"]).status).toBe(0)
    writeSpecDocYaml(cwd, "spec-cli-junit", [
      { id: "INV-CLI-SPEC-JUNIT-001", rule: "junit pass" },
      { id: "INV-CLI-SPEC-JUNIT-002", rule: "junit fail" },
    ])
    expect(runTx(cwd, dbPath, ["invariant", "sync", "--doc", "spec-cli-junit"]).status).toBe(0)

    expect(
      runTx(
        cwd,
        dbPath,
        ["spec", "link", "INV-CLI-SPEC-JUNIT-001", "test/spec/junit.test.ts", "passes", "--framework", "junit"],
      ).status,
    ).toBe(0)
    expect(
      runTx(
        cwd,
        dbPath,
        ["spec", "link", "INV-CLI-SPEC-JUNIT-002", "test/spec/junit.test.ts", "fails", "--framework", "junit"],
      ).status,
    ).toBe(0)

    const junitPayload = [
      "<testsuites>",
      '<testsuite name="example" file="test/spec/ignored-suite-file.test.ts">',
      '<testcase name="passes" file=".\\\\test\\\\spec\\\\junit.test.ts" time="0,01"/>',
      '<testcase name="fails" file=".\\\\test\\\\spec\\\\junit.test.ts" time="0.02"><failure message="oops">trace</failure></testcase>',
      '<testcase name="skip" status="skipped"/>',
      "</testsuite>",
      "</testsuites>",
    ].join("")

    const batch = runTx(cwd, dbPath, ["spec", "batch", "--from", "junit", "--json"], junitPayload)
    expect(batch.status).toBe(0)
    const batchJson = JSON.parse(batch.stdout) as { received: number; recorded: number; unmatched: string[] }
    expect(batchJson.received).toBe(2)
    expect(batchJson.recorded).toBe(2)
    expect(batchJson.unmatched).toEqual([])

    const matrix = runTx(cwd, dbPath, ["spec", "matrix", "--doc", "spec-cli-junit", "--json"])
    expect(matrix.status).toBe(0)
    const matrixJson = JSON.parse(matrix.stdout) as Array<{ invariantId: string; tests: Array<{ testId: string; latestRun: { passed: boolean | null } }> }>
    expect(matrixJson).toHaveLength(2)
    const byInvariant = new Map(matrixJson.map((entry) => [entry.invariantId, entry]))
    expect(byInvariant.get("INV-CLI-SPEC-JUNIT-001")?.tests[0]?.testId).toBe("test/spec/junit.test.ts::passes")
    expect(byInvariant.get("INV-CLI-SPEC-JUNIT-001")?.tests[0]?.latestRun.passed).toBe(true)
    expect(byInvariant.get("INV-CLI-SPEC-JUNIT-002")?.tests[0]?.testId).toBe("test/spec/junit.test.ts::fails")
    expect(byInvariant.get("INV-CLI-SPEC-JUNIT-002")?.tests[0]?.latestRun.passed).toBe(false)
  })

  it("normalizes --from values with whitespace/case for spec batch", () => {
    const batch = runTx(
      cwd,
      dbPath,
      ["spec", "batch", "--from", "  JUNIT ", "--json"],
      "<testsuite><testcase name=\"cli-normalized-from\"/></testsuite>",
    )

    expect(batch.status).toBe(0)
    const batchJson = JSON.parse(batch.stdout) as { received: number; recorded: number; unmatched: string[] }
    expect(batchJson.received).toBe(1)
    expect(batchJson.recorded).toBe(0)
    expect(batchJson.unmatched).toEqual(["junit::cli-normalized-from"])
  })

  it("fails with a descriptive error for malformed junit input", () => {
    const malformed = runTx(
      cwd,
      dbPath,
      ["spec", "batch", "--from", "junit", "--json"],
      "<testsuite><testcase name=\"broken\"></testsuite>",
    )

    expect(malformed.status).toBe(1)
    expect(malformed.stderr).toContain("Invalid JUnit XML input")
  })

  it("rejects oversize stdin payloads for spec batch", () => {
    const oversized = runTx(
      cwd,
      dbPath,
      ["spec", "batch", "--from", "generic", "--json"],
      "x".repeat((5 * 1024 * 1024) + 1),
    )

    expect(oversized.status).toBe(1)
    expect(oversized.stderr).toContain("Batch input exceeds 5242880 bytes")
  })
})
