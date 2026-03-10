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
  mkdirSync(join(cwd, ".tx", "docs", "prd"), { recursive: true })
  mkdirSync(join(cwd, ".tx", "docs", "design"), { recursive: true })
}

const writeDocsConfig = (cwd: string, requireEars: boolean): void => {
  writeFileSync(
    join(cwd, ".tx", "config.toml"),
    ["[docs]", 'path = ".tx/docs"', `require_ears = ${requireEars}`].join("\n"),
    "utf8"
  )
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
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "EARS PRD"',
      "status: changing",
      "",
      "problem: |",
      "  EARS integration",
      "",
      "solution: |",
      "  Add structured requirements",
      "",
      "ears_requirements:",
      "  - id: EARS-FL-001",
      "    pattern: ubiquitous",
      "    system: tx memory learn command",
      "    response: persist a learning entry",
      "    priority: must",
      "    rationale: Core primitive",
      "    test_hint: integration test",
      "  - id: EARS-FL-002",
      "    pattern: event_driven",
      "    trigger: a user runs tx memory recall <path>",
      "    system: recall service",
      "    response: return relevant learnings",
    ].join("\n")

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "EARS PRD",
          yamlContent,
        })
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const renderedPath = join(tempDir, ".tx", "docs", "prd", `${name}.md`)
    expect(existsSync(renderedPath)).toBe(true)
    const markdown = readFileSync(renderedPath, "utf8")
    expect(markdown).toContain("## Structured Requirements (EARS)")
    expect(markdown).toContain("| EARS-FL-001 | ubiquitous |")
    expect(markdown).toContain("| EARS-FL-002 | event_driven |")
  })

  it("rejects PRD YAML with missing required EARS trigger for event_driven", async () => {
    const name = `prd-${fixtureId("ears-missing-trigger").slice(3, 10)}`
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Invalid EARS PRD"',
      "status: changing",
      "",
      "ears_requirements:",
      "  - id: EARS-FL-001",
      "    pattern: event_driven",
      "    system: recall service",
      "    response: return learnings",
    ].join("\n")

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Invalid EARS PRD",
            yamlContent,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("Pattern 'event_driven' requires field 'trigger'")
  })

  it("rejects duplicate EARS IDs", async () => {
    const name = `prd-${fixtureId("ears-duplicate-id").slice(3, 10)}`
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Duplicate EARS IDs"',
      "status: changing",
      "",
      "ears_requirements:",
      "  - id: EARS-FL-001",
      "    pattern: ubiquitous",
      "    system: tx",
      "    response: do one thing",
      "  - id: EARS-FL-001",
      "    pattern: ubiquitous",
      "    system: tx",
      "    response: do another thing",
    ].join("\n")

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Duplicate EARS IDs",
            yamlContent,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("Duplicate EARS requirement id 'EARS-FL-001'")
  })

  it("rejects non-array ears_requirements in DocService validation", async () => {
    const name = `prd-${fixtureId("ears-non-array").slice(3, 10)}`
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Invalid non-array EARS"',
      "status: changing",
      "",
      "ears_requirements:",
      "  id: EARS-FL-001",
      "  pattern: ubiquitous",
      "  system: tx",
      "  response: do work",
    ].join("\n")

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Invalid non-array EARS",
            yamlContent,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("'ears_requirements' must be an array")
  })

  it("requires EARS when legacy requirements are present by default", async () => {
    const name = `prd-${fixtureId("ears-required-default").slice(3, 10)}`
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Legacy PRD"',
      "status: changing",
      "",
      "requirements:",
      "  - legacy requirement",
      "",
      "acceptance_criteria:",
      "  - legacy criterion",
    ].join("\n")

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Legacy PRD",
            yamlContent,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("must also define a non-empty 'ears_requirements' array")
  })

  it("rejects PRDs with legacy requirements but no ears_requirements regardless of config", async () => {
    // EARS is now a hard requirement — config.require_ears has no effect
    writeDocsConfig(tempDir, false)

    const name = `prd-${fixtureId("ears-backward-compatible").slice(3, 10)}`
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Legacy PRD"',
      "status: changing",
      "",
      "requirements:",
      "  - legacy requirement",
      "",
      "acceptance_criteria:",
      "  - legacy criterion",
    ].join("\n")

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.create({
            kind: "prd",
            name,
            title: "Legacy PRD",
            yamlContent,
          })
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("must also define a non-empty 'ears_requirements' array")
  })

  it("supports mixed requirements and ears_requirements in the same PRD", async () => {
    const name = `prd-${fixtureId("ears-mixed").slice(3, 10)}`
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Mixed PRD"',
      "status: changing",
      "",
      "requirements:",
      "  - legacy requirement",
      "",
      "ears_requirements:",
      "  - id: EARS-FL-001",
      "    pattern: optional",
      "    feature: dashboard mode",
      "    system: dashboard api",
      "    response: show assignment controls",
    ].join("\n")

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Mixed PRD",
          yamlContent,
        })
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const markdown = readFileSync(join(tempDir, ".tx", "docs", "prd", `${name}.md`), "utf8")
    expect(markdown).toContain("## Requirements")
    expect(markdown).toContain("## Structured Requirements (EARS)")
  })

  it("validates EARS on update and re-renders structured section", async () => {
    const name = `prd-${fixtureId("ears-update-valid").slice(3, 10)}`
    const initialYaml = [
      "kind: prd",
      `name: ${name}`,
      'title: "Update PRD"',
      "status: changing",
      "",
      "problem: |",
      "  Start without structured requirements.",
      "",
      "solution: |",
      "  Add them during update.",
    ].join("\n")

    const updatedYaml = [
      "kind: prd",
      `name: ${name}`,
      'title: "Update PRD"',
      "status: changing",
      "",
      "requirements:",
      "  - legacy requirement",
      "",
      "ears_requirements:",
      "  - id: EARS-UPD-001",
      "    pattern: event_driven",
      "    trigger: a user runs tx doc render",
      "    system: doc renderer",
      "    response: include EARS table",
    ].join("\n")

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Update PRD",
          yamlContent: initialYaml,
        })
        yield* svc.update(name, updatedYaml)
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const markdown = readFileSync(join(tempDir, ".tx", "docs", "prd", `${name}.md`), "utf8")
    expect(markdown).toContain("## Structured Requirements (EARS)")
    expect(markdown).toContain("| EARS-UPD-001 | event_driven |")
  })

  it("rejects invalid EARS during update", async () => {
    const name = `prd-${fixtureId("ears-update-invalid").slice(3, 10)}`
    const initialYaml = [
      "kind: prd",
      `name: ${name}`,
      'title: "Update Invalid PRD"',
      "status: changing",
      "",
      "problem: |",
      "  Start without structured requirements.",
      "",
      "solution: |",
      "  Add an invalid EARS block during update.",
    ].join("\n")

    const invalidUpdateYaml = [
      "kind: prd",
      `name: ${name}`,
      'title: "Update Invalid PRD"',
      "status: changing",
      "",
      "ears_requirements:",
      "  - id: EARS-UPD-001",
      "    pattern: event_driven",
      "    system: doc service",
      "    response: reject invalid updates",
    ].join("\n")

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Update Invalid PRD",
          yamlContent: initialYaml,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DocService
          yield* svc.update(name, invalidUpdateYaml)
        }).pipe(Effect.provide(shared.layer))
      )
    ).rejects.toThrow("Pattern 'event_driven' requires field 'trigger'")
  })

  it("escapes pipe characters in rendered EARS integration output", async () => {
    const name = `prd-${fixtureId("ears-pipe-escape").slice(3, 10)}`
    const yamlContent = [
      "kind: prd",
      `name: ${name}`,
      'title: "Pipe Escape PRD"',
      "status: changing",
      "",
      "ears_requirements:",
      "  - id: EARS-PIPE-001",
      "    pattern: ubiquitous",
      "    system: tx | learn",
      "    response: persist A | B values",
    ].join("\n")

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.create({
          kind: "prd",
          name,
          title: "Pipe Escape PRD",
          yamlContent,
        })
        yield* svc.render(name)
      }).pipe(Effect.provide(shared.layer))
    )

    const markdown = readFileSync(join(tempDir, ".tx", "docs", "prd", `${name}.md`), "utf8")
    expect(markdown).toContain(
      "| EARS-PIPE-001 | ubiquitous | The tx \\| learn shall persist A \\| B values. | - |"
    )
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

    const yamlPath = join(tempProjectDir, ".tx", "docs", "prd", `${name}.yml`)
    writeFileSync(
      yamlPath,
      [
        "kind: prd",
        `name: ${name}`,
        'title: "Valid EARS"',
        "status: changing",
        "",
        "problem: |",
        "  Validate structured requirements.",
        "",
        "solution: |",
        "  Use EARS syntax.",
        "",
      "ears_requirements:",
      "  - id: EARS-FL-001",
      "    pattern: event_driven",
      "    trigger: a user runs tx memory recall <path>",
      "    system: recall service",
      "    response: return relevant learnings",
      "",
      ].join("\n"),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).toBe(0)
    expect(lint.stdout).toContain("EARS validation passed")
  })

  it("supports linting by direct YAML file path", () => {
    const name = `prd-${fixtureId("cli-ears-path").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Path EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const yamlPath = join(tempProjectDir, ".tx", "docs", "prd", `${name}.yml`)
    writeFileSync(
      yamlPath,
      [
        "kind: prd",
        `name: ${name}`,
        'title: "Path EARS"',
        "status: changing",
        "",
        "problem: |",
        "  Validate by path.",
        "",
        "solution: |",
        "  Read YAML directly.",
        "",
      "ears_requirements:",
      "  - id: EARS-PATH-001",
      "    pattern: ubiquitous",
      "    system: tx",
      "    response: lint via path",
      "",
      ].join("\n"),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", yamlPath], tempProjectDir)
    expect(lint.status).toBe(0)
    expect(lint.stdout).toContain("EARS validation passed")
  })

  it("returns non-zero for invalid EARS requirements", () => {
    const name = `prd-${fixtureId("cli-ears-invalid").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Invalid EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const yamlPath = join(tempProjectDir, ".tx", "docs", "prd", `${name}.yml`)
    writeFileSync(
      yamlPath,
      [
        "kind: prd",
        `name: ${name}`,
        'title: "Invalid EARS"',
        "status: changing",
        "",
        "problem: |",
        "  Missing trigger.",
        "",
        "solution: |",
        "  Should fail lint.",
        "",
      "ears_requirements:",
      "  - id: EARS-FL-001",
      "    pattern: event_driven",
      "    system: recall service",
      "    response: return relevant learnings",
      "",
      ].join("\n"),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).not.toBe(0)
    expect(lint.stderr).toContain("EARS validation failed")
    expect(lint.stderr).toContain("(trigger)")
  })

  it("returns JSON output for valid lint", () => {
    const name = `prd-${fixtureId("cli-ears-json-valid").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Valid JSON EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const yamlPath = join(tempProjectDir, ".tx", "docs", "prd", `${name}.yml`)
    writeFileSync(
      yamlPath,
      [
        "kind: prd",
        `name: ${name}`,
        'title: "Valid JSON EARS"',
        "status: changing",
        "",
        "problem: |",
        "  Produce JSON output.",
        "",
        "solution: |",
        "  Lint a valid EARS block.",
        "",
      "ears_requirements:",
      "  - id: EARS-JSON-001",
      "    pattern: ubiquitous",
      "    system: tx",
      "    response: return json payload",
      "",
      ].join("\n"),
      "utf8"
    )
    // Force fsync to ensure data is on disk before subprocess reads it
    const fd = openSync(yamlPath, "r")
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
    expect(parsed.path).toContain(`${name}.yml`)
  })

  it("returns JSON output for invalid lint", () => {
    const name = `prd-${fixtureId("cli-ears-json-invalid").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Invalid JSON EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const yamlPath = join(tempProjectDir, ".tx", "docs", "prd", `${name}.yml`)
    writeFileSync(
      yamlPath,
      [
        "kind: prd",
        `name: ${name}`,
        'title: "Invalid JSON EARS"',
        "status: changing",
        "",
        "problem: |",
        "  Produce JSON error output.",
        "",
        "solution: |",
        "  Lint an invalid EARS block.",
        "",
      "ears_requirements:",
      "  - id: EARS-JSON-001",
      "    pattern: event_driven",
      "    system: tx",
      "    response: fail json payload",
      "",
      ].join("\n"),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name, "--json"], tempProjectDir)
    expect(lint.status).not.toBe(0)
    const parsed = JSON.parse(lint.stdout) as {
      valid: boolean
      count: number
      errors: Array<{ field: string }>
      path: string
    }
    expect(parsed.valid).toBe(false)
    expect(parsed.count).toBe(1)
    expect(parsed.path).toContain(`${name}.yml`)
    expect(parsed.errors.some((error) => error.field === "trigger")).toBe(true)
  })

  it("fails lint when legacy requirements omit EARS under the default config", () => {
    const name = `prd-${fixtureId("cli-ears-required").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Legacy PRD"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const yamlPath = join(tempProjectDir, ".tx", "docs", "prd", `${name}.yml`)
    writeFileSync(
      yamlPath,
      [
        "kind: prd",
        `name: ${name}`,
        'title: "Legacy PRD"',
        "status: changing",
        "",
        "problem: |",
        "  Missing EARS section.",
        "",
        "solution: |",
        "  Still using legacy requirements only.",
        "",
        "requirements:",
        "  - Legacy requirement one",
        "",
      ].join("\n"),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).not.toBe(0)
    expect(lint.stderr).toContain("must also define a non-empty 'ears_requirements' array")
  })

  it("rejects legacy requirements without EARS regardless of config", () => {
    // EARS is now a hard requirement — config toggle has no effect
    writeDocsConfig(tempProjectDir, false)

    const name = `prd-${fixtureId("cli-ears-optional").slice(3, 10)}`
    const addDoc = runTx(["doc", "add", "prd", name, "--title", "Optional EARS"], tempProjectDir)
    expect(addDoc.status).toBe(0)

    const yamlPath = join(tempProjectDir, ".tx", "docs", "prd", `${name}.yml`)
    writeFileSync(
      yamlPath,
      [
        "kind: prd",
        `name: ${name}`,
        'title: "Optional EARS"',
        "status: changing",
        "",
        "problem: |",
        "  Legacy-only authoring.",
        "",
        "solution: |",
        "  Config opt-out.",
        "",
        "requirements:",
        "  - Legacy requirement one",
        "",
      ].join("\n"),
      "utf8"
    )

    const lint = runTx(["doc", "lint-ears", name], tempProjectDir)
    expect(lint.status).not.toBe(0)
    expect(lint.stderr).toContain("must also define a non-empty 'ears_requirements' array")
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
