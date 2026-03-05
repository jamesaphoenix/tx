/**
 * @fileoverview Tests for require-primitive-template-coverage ESLint rule
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"
import rule, { _resetReported } from "../rules/require-primitive-template-coverage.js"

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
}))

function createContext(options = {}, filename = "/project/apps/cli/src/cli.ts") {
  const messages = []
  return {
    options: [options],
    filename,
    getFilename: () => filename,
    cwd: "/project",
    report: (info) => messages.push(info),
    _messages: messages,
  }
}

function createProgramNode() {
  return { type: "Program", body: [] }
}

function setupReadFileMock({
  pages = ["index", "---Task Management---", "ready", "gate", "spec-trace", "checkpoint"],
  registry = {
    checkpoint: { planned: true },
  },
  claudeTemplate = "",
  codexTemplate = "",
  throwOn = [],
} = {}) {
  fs.readFileSync.mockImplementation((filePath) => {
    const asPath = String(filePath)

    for (const needle of throwOn) {
      if (asPath.includes(needle)) throw new Error(`mock read failure: ${needle}`)
    }

    if (asPath.includes("apps/docs/content/docs/primitives/meta.json")) {
      return JSON.stringify({ pages })
    }
    if (asPath.includes("primitives-registry.json")) {
      return JSON.stringify(registry)
    }
    if (asPath.includes("apps/cli/src/templates/claude/CLAUDE.md")) {
      return claudeTemplate
    }
    if (asPath.includes("apps/cli/src/templates/codex/AGENTS.md")) {
      return codexTemplate
    }

    throw new Error(`unhandled readFileSync path: ${asPath}`)
  })
}

describe("require-primitive-template-coverage rule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetReported()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("passes when all required primitives are present in both templates", () => {
    setupReadFileMock({
      claudeTemplate: `
        | \`tx ready\` | queue |
        | \`tx gate\` | hitl |
        | \`tx spec\` | traceability |
      `,
      codexTemplate: `
        | \`tx ready\` | queue |
        | \`tx gate\` | hitl |
        | \`tx spec\` | traceability |
      `,
    })

    const context = createContext()
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(0)
  })

  it("reports when a documented primitive is missing from one template", () => {
    setupReadFileMock({
      claudeTemplate: `
        | \`tx ready\` | queue |
        | \`tx gate\` | hitl |
        | \`tx spec\` | traceability |
      `,
      codexTemplate: `
        | \`tx ready\` | queue |
        | \`tx spec\` | traceability |
      `,
    })

    const context = createContext()
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].messageId).toBe("missingPrimitiveInTemplate")
    expect(context._messages[0].data.primitive).toBe("gate")
    expect(context._messages[0].data.template).toContain("apps/cli/src/templates/codex/AGENTS.md")
    expect(context._messages[0].data.expected).toBe("tx gate")
  })

  it("skips planned primitives when checking templates", () => {
    setupReadFileMock({
      pages: ["index", "ready", "checkpoint"],
      registry: { checkpoint: { planned: true } },
      claudeTemplate: "| `tx ready` | queue |",
      codexTemplate: "| `tx ready` | queue |",
    })

    const context = createContext()
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(0)
  })

  it("reports unreadable template files", () => {
    setupReadFileMock({
      pages: ["index", "ready"],
      claudeTemplate: "| `tx ready` | queue |",
      codexTemplate: "| `tx ready` | queue |",
      throwOn: ["apps/cli/src/templates/codex/AGENTS.md"],
    })

    const context = createContext()
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].messageId).toBe("templateReadError")
    expect(context._messages[0].data.template).toContain("apps/cli/src/templates/codex/AGENTS.md")
  })
})
