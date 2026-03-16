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

describe("doc system with markdown-first spec types", () => {
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

  it("creates a requirement doc as prd (deprecated kind normalized)", () => {
    const add = runTx(
      ["doc", "add", "requirement", "auth-flows", "--title", "Auth Flows"],
      tmpDir,
    )
    expect(add.status).toBe(0)
    expect(add.stdout).toContain("auth-flows")

    // requirement kind is normalized to prd — file is .md in specs/prd/
    const filePath = join(tmpDir, "specs", "prd", "auth-flows.md")
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, "utf-8")
    expect(content).toContain("kind: spec")
    expect(content).toContain("spec_type: prd")
    expect(content).toContain('title: "Auth Flows"')
    expect(content).toContain("ears_requirements:")
  })

  it("creates a system_design doc as design (deprecated kind normalized)", () => {
    const add = runTx(
      ["doc", "add", "system_design", "error-handling", "--title", "Error Handling"],
      tmpDir,
    )
    expect(add.status).toBe(0)
    expect(add.stdout).toContain("error-handling")

    // system_design kind is normalized to design — file is .md in specs/design/
    const filePath = join(tmpDir, "specs", "design", "error-handling.md")
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, "utf-8")
    expect(content).toContain("kind: spec")
    expect(content).toContain("spec_type: design")
    expect(content).toContain('title: "Error Handling"')
    expect(content).toContain("# Architecture")
    expect(content).toContain("# Invariants")
  })

  it("lists deprecated kinds as their normalized equivalents", () => {
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

    // requirement -> prd, system_design -> design
    const kinds = docs.map((d: { kind: string }) => d.kind).sort()
    expect(kinds).toEqual(["design", "design", "prd"])
  })

  it("links prd to design (infers prd_to_design)", () => {
    // requirement is normalized to prd
    runTx(
      ["doc", "add", "prd", "auth-req", "--title", "Auth Req"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "design", "auth-dd", "--title", "Auth DD"],
      tmpDir,
    )

    const link = runTx(
      ["doc", "link", "auth-req", "auth-dd"],
      tmpDir,
    )
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("prd_to_design")
  })

  it("links overview to prd (infers overview_to_prd)", () => {
    runTx(
      ["doc", "add", "overview", "overview-x", "--title", "Overview X"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "prd", "prd-x", "--title", "PRD X"],
      tmpDir,
    )

    const link = runTx(["doc", "link", "overview-x", "prd-x"], tmpDir)
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("overview_to_prd")
  })

  it("links overview to design (infers overview_to_design)", () => {
    runTx(
      ["doc", "add", "overview", "overview-y", "--title", "Overview Y"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "design", "dd-y", "--title", "DD Y"],
      tmpDir,
    )

    const link = runTx(["doc", "link", "overview-y", "dd-y"], tmpDir)
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("overview_to_design")
  })

  it("links prd to design (infers prd_to_design) for system_design normalized kind", () => {
    // system_design is normalized to design
    runTx(
      ["doc", "add", "system_design", "sd-err", "--title", "SD Err"],
      tmpDir,
    )
    runTx(
      ["doc", "add", "prd", "prd-err", "--title", "PRD Err"],
      tmpDir,
    )

    // sd-err is actually a design doc; linking prd -> design
    const link = runTx(["doc", "link", "prd-err", "sd-err"], tmpDir)
    expect(link.status).toBe(0)
    expect(link.stdout).toContain("prd_to_design")
  })

  it("doc show works for deprecated requirement kind (stored as prd)", () => {
    runTx(
      ["doc", "add", "requirement", "show-req", "--title", "Show Req"],
      tmpDir,
    )

    const show = runTx(["doc", "show", "show-req", "--json"], tmpDir)
    expect(show.status).toBe(0)
    const doc = JSON.parse(show.stdout)
    // Stored as prd since requirement is normalized
    expect(doc.kind).toBe("prd")
    expect(doc.name).toBe("show-req")
    expect(doc.title).toBe("Show Req")
    expect(doc.status).toBe("changing")
  })

  it("doc show works for deprecated system_design kind (stored as design)", () => {
    runTx(
      ["doc", "add", "system_design", "show-sd", "--title", "Show SD"],
      tmpDir,
    )

    const show = runTx(["doc", "show", "show-sd", "--json"], tmpDir)
    expect(show.status).toBe(0)
    const doc = JSON.parse(show.stdout)
    // Stored as design since system_design is normalized
    expect(doc.kind).toBe("design")
    expect(doc.name).toBe("show-sd")
  })

  it("full doc chain: overview -> prd -> design", { timeout: 30000 }, () => {
    // Create all core doc types (overview, prd, design)
    runTx(["doc", "add", "overview", "full-overview", "--title", "Full Overview"], tmpDir)
    runTx(["doc", "add", "prd", "full-prd", "--title", "Full PRD"], tmpDir)
    runTx(["doc", "add", "design", "full-dd", "--title", "Full DD"], tmpDir)

    // Link the chain
    const link1 = runTx(["doc", "link", "full-overview", "full-prd"], tmpDir)
    expect(link1.status).toBe(0)

    const link2 = runTx(["doc", "link", "full-prd", "full-dd"], tmpDir)
    expect(link2.status).toBe(0)

    // Also link overview directly to design
    const link3 = runTx(["doc", "link", "full-overview", "full-dd"], tmpDir)
    expect(link3.status).toBe(0)

    // Verify all 3 docs exist
    const list = runTx(["doc", "list", "--json"], tmpDir)
    expect(JSON.parse(list.stdout)).toHaveLength(3)
  })

  it("validates prd and design docs (including deprecated kind aliases)", () => {
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

  it("deprecated requirement doc creates markdown file as prd", () => {
    const add = runTx(
      ["doc", "add", "requirement", "render-req", "--title", "Render Req"],
      tmpDir,
    )
    expect(add.status).toBe(0)

    // requirement is normalized to prd, so file is in specs/prd/
    const mdPath = join(tmpDir, "specs", "prd", "render-req.md")
    expect(existsSync(mdPath)).toBe(true)
    const md = readFileSync(mdPath, "utf-8")
    expect(md).toContain("Render Req")
    expect(md).toContain("spec_type: prd")
  })

  it("deprecated system_design doc creates markdown file as design", () => {
    const add = runTx(
      ["doc", "add", "system_design", "render-sd", "--title", "Render SD"],
      tmpDir,
    )
    expect(add.status).toBe(0)

    // system_design is normalized to design, so file is in specs/design/
    const mdPath = join(tmpDir, "specs", "design", "render-sd.md")
    expect(existsSync(mdPath)).toBe(true)
    const md = readFileSync(mdPath, "utf-8")
    expect(md).toContain("Render SD")
    expect(md).toContain("spec_type: design")
  })

  it("deprecated requirement doc (as prd) contains expected markdown content", () => {
    runTx(
      ["doc", "add", "requirement", "md-req", "--title", "MD Req"],
      tmpDir,
    )

    // requirement is normalized to prd, so file is in specs/prd/
    const mdPath = join(tmpDir, "specs", "prd", "md-req.md")
    expect(existsSync(mdPath)).toBe(true)
    const md = readFileSync(mdPath, "utf-8")
    expect(md).toContain("MD Req")
    // Markdown-first: contains spec frontmatter
    expect(md).toContain("spec_type: prd")
  })

  it("deprecated system_design doc (as design) contains expected markdown content", () => {
    runTx(
      ["doc", "add", "system_design", "md-sd", "--title", "MD SD"],
      tmpDir,
    )

    // system_design is normalized to design, so file is in specs/design/
    const mdPath = join(tmpDir, "specs", "design", "md-sd.md")
    expect(existsSync(mdPath)).toBe(true)
    const md = readFileSync(mdPath, "utf-8")
    expect(md).toContain("MD SD")
    expect(md).toContain("spec_type: design")
  })

  it("index.yml includes all doc names", () => {
    runTx(["doc", "add", "prd", "idx-prd", "--title", "Idx PRD"], tmpDir)
    runTx(["doc", "add", "design", "idx-dd", "--title", "Idx DD"], tmpDir)
    runTx(["doc", "add", "overview", "idx-overview", "--title", "Idx Overview"], tmpDir)

    // Index gets regenerated on each doc add
    const indexPath = join(tmpDir, "specs", "index.yml")
    expect(existsSync(indexPath)).toBe(true)
    const indexContent = readFileSync(indexPath, "utf-8")
    expect(indexContent).toContain("idx-prd")
    expect(indexContent).toContain("idx-dd")
    expect(indexContent).toContain("idx-overview")
    // Markdown-first uses prd_docs: / design_docs: sections
    expect(indexContent).toContain("prd")
    expect(indexContent).toContain("design")
  })

  it("index.md includes PRD and Design tables", () => {
    runTx(["doc", "add", "prd", "md-idx-prd", "--title", "MD Idx PRD"], tmpDir)
    runTx(["doc", "add", "design", "md-idx-dd", "--title", "MD Idx DD"], tmpDir)

    const indexMdPath = join(tmpDir, "specs", "index.md")
    expect(existsSync(indexMdPath)).toBe(true)
    const indexMd = readFileSync(indexMdPath, "utf-8")
    expect(indexMd).toContain("Product Requirements Documents")
    expect(indexMd).toContain("Design Documents")
    expect(indexMd).toContain("md-idx-prd")
    expect(indexMd).toContain("md-idx-dd")
  })
})
