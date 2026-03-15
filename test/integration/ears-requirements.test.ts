import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { DocService } from "@jamesaphoenix/tx-core"
import { fixtureId } from "../fixtures.js"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

const runTx = (args: string[], cwd: string): ExecResult => {
  const result = spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

const setupDocsWorkspace = (cwd: string): void => {
  mkdirSync(join(cwd, ".tx"), { recursive: true })
  mkdirSync(join(cwd, "specs", "prd"), { recursive: true })
  mkdirSync(join(cwd, "specs", "design"), { recursive: true })
}

const writeDocsConfig = (cwd: string, requireEars: boolean): void => {
  writeFileSync(
    join(cwd, ".tx", "config.toml"),
    ["[docs]", 'path = "specs"', `require_ears = ${requireEars}`].join("\n"),
    "utf8"
  )
}

const prdFrontmatter = (name: string, title: string): string => `---
kind: spec
spec_type: prd
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

const prdDoc = (input: {
  name: string
  title: string
  summary?: string
  problem?: string
  scope?: string
  requirements: string
  acceptanceCriteria?: string
  nonGoals?: string
  extraSections?: string
}): string => {
  const summary = input.summary ?? "PRD integration fixture."
  const problem = input.problem ?? "Validate PRD markdown behavior."
  const scope = input.scope ?? "Included: integration tests.\nExcluded: production behavior."
  const acceptanceCriteria = input.acceptanceCriteria ?? "- Fixture validates."
  const nonGoals = input.nonGoals ?? "- None."
  const extraSections = input.extraSections ? `\n\n${input.extraSections.trim()}` : ""

  return `${prdFrontmatter(input.name, input.title)}

# Summary
${summary}

# Problem
${problem}

# Scope
${scope}

# Requirements
${input.requirements.trim()}

# Acceptance Criteria
${acceptanceCriteria}

# Non-goals
${nonGoals}${extraSections}
`
}

describe("EARS requirements integration", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempDir: string

  beforeAll(async () => {
    shared = await getSharedTestLayer()
    originalCwd = process.cwd()
  })

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tx-ears-docs-"))
    setupDocsWorkspace(tempDir)
    process.chdir(tempDir)
  })

  afterEach(async () => {
    await shared.reset()
    process.chdir(originalCwd)
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })


  it("creates and renders a PRD with EARS requirements", async () => {
    const name = `prd-${fixtureId("ears-create").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "EARS PRD",
      problem: "EARS integration",
      requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-EARS-001
    kind: ubiquitous
    statement: the tx memory learn command shall persist a learning entry.
    priority: must
    rationale: Core primitive
  - id: REQ-EARS-002
    kind: event-driven
    when: a user runs tx memory recall <path>
    statement: the recall service shall return relevant learnings.
    priority: should
\`\`\``,
      acceptanceCriteria: "- PRD stores valid EARS requirements.",
      extraSections: `## Structured Requirements (EARS)
| ID | Kind |
| --- | --- |
| REQ-EARS-001 | ubiquitous |
| REQ-EARS-002 | event-driven |`,
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "EARS PRD",
          content,
        })
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const renderedPath = join(tempDir, "specs", "prd", `${name}.md`)
    expect(existsSync(renderedPath)).toBe(true)
    const markdown = readFileSync(renderedPath, "utf8")
    expect(markdown).toContain("## Structured Requirements (EARS)")
    expect(markdown).toContain("| REQ-EARS-001 | ubiquitous |")
    expect(markdown).toContain("| REQ-EARS-002 | event-driven |")
  })

  it("rejects PRD YAML with missing required EARS trigger for event_driven", async () => {
    const name = `prd-${fixtureId("ears-missing-trigger").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "Invalid EARS PRD",
      requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-EARS-003
    kind: event-driven
    statement: the recall service shall return learnings.
    priority: must
\`\`\``,
      acceptanceCriteria: "- Invalid docs are rejected.",
    })

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Invalid EARS PRD",
            content,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("Kind 'event-driven' requires field 'when'")
  })

  it("rejects duplicate EARS IDs", async () => {
    const name = `prd-${fixtureId("ears-duplicate-id").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "Duplicate EARS IDs",
      requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-EARS-004
    kind: ubiquitous
    statement: the system shall do one thing.
    priority: must
  - id: REQ-EARS-004
    kind: ubiquitous
    statement: the system shall do another thing.
    priority: should
\`\`\``,
      acceptanceCriteria: "- Duplicate IDs are rejected.",
    })

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Duplicate EARS IDs",
            content,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("Duplicate EARS requirement id 'REQ-EARS-004'")
  })

  it("rejects non-array ears_requirements in DocService validation", async () => {
    const name = `prd-${fixtureId("ears-non-array").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "Invalid non-array EARS",
      requirements: `\`\`\`yaml
ears_requirements:
  id: REQ-EARS-005
  kind: ubiquitous
  statement: the system shall do work.
  priority: must
\`\`\``,
      acceptanceCriteria: "- Non-array EARS blocks are rejected.",
    })

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Invalid non-array EARS",
            content,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow(/ears_requirements/i)
  })

  it("allows PRDs with plain requirements and no ears_requirements by default", async () => {
    const name = `prd-${fixtureId("ears-required-default").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "Legacy PRD",
      requirements: "- legacy requirement",
      acceptanceCriteria: "- legacy criterion",
    })

    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        return yield* svc.create({
          kind: "prd",
          name,
          title: "Legacy PRD",
          content,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(created.kind).toBe("prd")
  })

  it("allows PRDs with plain requirements regardless of require_ears config", async () => {
    writeDocsConfig(tempDir, false)

    const name = `prd-${fixtureId("ears-backward-compatible").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "Legacy PRD",
      requirements: "- legacy requirement",
      acceptanceCriteria: "- legacy criterion",
    })

    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        return yield* svc.create({
          kind: "prd",
          name,
          title: "Legacy PRD",
          content,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(created.kind).toBe("prd")
  })

  it("supports mixed requirements and ears_requirements in the same PRD", async () => {
    const name = `prd-${fixtureId("ears-mixed").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "Mixed PRD",
      requirements: `- legacy requirement
\`\`\`yaml
ears_requirements:
  - id: REQ-EARS-006
    kind: optional
    where: dashboard mode
    statement: the dashboard API shall show assignment controls.
    priority: should
\`\`\``,
      acceptanceCriteria: "- Mixed legacy and EARS content validates.",
      extraSections: "## Structured Requirements (EARS)\n- REQ-EARS-006",
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Mixed PRD",
          content,
        })
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const markdown = readFileSync(join(tempDir, "specs", "prd", `${name}.md`), "utf8")
    expect(markdown).toContain("# Requirements")
    expect(markdown).toContain("## Structured Requirements (EARS)")
  })

  it("validates EARS on update and re-renders structured section", async () => {
    const name = `prd-${fixtureId("ears-update-valid").slice(3, 10)}`
    const initialContent = prdDoc({
      name,
      title: "Update PRD",
      problem: "Start without structured requirements.",
      requirements: "- legacy requirement",
      acceptanceCriteria: "- Initial version persists.",
    })

    const updatedContent = prdDoc({
      name,
      title: "Update PRD",
      requirements: `- legacy requirement
\`\`\`yaml
ears_requirements:
  - id: REQ-EARS-UPD-001
    kind: event-driven
    when: a user runs tx doc render
    statement: the doc renderer shall include structured requirements.
    priority: must
\`\`\``,
      acceptanceCriteria: "- Updated version includes structured requirements.",
      extraSections: "## Structured Requirements (EARS)\n- REQ-EARS-UPD-001",
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Update PRD",
          content: initialContent,
        })
        yield* svc.update(name, updatedContent)
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const markdown = readFileSync(join(tempDir, "specs", "prd", `${name}.md`), "utf8")
    expect(markdown).toContain("## Structured Requirements (EARS)")
    expect(markdown).toContain("REQ-EARS-UPD-001")
  })

  it("rejects invalid EARS during update", async () => {
    const name = `prd-${fixtureId("ears-update-invalid").slice(3, 10)}`
    const initialContent = prdDoc({
      name,
      title: "Update Invalid PRD",
      problem: "Start without structured requirements.",
      requirements: "- baseline requirement",
      acceptanceCriteria: "- Initial version persists.",
    })

    const invalidUpdateContent = prdDoc({
      name,
      title: "Update Invalid PRD",
      requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-EARS-UPD-002
    kind: event-driven
    statement: the doc service shall reject invalid updates.
    priority: must
\`\`\``,
      acceptanceCriteria: "- Invalid update is rejected.",
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Update Invalid PRD",
          content: initialContent,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.update(name, invalidUpdateContent)
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("Kind 'event-driven' requires field 'when'")
  })

  it("preserves pipe characters in markdown EARS statements", async () => {
    const name = `prd-${fixtureId("ears-pipe-escape").slice(3, 10)}`
    const content = prdDoc({
      name,
      title: "Pipe Escape PRD",
      requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-EARS-PIPE-001
    kind: ubiquitous
    statement: the tx | learn command shall persist A | B values.
    priority: must
\`\`\``,
      acceptanceCriteria: "- Pipe characters are retained in markdown.",
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Pipe Escape PRD",
          content,
        })
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const markdown = readFileSync(join(tempDir, "specs", "prd", `${name}.md`), "utf8")
    expect(markdown).toContain("tx | learn command shall persist A | B values")
  })
})

describe("CLI doc lint-ears", () => {
  let tempProjectDir: string

  beforeEach(() => {
    tempProjectDir = mkdtempSync(join(tmpdir(), "tx-doc-lint-ears-"))
    const init = runTx(["init", "--codex"], tempProjectDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true })
    }
  })

  it("returns success for valid EARS requirements", () => {
    const name = `prd-${fixtureId("cli-ears-valid").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Valid EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    writeFileSync(
      markdownPath,
      prdDoc({
        name,
        title: "Valid EARS",
        problem: "Validate structured requirements.",
        requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-CLI-EARS-001
    kind: event-driven
    when: a user runs tx memory recall <path>
    statement: the recall service shall return relevant learnings.
    priority: must
\`\`\``,
        acceptanceCriteria: "- lint-ears passes for valid markdown.",
      }),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).toBe(0)
    expect(lint.stdout).toContain("EARS validation passed")
  })

  it("supports linting by direct markdown file path", () => {
    const name = `prd-${fixtureId("cli-ears-path").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Path EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    writeFileSync(
      markdownPath,
      prdDoc({
        name,
        title: "Path EARS",
        problem: "Validate by path.",
        requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-CLI-EARS-002
    kind: ubiquitous
    statement: the system shall lint a markdown file path directly.
    priority: must
\`\`\``,
        acceptanceCriteria: "- lint by path succeeds.",
      }),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", markdownPath], tempProjectDir)
    expect(lint.status).toBe(0)
    expect(lint.stdout).toContain("EARS validation passed")
  })

  it("returns non-zero for invalid EARS requirements", () => {
    const name = `prd-${fixtureId("cli-ears-invalid").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Invalid EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    writeFileSync(
      markdownPath,
      prdDoc({
        name,
        title: "Invalid EARS",
        problem: "Missing event-driven clause.",
        requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-CLI-EARS-003
    kind: event-driven
    statement: the recall service shall return relevant learnings.
    priority: must
\`\`\``,
        acceptanceCriteria: "- lint fails for invalid markdown EARS.",
      }),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).not.toBe(0)
    expect(lint.stderr).toContain("Markdown parse error")
    expect(lint.stderr).toContain("requires field 'when'")
  })

  it("returns JSON output for valid lint", () => {
    const name = `prd-${fixtureId("cli-ears-json-valid").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Valid JSON EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    writeFileSync(
      markdownPath,
      prdDoc({
        name,
        title: "Valid JSON EARS",
        problem: "Produce JSON output.",
        requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-CLI-EARS-004
    kind: ubiquitous
    statement: the system shall return json payload.
    priority: must
\`\`\``,
        acceptanceCriteria: "- JSON output is valid for passing lint.",
      }),
      "utf8"
    )
    // Force fsync to ensure data is on disk before subprocess reads it
    const fd = openSync(markdownPath, "r")
    fsyncSync(fd)
    closeSync(fd)

    const lint = runTx(["doc", "lint-ears", name, "--json"], tempProjectDir)
    expect(lint.status).toBe(0)
    const parsed = JSON.parse(lint.stdout) as {
      valid: boolean
      count: number
      errors: unknown[]
      path: string
    }
    expect(parsed.valid).toBe(true)
    expect(parsed.count).toBe(1)
    expect(parsed.errors).toHaveLength(0)
    expect(parsed.path).toContain(`${name}.md`)
  })

  it("returns JSON output for invalid lint", () => {
    const name = `prd-${fixtureId("cli-ears-json-invalid").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Invalid JSON EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    writeFileSync(
      markdownPath,
      prdDoc({
        name,
        title: "Invalid JSON EARS",
        problem: "Produce JSON error output.",
        requirements: `\`\`\`yaml
ears_requirements:
  - id: REQ-CLI-EARS-005
    kind: event-driven
    statement: the system shall fail json payload.
    priority: must
\`\`\``,
        acceptanceCriteria: "- Invalid markdown EARS emits JSON errors.",
      }),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name, "--json"], tempProjectDir)
    expect(lint.status).not.toBe(0)
    const parsed = JSON.parse(lint.stdout) as {
      valid: boolean
      count?: number
      errors: Array<{ field: string; message: string }>
      path: string
    }
    expect(parsed.valid).toBe(false)
    expect(parsed.path).toContain(`${name}.md`)
    expect(parsed.errors.some((error) => error.field === "markdown")).toBe(true)
    expect(parsed.errors.some((error) => error.message.includes("requires field 'when'"))).toBe(true)
  })

  it("returns success when PRD has no ears_requirements under the default config", () => {
    const name = `prd-${fixtureId("cli-ears-required").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Legacy PRD"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    writeFileSync(
      markdownPath,
      prdDoc({
        name,
        title: "Legacy PRD",
        problem: "Missing EARS section.",
        requirements: "- Legacy requirement one",
        acceptanceCriteria: "- Legacy requirement remains documented.",
      }),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).toBe(0)
    expect(lint.stdout).toContain("No ears_requirements section found")
  })

  it("returns success without EARS regardless of require_ears config", () => {
    writeDocsConfig(tempProjectDir, false)

    const name = `prd-${fixtureId("cli-ears-optional").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Optional EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const markdownPath = join(tempProjectDir, "specs", "prd", `${name}.md`)
    writeFileSync(
      markdownPath,
      prdDoc({
        name,
        title: "Optional EARS",
        problem: "Legacy-only authoring.",
        requirements: "- Legacy requirement one",
        acceptanceCriteria: "- Legacy requirement remains documented.",
      }),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).toBe(0)
    expect(lint.stdout).toContain("No ears_requirements section found")
  })

  it("shows lint-ears in doc help output", () => {
    const help = runTx(["doc", "--help"], tempProjectDir)
    expect(help.status).toBe(0)
    expect(help.stdout).toContain("lint-ears")
  })

  it("shows lint-ears in top-level help output", () => {
    const help = runTx(["--help"], tempProjectDir)
    expect(help.status).toBe(0)
    expect(help.stdout).toContain("lint-ears")
  })

  it("fails lint-ears for non-PRD docs", () => {
    const name = `dd-${fixtureId("cli-ears-non-prd").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "design", name, "--title", "Design Doc"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).not.toBe(0)
    expect(lint.stderr).toContain("only supported for PRD docs")
  })
})
