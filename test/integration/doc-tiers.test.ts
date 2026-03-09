import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
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

describe("4-tier doc system (Phase 1)", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-doc-tiers-"))
    const init = runTx(["init", "--codex"], tmpDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("creates a requirement doc with YAML template", () => {
    const add = runTx(
      ["doc", "add", "requirement", "auth-flows", "--title", "Auth Flows"],
      tmpDir,
    )
    expect(add.status).toBe(0)
    expect(add.stdout).toContain("auth-flows")

    // Verify YAML file exists and contains expected sections
    const filePath = join(tmpDir, ".tx", "docs", "requirement", "auth-flows.yml")
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, "utf-8")
    expect(content).toContain("kind: requirement")
    expect(content).toContain('title: "Auth Flows"')
    expect(content).toContain("actors:")
    expect(content).toContain("use_cases:")
    expect(content).toContain("traceability:")
  })

  it("creates a system_design doc with YAML template", () => {
    const add = runTx(
      ["doc", "add", "system_design", "error-handling", "--title", "Error Handling"],
      tmpDir,
    )
    expect(add.status).toBe(0)
    expect(add.stdout).toContain("error-handling")

    const filePath = join(tmpDir, ".tx", "docs", "system_design", "error-handling.yml")
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, "utf-8")
    expect(content).toContain("kind: system_design")
    expect(content).toContain('title: "Error Handling"')
    expect(content).toContain("scope:")
    expect(content).toContain("constraints:")
    expect(content).toContain("applies_to:")
    expect(content).toContain("decision_log:")
  })

  it("lists requirement and system_design docs", () => {
    runTx(
      ["doc", "add", "requirement", "req-one", "--title", "Req One"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "system_design", "sd-one", "--title", "SD One"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "design", "dd-one", "--title", "DD One"],
      tmpDir,
    )

    const list = runTx(["doc", "list", "--json"], tmpDir)
    expect(list.status).toBe(0)
    const docs = JSON.parse(list.stdout)
    expect(docs).toHaveLength(3)

    const kinds = docs.map((d: { kind: string }) => d.kind).sort()
    expect(kinds).toEqual(["design", "requirement", "system_design"])
  })

  it("links requirement to prd (infers requirement_to_prd)", () => {
    runTx(
      ["doc", "add", "requirement", "auth-req", "--title", "Auth Req"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "prd", "auth-prd", "--title", "Auth PRD"],
      tmpDir,
    )

    const link = runTx(
      ["doc", "link", "auth-req", "auth-prd"],
      tmpDir,
    )
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("requirement_to_prd")
  })

  it("links requirement to design (infers requirement_to_design)", () => {
    runTx(
      ["doc", "add", "requirement", "req-x", "--title", "Req X"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "design", "dd-x", "--title", "DD X"],
      tmpDir,
    )

    const link = runTx(["doc", "link", "req-x", "dd-x"], tmpDir)
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("requirement_to_design")
  })

  it("links system_design to design (infers system_design_to_design)", () => {
    runTx(
      ["doc", "add", "system_design", "sd-err", "--title", "SD Err"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "design", "dd-err", "--title", "DD Err"],
      tmpDir,
    )

    const link = runTx(["doc", "link", "sd-err", "dd-err"], tmpDir)
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("system_design_to_design")
  })

  it("links system_design to prd (infers system_design_to_prd)", () => {
    runTx(
      ["doc", "add", "system_design", "sd-y", "--title", "SD Y"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "prd", "prd-y", "--title", "PRD Y"],
      tmpDir,
    )

    const link = runTx(["doc", "link", "sd-y", "prd-y"], tmpDir)
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("system_design_to_prd")
  })

  it("doc show works for requirement kind", () => {
    runTx(
      ["doc", "add", "requirement", "show-req", "--title", "Show Req"],
      tmpDir,
    )

    const show = runTx(["doc", "show", "show-req", "--json"], tmpDir)
    expect(show.status).toBe(0)
    const doc = JSON.parse(show.stdout)
    expect(doc.kind).toBe("requirement")
    expect(doc.name).toBe("show-req")
    expect(doc.title).toBe("Show Req")
    expect(doc.status).toBe("changing")
  })

  it("doc show works for system_design kind", () => {
    runTx(
      ["doc", "add", "system_design", "show-sd", "--title", "Show SD"],
      tmpDir,
    )

    const show = runTx(["doc", "show", "show-sd", "--json"], tmpDir)
    expect(show.status).toBe(0)
    const doc = JSON.parse(show.stdout)
    expect(doc.kind).toBe("system_design")
    expect(doc.name).toBe("show-sd")
  })

  it("full doc chain: requirement -> prd -> design with system_design cross-cut", () => {
    // Create all 4 doc types
    runTx(["doc", "add", "requirement", "full-req", "--title", "Full Req"], tmpDir)
    runTx(["doc", "add", "prd", "full-prd", "--title", "Full PRD"], tmpDir)
    runTx(["doc", "add", "design", "full-dd", "--title", "Full DD"], tmpDir)
    runTx(["doc", "add", "system_design", "full-sd", "--title", "Full SD"], tmpDir)

    // Link the chain
    const link1 = runTx(["doc", "link", "full-req", "full-prd"], tmpDir)
    expect(link1.status).toBe(0)

    const link2 = runTx(["doc", "link", "full-prd", "full-dd"], tmpDir)
    expect(link2.status).toBe(0)

    // Cross-cutting SD links
    const link3 = runTx(["doc", "link", "full-sd", "full-dd"], tmpDir)
    expect(link3.status).toBe(0)

    const link4 = runTx(["doc", "link", "full-sd", "full-prd"], tmpDir)
    expect(link4.status).toBe(0)

    // Verify all 4 docs exist
    const list = runTx(["doc", "list", "--json"], tmpDir)
    expect(JSON.parse(list.stdout)).toHaveLength(4)
  })

  it("validates requirement and system_design docs", () => {
    runTx(
      ["doc", "add", "requirement", "val-req", "--title", "Val Req"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "system_design", "val-sd", "--title", "Val SD"],
      tmpDir,
    )

    const valReq = runTx(["doc", "validate", "val-req"], tmpDir)
    expect(valReq.status).toBe(0)

    const valSd = runTx(["doc", "validate", "val-sd"], tmpDir)
    expect(valSd.status).toBe(0)
  })

  it("renders requirement doc to markdown", () => {
    runTx(
      ["doc", "add", "requirement", "render-req", "--title", "Render Req"],
      tmpDir,
    )

    const render = runTx(["doc", "render", "render-req"], tmpDir)
    expect(render.status).toBe(0)
    expect(render.stdout).toContain("Rendered 1 doc(s)")
    expect(render.stdout).toContain("render-req.md")
  })

  it("renders system_design doc to markdown", () => {
    runTx(
      ["doc", "add", "system_design", "render-sd", "--title", "Render SD"],
      tmpDir,
    )

    const render = runTx(["doc", "render", "render-sd"], tmpDir)
    expect(render.status).toBe(0)
    expect(render.stdout).toContain("Rendered 1 doc(s)")
    expect(render.stdout).toContain("render-sd.md")
  })

  it("rendered requirement markdown contains expected sections", () => {
    runTx(
      ["doc", "add", "requirement", "md-req", "--title", "MD Req"],
      tmpDir,
    )
    runTx(["doc", "render", "md-req"], tmpDir)

    const mdPath = join(tmpDir, ".tx", "docs", "requirement", "md-req.md")
    expect(existsSync(mdPath)).toBe(true)
    const md = readFileSync(mdPath, "utf-8")
    expect(md).toContain("# MD Req")
    expect(md).toContain("**Kind**: requirement")
  })

  it("rendered system_design markdown contains expected sections", () => {
    runTx(
      ["doc", "add", "system_design", "md-sd", "--title", "MD SD"],
      tmpDir,
    )
    runTx(["doc", "render", "md-sd"], tmpDir)

    const mdPath = join(tmpDir, ".tx", "docs", "system_design", "md-sd.md")
    expect(existsSync(mdPath)).toBe(true)
    const md = readFileSync(mdPath, "utf-8")
    expect(md).toContain("# MD SD")
    expect(md).toContain("**Kind**: system_design")
  })

  it("index.yml includes requirement and system_design docs", () => {
    runTx(["doc", "add", "requirement", "idx-req", "--title", "Idx Req"], tmpDir)
    runTx(["doc", "add", "prd", "idx-prd", "--title", "Idx PRD"], tmpDir)
    runTx(["doc", "add", "design", "idx-dd", "--title", "Idx DD"], tmpDir)
    runTx(["doc", "add", "system_design", "idx-sd", "--title", "Idx SD"], tmpDir)

    // Index gets regenerated on each doc add
    const indexPath = join(tmpDir, ".tx", "docs", "index.yml")
    expect(existsSync(indexPath)).toBe(true)
    const indexContent = readFileSync(indexPath, "utf-8")
    expect(indexContent).toContain("idx-req")
    expect(indexContent).toContain("idx-prd")
    expect(indexContent).toContain("idx-dd")
    expect(indexContent).toContain("idx-sd")
    expect(indexContent).toContain("requirements:")
    expect(indexContent).toContain("system_designs:")
  })

  it("index.md includes requirement and system_design tables", () => {
    runTx(["doc", "add", "requirement", "md-idx-req", "--title", "MD Idx Req"], tmpDir)
    runTx(["doc", "add", "system_design", "md-idx-sd", "--title", "MD Idx SD"], tmpDir)

    const indexMdPath = join(tmpDir, ".tx", "docs", "index.md")
    expect(existsSync(indexMdPath)).toBe(true)
    const indexMd = readFileSync(indexMdPath, "utf-8")
    expect(indexMd).toContain("Requirements Documents")
    expect(indexMd).toContain("System Design Documents")
    expect(indexMd).toContain("md-idx-req")
    expect(indexMd).toContain("md-idx-sd")
  })
})
