/**
 * Spec-type registry: merging built-in defaults with user config, resolving
 * per-section lint prompts, and the advisory warnings for dropped block-bearing
 * sections.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  readTxConfig,
  renderLintMessage,
  resolveSpecTypes,
  specTypeNames,
  specTypeSubdir,
  DEFAULT_MISSING_SECTION_MESSAGE,
} from "@jamesaphoenix/tx"

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tx-spec-registry-"))
  tempDirs.push(dir)
  return dir
}

function withConfig(content: string): ReturnType<typeof resolveSpecTypes> {
  const cwd = makeTempDir()
  const path = join(cwd, ".tx", "config.toml")
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return resolveSpecTypes(readTxConfig(cwd))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("resolveSpecTypes", () => {
  it("[INV-SPECCFG-001] resolves the five built-in spec types plus legacy kinds", () => {
    const registry = resolveSpecTypes(readTxConfig(makeTempDir()))

    expect(specTypeNames(registry)).toEqual([
      "decision",
      "design",
      "overview",
      "prd",
      "requirement",
      "runbook",
      "system_design",
    ])
    expect(registry.types.get("prd")!.builtin).toBe(true)
    expect(registry.types.get("prd")!.sectionsCustomized).toBe(false)
    expect(registry.warnings).toEqual([])
  })

  it("derives subdirs, with overview at the docs root and legacy kinds preserved", () => {
    const registry = resolveSpecTypes(readTxConfig(makeTempDir()))

    expect(specTypeSubdir(registry, "prd")).toBe("prd")
    expect(specTypeSubdir(registry, "overview")).toBe("")
    expect(specTypeSubdir(registry, "requirement")).toBe("requirements")
    expect(specTypeSubdir(registry, "system_design")).toBe("system-design")
    // Unknown types fall back to the type name.
    expect(specTypeSubdir(registry, "rfc")).toBe("rfc")
  })

  it("registers a custom type with its configured subdir and severity", () => {
    const registry = withConfig(
      [
        "[spec.types.rfc]",
        'severity = "warn"',
        'subdir = "rfcs"',
        'sections = ["Summary", "Motivation"]',
        "",
      ].join("\n"),
    )

    const rfc = registry.types.get("rfc")!
    expect(rfc.builtin).toBe(false)
    expect(rfc.severity).toBe("warn")
    expect(rfc.subdir).toBe("rfcs")
    expect(rfc.sections.map((s) => s.heading)).toEqual(["Summary", "Motivation"])
  })

  it("resolves each section's message: per-section, then global, then built-in", () => {
    const registry = withConfig(
      [
        "[spec.lint.messages]",
        'missing_section = "GLOBAL {section}"',
        "",
        "[spec.types.rfc]",
        "",
        "[spec.types.rfc.section.summary]",
        'message = "PER-SECTION {section}"',
        "",
        "[spec.types.rfc.section.motivation]",
        "",
      ].join("\n"),
    )

    const rfc = registry.types.get("rfc")!
    expect(rfc.sections[0]!.message).toBe("PER-SECTION {section}")
    expect(rfc.sections[1]!.message).toBe("GLOBAL {section}")
    // The global override also applies to built-in sections without their own.
    expect(registry.types.get("design")!.sections[0]!.message).toBe("GLOBAL {section}")
    // ...but a built-in section that ships its own message keeps it.
    const invariants = registry.types
      .get("design")!
      .sections.find((section) => section.heading === "Invariants")!
    expect(invariants.message).toContain("tx derives spec coverage")
  })

  it("falls back to the built-in template when nothing is configured", () => {
    const registry = resolveSpecTypes(readTxConfig(makeTempDir()))

    expect(registry.types.get("design")!.sections[0]!.message).toBe(
      DEFAULT_MISSING_SECTION_MESSAGE,
    )
  })

  it("flags a built-in whose sections were customized", () => {
    const registry = withConfig(
      ["[spec.types.prd]", 'sections = ["Summary", "Why Now", "Requirements"]', ""].join("\n"),
    )

    expect(registry.types.get("prd")!.sectionsCustomized).toBe(true)
    expect(registry.types.get("design")!.sectionsCustomized).toBe(false)
  })

  it("treats heading case and whitespace as equivalent when detecting customization", () => {
    const registry = withConfig(
      [
        "[spec.types.overview]",
        'sections = ["summary", "ARCHITECTURE", "Components", "Data Flows"]',
        "",
      ].join("\n"),
    )

    expect(registry.types.get("overview")!.sectionsCustomized).toBe(false)
  })

  it("[INV-SPECCFG-011] warns when a design doc drops a block-bearing section", () => {
    const registry = withConfig(
      ["[spec.types.design]", 'sections = ["Summary", "Architecture"]', ""].join("\n"),
    )

    expect(registry.warnings).toHaveLength(2)
    expect(registry.warnings[0]).toContain("spec.types.design")
    expect(registry.warnings[0]).toContain("'Invariants' section removed")
    expect(registry.warnings[1]).toContain("'Verification' section removed")
  })

  it("warns when a PRD drops its Requirements section", () => {
    const registry = withConfig(
      ["[spec.types.prd]", 'sections = ["Summary", "Problem"]', ""].join("\n"),
    )

    expect(registry.warnings).toHaveLength(1)
    expect(registry.warnings[0]).toContain("'Requirements' section removed")
  })

  it("does not warn about custom types", () => {
    const registry = withConfig(
      ["[spec.types.rfc]", 'sections = ["Summary"]', ""].join("\n"),
    )

    expect(registry.warnings).toEqual([])
  })
})

describe("renderLintMessage", () => {
  it("substitutes known placeholders", () => {
    expect(
      renderLintMessage("{name}: add '{section}' to {spec_type} — {description}", {
        name: "auth-prd",
        section: "Problem",
        spec_type: "prd",
        description: "State the problem.",
      }),
    ).toBe("auth-prd: add 'Problem' to prd — State the problem.")
  })

  it("leaves unknown placeholders untouched", () => {
    expect(renderLintMessage("{name} {nope}", { name: "x" })).toBe("x {nope}")
  })

  it("returns the template unchanged when it has no placeholders", () => {
    expect(renderLintMessage("plain text", { name: "x" })).toBe("plain text")
  })
})
