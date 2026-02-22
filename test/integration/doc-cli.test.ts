import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

function runTx(args: string[], cwd: string): ExecResult {
  const res = spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
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
    expect(existsSync(join(tmpProjectDir, ".tx", "docs", "index.md"))).toBe(true)
    expect(existsSync(join(tmpProjectDir, ".tx", "docs", "index.yml"))).toBe(true)
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
})
