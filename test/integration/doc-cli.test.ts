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

function writeDocsConfig(cwd: string, requireEars: boolean): void {
  writeFileSync(
    join(cwd, ".tx", "config.toml"),
    ["[docs]", 'path = "specs"', `require_ears = ${requireEars}`].join("\n"),
    "utf-8"
  )
}

// ---------------------------------------------------------------------------
// Markdown-first helpers
// ---------------------------------------------------------------------------

interface InvariantDef {
  id: string
  statement: string
  severity?: string
  verified_by?: string[]
}

interface EarsRequirementDef {
  id: string
  kind?: string
  statement: string
  priority?: string
  rationale?: string
}

/** Build a fenced YAML block for invariants. */
function invariantsYaml(invariants: InvariantDef[]): string {
  const lines: string[] = ['```yaml', 'invariants:']
  for (const inv of invariants) {
    lines.push(`  - id: ${inv.id}`)
    lines.push(`    statement: "${inv.statement}"`)
    lines.push(`    severity: ${inv.severity ?? 'high'}`)
    lines.push('    verified_by:')
    for (const v of (inv.verified_by ?? ['test/placeholder.test.ts'])) {
      lines.push(`      - ${v}`)
    }
  }
  lines.push('```')
  return lines.join('\n')
}

/** Build a fenced YAML block for EARS requirements. */
function earsYaml(ears: EarsRequirementDef[]): string {
  const lines: string[] = ['```yaml', 'ears_requirements:']
  for (const req of ears) {
    lines.push(`  - id: ${req.id}`)
    lines.push(`    kind: ${req.kind ?? 'ubiquitous'}`)
    lines.push(`    statement: "${req.statement}"`)
    lines.push(`    priority: ${req.priority ?? 'must'}`)
    if (req.rationale) lines.push(`    rationale: "${req.rationale}"`)
  }
  lines.push('```')
  return lines.join('\n')
}

/**
 * Build a markdown-first doc with YAML frontmatter and section body.
 * Sections are rendered as `# Heading\nbody\n`. Embedded YAML blocks
 * (invariants, EARS) must be included inside the section body text
 * via the invariantsYaml/earsYaml helpers.
 */
function buildMdDoc(opts: {
  specType: string
  name: string
  title: string
  sections: Record<string, string>
}): string {
  const lines: string[] = [
    '---',
    'kind: spec',
    `spec_type: ${opts.specType}`,
    `name: ${opts.name}`,
    `title: "${opts.title}"`,
    'status: draft',
    'version: 1',
    'owners:',
    '  - team',
    `summary: ${opts.title} summary`,
    'domain: test',
    'tags: []',
    'depends_on: []',
    'supersedes: []',
    'implements: null',
    `last_reviewed_at: ${new Date().toISOString().split('T')[0]}`,
    '---',
    '',
  ]

  for (const [heading, body] of Object.entries(opts.sections)) {
    lines.push(`# ${heading}`, body, '')
  }

  return lines.join('\n')
}

/** Build required sections for a PRD spec type. */
function prdSections(opts?: {
  invariants?: InvariantDef[]
  ears?: EarsRequirementDef[]
}): Record<string, string> {
  const requirementsContent = (opts?.ears && opts.ears.length > 0)
    ? earsYaml(opts.ears)
    : 'No specific requirements.'

  const sections: Record<string, string> = {
    Summary: 'PRD summary.',
    Problem: 'Problem statement.',
    Scope: 'Included: all.\nExcluded: none.',
    Requirements: requirementsContent,
    'Acceptance Criteria': 'AC placeholder.',
  }

  if (opts?.invariants && opts.invariants.length > 0) {
    sections['Invariants'] = invariantsYaml(opts.invariants)
  }

  return sections
}

/** Build required sections for a design spec type. */
function designSections(opts?: {
  invariants?: InvariantDef[]
}): Record<string, string> {
  const invariantsContent = (opts?.invariants && opts.invariants.length > 0)
    ? invariantsYaml(opts.invariants)
    : '```yaml\ninvariants: []\n```'

  return {
    Summary: 'Design summary.',
    Architecture: '## Components\n...',
    Interfaces: '```yaml\ninterfaces: []\n```',
    'Data Model': 'No data model changes.',
    Invariants: invariantsContent,
    'Failure Modes': '```yaml\nfailure_modes: []\n```',
    Verification: '```yaml\nverification: []\n```',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  it("scaffolds PRDs with active EARS by default", () => {
    const addDoc = runTx(
      ["doc", "add", "prd", "doc-default-prd", "--title", "Doc Default PRD"],
      tmpProjectDir,
    )
    expect(addDoc.status).toBe(0)

    // Markdown-first: file is .md, not .yml
    const md = readFileSync(
      join(tmpProjectDir, "specs", "prd", "doc-default-prd.md"),
      "utf-8"
    )
    // Frontmatter contains spec_type: prd
    expect(md).toContain("spec_type: prd")
    expect(md).toContain("kind: spec")
    // EARS requirements are in a fenced yaml block
    expect(md).toContain("ears_requirements:")
    expect(md).toContain("REQ-DOCDEFAULTPR-001")
  })
})

describe("tx doc lifecycle coverage", () => {
  let tmpProjectDir: string

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-lifecycle-"))
    const init = runTx(["init", "--codex"], tmpProjectDir)
    expect(init.status).toBe(0)
    writeDocsConfig(tmpProjectDir, false)
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

  it("resolves duplicate slugs through scoped refs and stable doc ids", () => {
    const addPrd = runTx(["doc", "add", "prd", "shared-slug", "--title", "Shared PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "shared-slug", "--title", "Shared Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    const ambiguous = runTx(["doc", "show", "shared-slug", "--json"], tmpProjectDir)
    expect(ambiguous.status).toBe(1)
    const ambiguousError = JSON.parse(ambiguous.stdout) as {
      ok: false
      error: { message: string }
    }
    expect(ambiguousError.ok).toBe(false)
    expect(ambiguousError.error.message).toContain("ambiguous across kinds")
    expect(ambiguousError.error.message).toContain("Use doc_id instead")

    const prdShow = runTx(["doc", "show", "prd/shared-slug", "--json"], tmpProjectDir)
    const designShow = runTx(["doc", "show", "design/shared-slug", "--json"], tmpProjectDir)
    expect(prdShow.status).toBe(0)
    expect(designShow.status).toBe(0)

    const prdDoc = JSON.parse(prdShow.stdout) as {
      docId: string
      name: string
      kind: string
      filePath: string
    }
    const designDoc = JSON.parse(designShow.stdout) as {
      docId: string
      name: string
      kind: string
      filePath: string
    }

    expect(prdDoc).toMatchObject({
      name: "shared-slug",
      kind: "prd",
      filePath: "prd/shared-slug.md",
    })
    expect(designDoc).toMatchObject({
      name: "shared-slug",
      kind: "design",
      filePath: "design/shared-slug.md",
    })
    expect(prdDoc.docId).not.toBe(designDoc.docId)

    const byIdShow = runTx(["doc", "show", prdDoc.docId, "--json"], tmpProjectDir)
    expect(byIdShow.status).toBe(0)
    const byIdDoc = JSON.parse(byIdShow.stdout) as {
      docId: string
      name: string
      kind: string
    }
    expect(byIdDoc).toMatchObject({
      docId: prdDoc.docId,
      name: "shared-slug",
      kind: "prd",
    })
  })

  it("syncs and versions duplicate-slug docs without falling back to bare names", () => {
    const addPrd = runTx(["doc", "add", "prd", "shared-sync", "--title", "Shared Sync PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "shared-sync", "--title", "Shared Sync Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    const prdShow = runTx(["doc", "show", "prd/shared-sync", "--json"], tmpProjectDir)
    expect(prdShow.status).toBe(0)
    const prdDoc = JSON.parse(prdShow.stdout) as {
      docId: string
      name: string
      kind: string
      filePath: string
      version: number
    }

    const prdPath = join(tmpProjectDir, "specs", "prd", "shared-sync.md")
    const designPath = join(tmpProjectDir, "specs", "design", "shared-sync.md")
    writeFileSync(prdPath, readFileSync(prdPath, "utf-8") + "\n# PRD Extra Section\n", "utf-8")
    writeFileSync(designPath, readFileSync(designPath, "utf-8") + "\n# Design Extra Section\n", "utf-8")

    const sync = runTx(["doc", "sync"], tmpProjectDir)
    expect(sync.status).toBe(0)
    expect(sync.stdout).toContain("Synced 2 doc(s)")

    const lock = runTx(["doc", "lock", "prd/shared-sync", "--json"], tmpProjectDir)
    expect(lock.status).toBe(0)
    const locked = JSON.parse(lock.stdout) as { docId: string; status: string }
    expect(locked).toMatchObject({
      docId: prdDoc.docId,
      status: "locked",
    })

    const version = runTx(["doc", "version", prdDoc.docId, "--json"], tmpProjectDir)
    expect(version.status).toBe(0)
    const versioned = JSON.parse(version.stdout) as {
      docId: string
      name: string
      kind: string
      version: number
      filePath: string
    }
    expect(versioned).toMatchObject({
      docId: prdDoc.docId,
      name: "shared-sync",
      kind: "prd",
      version: 2,
      filePath: "prd/shared-sync.md",
    })

    const latest = runTx(["doc", "show", prdDoc.docId, "--json"], tmpProjectDir)
    expect(latest.status).toBe(0)
    const latestDoc = JSON.parse(latest.stdout) as {
      docId: string
      version: number
      filePath: string
    }
    expect(latestDoc).toMatchObject({
      docId: prdDoc.docId,
      version: 2,
      filePath: "prd/shared-sync.md",
    })
  }, 30000)

  it("keeps the shared markdown file when removing a newer mutable version", () => {
    const add = runTx(["doc", "add", "prd", "versioned-delete", "--title", "Versioned Delete"], tmpProjectDir)
    expect(add.status).toBe(0)

    const lock = runTx(["doc", "lock", "versioned-delete"], tmpProjectDir)
    expect(lock.status).toBe(0)

    const version = runTx(["doc", "version", "versioned-delete"], tmpProjectDir)
    expect(version.status).toBe(0)

    const mdPath = join(tmpProjectDir, "specs", "prd", "versioned-delete.md")
    expect(existsSync(mdPath)).toBe(true)

    const remove = runTx(["doc", "rm", "versioned-delete"], tmpProjectDir)
    expect(remove.status).toBe(0)
    expect(existsSync(mdPath)).toBe(true)

    const show = runTx(["doc", "show", "versioned-delete", "--json"], tmpProjectDir)
    expect(show.status).toBe(0)
    const doc = JSON.parse(show.stdout) as { version: number; status: string }
    expect(doc.version).toBe(1)
    expect(doc.status).toBe("locked")
  })

  it("removes the latest mutable doc version and deletes its markdown file", () => {
    const add = runTx(["doc", "add", "design", "delete-me", "--title", "Delete Me"], tmpProjectDir)
    expect(add.status).toBe(0)

    const mdPath = join(tmpProjectDir, "specs", "design", "delete-me.md")
    expect(existsSync(mdPath)).toBe(true)

    const remove = runTx(["doc", "rm", "delete-me", "--json"], tmpProjectDir)
    expect(remove.status).toBe(0)
    const removed = JSON.parse(remove.stdout) as {
      deleted: boolean
      name: string
      kind: string
      filePath: string
    }
    expect(removed).toMatchObject({
      deleted: true,
      name: "delete-me",
      kind: "design",
      filePath: "design/delete-me.md",
    })

    expect(existsSync(mdPath)).toBe(false)

    const list = runTx(["doc", "list", "--json"], tmpProjectDir)
    expect(list.status).toBe(0)
    const docs = JSON.parse(list.stdout) as Array<{ name: string }>
    expect(docs.some((doc) => doc.name === "delete-me")).toBe(false)
  })

  it("rejects removing locked docs", () => {
    const add = runTx(["doc", "add", "prd", "locked-delete", "--title", "Locked Delete"], tmpProjectDir)
    expect(add.status).toBe(0)

    const lock = runTx(["doc", "lock", "locked-delete"], tmpProjectDir)
    expect(lock.status).toBe(0)

    const remove = runTx(["doc", "remove", "locked-delete"], tmpProjectDir)
    expect(remove.status).toBe(1)
    expect(remove.stderr).toContain("Doc is locked: locked-delete v1")

    const show = runTx(["doc", "show", "locked-delete", "--json"], tmpProjectDir)
    expect(show.status).toBe(0)
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

    const indexMd = join(tmpProjectDir, "specs", "index.md")
    const indexYml = join(tmpProjectDir, "specs", "index.yml")
    writeFileSync(indexYml, "legacy: true\n", "utf-8")

    // Lock triggers render internally (index regeneration + legacy YAML cleanup)
    const lockResult = runTx(["doc", "lock", "dd-feature-patch"], tmpProjectDir)
    expect(lockResult.status).toBe(0)
    for (let i = 0; i < 10 && !existsSync(indexMd); i++) {
      spawnSync("sleep", ["0.05"])
    }
    expect(existsSync(indexMd)).toBe(true)
    expect(existsSync(indexYml)).toBe(false)
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

  it("doc validate explains how to fix searchable index metadata", () => {
    const addDesign = runTx(["doc", "add", "design", "searchability-design", "--title", "Searchability Design"], tmpProjectDir)
    expect(addDesign.status).toBe(0)

    const mdPath = join(tmpProjectDir, "specs", "design", "searchability-design.md")
    const degraded = readFileSync(mdPath, "utf-8")
      .replace('summary: "Technical design for Searchability Design."', 'summary: ""')
      .replace("domain: searchability", "domain: product-area")
      .replace("  - searchability", "")
      .replace("  - design", "")
    writeFileSync(mdPath, degraded, "utf-8")

    const validate = runTx(["doc", "validate", "--json"], tmpProjectDir)
    expect(validate.status).toBe(0)
    const payload = JSON.parse(validate.stdout) as { warnings: string[] }
    expect(payload.warnings.some((warning) => warning.includes("summary"))).toBe(true)
    expect(payload.warnings.some((warning) => warning.includes("domain"))).toBe(true)
    expect(payload.warnings.some((warning) => warning.includes("tags"))).toBe(true)
    expect(payload.warnings.some((warning) => warning.includes("specs/index.md"))).toBe(true)
  })

  it("detects content drift after markdown mutation", () => {
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

    // Markdown-first: file is .md, not .yml
    const mdPath = join(tmpProjectDir, "specs", "design", "dd-drift.md")
    const original = readFileSync(mdPath, "utf-8")
    writeFileSync(mdPath, `${original}\n# manual drift edit\n`, "utf-8")

    const drift = runTx(["doc", "drift", "dd-drift", "--json"], tmpProjectDir)
    expect(drift.status).toBe(0)
    const driftJson = JSON.parse(drift.stdout) as { warnings: string[] }
    expect(driftJson.warnings.length).toBeGreaterThan(0)
    expect(driftJson.warnings.some((w) => w.includes("Content hash mismatch"))).toBe(true)
  })

  it("syncs invariants from embedded invariants and EARS requirements blocks", () => {
    const addPrd = runTx(["doc", "add", "prd", "invariant-prd", "--title", "Invariant PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "invariant-design", "--title", "Invariant Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    // Write markdown-first PRD with embedded invariants + EARS requirements
    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "invariant-prd.md"),
      buildMdDoc({
        specType: 'prd',
        name: 'invariant-prd',
        title: 'Invariant PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-PRD-EXPLICIT-001', statement: 'Explicit PRD invariant' },
          ],
          ears: [
            { id: 'REQ-PRD-001', statement: 'the system shall return deterministic task IDs' },
          ],
        }),
      }),
      "utf-8"
    )

    // Write markdown-first design doc with embedded invariants
    writeFileSync(
      join(tmpProjectDir, "specs", "design", "invariant-design.md"),
      buildMdDoc({
        specType: 'design',
        name: 'invariant-design',
        title: 'Invariant Design',
        sections: designSections({
          invariants: [
            { id: 'INV-DESIGN-EXPLICIT-001', statement: 'Explicit design invariant', severity: 'medium' },
          ],
        }),
      }),
      "utf-8"
    )

    const sync = runTx(["invariant", "sync", "--json"], tmpProjectDir)
    expect(sync.status).toBe(0)
    const syncJson = JSON.parse(sync.stdout) as {
      synced: number
      invariants: Array<{ id: string }>
    }
    // 1 explicit PRD invariant + 1 EARS-derived (INV-REQ-PRD-001) + 1 explicit design invariant = 3
    expect(syncJson.synced).toBe(3)

    const syncedIds = syncJson.invariants.map((inv) => inv.id)
    expect(syncedIds).toContain("INV-PRD-EXPLICIT-001")
    expect(syncedIds).toContain("INV-DESIGN-EXPLICIT-001")
    expect(syncedIds).toContain("INV-REQ-PRD-001")
  })

  it("retains EARS-derived subsystem metadata and supports subsystem filtering", () => {
    const addPrd = runTx(["doc", "add", "prd", "ears-meta-prd", "--title", "EARS Meta PRD"], tmpProjectDir)
    expect(addPrd.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "ears-meta-prd.md"),
      buildMdDoc({
        specType: 'prd',
        name: 'ears-meta-prd',
        title: 'EARS Meta PRD',
        sections: prdSections({
          ears: [
            { id: 'REQ-AUTH-001', statement: 'the system shall emit deterministic access tokens' },
          ],
        }),
      }),
      "utf-8"
    )

    const sync = runTx(["invariant", "sync", "--doc", "ears-meta-prd", "--json"], tmpProjectDir)
    expect(sync.status).toBe(0)
    const syncJson = JSON.parse(sync.stdout) as { synced: number; invariants: Array<{ id: string }> }
    expect(syncJson.synced).toBe(1)
    expect(syncJson.invariants.map((inv) => inv.id)).toContain("INV-REQ-AUTH-001")

    const show = runTx(["invariant", "show", "INV-REQ-AUTH-001", "--json"], tmpProjectDir)
    expect(show.status).toBe(0)
    const shown = JSON.parse(show.stdout) as {
      id: string
      subsystem?: string | null
      testRef?: string | null
    }
    expect(shown.id).toBe("INV-REQ-AUTH-001")
    // In markdown-first, subsystem is set to the doc kind
    expect(shown.subsystem).toBe("prd")

    const listBySubsystem = runTx(["invariant", "list", "--subsystem", "prd", "--json"], tmpProjectDir)
    expect(listBySubsystem.status).toBe(0)
    const filtered = JSON.parse(listBySubsystem.stdout) as Array<{ id: string; subsystem?: string | null }>
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe("INV-REQ-AUTH-001")
    expect(filtered[0]?.subsystem).toBe("prd")
  })

  it("syncs only the requested doc when using invariant sync --doc", () => {
    const addPrd = runTx(["doc", "add", "prd", "target-prd", "--title", "Target PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "target-design", "--title", "Target Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "target-prd.md"),
      buildMdDoc({
        specType: 'prd',
        name: 'target-prd',
        title: 'Target PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-TARGET-PRD-EXPLICIT-001', statement: 'Explicit target PRD invariant' },
          ],
          ears: [
            { id: 'REQ-TGT-001', statement: 'the system shall return deterministic values' },
          ],
        }),
      }),
      "utf-8"
    )

    writeFileSync(
      join(tmpProjectDir, "specs", "design", "target-design.md"),
      buildMdDoc({
        specType: 'design',
        name: 'target-design',
        title: 'Target Design',
        sections: designSections({
          invariants: [
            { id: 'INV-TARGET-DESIGN-EXPLICIT-001', statement: 'Explicit target design invariant', severity: 'medium' },
          ],
        }),
      }),
      "utf-8"
    )

    // Sync only PRD: 1 explicit invariant + 1 EARS = 2
    const syncPrd = runTx(["invariant", "sync", "--doc", "target-prd", "--json"], tmpProjectDir)
    expect(syncPrd.status).toBe(0)
    const syncPrdJson = JSON.parse(syncPrd.stdout) as { synced: number; invariants: Array<{ id: string }> }
    expect(syncPrdJson.synced).toBe(2)
    expect(syncPrdJson.invariants.map((inv) => inv.id)).toContain("INV-TARGET-PRD-EXPLICIT-001")
    expect(syncPrdJson.invariants.map((inv) => inv.id)).not.toContain("INV-TARGET-DESIGN-EXPLICIT-001")

    const listAfterPrd = runTx(["invariant", "list", "--json"], tmpProjectDir)
    expect(listAfterPrd.status).toBe(0)
    const listAfterPrdJson = JSON.parse(listAfterPrd.stdout) as Array<{ id: string }>
    expect(listAfterPrdJson).toHaveLength(2)
    expect(listAfterPrdJson.some((inv) => inv.id === "INV-TARGET-DESIGN-EXPLICIT-001")).toBe(false)

    // Now sync design: 1 explicit invariant
    const syncDesign = runTx(["invariant", "sync", "--doc", "target-design", "--json"], tmpProjectDir)
    expect(syncDesign.status).toBe(0)
    const syncDesignJson = JSON.parse(syncDesign.stdout) as { synced: number; invariants: Array<{ id: string }> }
    expect(syncDesignJson.synced).toBe(1)
    expect(syncDesignJson.invariants.map((inv) => inv.id)).toContain("INV-TARGET-DESIGN-EXPLICIT-001")
  })

  it("deprecates invariants that are removed from markdown on re-sync", () => {
    const addPrd = runTx(["doc", "add", "prd", "deprecation-prd", "--title", "Deprecation PRD"], tmpProjectDir)
    expect(addPrd.status).toBe(0)

    const prdPath = join(tmpProjectDir, "specs", "prd", "deprecation-prd.md")
    // First sync: 1 explicit invariant + 1 EARS = 2
    writeFileSync(
      prdPath,
      buildMdDoc({
        specType: 'prd',
        name: 'deprecation-prd',
        title: 'Deprecation PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-DEPRECATION-EXPLICIT-001', statement: 'Explicit invariant to remove' },
          ],
          ears: [
            { id: 'REQ-DEP-001', statement: 'the system shall handle deprecation' },
          ],
        }),
      }),
      "utf-8"
    )

    const firstSync = runTx(["invariant", "sync", "--doc", "deprecation-prd", "--json"], tmpProjectDir)
    expect(firstSync.status).toBe(0)
    const firstSyncJson = JSON.parse(firstSync.stdout) as { synced: number }
    expect(firstSyncJson.synced).toBe(2)

    // Second sync: remove all invariants and EARS
    writeFileSync(
      prdPath,
      buildMdDoc({
        specType: 'prd',
        name: 'deprecation-prd',
        title: 'Deprecation PRD',
        sections: prdSections(),
      }),
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
      "INV-REQ-DEP-001",
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

    const prdPath = join(tmpProjectDir, "specs", "prd", "upsert-prd.md")
    writeFileSync(
      prdPath,
      buildMdDoc({
        specType: 'prd',
        name: 'upsert-prd',
        title: 'Upsert PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-UPSERT-001', statement: 'Original rule text', verified_by: ['test/original.test.ts'] },
          ],
        }),
      }),
      "utf-8"
    )

    const firstSync = runTx(["invariant", "sync", "--doc", "upsert-prd", "--json"], tmpProjectDir)
    expect(firstSync.status).toBe(0)

    // Update the invariant statement and verified_by
    writeFileSync(
      prdPath,
      buildMdDoc({
        specType: 'prd',
        name: 'upsert-prd',
        title: 'Upsert PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-UPSERT-001', statement: 'Updated rule text', verified_by: ['test/updated.test.ts'] },
          ],
        }),
      }),
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

  it("derives invariants from embedded invariants and ears_requirements blocks", () => {
    const addPrd = runTx(["doc", "add", "prd", "scalar-prd", "--title", "Scalar PRD"], tmpProjectDir)
    const addDesign = runTx(["doc", "add", "design", "scalar-design", "--title", "Scalar Design"], tmpProjectDir)
    expect(addPrd.status).toBe(0)
    expect(addDesign.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "scalar-prd.md"),
      buildMdDoc({
        specType: 'prd',
        name: 'scalar-prd',
        title: 'Scalar PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-SCALAR-PRD-001', statement: 'PRD invariant one' },
            { id: 'INV-SCALAR-PRD-002', statement: 'PRD invariant two' },
          ],
          ears: [
            { id: 'REQ-SCALAR-001', statement: 'the system shall handle scalar requirements' },
          ],
        }),
      }),
      "utf-8"
    )

    writeFileSync(
      join(tmpProjectDir, "specs", "design", "scalar-design.md"),
      buildMdDoc({
        specType: 'design',
        name: 'scalar-design',
        title: 'Scalar Design',
        sections: designSections({
          invariants: [
            { id: 'INV-SCALAR-DESIGN-001', statement: 'Design invariant one' },
            { id: 'INV-SCALAR-DESIGN-002', statement: 'Design invariant two' },
          ],
        }),
      }),
      "utf-8"
    )

    const sync = runTx(["invariant", "sync", "--json"], tmpProjectDir)
    expect(sync.status).toBe(0)
    const syncJson = JSON.parse(sync.stdout) as {
      synced: number
      invariants: Array<{ id: string }>
    }

    // 2 PRD invariants + 1 EARS + 2 design invariants = 5
    expect(syncJson.synced).toBe(5)
    const ids = new Set(syncJson.invariants.map((inv) => inv.id))
    expect(ids.has("INV-SCALAR-PRD-001")).toBe(true)
    expect(ids.has("INV-SCALAR-PRD-002")).toBe(true)
    expect(ids.has("INV-REQ-SCALAR-001")).toBe(true)
    expect(ids.has("INV-SCALAR-DESIGN-001")).toBe(true)
    expect(ids.has("INV-SCALAR-DESIGN-002")).toBe(true)
  })

  it("supports invariant show and record flows after sync", () => {
    const addPrd = runTx(["doc", "add", "prd", "record-prd", "--title", "Record PRD"], tmpProjectDir)
    expect(addPrd.status).toBe(0)

    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "record-prd.md"),
      buildMdDoc({
        specType: 'prd',
        name: 'record-prd',
        title: 'Record PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-RECORD-001', statement: 'Record flow invariant' },
          ],
        }),
      }),
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

  it("continues syncing valid docs when one doc has malformed markdown", () => {
    const addBad = runTx(["doc", "add", "prd", "bad-prd", "--title", "Bad PRD"], tmpProjectDir)
    const addGood = runTx(["doc", "add", "prd", "good-prd", "--title", "Good PRD"], tmpProjectDir)
    expect(addBad.status).toBe(0)
    expect(addGood.status).toBe(0)

    // Overwrite bad-prd with malformed markdown (invalid frontmatter)
    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "bad-prd.md"),
      [
        "---",
        "kind: spec",
        "spec_type: prd",
        "name: bad-prd",
        'title: "Bad PRD"',
        "status: draft",
        "version: not-a-number",
        "---",
        "",
        "# Broken content",
        "",
      ].join("\n"),
      "utf-8"
    )

    // Write good-prd with proper markdown-first content
    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "good-prd.md"),
      buildMdDoc({
        specType: 'prd',
        name: 'good-prd',
        title: 'Good PRD',
        sections: prdSections({
          invariants: [
            { id: 'INV-GOOD-001', statement: 'Good explicit invariant' },
          ],
          ears: [
            { id: 'REQ-GOOD-001', statement: 'the system shall do something good' },
          ],
        }),
      }),
      "utf-8"
    )

    const syncAll = runTx(["invariant", "sync", "--json"], tmpProjectDir)
    expect(syncAll.status).toBe(0)
    const payload = JSON.parse(syncAll.stdout) as {
      synced: number
      invariants: Array<{ id: string }>
    }
    // 1 explicit invariant + 1 EARS = 2
    expect(payload.synced).toBe(2)
    const ids = new Set(payload.invariants.map((inv) => inv.id))
    expect(ids.has("INV-GOOD-001")).toBe(true)
    expect(ids.has("INV-REQ-GOOD-001")).toBe(true)
  })

  it("fails doc-scoped invariant sync when the target doc markdown is malformed", () => {
    const addBad = runTx(["doc", "add", "prd", "bad-only-prd", "--title", "Bad Only PRD"], tmpProjectDir)
    expect(addBad.status).toBe(0)

    // Overwrite with malformed markdown (invalid frontmatter)
    writeFileSync(
      join(tmpProjectDir, "specs", "prd", "bad-only-prd.md"),
      [
        "---",
        "kind: spec",
        "spec_type: prd",
        "name: bad-only-prd",
        'title: "Bad Only PRD"',
        "status: draft",
        "version: not-a-number",
        "---",
        "",
        "# Broken content",
        "",
      ].join("\n"),
      "utf-8"
    )

    const syncDoc = runTx(["invariant", "sync", "--doc", "bad-only-prd"], tmpProjectDir)
    expect(syncDoc.status).not.toBe(0)
    expect(syncDoc.stderr).toContain("Invalid YAML for doc 'bad-only-prd'")
  })
})

describe("tx doc add file-exists guard", () => {
  let tmpProjectDir: string

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-guard-"))
    const init = runTx(["init", "--codex"], tmpProjectDir)
    expect(init.status).toBe(0)
    writeDocsConfig(tmpProjectDir, false)
  })

  afterEach(() => {
    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("refuses to overwrite an existing file on disk", () => {
    // Create a file on disk manually (not via tx doc add)
    const prdDir = join(tmpProjectDir, "specs", "prd")
    const { mkdirSync: mkDir } = require("node:fs")
    mkDir(prdDir, { recursive: true })
    const filePath = join(prdDir, "existing-doc.md")
    const originalContent = "# My existing content\nDo not overwrite me.\n"
    writeFileSync(filePath, originalContent, "utf-8")

    // tx doc add should fail because the file already exists
    const result = runTx(
      ["doc", "add", "prd", "existing-doc", "--title", "Existing Doc"],
      tmpProjectDir,
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("File already exists")
    expect(result.stderr).toContain("Edit it directly")

    // Original content must be preserved
    const afterContent = readFileSync(filePath, "utf-8")
    expect(afterContent).toBe(originalContent)
  })

  it("succeeds when no file exists on disk", () => {
    const result = runTx(
      ["doc", "add", "prd", "fresh-doc", "--title", "Fresh Doc"],
      tmpProjectDir,
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Created doc: fresh-doc")

    const filePath = join(tmpProjectDir, "specs", "prd", "fresh-doc.md")
    expect(existsSync(filePath)).toBe(true)
  })
})

describe("tx doc sync", () => {
  let tmpProjectDir: string

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-sync-"))
    const init = runTx(["init", "--codex"], tmpProjectDir)
    expect(init.status).toBe(0)
    writeDocsConfig(tmpProjectDir, false)
  })

  afterEach(() => {
    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("re-syncs all doc hashes from disk", () => {
    // Create a doc
    const add = runTx(
      ["doc", "add", "prd", "sync-test", "--title", "Sync Test"],
      tmpProjectDir,
    )
    expect(add.status).toBe(0)

    // Modify file on disk
    const filePath = join(tmpProjectDir, "specs", "prd", "sync-test.md")
    const original = readFileSync(filePath, "utf-8")
    writeFileSync(filePath, original + "\n# Extra section\n", "utf-8")

    // Verify drift exists before sync
    const drift = runTx(["doc", "drift", "sync-test"], tmpProjectDir)
    expect(drift.stdout).toContain("drift warning")

    // Sync should clear the drift
    const sync = runTx(["doc", "sync"], tmpProjectDir)
    expect(sync.status).toBe(0)
    expect(sync.stdout).toContain("Synced 1 doc(s)")
    const docIdMatches = readFileSync(filePath, "utf-8").match(/^\s*doc_id\s*:/gm) ?? []
    expect(docIdMatches).toHaveLength(1)

    // No drift after sync
    const driftAfter = runTx(["doc", "drift", "sync-test"], tmpProjectDir)
    expect(driftAfter.stdout).toContain("No drift")
  })

  it("syncs a single doc by name", () => {
    const add = runTx(
      ["doc", "add", "design", "sync-single", "--title", "Sync Single"],
      tmpProjectDir,
    )
    expect(add.status).toBe(0)

    // Modify file
    const filePath = join(tmpProjectDir, "specs", "design", "sync-single.md")
    const original = readFileSync(filePath, "utf-8")
    writeFileSync(filePath, original + "\n# Added\n", "utf-8")

    const sync = runTx(["doc", "sync", "sync-single"], tmpProjectDir)
    expect(sync.status).toBe(0)
    expect(sync.stdout).toContain("Synced 1 doc(s)")
    expect(sync.stdout).toContain("sync-single")
  })
})
