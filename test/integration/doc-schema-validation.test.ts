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

const specFrontmatter = (
  specType: "prd" | "design" | "overview",
  name: string,
  title: string
): string => `---
kind: spec
spec_type: ${specType}
name: ${name}
title: "${title}"
status: draft
version: 1
owners:
  - docs-team
summary: Integration test fixture for ${title}
domain: test
tags:
  - integration
depends_on: []
supersedes: []
implements: null
last_reviewed_at: "2026-03-15"
---`

const withSpecFrontmatter = (
  specType: "prd" | "design" | "overview",
  name: string,
  title: string,
  body: string
): string => `${specFrontmatter(specType, name, title)}\n\n${body.trim()}\n`

describe("Markdown content schema validation integration", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempProjectDir: string

  const createDoc = async (input: {
    kind: DocKind
    name: string
    title: string
    content: string
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
    const content = withSpecFrontmatter(
      "prd",
      name,
      "Valid PRD",
      `# Summary
Valid PRD test fixture.

# Problem
Existing process is manual.

# Scope
Included: schema validation.
Excluded: production rollout.

# Requirements
\`\`\`yaml
ears_requirements:
  - id: REQ-DOCS-001
    kind: ubiquitous
    statement: the system shall validate content schema.
    priority: must
\`\`\`

# Acceptance Criteria
- PRD markdown validates successfully.

# Non-goals
- None.`
    )

    const doc = await createDoc({
      kind: "prd",
      name,
      title: "Valid PRD",
      content,
    })

    expect(doc.kind).toBe("prd")
    expect(doc.name).toBe(name)
  })

  it("2. PRD missing problem fails with problem error", async () => {
    const name = shortName("doc-schema-prd-missing-problem", "prd")
    const content = withSpecFrontmatter(
      "prd",
      name,
      "Missing Problem PRD",
      `# Summary
Missing problem section fixture.

# Scope
Included: section validation.
Excluded: full PRD behavior.

# Requirements
\`\`\`yaml
ears_requirements:
  - id: REQ-DOCS-002
    kind: ubiquitous
    statement: the system shall fail when required sections are missing.
    priority: must
\`\`\`

# Acceptance Criteria
- Validation reports missing section.

# Non-goals
- None.`
    )

    await expect(
      createDoc({
        kind: "prd",
        name,
        title: "Missing Problem PRD",
        content,
      })
    ).rejects.toThrow(/problem/i)
  })

  it("3. PRD with deprecated requirements passes and keeps deprecation warning path", async () => {
    const name = shortName("doc-schema-prd-deprecated", "prd")
    const content = withSpecFrontmatter(
      "prd",
      name,
      "Deprecated Requirements PRD",
      `# Summary
Deprecated requirements compatibility fixture.

# Problem
Validate deprecated requirements behavior.

# Scope
Included: markdown requirement rendering.
Excluded: migration tooling.

# Requirements
- Legacy requirement line
\`\`\`yaml
ears_requirements:
  - id: REQ-DOCS-003
    kind: ubiquitous
    statement: the system shall still parse docs with legacy requirement prose.
    priority: should
\`\`\`

# Acceptance Criteria
- PRD creation succeeds with legacy requirements present.

# Non-goals
- None.`
    )

    const doc = await createDoc({
      kind: "prd",
      name,
      title: "Deprecated Requirements PRD",
      content,
    })
    expect(doc.kind).toBe("prd")

    const rendered = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        return yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )
    expect(rendered.length).toBeGreaterThan(0)

    const markdown = readFileSync(join(tempProjectDir, "specs", "prd", `${name}.md`), "utf-8")
    expect(markdown).toContain("# Requirements")
    expect(markdown).toContain("Legacy requirement line")

    const validatorSource = readFileSync(
      resolve(__dirname, "../../packages/core/src/internal/doc-service-impl.ts"),
      "utf-8"
    )
    expect(validatorSource).toContain(
      "Deprecated field 'requirements' detected in PRD YAML; use 'ears_requirements' instead."
    )
  })

  it("4. valid design doc with required fields succeeds", async () => {
    const name = shortName("doc-schema-design-valid", "design")
    const content = withSpecFrontmatter(
      "design",
      name,
      "Valid Design",
      `# Summary
Design fixture summary.

# Architecture
Use service-repository layering.

# Interfaces
\`\`\`yaml
interfaces:
  - name: CreateDoc
    type: http
    method: POST
    path: /docs
    semantics: Creates markdown docs.
\`\`\`

# Data Model
No schema changes for this fixture.

# Invariants
\`\`\`yaml
invariants:
  - id: INV-DOCS-001
    statement: Every design fixture has required sections.
    severity: high
    verified_by:
      - test/integration/doc-schema-validation.test.ts
\`\`\`

# Failure Modes
\`\`\`yaml
failure_modes:
  - condition: Missing markdown sections
    impact: Parsing fails
    handling: Return validation error
\`\`\`

# Verification
\`\`\`yaml
verification:
  - requirement_id: REQ-DOCS-004
    test_type: integration
    target: test/integration/doc-schema-validation.test.ts
\`\`\``
    )

    const doc = await createDoc({
      kind: "design",
      name,
      title: "Valid Design",
      content,
    })

    expect(doc.kind).toBe("design")
    expect(doc.name).toBe(name)
  })

  it("5. design doc missing architecture fails", async () => {
    const name = shortName("doc-schema-design-missing-architecture", "design")
    const content = withSpecFrontmatter(
      "design",
      name,
      "Missing Architecture Design",
      `# Summary
Architecture section intentionally missing.

# Interfaces
\`\`\`yaml
interfaces: []
\`\`\`

# Data Model
No data model changes.

# Invariants
\`\`\`yaml
invariants: []
\`\`\`

# Failure Modes
\`\`\`yaml
failure_modes: []
\`\`\`

# Verification
\`\`\`yaml
verification: []
\`\`\``
    )

    await expect(
      createDoc({
        kind: "design",
        name,
        title: "Missing Architecture Design",
        content,
      })
    ).rejects.toThrow(/architecture/i)
  })

  it("6. design doc with null testing_strategy renders successfully", () => {
    const name = shortName("doc-schema-design-null-testing", "design")
    const add = runTx(["doc", "add", "design", name, "--title", "Null Testing Strategy Design"], tempProjectDir)
    expect(add.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "design", `${name}.md`)
    const content = withSpecFrontmatter(
      "design",
      name,
      "Null Testing Strategy Design",
      `# Summary
Null testing strategy regression fixture.

# Architecture
Keep this minimal.

# Interfaces
\`\`\`yaml
interfaces: []
\`\`\`

# Data Model
No model changes.

# Invariants
\`\`\`yaml
invariants: []
\`\`\`

# Failure Modes
\`\`\`yaml
failure_modes: []
\`\`\`

# Verification
\`\`\`yaml
verification: []
\`\`\`

# Testing Strategy
null`
    )
    writeFileSync(markdownPath, content, "utf-8")

    const render = runTx(["doc", "render", name], tempProjectDir)
    expect(render.status).toBe(0)
  })

  it("7. valid requirement doc with overview and functional_requirements succeeds", async () => {
    const name = shortName("doc-schema-requirement-valid", "prd")
    const content = withSpecFrontmatter(
      "prd",
      name,
      "Valid Requirement",
      `# Summary
Requirement-style PRD summary.

# Problem
Requirement overview text.

# Scope
Included: schema validation behavior.
Excluded: implementation details.

# Requirements
- The system shall support schema validation.
\`\`\`yaml
ears_requirements:
  - id: REQ-DOCS-007
    kind: ubiquitous
    statement: the system shall support schema validation.
    priority: must
\`\`\`

# Acceptance Criteria
- Requirement-style PRD persists successfully.

# Non-goals
- None.`
    )

    const doc = await createDoc({
      kind: "prd",
      name,
      title: "Valid Requirement",
      content,
    })

    expect(doc.kind).toBe("prd")
  })

  it("8. requirement doc render with actors array avoids [object Object]", () => {
    const name = shortName("doc-schema-requirement-actors", "requirement")
    const add = runTx(["doc", "add", "requirement", name, "--title", "Requirement Actors"], tempProjectDir)
    expect(add.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    const content = withSpecFrontmatter(
      "prd",
      name,
      "Requirement Actors",
      `# Summary
Validate rendering of structured actors.

# Problem
Actor metadata must render as text, not object coercion.

# Scope
Included: actor content rendering.
Excluded: actor schema enforcement.

# Requirements
- Product Manager: Defines acceptance criteria
- Engineer: Implements the feature
\`\`\`yaml
ears_requirements:
  - id: REQ-DOCS-008
    kind: ubiquitous
    statement: the system shall render actor entries as readable text.
    priority: should
\`\`\`

# Acceptance Criteria
- Actor entries render as plain text.

# Non-goals
- None.`
    )
    writeFileSync(markdownPath, content, "utf-8")

    const render = runTx(["doc", "render", name], tempProjectDir)
    expect(render.status).toBe(0)

    const mdPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    const markdown = readFileSync(mdPath, "utf-8")
    expect(markdown).not.toContain("[object Object]")
    expect(markdown).toContain("Product Manager")
    expect(markdown).toContain("Engineer")
  })

  it("9. valid system_design doc with required fields succeeds", async () => {
    const name = shortName("doc-schema-system-design-valid", "design")
    const content = withSpecFrontmatter(
      "design",
      name,
      "Valid System Design",
      `# Summary
Cross-cutting architecture overview.

# Architecture
Describe architecture constraints and flows.

# Interfaces
\`\`\`yaml
interfaces: []
\`\`\`

# Data Model
No model changes.

# Invariants
\`\`\`yaml
invariants: []
\`\`\`

# Failure Modes
\`\`\`yaml
failure_modes: []
\`\`\`

# Verification
\`\`\`yaml
verification: []
\`\`\``
    )

    const doc = await createDoc({
      kind: "design",
      name,
      title: "Valid System Design",
      content,
    })

    expect(doc.kind).toBe("design")
  })

  it("10. overview doc missing problem_definition fails", async () => {
    const name = shortName("doc-schema-overview-missing-problem-definition", "overview")
    const content = withSpecFrontmatter(
      "overview",
      name,
      "Missing Problem Definition Overview",
      `# Summary
Overview fixture missing required Components section.

# Architecture
Architecture summary.

# Data Flows
Primary data flow description.`
    )

    await expect(
      createDoc({
        kind: "overview",
        name,
        title: "Missing Problem Definition Overview",
        content,
      })
    ).rejects.toThrow(/components/i)
  })

  it("11. EARS validation still fails invalid pattern entries", () => {
    const name = shortName("doc-schema-prd-invalid-ears-pattern", "prd")
    const add = runTx(["doc", "add", "prd", name, "--title", "Invalid EARS Pattern PRD"], tempProjectDir)
    expect(add.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    const invalidContent = withSpecFrontmatter(
      "prd",
      name,
      "Invalid EARS Pattern PRD",
      `# Summary
Invalid EARS requirement fixture.

# Problem
Validate EARS kind enforcement.

# Scope
Included: EARS semantic validation.
Excluded: renderer behavior.

# Requirements
\`\`\`yaml
ears_requirements:
  - id: REQ-DOCS-011
    kind: invalid-kind
    statement: the system shall reject invalid EARS kinds.
    priority: must
\`\`\`

# Acceptance Criteria
- Invalid kind entries are rejected.

# Non-goals
- None.`
    )
    writeFileSync(markdownPath, invalidContent, "utf-8")

    const render = runTx(["doc", "render", name], tempProjectDir)
    expect(render.status).not.toBe(0)

    const output = `${render.stdout}\n${render.stderr}`
    expect(output).toMatch(/ears_requirements|kind|invalid/i)
  })

  it("12. kind mismatch between YAML and requested kind fails", async () => {
    const name = shortName("doc-schema-kind-mismatch", "design")
    const content = withSpecFrontmatter(
      "prd",
      name,
      "Kind Mismatch Design",
      `# Summary
Kind mismatch fixture.

# Problem
Content kind intentionally mismatches requested kind.

# Scope
Included: mismatch error path.
Excluded: design parsing.

# Requirements
\`\`\`yaml
ears_requirements:
  - id: REQ-DOCS-012
    kind: ubiquitous
    statement: the system shall detect kind mismatches.
    priority: must
\`\`\`

# Acceptance Criteria
- Mismatch is rejected.

# Non-goals
- None.`
    )

    await expect(
      createDoc({
        kind: "design",
        name,
        title: "Kind Mismatch Design",
        content,
      })
    ).rejects.toThrow(/spec_type|kind/i)
  })
})
