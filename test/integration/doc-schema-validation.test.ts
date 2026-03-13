import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { DocService } from "@jamesaphoenix/tx-core"
import { fixtureId } from "../fixtures.js"
import type { DocKind } from "@jamesaphoenix/tx-types"

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

const runTx = (args: string[], cwd: string): ExecResult => {
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

const shortName = (seed: string, prefix: string): string =>
  `${prefix}-${fixtureId(seed).slice(3, 10)}`

const traceabilityRow = [
  "  - requirement_id: REQ-001",
  "    level: integration",
  "    verification: Run integration tests",
  "    success_criteria: Tests pass",
].join("\n")

describe("YAML content schema validation integration", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempProjectDir: string

  const createDoc = async (input: {
    kind: DocKind
    name: string
    title: string
    yamlContent: string
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        return yield* svc.create(input)
      }).pipe(Effect.provide(shared.layer))
    )

  beforeAll(async () => {
    shared = await getSharedTestLayer()
    originalCwd = process.cwd()
  })

  beforeEach(() => {
    tempProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-schema-validation-"))
    const init = runTx(["init", "--codex"], tempProjectDir)
    expect(init.status).toBe(0)
    process.chdir(tempProjectDir)
  })

  afterEach(async () => {
    await shared.reset()
    process.chdir(originalCwd)
    if (existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true })
    }
  })

  it("1. valid PRD with all required fields succeeds", async () => {
    const name = shortName("doc-schema-prd-valid", "prd")
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Valid PRD"',
      "status: changing",
      "",
      "problem: |",
      "  Existing process is manual.",
      "",
      "solution: |",
      "  Add automated validation and checks.",
      "",
      "ears_requirements:",
      "  - id: EARS-PRDVAL-001",
      "    statement: When YAML is submitted, then the system shall validate content schema.",
      "",
      "acceptance_criteria:",
      "  - PRD YAML validates successfully.",
    ].join("\n")

    const doc = await createDoc({
      kind: "prd",
      name,
      title: "Valid PRD",
      yamlContent,
    })

    expect(doc.kind).toBe("prd")
    expect(doc.name).toBe(name)
  })

  it("2. PRD missing problem fails with problem error", async () => {
    const name = shortName("doc-schema-prd-missing-problem", "prd")
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Missing Problem PRD"',
      "status: changing",
      "",
      "solution: |",
      "  This has no problem section.",
      "",
      "ears_requirements:",
      "  - id: EARS-PRDMISS-001",
      "    statement: When missing sections exist, then validation shall fail.",
      "",
      "acceptance_criteria:",
      "  - Validation reports missing field.",
    ].join("\n")

    await expect(
      createDoc({
        kind: "prd",
        name,
        title: "Missing Problem PRD",
        yamlContent,
      })
    ).rejects.toThrow(/problem/i)
  })

  it("3. PRD deprecation warning text is surfaced for requirements", () => {
    const name = shortName("doc-schema-prd-deprecated", "prd")
    const add = runTx(["doc", "add", "prd", name, "--title", "Deprecated PRD"], tempProjectDir)
    expect(add.status).toBe(0)

    const yamlPath = join(tempProjectDir, "specs", "prd", `${name}.yml`)
    const yaml = readFileSync(yamlPath, "utf-8")
    const combined = `${add.stdout}\n${add.stderr}\n${yaml}`

    expect(combined).toContain("requirements")
    expect(combined.toLowerCase()).toContain("deprecated")
  })

  it("4. valid design doc with required fields succeeds", async () => {
    const name = shortName("doc-schema-design-valid", "design")
    const yamlContent = [
      "kind: design",
      `name: ${name}`,
      'title: "Valid Design"',
      "status: changing",
      "version: 1",
      "",
      "problem_definition: |",
      "  Need a robust implementation plan.",
      "",
      "architecture: |",
      "  Use service-repository layering.",
      "",
      "testing_strategy:",
      traceabilityRow,
    ].join("\n")

    const doc = await createDoc({
      kind: "design",
      name,
      title: "Valid Design",
      yamlContent,
    })

    expect(doc.kind).toBe("design")
    expect(doc.name).toBe(name)
  })

  it("5. design doc missing architecture fails", async () => {
    const name = shortName("doc-schema-design-missing-architecture", "design")
    const yamlContent = [
      "kind: design",
      `name: ${name}`,
      'title: "Missing Architecture Design"',
      "status: changing",
      "version: 1",
      "",
      "problem_definition: |",
      "  Architecture section is missing.",
      "",
      "testing_strategy:",
      traceabilityRow,
    ].join("\n")

    await expect(
      createDoc({
        kind: "design",
        name,
        title: "Missing Architecture Design",
        yamlContent,
      })
    ).rejects.toThrow(/architecture/i)
  })

  it("6. design doc with null testing_strategy renders successfully", () => {
    const name = shortName("doc-schema-design-null-testing", "design")
    const add = runTx(["doc", "add", "design", name, "--title", "Null Testing Strategy Design"], tempProjectDir)
    expect(add.status).toBe(0)

    const yamlPath = join(tempProjectDir, "specs", "design", `${name}.yml`)
    const yamlContent = [
      "kind: design",
      `name: ${name}`,
      'title: "Null Testing Strategy Design"',
      "status: changing",
      "",
      "problem_definition: |",
      "  Null testing strategy should not break rendering.",
      "",
      "architecture: |",
      "  Keep this minimal.",
      "",
      "testing_strategy: null",
    ].join("\n")
    writeFileSync(yamlPath, yamlContent, "utf-8")

    const render = runTx(["doc", "render", name], tempProjectDir)
    expect(render.status).toBe(0)
  })

  it("7. valid requirement doc with overview and functional_requirements succeeds", async () => {
    const name = shortName("doc-schema-requirement-valid", "requirement")
    const yamlContent = [
      "kind: requirement",
      `name: ${name}`,
      'title: "Valid Requirement"',
      "status: changing",
      "",
      "overview: |",
      "  Requirement overview text.",
      "",
      "functional_requirements: |",
      "  - The system shall support schema validation.",
    ].join("\n")

    const doc = await createDoc({
      kind: "requirement",
      name,
      title: "Valid Requirement",
      yamlContent,
    })

    expect(doc.kind).toBe("requirement")
  })

  it("8. requirement doc render with actors array avoids [object Object]", () => {
    const name = shortName("doc-schema-requirement-actors", "requirement")
    const add = runTx(["doc", "add", "requirement", name, "--title", "Requirement Actors"], tempProjectDir)
    expect(add.status).toBe(0)

    const yamlPath = join(tempProjectDir, "specs", "requirements", `${name}.yml`)
    const yamlContent = [
      "kind: requirement",
      `name: ${name}`,
      'title: "Requirement Actors"',
      "status: changing",
      "",
      "overview: |",
      "  Validate rendering of structured actors.",
      "",
      "actors:",
      "  - name: Product Manager",
      "    description: Defines acceptance criteria",
      "  - name: Engineer",
      "    description: Implements the feature",
      "",
      "functional_requirements: |",
      "  - The system shall render actor entries as structured rows.",
    ].join("\n")
    writeFileSync(yamlPath, yamlContent, "utf-8")

    const render = runTx(["doc", "render", name], tempProjectDir)
    expect(render.status).toBe(0)

    const mdPath = join(tempProjectDir, "specs", "requirements", `${name}.md`)
    const markdown = readFileSync(mdPath, "utf-8")
    expect(markdown).not.toContain("[object Object]")
    expect(markdown).toContain("Product Manager")
    expect(markdown).toContain("Engineer")
  })

  it("9. valid system_design doc with required fields succeeds", async () => {
    const name = shortName("doc-schema-system-design-valid", "system-design")
    const yamlContent = [
      "kind: system_design",
      `name: ${name}`,
      'title: "Valid System Design"',
      "status: changing",
      "",
      "overview: |",
      "  Cross-cutting architecture overview.",
      "",
      "scope: |",
      "  Applies to documentation and validation subsystems.",
      "",
      "design: |",
      "  Describe architecture constraints and flows.",
    ].join("\n")

    const doc = await createDoc({
      kind: "system_design",
      name,
      title: "Valid System Design",
      yamlContent,
    })

    expect(doc.kind).toBe("system_design")
  })

  it("10. overview doc missing problem_definition fails", async () => {
    const name = shortName("doc-schema-overview-missing-problem-definition", "overview")
    const yamlContent = [
      "kind: overview",
      `name: ${name}`,
      'title: "Missing Problem Definition Overview"',
      "status: changing",
      "",
      "subsystems: |",
      "  - docs",
      "  - validation",
    ].join("\n")

    await expect(
      createDoc({
        kind: "overview",
        name,
        title: "Missing Problem Definition Overview",
        yamlContent,
      })
    ).rejects.toThrow(/problem_definition/i)
  })

  it("11. EARS validation still fails invalid statement entries", async () => {
    const name = shortName("doc-schema-prd-invalid-ears", "prd")
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Invalid EARS PRD"',
      "status: changing",
      "",
      "problem: |",
      "  Validate EARS remains enforced.",
      "",
      "solution: |",
      "  Reject invalid EARS entries.",
      "",
      "ears_requirements:",
      "  - id: EARS-INVALID-001",
      '    statement: ""',
      "",
      "acceptance_criteria:",
      "  - Invalid EARS entries are rejected.",
    ].join("\n")

    await expect(
      createDoc({
        kind: "prd",
        name,
        title: "Invalid EARS PRD",
        yamlContent,
      })
    ).rejects.toThrow(/EARS:|statement/i)
  })

  it("12. kind mismatch between YAML and requested kind fails", async () => {
    const name = shortName("doc-schema-kind-mismatch", "design")
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Kind Mismatch Design"',
      "status: changing",
      "version: 1",
      "",
      "problem_definition: |",
      "  Content is design-shaped but kind is mismatched.",
      "",
      "architecture: |",
      "  Keep design fields valid so mismatch check is reached.",
      "",
      "testing_strategy:",
      traceabilityRow,
    ].join("\n")

    await expect(
      createDoc({
        kind: "design",
        name,
        title: "Kind Mismatch Design",
        yamlContent,
      })
    ).rejects.toThrow(/Expected "design", actual "prd"|kind/i)
  })
})
