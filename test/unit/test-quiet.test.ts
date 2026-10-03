import { afterEach, describe, expect, it } from "vitest"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function runQuiet(args: string[], failed = false) {
  const directory = mkdtempSync(join(tmpdir(), "tx-quiet-regression-"))
  temporaryDirectories.push(directory)
  const argumentsPath = join(directory, "arguments.txt")
  const reportPath = join(directory, "fixture.json")
  writeFileSync(reportPath, JSON.stringify({
    numTotalTests: 1, numPassedTests: failed ? 0 : 1, numFailedTests: failed ? 1 : 0, numPendingTests: 0,
    testResults: [{ name: resolve("test/integration/example.test.ts"), status: failed ? "failed" : "passed",
      assertionResults: [{ fullName: "example regression", status: failed ? "failed" : "passed", failureMessages: failed ? ["Expected real failure"] : [] }] }],
  }))
  const stub = join(directory, "bunx")
  writeFileSync(stub, `#!/bin/bash
printf '%s\\n' "$@" >> "$TX_QUIET_ARGUMENTS"
for argument in "$@"; do
  case "$argument" in
    --outputFile=*) cp "$TX_QUIET_REPORT" "${"$"}{argument#--outputFile=}" ;;
  esac
done
echo 'JSON report written to a file'
exit "$TX_QUIET_EXIT"
`)
  chmodSync(stub, 0o755)
  const result = spawnSync("/bin/bash", [resolve("scripts/test-quiet.sh"), ...args], {
    encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, TX_QUIET_ARGUMENTS: argumentsPath,
      TX_QUIET_REPORT: reportPath, TX_QUIET_EXIT: failed ? "1" : "0" },
  })
  return { ...result, arguments: readFileSync(argumentsPath, "utf8").trim().split("\n") }
}

describe("quiet test runner", () => {
  it("reads the explicit report file and forwards every selected test path", () => {
    const result = runQuiet(["test/unit/one.test.ts", "test/integration/two.test.ts"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("All passing")
    expect(result.arguments).toEqual(expect.arrayContaining(["test/unit/one.test.ts", "test/integration/two.test.ts"]))
    expect(result.arguments.some(argument => argument.startsWith("--outputFile="))).toBe(true)
  })

  it("preserves a failing exit code and prints the failed assertion", () => {
    const result = runQuiet([], true)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("FAIL: example regression")
    expect(result.stdout).toContain("Expected real failure")
    expect(result.arguments).toContain("test/integration/")
  })
})
