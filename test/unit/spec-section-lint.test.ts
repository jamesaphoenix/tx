/**
 * Required-section linting.
 *
 * Sections are lint-only: `parseMdDocSync` must succeed regardless, and
 * `lintSpecSections` reports what is missing at the configured severity.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { Either } from "effect"
import {
  lintSpecSections,
  parseMdDocSync,
  readTxConfig,
  resolveSpecTypes,
} from "@jamesaphoenix/tx"

const tempDirs: string[] = []

function registryFor(content?: string): ReturnType<typeof resolveSpecTypes> {
  const cwd = mkdtempSync(join(tmpdir(), "tx-section-lint-"))
  tempDirs.push(cwd)
  if (content !== undefined) {
    const path = join(cwd, ".tx", "config.toml")
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return resolveSpecTypes(readTxConfig(cwd))
}

const frontmatter = (specType: string) =>
  [
    "---",
    "kind: spec",
    `spec_type: ${specType}`,
    "name: sample-doc",
    'title: "Sample Doc"',
    "status: draft",
    "version: 1",
    "owners:",
    "  - docs-team",
    'summary: "A sample."',
    "domain: sample",
    "tags:",
    "  - sample",
    "depends_on: []",
    "supersedes: []",
    "implements: null",
    "last_reviewed_at: 2026-01-01",
    "---",
    "",
  ].join("\n")

function parseSpec(specType: string, body: string) {
  const parsed = parseMdDocSync(frontmatter(specType) + body)
  if (Either.isLeft(parsed)) {
    throw new Error(`expected parse to succeed, got: ${parsed.left.reason}`)
  }
  return parsed.right
}

const lint = (
  specType: string,
  body: string,
  registry: ReturnType<typeof resolveSpecTypes>,
) => lintSpecSections(parseSpec(specType, body), registry, { docName: "sample-doc" })

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

const FULL_PRD = [
  "# Summary",
  "s",
  "# Problem",
  "p",
  "# Scope",
  "sc",
  "# Requirements",
  "r",
  "# Acceptance Criteria",
  "ac",
  "",
].join("\n")

describe("lintSpecSections", () => {
  it("returns nothing when every configured section is present", () => {
    expect(lint("prd", FULL_PRD, registryFor())).toEqual([])
  })

  it("[INV-SPECCFG-003] parses a doc with missing sections instead of failing", () => {
    // The parse itself must succeed — this is the lint-only guarantee.
    const parsed = parseSpec("prd", "# Summary\ns\n")
    expect(parsed.kind).toBe("spec")
    expect(parsed.sections.map((s) => s.heading)).toEqual(["Summary"])
  })

  it("emits one error finding per missing section", () => {
    const findings = lint("prd", "# Summary\ns\n", registryFor())

    expect(findings.map((f) => f.section)).toEqual([
      "Problem",
      "Scope",
      "Requirements",
      "Acceptance Criteria",
    ])
    expect(findings.every((f) => f.severity === "error")).toBe(true)
    expect(findings.every((f) => f.rule === "missing_section")).toBe(true)
  })

  it("[INV-SPECCFG-004] renders the per-section message with placeholders substituted", () => {
    const findings = lint(
      "prd",
      "# Summary\ns\n# Scope\nsc\n# Requirements\nr\n# Acceptance Criteria\nac\n",
      registryFor(),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.message).toBe(
      "sample-doc: PRD is missing '# Problem'. State the problem before listing requirements. The user or system problem being solved, with evidence or a motivating scenario.",
    )
    expect(findings[0]!.message).not.toContain("{")
  })

  it("honours a custom message template from config", () => {
    const registry = registryFor(
      [
        "[spec.types.rfc]",
        "",
        "[spec.types.rfc.section.motivation]",
        'description = "Why now."',
        'message = "{name} [{spec_type}] needs {section}: {description}"',
        "",
      ].join("\n"),
    )

    const findings = lint("rfc", "# Summary\ns\n", registry)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.message).toBe("sample-doc [rfc] needs Motivation: Why now.")
  })

  it("downgrades findings to warnings when severity is warn", () => {
    const registry = registryFor(['[spec.types.prd]', 'severity = "warn"', ""].join("\n"))

    const findings = lint("prd", "# Summary\ns\n", registry)
    expect(findings).toHaveLength(4)
    expect(findings.every((f) => f.severity === "warn")).toBe(true)
  })

  it("[INV-SPECCFG-005] emits nothing when severity is off", () => {
    const registry = registryFor(['[spec.types.prd]', 'severity = "off"', ""].join("\n"))

    expect(lint("prd", "", registry)).toEqual([])
  })

  it("[INV-SPECCFG-010] matches headings case-insensitively and at any heading level", () => {
    const body = [
      "## summary",
      "s",
      "###### PROBLEM",
      "p",
      "# scope",
      "sc",
      "# requirements",
      "r",
      "# ACCEPTANCE criteria",
      "ac",
      "",
    ].join("\n")

    expect(lint("prd", body, registryFor())).toEqual([])
  })

  it("[INV-SPECCFG-010] ignores headings inside fenced code blocks", () => {
    const body = ["# Summary", "```md", "# Problem", "```", ""].join("\n")

    const findings = lint("prd", body, registryFor())
    expect(findings.map((f) => f.section)).toContain("Problem")
  })

  it("[INV-SPECCFG-007] warns once for a spec_type that is not configured", () => {
    const findings = lint("postmortem", "# Anything\nx\n", registryFor())

    expect(findings).toHaveLength(1)
    expect(findings[0]!.rule).toBe("unknown_spec_type")
    expect(findings[0]!.severity).toBe("warn")
    expect(findings[0]!.message).toContain("postmortem")
    expect(findings[0]!.message).not.toContain("{")
  })

  it("checks a custom type's configured sections", () => {
    const registry = registryFor(
      ["[spec.types.rfc]", 'sections = ["Summary", "Motivation", "Proposal"]', ""].join("\n"),
    )

    const findings = lint("rfc", "# Summary\ns\n# Proposal\np\n", registry)
    expect(findings.map((f) => f.section)).toEqual(["Motivation"])
  })

  it("returns nothing for task docs", () => {
    const parsed = parseMdDocSync("---\nkind: task\nid: tx-123\n---\n\n# Anything\n")
    if (Either.isLeft(parsed)) throw new Error("expected task doc to parse")

    expect(lintSpecSections(parsed.right, registryFor(), { docName: "t" })).toEqual([])
  })
})
