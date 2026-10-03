import { afterEach, describe, expect, it } from "vitest"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const temporaryDirectories: string[] = []
afterEach(() => {for (const directory of temporaryDirectories.splice(0)) rmSync(directory,{recursive:true,force:true})})

function checkWithFailure(fault: "lint" | "docs") {
  const directory = mkdtempSync(join(tmpdir(),"tx-check-regression-"))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory,"scripts"))
  mkdirSync(join(directory,"bin"))
  copyFileSync(resolve("scripts/check.sh"),join(directory,"scripts/check.sh"))
  const executable = (name:string, content:string) => {
    const path = join(directory,name)
    writeFileSync(path,`#!/bin/bash\n${content}\n`)
    chmodSync(path,0o755)
  }
  executable("bin/npx",'if [[ "$TX_CHECK_FAULT" == "lint" && "$*" == "turbo lint" ]]; then echo "Package lint failed"; exit 17; fi')
  executable("bin/bun",'if [[ "$TX_CHECK_FAULT" == "docs" && "$*" == "run test:docs" ]]; then echo "Production docs failed"; exit 19; fi\necho "Tests 8 passed (8)"')
  executable("scripts/test-quiet.sh","echo 'Root tests passed'")
  executable("scripts/enforce-no-verify.sh","exit 0")
  return spawnSync("/bin/bash",[join(directory,"scripts/check.sh"),"--all"],{encoding:"utf8",
    env:{...process.env,PATH:`${join(directory,"bin")}:${process.env.PATH}`,TX_CHECK_FAULT:fault}})
}

describe("complete local quality gate", () => {
  it.each(["lint","docs"] as const)("keeps an earlier %s failure when later checks pass", fault => {
    const result = checkWithFailure(fault)
    expect(result.stdout).toContain(fault === "lint" ? "Package lint failed" : "Production docs failed")
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Some checks failed")
    expect(result.stdout).not.toContain("All checks passed")
  })
})
