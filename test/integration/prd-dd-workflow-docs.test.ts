import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const repoFile = (...parts: string[]) => resolve(__dirname, "..", "..", ...parts)

const readRepoFile = (path: string): string => readFileSync(repoFile(path), "utf-8")

describe("PRD/DD workflow docs", () => {
  it("removes standalone plan.md execution guidance from human-in-loop surfaces", () => {
    const files = [
      "AGENTS.md",
      "CLAUDE.md",
      "apps/cli/README.md",
      "packages/core/README.md",
      "apps/agent-sdk/README.md",
      "apps/docs/content/docs/getting-started.mdx",
      "apps/docs/content/docs/primitives/index.mdx",
      "apps/cli/src/templates/codex/AGENTS.md",
      "apps/cli/src/templates/claude/CLAUDE.md",
    ]

    for (const file of files) {
      const content = readRepoFile(file)
      expect(content, `${file} should not reference plan.md execution`).not.toContain("Execute plan.md")
      expect(content, `${file} should not ask for Plan implementation`).not.toContain("Plan implementation for $task")
      expect(content, `${file} should reference paired docs`).toContain("paired PRD/design doc")
      expect(content, `${file} should review the task graph`).toContain("tx dep tree $task")
    }
  })

  it("shows paired docs-first quickstarts", () => {
    const files = [
      "README.md",
      "AGENTS.md",
      "apps/docs/content/docs/getting-started.mdx",
      "apps/cli/src/templates/codex/AGENTS.md",
      "apps/cli/src/templates/claude/CLAUDE.md",
    ]

    for (const file of files) {
      const content = readRepoFile(file)
      expect(content, `${file} should create a PRD doc`).toContain('tx doc add prd auth-flow-prd --title "Auth Flow PRD"')
      expect(content, `${file} should create a design doc`).toContain('tx doc add design auth-flow-design --title "Auth Flow Design"')
      expect(content, `${file} should link the PRD and design doc`).toContain("tx doc link auth-flow-prd auth-flow-design")
      expect(content, `${file} should scope spec status to the design doc`).toContain("tx spec status --doc auth-flow-design")
    }
  })

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
