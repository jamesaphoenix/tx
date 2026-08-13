/**
 * Configurable spec types, end to end through the CLI.
 *
 * Covers: default config behaves exactly as before; missing sections are
 * lint-only; per-type severity and per-section lint prompts; user-defined spec
 * types (scaffold, subdir, DB kind, lint); custom template files; and the
 * advisory warning when a block-bearing section is dropped.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun"

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

const runTx = (args: string[], cwd: string): ExecResult => {
  const res = spawnSync(BUN_BIN, [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 60000,
  })
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

let projectDir: string

const configPath = () => join(projectDir, ".tx", "config.toml")

const appendConfig = (content: string): void => {
  appendFileSync(configPath(), `\n${content}\n`)
}

/**
 * Replace every `[spec.types.<type>...]` table with `block`.
 *
 * Mirrors how a user actually edits the scaffolded config (in place) rather
 * than appending a duplicate table, which is not valid TOML.
 */
const setSpecTypeBlock = (typeName: string, block: string): void => {
  const prefix = `[spec.types.${typeName}`
  const kept: string[] = []
  let skipping = false
  for (const line of readFileSync(configPath(), "utf-8").split("\n")) {
    const header = line.trim().match(/^\[([^\]]+)\]/)
    if (header) {
      skipping = line.trim().startsWith(`${prefix}]`) || line.trim().startsWith(`${prefix}.`)
    }
    if (!skipping) kept.push(line)
  }
  writeFileSync(configPath(), `${kept.join("\n")}\n\n${block}\n`)
}

const specPath = (...parts: string[]) => join(projectDir, "specs", ...parts)

/** Delete a `# Heading` section (heading + body up to the next heading). */
const removeSection = (file: string, heading: string): void => {
  const lines = readFileSync(file, "utf-8").split("\n")
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line)
    if (isHeading) {
      skipping = line.replace(/^#{1,6}\s+/, "").trim().toLowerCase() === heading.toLowerCase()
    }
    if (!skipping) out.push(line)
  }
  writeFileSync(file, out.join("\n"))
}

const lintJson = (): {
  ok: boolean
  section_warnings: number
  config_warnings: number
  issues: Array<{ section: string; severity: string; message: string }>
} => {
  const res = runTx(["spec", "lint", "--json"], projectDir)
  return JSON.parse(res.stdout)
}

const sectionIssues = () => lintJson().issues.filter((issue) => issue.section === "sections")

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "tx-spec-types-"))
  const init = runTx(["init"], projectDir)
  expect(init.status).toBe(0)
})

afterEach(() => {
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

describe("configurable spec types", () => {
  it("1. [INV-SPECCFG-001] default config: a scaffolded PRD lints clean", () => {
    expect(runTx(["doc", "add", "prd", "auth-prd", "--title", "Auth"], projectDir).status).toBe(0)

    expect(sectionIssues()).toEqual([])
    expect(lintJson().config_warnings).toBe(0)
  })

  it("2. [INV-SPECCFG-003] a missing section no longer blocks doc sync or drift detection", () => {
    runTx(["doc", "add", "prd", "auth-prd", "--title", "Auth"], projectDir)
    removeSection(specPath("prd", "auth-prd.md"), "Problem")

    const sync = runTx(["doc", "sync"], projectDir)
    expect(sync.status).toBe(0)
    expect(sync.stdout).toContain("auth-prd")

    // Drift must resolve normally rather than failing to parse the file.
    const drift = runTx(["doc", "drift", "auth-prd"], projectDir)
    expect(drift.status).toBe(0)
    expect(drift.stdout + drift.stderr).not.toMatch(/Unable to validate markdown structure/)
  })

  it("3. tx spec lint reports the missing section as an error and exits 1", () => {
    runTx(["doc", "add", "prd", "auth-prd", "--title", "Auth"], projectDir)
    removeSection(specPath("prd", "auth-prd.md"), "Problem")
    runTx(["doc", "sync"], projectDir)

    const issues = sectionIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe("error")
    expect(issues[0]!.message).toContain("Problem")
    expect(lintJson().ok).toBe(false)
    expect(runTx(["spec", "lint"], projectDir).status).toBe(1)
  })

  it('4. severity "warn" reports without failing, and "off" is silent', () => {
    runTx(["doc", "add", "prd", "auth-prd", "--title", "Auth"], projectDir)
    removeSection(specPath("prd", "auth-prd.md"), "Problem")
    runTx(["doc", "sync"], projectDir)

    appendConfig('[spec.types.prd.severity-probe]\n') // no-op table, keeps parser honest
    writeFileSync(
      configPath(),
      readFileSync(configPath(), "utf-8").replace(
        /(\[spec\.types\.prd\]\nseverity = )"error"/,
        '$1"warn"',
      ),
    )

    const warnIssues = sectionIssues()
    expect(warnIssues).toHaveLength(1)
    expect(warnIssues[0]!.severity).toBe("warn")
    expect(runTx(["spec", "lint"], projectDir).status).toBe(0)

    writeFileSync(
      configPath(),
      readFileSync(configPath(), "utf-8").replace(
        /(\[spec\.types\.prd\]\nseverity = )"warn"/,
        '$1"off"',
      ),
    )
    expect(sectionIssues()).toEqual([])
  })

  it("5. [INV-SPECCFG-006] a custom spec type scaffolds into its subdir, persists its kind, and is listed", () => {
    appendConfig(
      [
        "[spec.types.rfc]",
        'severity = "warn"',
        'subdir = "rfc"',
        "",
        "[spec.types.rfc.section.summary]",
        'description = "What this proposes."',
        "",
        "[spec.types.rfc.section.motivation]",
        'description = "Why now."',
      ].join("\n"),
    )

    const add = runTx(["doc", "add", "rfc", "my-rfc", "--title", "My RFC"], projectDir)
    expect(add.status).toBe(0)

    // File lands in the configured subdirectory with the configured sections.
    const file = specPath("rfc", "my-rfc.md")
    expect(existsSync(file)).toBe(true)
    const content = readFileSync(file, "utf-8")
    expect(content).toContain("spec_type: rfc")
    expect(content).toContain("# Summary")
    expect(content).toContain("# Motivation")
    expect(content).toContain("What this proposes.")

    // The kind round-trips through SQLite (exercises the migration that dropped
    // the docs.kind CHECK allow-list).
    const list = JSON.parse(runTx(["doc", "list", "--json"], projectDir).stdout)
    expect(list.map((doc: { kind: string }) => doc.kind)).toContain("rfc")

    const types = JSON.parse(runTx(["spec", "types", "--json"], projectDir).stdout)
    const rfc = types.types.find((type: { name: string }) => type.name === "rfc")
    expect(rfc).toMatchObject({ name: "rfc", builtin: false, severity: "warn", subdir: "rfc" })
    expect(rfc.sections.map((section: { heading: string }) => section.heading)).toEqual([
      "Summary",
      "Motivation",
    ])
  })

  it("6. [INV-SPECCFG-004] a custom section's own message template is rendered with its placeholders", () => {
    appendConfig(
      [
        "[spec.types.rfc]",
        'severity = "warn"',
        "",
        "[spec.types.rfc.section.summary]",
        'description = "What this proposes."',
        "",
        "[spec.types.rfc.section.motivation]",
        'description = "Why now."',
        'message = "{name} [{spec_type}] must document {section}: {description}"',
      ].join("\n"),
    )
    runTx(["doc", "add", "rfc", "my-rfc", "--title", "My RFC"], projectDir)
    removeSection(specPath("rfc", "my-rfc.md"), "Motivation")
    runTx(["doc", "sync"], projectDir)

    const issues = sectionIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("my-rfc [rfc] must document Motivation: Why now.")
    expect(issues[0]!.message).not.toContain("{")
  })

  it("7. [INV-SPECCFG-007] a doc whose spec_type is no longer configured warns without crashing", () => {
    appendConfig(['[spec.types.rfc]', 'sections = ["Summary"]'].join("\n"))
    runTx(["doc", "add", "rfc", "my-rfc", "--title", "My RFC"], projectDir)

    // Drop the type from config while the doc remains on disk and in the DB.
    writeFileSync(
      configPath(),
      readFileSync(configPath(), "utf-8").replace(
        /\[spec\.types\.rfc\]\nsections = \["Summary"\]\n/,
        "",
      ),
    )

    const issues = sectionIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe("warn")
    expect(issues[0]!.message).toContain("rfc")
    // Lint still completes and other checks still run.
    expect(runTx(["spec", "lint"], projectDir).status).toBe(0)
  })

  it("8. a configured template file is used, and a missing one errors clearly", () => {
    const templatePath = join(projectDir, ".tx", "templates", "rfc.md")
    appendConfig(
      [
        "[spec.types.rfc]",
        'template = ".tx/templates/rfc.md"',
        'sections = ["Summary"]',
      ].join("\n"),
    )

    // Missing template file -> actionable error, no doc created.
    const missing = runTx(["doc", "add", "rfc", "no-template", "--title", "X"], projectDir)
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain("Template file not found")
    expect(missing.stderr).toContain("[spec.types.rfc].template")

    mkdirSync(dirname(templatePath), { recursive: true })
    writeFileSync(
      templatePath,
      [
        "---",
        "kind: spec",
        "spec_type: {spec_type}",
        "name: {name}",
        'title: "{title}"',
        "status: draft",
        "version: 1",
        "owners:",
        "  - docs-team",
        'summary: "Custom template."',
        "domain: custom",
        "tags:",
        "  - custom",
        "depends_on: []",
        "supersedes: []",
        "implements: null",
        "last_reviewed_at: {date}",
        "---",
        "",
        "# Summary",
        "From the project template.",
        "",
      ].join("\n"),
    )

    const add = runTx(["doc", "add", "rfc", "templated", "--title", "Templated RFC"], projectDir)
    expect(add.status).toBe(0)
    const content = readFileSync(specPath("rfc", "templated.md"), "utf-8")
    expect(content).toContain("From the project template.")
    expect(content).toContain("name: templated")
    expect(content).toContain('title: "Templated RFC"')
    expect(content).toContain("spec_type: rfc")
    expect(content).not.toContain("{name}")
    expect(content).not.toContain("{date}")
  })

  it("9. customizing a built-in's sections switches it to the generic template and seeds blocks", () => {
    setSpecTypeBlock(
      "design",
      [
        "[spec.types.design]",
        'severity = "error"',
        "",
        "[spec.types.design.section.summary]",
        'description = "The approach."',
        "",
        "[spec.types.design.section.invariants]",
        'description = "INV-* entries with verified_by paths."',
        "",
        "[spec.types.design.section.rollout]",
        'description = "How this ships."',
      ].join("\n"),
    )

    expect(runTx(["doc", "add", "design", "auth-design", "--title", "Auth"], projectDir).status).toBe(0)

    const content = readFileSync(specPath("design", "auth-design.md"), "utf-8")
    expect(content).toContain("# Summary")
    expect(content).toContain("# Invariants")
    expect(content).toContain("# Rollout")
    // Built-in sections that were dropped are gone.
    expect(content).not.toContain("# Data Model")
    // The invariants yaml block is still seeded so spec discovery keeps working.
    expect(content).toContain("invariants: []")

    expect(sectionIssues()).toEqual([])
  })

  it("10. [INV-SPECCFG-011] dropping a block-bearing section raises an advisory config warning", () => {
    setSpecTypeBlock(
      "design",
      ["[spec.types.design]", 'sections = ["Summary", "Architecture"]'].join("\n"),
    )

    const lint = lintJson()
    expect(lint.config_warnings).toBe(2)
    const configIssues = lint.issues.filter((issue) => issue.section === "config")
    expect(configIssues.map((issue) => issue.severity)).toEqual(["warn", "warn"])
    expect(configIssues[0]!.message).toContain("Invariants")
    expect(configIssues[1]!.message).toContain("Verification")

    const types = JSON.parse(runTx(["spec", "types", "--json"], projectDir).stdout)
    expect(types.warnings).toHaveLength(2)
  })

  it("11. tx doc template previews the configured structure without writing", () => {
    appendConfig(
      [
        "[spec.types.rfc]",
        "",
        "[spec.types.rfc.section.summary]",
        'description = "What this proposes."',
      ].join("\n"),
    )

    const res = runTx(["doc", "template", "rfc", "--name", "preview-rfc", "--title", "Preview"], projectDir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("spec_type: rfc")
    expect(res.stdout).toContain("# Summary")
    expect(res.stdout).toContain("What this proposes.")
    // Nothing was persisted.
    expect(existsSync(specPath("rfc", "preview-rfc.md"))).toBe(false)
    expect(JSON.parse(runTx(["doc", "list", "--json"], projectDir).stdout)).toEqual([])
  })

  it("12. [INV-SPECCFG-008] generated skills embed this project's configured sections and prompts", () => {
    appendConfig(
      [
        "[spec.types.rfc]",
        'severity = "warn"',
        "",
        "[spec.types.rfc.section.motivation]",
        'description = "Motivation description v1."',
        'message = "{name}: every RFC needs {section}"',
      ].join("\n"),
    )

    expect(runTx(["skills", "generate", "--target", "claude", "--clean"], projectDir).status).toBe(0)

    const skillPath = join(
      projectDir,
      ".tx",
      "generated-skills",
      "claude",
      ".claude",
      "skills",
      "spec-doc",
      "SKILL.md",
    )
    const skill = readFileSync(skillPath, "utf-8")
    expect(skill).toContain("### `rfc` (custom to this project)")
    expect(skill).toContain("Motivation description v1.")
    expect(skill).toContain("every RFC needs Motivation")
    expect(skill).toContain("severity **warn**")
    // The fixed core is still documented as non-configurable.
    expect(skill).toContain("are fixed by tx and are NOT configurable")

    // Editing config and re-generating refreshes the rendered structure.
    writeFileSync(
      configPath(),
      readFileSync(configPath(), "utf-8").replace(
        "Motivation description v1.",
        "Motivation description v2.",
      ),
    )
    runTx(["skills", "generate", "--target", "claude", "--clean"], projectDir)
    expect(readFileSync(skillPath, "utf-8")).toContain("Motivation description v2.")
  })

  it("13. tx spec types lists built-ins with their descriptions by default", () => {
    const res = runTx(["spec", "types", "--json"], projectDir)
    expect(res.status).toBe(0)

    const parsed = JSON.parse(res.stdout)
    const names = parsed.types.map((type: { name: string }) => type.name)
    expect(names).toEqual(expect.arrayContaining(["prd", "design", "overview", "runbook", "decision"]))

    const prd = parsed.types.find((type: { name: string }) => type.name === "prd")
    expect(prd.builtin).toBe(true)
    expect(prd.customized).toBe(false)
    for (const section of prd.sections) {
      expect(section.description.length).toBeGreaterThan(0)
      expect(section.message.length).toBeGreaterThan(0)
    }
    expect(parsed.warnings).toEqual([])
  })

  it("14. tx init scaffolds the spec type config into .tx/config.toml", () => {
    const raw = readFileSync(configPath(), "utf-8")

    expect(raw).toContain("[spec.types.prd]")
    expect(raw).toContain("[spec.types.prd.section.acceptance-criteria]")
    expect(raw).toContain("[spec.types.design.section.invariants]")
    expect(raw).toContain('heading = "Acceptance Criteria"')
    expect(raw).toContain("# [spec.types.rfc]")
    expect(raw).toContain("# [spec.lint.messages]")
    expect(raw).toContain("NOT configurable")
  })
})
