import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const repoFile = (...parts: string[]) => resolve(__dirname, "..", "..", ...parts)

const readRepoFile = (path: string): string => readFileSync(repoFile(path), "utf-8")

describe("PRD/DD workflow docs", () => {

  it("ships creation and mapping guidance without agent templates", () => {
    const docs = readRepoFile("apps/cli/src/templates/shared-skills/tx-docs/SKILL.md")
    expect(docs).toContain("tx doc add prd")
    expect(docs).toContain("tx doc add design")
    const verify = readRepoFile("apps/cli/src/templates/shared-skills/verify-invariants/SKILL.md")
    expect(verify).toContain("// @spec INV-AUTH-001")
    expect(verify).toContain("[INV-AUTH-001]")
    expect(verify).toContain("not a passing result")
  })
})
