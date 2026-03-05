/**
 * @fileoverview Tests for require-llms-primitive-coverage ESLint rule
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"
import rule, { _resetReported } from "../rules/require-llms-primitive-coverage.js"

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
  pages = ["index", "---Task Management---", "ready", "memory", "spec-trace"],
  llmsContent = "",
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
    if (asPath.includes("apps/docs/public/llms.txt")) {
      return llmsContent
    }

    throw new Error(`unhandled readFileSync path: ${asPath}`)
  })
}

describe("require-llms-primitive-coverage rule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetReported()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("passes when llms.txt includes every primitive URL", () => {
    setupReadFileMock({
      llmsContent: `
        - [tx ready](https://tx-docs.vercel.app/docs/primitives/ready)
        - [tx memory](https://tx-docs.vercel.app/docs/primitives/memory)
        - [tx spec](https://tx-docs.vercel.app/docs/primitives/spec-trace)
      `,
    })

    const context = createContext()
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(0)
  })

  it("reports each primitive missing from llms.txt", () => {
    setupReadFileMock({
      pages: ["index", "ready", "memory", "spec-trace"],
      llmsContent: `
        - [tx ready](https://tx-docs.vercel.app/docs/primitives/ready)
      `,
    })

    const context = createContext()
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(2)
    expect(context._messages.map((message) => message.messageId)).toEqual([
      "missingPrimitiveInLlms",
      "missingPrimitiveInLlms",
    ])
    expect(context._messages.map((message) => message.data.primitive)).toEqual([
      "memory",
      "spec-trace",
    ])
  })

  it("reports unreadable llms.txt files", () => {
    setupReadFileMock({
      llmsContent: "",
      throwOn: ["apps/docs/public/llms.txt"],
    })

    const context = createContext()
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].messageId).toBe("llmsReadError")
    expect(context._messages[0].data.llmsPath).toContain("apps/docs/public/llms.txt")
  })

  it("supports a custom docs URL base", () => {
    setupReadFileMock({
      pages: ["index", "ready"],
      llmsContent: `
        - [tx ready](https://docs.example.com/primitives/ready)
      `,
    })

    const context = createContext({
      urlBase: "https://docs.example.com/primitives",
    })
    const visitor = rule.create(context)
    visitor.Program(createProgramNode())

    expect(context._messages).toHaveLength(0)
  })
})
