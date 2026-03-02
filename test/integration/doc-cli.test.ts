import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun"
const HAS_BUN =
  process.execPath.includes("bun") ||
  spawnSync("bun", ["--version"], { encoding: "utf-8" }).status === 0

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

function runTx(args: string[], cwd: string): ExecResult {
  const runner = HAS_BUN ? BUN_BIN : process.execPath
  const runnerArgs = HAS_BUN
    ? [CLI_SRC, ...args]
    : ["--loader", "tsx", CLI_SRC, ...args]

  const res = spawnSync(runner, runnerArgs, {
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

describe("tx doc command default behavior", () => {
  let tmpProjectDir: string

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-cli-"))
    const init = runTx(["init", "--codex"], tmpProjectDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("defaults to listing docs when no subcommand is provided", () => {
    const result = runTx(["doc"], tmpProjectDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No docs found")
  })

  it("lists docs from tx doc after creating one", () => {
    const addDoc = runTx(
      ["doc", "add", "overview", "doc-default-test", "--title", "Doc Default Test"],
      tmpProjectDir,
    )
    expect(addDoc.status).toBe(0)

    const result = runTx(["doc"], tmpProjectDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("doc-default-test")
    expect(result.stdout).toContain("doc(s):")
  })

  it("returns JSON list when using tx doc --json", () => {
    const addDoc = runTx(
      ["doc", "add", "overview", "doc-default-json", "--title", "Doc Default Json"],
      tmpProjectDir,
    )
    expect(addDoc.status).toBe(0)

    const result = runTx(["doc", "--json"], tmpProjectDir)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as Array<{ name: string }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.some((doc) => doc.name === "doc-default-json")).toBe(true)
  })
})

describe("tx doc lifecycle coverage", () => {
  let tmpProjectDir: string

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-lifecycle-"))
    const init = runTx(["init", "--codex"], tmpProjectDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("supports lock + version for PRDs", () => {
    const add = runTx(["doc", "add", "prd", "prd-lifecycle", "--title", "PRD Lifecycle"], tmpProjectDir)
    expect(add.status).toBe(0)

    const lock = runTx(["doc", "lock", "prd-lifecycle"], tmpProjectDir)
    expect(lock.status).toBe(0)
    expect(lock.stdout).toContain("Locked: prd-lifecycle")

    const version = runTx(["doc", "version", "prd-lifecycle"], tmpProjectDir)
    expect(version.status).toBe(0)
    expect(version.stdout).toContain("Created version: prd-lifecycle v2")

    const show = runTx(["doc", "show", "prd-lifecycle", "--json"], tmpProjectDir)
    expect(show.status).toBe(0)
    const doc = JSON.parse(show.stdout) as { name: string; version: number; status: string }
    expect(doc.name).toBe("prd-lifecycle")
    expect(doc.version).toBe(2)
    expect(doc.status).toBe("changing")
  })

  it("supports doc linking, patch creation, and rendering", () => {
    const addPrd = runTx(["doc", "add", "prd", "prd-feature", "--title", "PRD Feature"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "dd-feature", "--title", "DD Feature"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    const link = runTx(["doc", "link", "prd-feature", "dd-feature"], tmpProjectDir)
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("Linked: prd-feature → dd-feature")

    const patch = runTx(
      ["doc", "patch", "dd-feature", "dd-feature-patch", "--title", "DD Feature Patch"],
      tmpProjectDir
    )
    expect(patch.status).toBe(0)
    expect(patch.stdout).toContain("Created patch: dd-feature-patch → dd-feature")

    const render = runTx(["doc", "render"], tmpProjectDir)
    expect(render.status).toBe(0)
    expect(render.stdout).toContain("Rendered")
    // After subprocess exits, verify files exist (retry briefly for fs flush)
    const indexMd = join(tmpProjectDir, ".tx", "docs", "index.md")
    const indexYml = join(tmpProjectDir, ".tx", "docs", "index.yml")
    for (let i = 0; i < 10 && (!existsSync(indexMd) || !existsSync(indexYml)); i++) {
      spawnSync("sleep", ["0.05"])
    }
    expect(existsSync(indexMd)).toBe(true)
    expect(existsSync(indexYml)).toBe(true)
  })

  it("validate reflects unlinked tasks and clears after attach", () => {
    const addTask = runTx(["add", "Implement docs flow", "--json"], tmpProjectDir)
    expect(addTask.status).toBe(0)
    const task = JSON.parse(addTask.stdout) as { id: string }

    const addDesign = runTx(["doc", "add", "design", "dd-attach", "--title", "DD Attach"], tmpProjectDir)
    expect(addDesign.status).toBe(0)

    const validateBefore = runTx(["doc", "validate", "--json"], tmpProjectDir)
    expect(validateBefore.status).toBe(0)
    const before = JSON.parse(validateBefore.stdout) as { warnings: string[] }
    expect(before.warnings.some((w) => w.includes(task.id))).toBe(true)

    const attach = runTx(["doc", "attach", task.id, "dd-attach", "--type", "implements"], tmpProjectDir)
    expect(attach.status).toBe(0)
    expect(attach.stdout).toContain(`Attached: task ${task.id} → doc dd-attach (implements)`)

    const validateAfter = runTx(["doc", "validate", "--json"], tmpProjectDir)
    expect(validateAfter.status).toBe(0)
    const after = JSON.parse(validateAfter.stdout) as { warnings: string[] }
    expect(after.warnings).toEqual([])
  })

  it("detects content drift after YAML mutation", () => {
    const addTask = runTx(["add", "Drift task", "--json"], tmpProjectDir)
    expect(addTask.status).toBe(0)
    const task = JSON.parse(addTask.stdout) as { id: string }

    const addDesign = runTx(["doc", "add", "design", "dd-drift", "--title", "DD Drift"], tmpProjectDir)
    expect(addDesign.status).toBe(0)
    const attach = runTx(["doc", "attach", task.id, "dd-drift"], tmpProjectDir)
    expect(attach.status).toBe(0)

    const clean = runTx(["doc", "drift", "dd-drift", "--json"], tmpProjectDir)
    expect(clean.status).toBe(0)
    const cleanJson = JSON.parse(clean.stdout) as { warnings: string[] }
    expect(cleanJson.warnings).toEqual([])

    const yamlPath = join(tmpProjectDir, ".tx", "docs", "design", "dd-drift.yml")
    const original = readFileSync(yamlPath, "utf-8")
    writeFileSync(yamlPath, `${original}\n# manual drift edit\n`, "utf-8")

    const drift = runTx(["doc", "drift", "dd-drift", "--json"], tmpProjectDir)
    expect(drift.status).toBe(0)
    const driftJson = JSON.parse(drift.stdout) as { warnings: string[] }
    expect(driftJson.warnings.length).toBeGreaterThan(0)
    expect(driftJson.warnings.some((w) => w.includes("Content hash mismatch"))).toBe(true)
  })

  it("syncs invariants from explicit YAML, PRD requirements/EARS, and design goals", () => {
    const addPrd = runTx(["doc", "add", "prd", "invariant-prd", "--title", "Invariant PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "invariant-design", "--title", "Invariant Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    const prdYamlPath = join(tmpProjectDir, ".tx", "docs", "prd", "invariant-prd.yml")
    writeFileSync(
      prdYamlPath,
      [
        "kind: prd",
        "name: invariant-prd",
        'title: "Invariant PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements:",
        "  - Requirement one must hold",
        "  - Requirement two remains true",
        "",
        "ears_requirements:",
        "  - id: EARS-PRD-001",
        "    pattern: ubiquitous",
        "    system: The API",
        "    response: return deterministic task IDs",
        "    test_hint: test/integration/task-id.test.ts",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
        "invariants:",
        "  - id: INV-PRD-EXPLICIT-001",
        "    rule: Explicit PRD invariant",
        "    enforcement: integration_test",
        "",
      ].join("\n"),
      "utf-8"
    )

    const designYamlPath = join(tmpProjectDir, ".tx", "docs", "design", "invariant-design.yml")
    writeFileSync(
      designYamlPath,
      [
        "kind: design",
        "name: invariant-design",
        'title: "Invariant Design"',
        "status: changing",
        "version: 1",
        "",
        "problem_definition: |",
        "  Why this change is needed.",
        "",
        "goals:",
        "  - Design goal one must be preserved",
        "  - Design goal two must stay true",
        "",
        "architecture: |",
        "  ## Components",
        "  ...",
        "",
        "data_model: |",
        "  ## Table Name",
        "  | Column | Type | Constraints |",
        "  |--------|------|-------------|",
        "",
        "invariants:",
        "  - id: INV-DESIGN-EXPLICIT-001",
        "    rule: Explicit design invariant",
        "    enforcement: linter",
        "",
      ].join("\n"),
      "utf-8"
    )

    const sync = runTx(["invariant", "sync", "--json"], tmpProjectDir)
    expect(sync.status).toBe(0)
    const syncJson = JSON.parse(sync.stdout) as {
      synced: number
      invariants: Array<{ id: string }>
    }
    expect(syncJson.synced).toBe(7)

    const syncedIds = syncJson.invariants.map((inv) => inv.id)
    expect(syncedIds).toContain("INV-PRD-EXPLICIT-001")
    expect(syncedIds).toContain("INV-DESIGN-EXPLICIT-001")
    expect(syncedIds).toContain("INV-EARS-PRD-001")
    expect(syncedIds).toContain("INV-PRD-INVARIANT-PRD-REQ-001")
    expect(syncedIds).toContain("INV-PRD-INVARIANT-PRD-REQ-002")
    expect(syncedIds).toContain("INV-DESIGN-INVARIANT-DESIGN-GOAL-001")
    expect(syncedIds).toContain("INV-DESIGN-INVARIANT-DESIGN-GOAL-002")
  })

  it("retains EARS-derived subsystem/test_ref metadata and supports subsystem filtering", () => {
    const addPrd = runTx(["doc", "add", "prd", "ears-meta-prd", "--title", "EARS Meta PRD"], tmpProjectDir)
    expect(addPrd.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "prd", "ears-meta-prd.yml"),
      [
        "kind: prd",
        "name: ears-meta-prd",
        'title: "EARS Meta PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements: []",
        "",
        "ears_requirements:",
        "  - id: EARS-AUTH-001",
        "    pattern: ubiquitous",
        "    system: Authentication API",
        "    response: emit deterministic access tokens",
        "    test_hint: test/integration/auth-token.test.ts",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
      ].join("\n"),
      "utf-8"
    )

    const sync = runTx(["invariant", "sync", "--doc", "ears-meta-prd", "--json"], tmpProjectDir)
    expect(sync.status).toBe(0)
    const syncJson = JSON.parse(sync.stdout) as { synced: number; invariants: Array<{ id: string }> }
    expect(syncJson.synced).toBe(1)
    expect(syncJson.invariants.map((inv) => inv.id)).toContain("INV-EARS-AUTH-001")

    const show = runTx(["invariant", "show", "INV-EARS-AUTH-001", "--json"], tmpProjectDir)
    expect(show.status).toBe(0)
    const shown = JSON.parse(show.stdout) as {
      id: string
      subsystem?: string | null
      testRef?: string | null
    }
    expect(shown.id).toBe("INV-EARS-AUTH-001")
    expect(shown.subsystem).toBe("auth")
    expect(shown.testRef).toBe("test/integration/auth-token.test.ts")

    const listBySubsystem = runTx(["invariant", "list", "--subsystem", "auth", "--json"], tmpProjectDir)
    expect(listBySubsystem.status).toBe(0)
    const filtered = JSON.parse(listBySubsystem.stdout) as Array<{ id: string; subsystem?: string | null }>
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe("INV-EARS-AUTH-001")
    expect(filtered[0]?.subsystem).toBe("auth")
  })

  it("syncs only the requested doc when using invariant sync --doc", () => {
    const addPrd = runTx(["doc", "add", "prd", "target-prd", "--title", "Target PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "target-design", "--title", "Target Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "prd", "target-prd.yml"),
      [
        "kind: prd",
        "name: target-prd",
        'title: "Target PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements:",
        "  - Requirement A",
        "  - Requirement B",
        "",
        "ears_requirements:",
        "  - id: EARS-TGT-001",
        "    pattern: ubiquitous",
        "    system: Target API",
        "    response: return deterministic values",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
        "invariants:",
        "  - id: INV-TARGET-PRD-EXPLICIT-001",
        "    rule: Explicit target PRD invariant",
        "    enforcement: integration_test",
        "",
      ].join("\n"),
      "utf-8"
    )

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "design", "target-design.yml"),
      [
        "kind: design",
        "name: target-design",
        'title: "Target Design"',
        "status: changing",
        "version: 1",
        "",
        "problem_definition: |",
        "  Why this change is needed.",
        "",
        "goals:",
        "  - Keep target design stable",
        "",
        "architecture: |",
        "  ## Components",
        "  ...",
        "",
        "data_model: |",
        "  ## Table Name",
        "  | Column | Type | Constraints |",
        "  |--------|------|-------------|",
        "",
        "invariants:",
        "  - id: INV-TARGET-DESIGN-EXPLICIT-001",
        "    rule: Explicit target design invariant",
        "    enforcement: linter",
        "",
      ].join("\n"),
      "utf-8"
    )

    const syncPrd = runTx(["invariant", "sync", "--doc", "target-prd", "--json"], tmpProjectDir)
    expect(syncPrd.status).toBe(0)
    const syncPrdJson = JSON.parse(syncPrd.stdout) as { synced: number; invariants: Array<{ id: string }> }
    expect(syncPrdJson.synced).toBe(4)
    expect(syncPrdJson.invariants.map((inv) => inv.id)).toContain("INV-TARGET-PRD-EXPLICIT-001")
    expect(syncPrdJson.invariants.map((inv) => inv.id)).not.toContain("INV-TARGET-DESIGN-EXPLICIT-001")

    const listAfterPrd = runTx(["invariant", "list", "--json"], tmpProjectDir)
    expect(listAfterPrd.status).toBe(0)
    const listAfterPrdJson = JSON.parse(listAfterPrd.stdout) as Array<{ id: string }>
    expect(listAfterPrdJson).toHaveLength(4)
    expect(listAfterPrdJson.some((inv) => inv.id === "INV-TARGET-DESIGN-EXPLICIT-001")).toBe(false)

    const syncDesign = runTx(["invariant", "sync", "--doc", "target-design", "--json"], tmpProjectDir)
    expect(syncDesign.status).toBe(0)
    const syncDesignJson = JSON.parse(syncDesign.stdout) as { synced: number; invariants: Array<{ id: string }> }
    expect(syncDesignJson.synced).toBe(2)
    expect(syncDesignJson.invariants.map((inv) => inv.id)).toContain("INV-TARGET-DESIGN-EXPLICIT-001")
  })

  it("deprecates invariants that are removed from YAML on re-sync", () => {
    const addPrd = runTx(["doc", "add", "prd", "deprecation-prd", "--title", "Deprecation PRD"], tmpProjectDir)
    expect(addPrd.status).toBe(0)

    const prdPath = join(tmpProjectDir, ".tx", "docs", "prd", "deprecation-prd.yml")
    writeFileSync(
      prdPath,
      [
        "kind: prd",
        "name: deprecation-prd",
        'title: "Deprecation PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements:",
        "  - Requirement to remove later",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
        "invariants:",
        "  - id: INV-DEPRECATION-EXPLICIT-001",
        "    rule: Explicit invariant to remove",
        "    enforcement: integration_test",
        "",
      ].join("\n"),
      "utf-8"
    )

    const firstSync = runTx(["invariant", "sync", "--doc", "deprecation-prd", "--json"], tmpProjectDir)
    expect(firstSync.status).toBe(0)
    const firstSyncJson = JSON.parse(firstSync.stdout) as { synced: number }
    expect(firstSyncJson.synced).toBe(2)

    writeFileSync(
      prdPath,
      [
        "kind: prd",
        "name: deprecation-prd",
        'title: "Deprecation PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements: []",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
      ].join("\n"),
      "utf-8"
    )

    const secondSync = runTx(["invariant", "sync", "--doc", "deprecation-prd", "--json"], tmpProjectDir)
    expect(secondSync.status).toBe(0)
    const secondSyncJson = JSON.parse(secondSync.stdout) as { synced: number }
    expect(secondSyncJson.synced).toBe(0)

    const list = runTx(["invariant", "list", "--json"], tmpProjectDir)
    expect(list.status).toBe(0)
    const listed = JSON.parse(list.stdout) as Array<{ id: string; status: string }>
    const deprecationIds = new Set([
      "INV-DEPRECATION-EXPLICIT-001",
      "INV-PRD-DEPRECATION-PRD-REQ-001",
    ])
    const rows = listed.filter((inv) => deprecationIds.has(inv.id))
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe("deprecated")
    }
  })

  it("upserts existing invariants by id instead of duplicating rows", () => {
    const addPrd = runTx(["doc", "add", "prd", "upsert-prd", "--title", "Upsert PRD"], tmpProjectDir)
    expect(addPrd.status).toBe(0)

    const prdPath = join(tmpProjectDir, ".tx", "docs", "prd", "upsert-prd.yml")
    writeFileSync(
      prdPath,
      [
        "kind: prd",
        "name: upsert-prd",
        'title: "Upsert PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements: []",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
        "invariants:",
        "  - id: INV-UPSERT-001",
        "    rule: Original rule text",
        "    enforcement: integration_test",
        "    test_ref: test/original.test.ts",
        "",
      ].join("\n"),
      "utf-8"
    )

    const firstSync = runTx(["invariant", "sync", "--doc", "upsert-prd", "--json"], tmpProjectDir)
    expect(firstSync.status).toBe(0)

    writeFileSync(
      prdPath,
      [
        "kind: prd",
        "name: upsert-prd",
        'title: "Upsert PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements: []",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
        "invariants:",
        "  - id: INV-UPSERT-001",
        "    rule: Updated rule text",
        "    enforcement: integration_test",
        "    test_ref: test/updated.test.ts",
        "",
      ].join("\n"),
      "utf-8"
    )

    const secondSync = runTx(["invariant", "sync", "--doc", "upsert-prd", "--json"], tmpProjectDir)
    expect(secondSync.status).toBe(0)
    const secondSyncJson = JSON.parse(secondSync.stdout) as { synced: number }
    expect(secondSyncJson.synced).toBe(1)

    const list = runTx(["invariant", "list", "--json"], tmpProjectDir)
    expect(list.status).toBe(0)
    const rows = (JSON.parse(list.stdout) as Array<{
      id: string
      rule: string
      testRef?: string | null
      status: string
    }>).filter((inv) => inv.id === "INV-UPSERT-001")

    expect(rows).toHaveLength(1)
    expect(rows[0]?.rule).toBe("Updated rule text")
    expect(rows[0]?.testRef).toBe("test/updated.test.ts")
    expect(rows[0]?.status).toBe("active")
  })

  it("derives invariants from scalar legacy requirements/goals blocks", () => {
    const addPrd = runTx(["doc", "add", "prd", "scalar-prd", "--title", "Scalar PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "scalar-design", "--title", "Scalar Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "prd", "scalar-prd.yml"),
      [
        "kind: prd",
        "name: scalar-prd",
        'title: "Scalar PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements: |",
        "  - Legacy requirement one",
        "  - Legacy requirement two",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
      ].join("\n"),
      "utf-8"
    )

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "design", "scalar-design.yml"),
      [
        "kind: design",
        "name: scalar-design",
        'title: "Scalar Design"',
        "status: changing",
        "version: 1",
        "",
        "problem_definition: |",
        "  Why this change is needed.",
        "",
        "goals: |",
        "  - Legacy goal one",
        "  - Legacy goal two",
        "",
        "architecture: |",
        "  ## Components",
        "  ...",
        "",
        "data_model: |",
        "  ## Table Name",
        "  | Column | Type | Constraints |",
        "  |--------|------|-------------|",
        "",
      ].join("\n"),
      "utf-8"
    )

    const sync = runTx(["invariant", "sync", "--json"], tmpProjectDir)
    expect(sync.status).toBe(0)
    const syncJson = JSON.parse(sync.stdout) as {
      synced: number
      invariants: Array<{ id: string }>
    }

    expect(syncJson.synced).toBe(4)
    const ids = new Set(syncJson.invariants.map((inv) => inv.id))
    expect(ids.has("INV-PRD-SCALAR-PRD-REQ-001")).toBe(true)
    expect(ids.has("INV-PRD-SCALAR-PRD-REQ-002")).toBe(true)
    expect(ids.has("INV-DESIGN-SCALAR-DESIGN-GOAL-001")).toBe(true)
    expect(ids.has("INV-DESIGN-SCALAR-DESIGN-GOAL-002")).toBe(true)
  })

  it("supports invariant show and record flows after sync", () => {
    const addPrd = runTx(["doc", "add", "prd", "record-prd", "--title", "Record PRD"], tmpProjectDir)
    expect(addPrd.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "prd", "record-prd.yml"),
      [
        "kind: prd",
        "name: record-prd",
        'title: "Record PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Problem statement.",
        "",
        "solution: |",
        "  Solution statement.",
        "",
        "requirements: []",
        "",
        "acceptance_criteria:",
        "  - Criterion 1",
        "",
        "out_of_scope:",
        "  - Item 1",
        "",
        "invariants:",
        "  - id: INV-RECORD-001",
        "    rule: Record flow invariant",
        "    enforcement: integration_test",
        "",
      ].join("\n"),
      "utf-8"
    )

    const sync = runTx(["invariant", "sync", "--doc", "record-prd", "--json"], tmpProjectDir)
    expect(sync.status).toBe(0)

    const show = runTx(["invariant", "show", "INV-RECORD-001", "--json"], tmpProjectDir)
    expect(show.status).toBe(0)
    const shown = JSON.parse(show.stdout) as { id: string; rule: string; status: string }
    expect(shown.id).toBe("INV-RECORD-001")
    expect(shown.rule).toBe("Record flow invariant")
    expect(shown.status).toBe("active")

    const recordPassed = runTx(
      ["invariant", "record", "INV-RECORD-001", "--passed", "--details", "manual pass", "--json"],
      tmpProjectDir
    )
    expect(recordPassed.status).toBe(0)
    const passedPayload = JSON.parse(recordPassed.stdout) as {
      invariantId: string
      passed: boolean
      details: string | null
    }
    expect(passedPayload.invariantId).toBe("INV-RECORD-001")
    expect(passedPayload.passed).toBe(true)
    expect(passedPayload.details).toBe("manual pass")
  })

  it("returns clear errors for invariant show/record on unknown ids", () => {
    const missingShow = runTx(["invariant", "show", "INV-MISSING-001"], tmpProjectDir)
    expect(missingShow.status).not.toBe(0)
    expect(missingShow.stderr).toContain("Invariant not found: INV-MISSING-001")

    const missingRecord = runTx(["invariant", "record", "INV-MISSING-001", "--passed"], tmpProjectDir)
    expect(missingRecord.status).not.toBe(0)
    expect(missingRecord.stderr).toContain("Invariant not found")
  })

  it("shows usage and flag errors for invariant show/record argument guards", () => {
    const showUsage = runTx(["invariant", "show"], tmpProjectDir)
    expect(showUsage.status).not.toBe(0)
    expect(showUsage.stderr).toContain("Usage: tx invariant show <id>")

    const recordMissingFlags = runTx(["invariant", "record", "INV-ANY"], tmpProjectDir)
    expect(recordMissingFlags.status).not.toBe(0)
    expect(recordMissingFlags.stderr).toContain("Must specify --passed or --failed")
  })

  it("fails doc-scoped invariant sync when the requested doc does not exist", () => {
    const missing = runTx(["invariant", "sync", "--doc", "ghost-doc"], tmpProjectDir)
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain("Doc not found")
  })

  it("continues syncing valid docs when one doc has malformed YAML", () => {
    const addBad = runTx(["doc", "add", "prd", "bad-prd", "--title", "Bad PRD"], tmpProjectDir)
    const addGood = runTx(["doc", "add", "prd", "good-prd", "--title", "Good PRD"], tmpProjectDir)
    expect(addBad.status).toBe(0)
    expect(addGood.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "prd", "bad-prd.yml"),
      [
        "kind: prd",
        "name: bad-prd",
        'title: "Bad PRD"',
        "status: changing",
        "requirements:",
        "  - [broken",
        "",
      ].join("\n"),
      "utf-8"
    )

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "prd", "good-prd.yml"),
      [
        "kind: prd",
        "name: good-prd",
        'title: "Good PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Good problem.",
        "",
        "solution: |",
        "  Good solution.",
        "",
        "requirements:",
        "  - Good requirement",
        "",
        "acceptance_criteria:",
        "  - Good criterion",
        "",
        "out_of_scope:",
        "  - None",
        "",
        "invariants:",
        "  - id: INV-GOOD-001",
        "    rule: Good explicit invariant",
        "    enforcement: integration_test",
        "",
      ].join("\n"),
      "utf-8"
    )

    const syncAll = runTx(["invariant", "sync", "--json"], tmpProjectDir)
    expect(syncAll.status).toBe(0)
    const payload = JSON.parse(syncAll.stdout) as {
      synced: number
      invariants: Array<{ id: string }>
    }
    expect(payload.synced).toBe(2)
    const ids = new Set(payload.invariants.map((inv) => inv.id))
    expect(ids.has("INV-GOOD-001")).toBe(true)
    expect(ids.has("INV-PRD-GOOD-PRD-REQ-001")).toBe(true)
  })

  it("fails doc-scoped invariant sync when the target doc YAML is malformed", () => {
    const addBad = runTx(["doc", "add", "prd", "bad-only-prd", "--title", "Bad Only PRD"], tmpProjectDir)
    expect(addBad.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, ".tx", "docs", "prd", "bad-only-prd.yml"),
      [
        "kind: prd",
        "name: bad-only-prd",
        'title: "Bad Only PRD"',
        "status: changing",
        "requirements:",
        "  - [broken",
        "",
      ].join("\n"),
      "utf-8"
    )

    const syncDoc = runTx(["invariant", "sync", "--doc", "bad-only-prd"], tmpProjectDir)
    expect(syncDoc.status).not.toBe(0)
    expect(syncDoc.stderr).toContain("Invalid YAML for doc 'bad-only-prd'")
  })
})
