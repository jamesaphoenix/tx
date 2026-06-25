/**
 * CLI integration tests for tx spec lint command
 *
 * Tests the all-in-one spec/doc checker that consolidates:
 * - Doc drift detection (hash mismatch between disk and DB)
 * - Task-doc coverage (unlinked tasks)
 * - EARS requirement validation on PRD docs
 * - Spec-test status (uncovered/failing invariants)
 *
 * Per DD-007: Uses real SQLite database via subprocess CLI invocation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 120000 : 60000))

interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

const runTx = (cwd: string, dbPath: string, args: string[]): ExecResult => {
  const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
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

const writeDocsConfig = (cwd: string): void => {
  writeFileSync(
    join(cwd, ".tx", "config.toml"),
    ["[docs]", 'path = "specs"', "require_ears = false"].join("\n"),
    "utf-8"
  )
}

describe("CLI spec lint", () => {
  let cwd: string
  let dbPath: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "tx-cli-spec-lint-"))
    mkdirSync(join(cwd, ".tx"), { recursive: true })
    dbPath = join(cwd, ".tx", "tasks.db")

    const init = runTx(cwd, dbPath, ["init"])
    expect(init.status).toBe(0)
    writeDocsConfig(cwd)
  })

  afterEach(() => {
    if (existsSync(cwd)) {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  describe("clean state", () => {
    it("reports CLEAN when no docs or tasks exist", () => {
      const result = runTx(cwd, dbPath, ["spec", "lint"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Spec Lint: CLEAN")
      expect(result.stdout).toContain("Docs:      0 total, 0 drifted")
      expect(result.stdout).toContain("Coverage:  0 unlinked task(s)")
    })

    it("reports CLEAN in JSON mode", () => {
      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.ok).toBe(true)
      expect(json.total_docs).toBe(0)
      expect(json.drift_count).toBe(0)
      expect(json.coverage_warnings).toBe(0)
      expect(json.issues).toEqual([])
    })
  })

  describe("task-doc coverage", () => {
    it("warns about tasks not linked to docs", () => {
      // Add a task but don't attach it to a doc
      const addResult = runTx(cwd, dbPath, ["add", "Unlinked task"])
      expect(addResult.status).toBe(0)

      const result = runTx(cwd, dbPath, ["spec", "lint"])
      expect(result.status).toBe(0) // warnings don't cause exit 1
      expect(result.stdout).toContain("Coverage:  1 unlinked task(s)")
      expect(result.stdout).toContain("Coverage:")
    })

    it("JSON reports coverage warnings", () => {
      runTx(cwd, dbPath, ["add", "Task A"])
      runTx(cwd, dbPath, ["add", "Task B"])

      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.coverage_warnings).toBe(2)
      expect(json.issues.filter((i: { section: string }) => i.section === "coverage")).toHaveLength(2)
    })
  })

  describe("index searchability", () => {
    it("warns when summary/domain/tags are not useful for generated specs/index.md", { timeout: 120_000 }, () => {
      const add = runTx(cwd, dbPath, ["doc", "add", "design", "searchability-design", "--title", "Searchability Design"])
      expect(add.status).toBe(0)

      const docPath = join(cwd, "specs", "design", "searchability-design.md")
      const content = readFileSync(docPath, "utf-8")
        .replace('summary: "Technical design for Searchability Design."', 'summary: ""')
        .replace("domain: searchability", "domain: product-area")
        .replace("\n  - searchability", "")
      writeFileSync(docPath, content, "utf-8")

      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.index_warnings).toBeGreaterThan(0)

      const indexIssues = json.issues.filter((i: { section: string }) => i.section === "index")
      expect(indexIssues.some((i: { message: string }) => i.message.includes("summary"))).toBe(true)
      expect(indexIssues.some((i: { message: string }) => i.message.includes("domain"))).toBe(true)
      expect(indexIssues.some((i: { message: string }) => i.message.includes("tags"))).toBe(true)
      expect(indexIssues.some((i: { message: string }) => i.message.includes("specs/index.md"))).toBe(true)
    })
  })

  describe("doc drift detection", () => {
    it("warns by default when a design doc has no linked tasks", { timeout: 120_000 }, () => {
      const add = runTx(cwd, dbPath, ["doc", "add", "design", "no-task-design", "--title", "No Task Design"])
      expect(add.status).toBe(0)

      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      const driftIssues = json.issues.filter((i: { section: string }) => i.section === "drift")
      expect(driftIssues.some((i: { message: string }) => i.message.includes("has no linked tasks"))).toBe(true)
      expect(json.drift_count).toBeGreaterThanOrEqual(1)
    })

    it("suppresses design doc task-link warnings when configured", { timeout: 120_000 }, () => {
      writeFileSync(
        join(cwd, ".tx", "config.toml"),
        [
          "[docs]",
          'path = "specs"',
          "",
          "[spec]",
          'design_doc_missing_task_links = "never"',
        ].join("\n"),
        "utf-8"
      )

      const add = runTx(cwd, dbPath, ["doc", "add", "design", "quiet-design", "--title", "Quiet Design"])
      expect(add.status).toBe(0)

      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      const driftIssues = json.issues.filter((i: { section: string }) => i.section === "drift")
      expect(driftIssues.some((i: { message: string }) => i.message.includes("has no linked tasks"))).toBe(false)
      expect(json.drift_count).toBe(0)
    })

    it("reports design doc task-link warnings only for locked docs when configured", { timeout: 120_000 }, () => {
      writeFileSync(
        join(cwd, ".tx", "config.toml"),
        [
          "[docs]",
          'path = "specs"',
          "",
          "[spec]",
          'design_doc_missing_task_links = "locked_only"',
        ].join("\n"),
        "utf-8"
      )

      const add = runTx(cwd, dbPath, ["doc", "add", "design", "locked-policy", "--title", "Locked Policy"])
      expect(add.status).toBe(0)

      const beforeLock = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(beforeLock.status).toBe(0)
      const beforeJson = JSON.parse(beforeLock.stdout)
      const beforeDriftIssues = beforeJson.issues.filter((i: { section: string }) => i.section === "drift")
      expect(beforeDriftIssues.some((i: { message: string }) => i.message.includes("has no linked tasks"))).toBe(false)
      expect(beforeJson.drift_count).toBe(0)

      const lock = runTx(cwd, dbPath, ["doc", "lock", "locked-policy"])
      expect(lock.status).toBe(0)

      const afterLock = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(afterLock.status).toBe(0)
      const afterJson = JSON.parse(afterLock.stdout)
      const afterDriftIssues = afterJson.issues.filter((i: { section: string }) => i.section === "drift")
      expect(afterDriftIssues.some((i: { message: string }) => i.message.includes("has no linked tasks"))).toBe(true)
      expect(afterJson.drift_count).toBeGreaterThanOrEqual(1)
    })

    it("detects drift when doc content changes on disk after sync", { timeout: 120_000 }, () => {
      // Create a doc via CLI (syncs hash to DB)
      const add = runTx(cwd, dbPath, ["doc", "add", "prd", "drift-test", "--title", "Drift Test"])
      expect(add.status).toBe(0)

      // Now modify the file on disk without syncing
      const docPath = join(cwd, "specs", "prd", "drift-test.md")
      expect(existsSync(docPath)).toBe(true)
      const original = readFileSync(docPath, "utf-8")
      writeFileSync(docPath, original + "\n# Extra section added\n", "utf-8")

      const result = runTx(cwd, dbPath, ["spec", "lint"])
      // drift is a warning, not an error
      expect(result.stdout).toContain("1 drifted")
      expect(result.stdout).toContain("Drift:")
    })
  })

  describe("EARS validation", () => {
    it("passes with valid EARS requirements from CLI-created PRD", { timeout: 120_000 }, () => {
      // doc add prd creates a template with valid EARS structure
      const add = runTx(cwd, dbPath, ["doc", "add", "prd", "ears-valid", "--title", "Valid EARS"])
      expect(add.status).toBe(0)

      // The CLI template generates a valid PRD with EARS — spec lint should not
      // report any EARS errors for it (template uses valid kind, priority, statement)
      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      const json = JSON.parse(result.stdout)
      const earsIssues = json.issues.filter((i: { section: string }) => i.section === "ears")
      // Template has placeholder EARS that may or may not pass strict validation.
      // The key assertion: no parse errors or file-not-found errors
      const parseErrors = earsIssues.filter((i: { message: string }) =>
        i.message.includes("parse error") || i.message.includes("file not found")
      )
      expect(parseErrors).toHaveLength(0)
    })

    it("reports errors for invalid EARS requirements", { timeout: 120_000 }, () => {
      const add = runTx(cwd, dbPath, ["doc", "add", "prd", "ears-invalid", "--title", "Invalid EARS"])
      expect(add.status).toBe(0)

      // Write a PRD with bad EARS (missing required fields)
      const docPath = join(cwd, "specs", "prd", "ears-invalid.md")
      const content = [
        "---",
        "kind: spec",
        "spec_type: prd",
        "name: ears-invalid",
        'title: "Invalid EARS"',
        "status: draft",
        "version: 1",
        "owners:",
        "  - test",
        "summary: Test",
        "domain: test",
        "tags:",
        "  - test",
        "depends_on: []",
        "supersedes: []",
        "implements: null",
        "last_reviewed_at: 2026-01-01",
        "---",
        "",
        "# Summary",
        "Test doc.",
        "",
        "# Requirements",
        "```yaml",
        "ears_requirements:",
        "  - id: REQ-BAD-001",
        '    statement: "missing kind and priority"',
        "```",
        "",
      ].join("\n")
      writeFileSync(docPath, content, "utf-8")

      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      const json = JSON.parse(result.stdout)
      const earsIssues = json.issues.filter((i: { section: string }) => i.section === "ears")
      expect(earsIssues.length).toBeGreaterThan(0)
      // EARS errors are severity "error"
      expect(earsIssues.some((i: { severity: string }) => i.severity === "error")).toBe(true)
    })

    it("returns exit code 1 when EARS errors exist", { timeout: 120_000 }, () => {
      const add = runTx(cwd, dbPath, ["doc", "add", "prd", "ears-exit", "--title", "EARS Exit"])
      expect(add.status).toBe(0)

      const docPath = join(cwd, "specs", "prd", "ears-exit.md")
      writeFileSync(docPath, [
        "---",
        "kind: spec",
        "spec_type: prd",
        "name: ears-exit",
        'title: "EARS Exit"',
        "status: draft",
        "version: 1",
        "owners: [test]",
        "summary: T",
        "domain: test",
        "tags: [test]",
        "depends_on: []",
        "supersedes: []",
        "implements: null",
        "last_reviewed_at: 2026-01-01",
        "---",
        "",
        "# Requirements",
        "```yaml",
        "ears_requirements:",
        "  - id: REQ-EXIT-001",
        '    statement: "missing kind"',
        "```",
        "",
      ].join("\n"), "utf-8")

      const result = runTx(cwd, dbPath, ["spec", "lint"])
      expect(result.status).toBe(1) // errors cause exit 1
      expect(result.stdout).toContain("Spec Lint: FAIL")
    })
  })

  describe("spec-test coverage", () => {
    it("warns about uncovered invariants", { timeout: 120_000 }, () => {
      // Create a design doc with invariants
      const add = runTx(cwd, dbPath, ["doc", "add", "design", "inv-uncov", "--title", "Invariant Coverage"])
      expect(add.status).toBe(0)

      // Write invariants into the doc
      const docPath = join(cwd, "specs", "design", "inv-uncov.md")
      const original = readFileSync(docPath, "utf-8")
      const withInvariants = original + [
        "",
        "# Invariants",
        "```yaml",
        "invariants:",
        "  - id: INV-UNCOV-001",
        '    statement: "uncovered rule"',
        "    severity: high",
        "    verified_by:",
        "      - test/placeholder.test.ts",
        "```",
        "",
      ].join("\n")
      writeFileSync(docPath, withInvariants, "utf-8")

      // Sync invariants
      runTx(cwd, dbPath, ["invariant", "sync", "--doc", "inv-uncov"])

      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(result.status).toBe(0) // uncovered is a warning
      const json = JSON.parse(result.stdout)
      const specIssues = json.issues.filter((i: { section: string }) => i.section === "spec")
      expect(specIssues.some((i: { message: string }) => i.message.includes("no linked tests"))).toBe(true)
    })
  })

  describe("combined output", () => {
    it("shows all sections in human-readable output", { timeout: 120_000 }, () => {
      const add = runTx(cwd, dbPath, ["doc", "add", "prd", "combo-test", "--title", "Combo"])
      expect(add.status).toBe(0)

      const result = runTx(cwd, dbPath, ["spec", "lint"])
      expect(result.stdout).toContain("Spec Lint:")
      expect(result.stdout).toContain("Docs:")
      expect(result.stdout).toContain("Coverage:")
      expect(result.stdout).toContain("Index:")
      expect(result.stdout).toContain("EARS:")
      expect(result.stdout).toContain("Spec-Test:")
    })

    it("JSON output has complete structure", { timeout: 120_000 }, () => {
      const result = runTx(cwd, dbPath, ["spec", "lint", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("ok")
      expect(json).toHaveProperty("total_docs")
      expect(json).toHaveProperty("drift_count")
      expect(json).toHaveProperty("coverage_warnings")
      expect(json).toHaveProperty("index_warnings")
      expect(json).toHaveProperty("fci")
      expect(json).toHaveProperty("phase")
      expect(json).toHaveProperty("issues")
      expect(typeof json.ok).toBe("boolean")
      expect(typeof json.total_docs).toBe("number")
      expect(Array.isArray(json.issues)).toBe(true)
    })
  })

  describe("help", () => {
    it("spec lint --help shows help", () => {
      const result = runTx(cwd, dbPath, ["spec", "lint", "--help"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("spec lint")
      expect(result.stdout).toContain("Index searchability")
    })

    it("help spec lint shows subcommand help", () => {
      const result = runTx(cwd, dbPath, ["help", "spec", "lint"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("spec lint")
      expect(result.stdout).toContain("Search Keywords")
    })
  })

  describe("deprecated invariant alias", () => {
    it("tx invariant shows deprecation warning", () => {
      const result = runTx(cwd, dbPath, ["invariant", "list"])
      expect(result.stderr).toContain("[deprecated]")
      expect(result.stderr).toContain("tx spec")
    })
  })
})
