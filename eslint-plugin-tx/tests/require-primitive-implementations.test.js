/**
 * @fileoverview Tests for the require-primitive-implementations ESLint rule
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"
import rule, { _resetReported } from "../rules/require-primitive-implementations.js"

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

const REGISTRY = {
  ready: {
    cli: "apps/cli/src/commands/task.ts",
    mcp: "apps/mcp-server/src/tools/task.ts",
    api: "apps/api-server/src/routes/tasks.ts",
    sdk: "apps/agent-sdk/src/client.ts",
    required: ["cli", "mcp", "api", "sdk"],
  },
  checkpoint: {
    planned: true,
    required: [],
  },
}

function createContext(options = {}, filename = "/project/apps/cli/src/commands/task.ts") {
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

function setupMocks({ docFiles = ["ready.mdx"], registry = REGISTRY, existingFiles = null } = {}) {
  // Clear the module-level deduplication set by reimporting
  // For tests, we accept potential dedup issues and check message count carefully

  fs.readdirSync.mockReturnValue(docFiles)
  fs.readFileSync.mockReturnValue(JSON.stringify(registry))

  if (existingFiles === null) {
    // All files exist by default
    fs.existsSync.mockReturnValue(true)
  } else if (typeof existingFiles === "function") {
    fs.existsSync.mockImplementation(existingFiles)
  } else {
    fs.existsSync.mockReturnValue(existingFiles)
  }
}

describe("require-primitive-implementations rule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetReported()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("meta", () => {
    it("has correct type", () => {
      expect(rule.meta.type).toBe("problem")
    })

    it("has all messages defined", () => {
      expect(rule.meta.messages.unconfiguredPrimitive).toContain("no entry")
      expect(rule.meta.messages.missingImplementations).toContain("missing implementations")
      expect(rule.meta.messages.plannedPrimitiveHasImpl).toContain("planned")
    })

    it("has schema for registryPath and docsDir", () => {
      expect(rule.meta.schema).toHaveLength(1)
      expect(rule.meta.schema[0].properties.registryPath).toBeDefined()
      expect(rule.meta.schema[0].properties.docsDir).toBeDefined()
    })
  })

  describe("all implementations exist", () => {
    it("reports nothing when all interface files exist", () => {
      setupMocks()

      const context = createContext({
        registryPath: "primitives-registry.json",
        docsDir: "apps/docs/content/docs/primitives",
      })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("missing MCP implementation", () => {
    it("reports missing MCP when its file does not exist", () => {
      setupMocks({
        existingFiles: (p) => {
          if (p.includes("mcp-server")) return false
          return true
        },
      })

      const context = createContext({
        registryPath: "primitives-registry.json",
        docsDir: "apps/docs/content/docs/primitives",
      })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(1)
      expect(context._messages[0].messageId).toBe("missingImplementations")
      expect(context._messages[0].data.primitive).toBe("ready")
      expect(context._messages[0].data.interfaces).toContain("mcp")
    })
  })

  describe("multiple missing interfaces", () => {
    it("reports all missing interfaces in one message", () => {
      setupMocks({
        existingFiles: (p) => {
          if (p.includes("mcp-server")) return false
          if (p.includes("api-server")) return false
          return true
        },
      })

      const context = createContext({
        registryPath: "primitives-registry.json",
        docsDir: "apps/docs/content/docs/primitives",
      })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(1)
      expect(context._messages[0].data.interfaces).toBe("mcp, api")
    })
  })

  describe("unconfigured primitive", () => {
    it("reports when docs .mdx exists but no registry entry", () => {
      const registryWithoutNewFeature = { ...REGISTRY }

      setupMocks({
        docFiles: ["ready.mdx", "newfeature.mdx"],
        registry: registryWithoutNewFeature,
      })

      const context = createContext({
        registryPath: "primitives-registry.json",
        docsDir: "apps/docs/content/docs/primitives",
      })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const unconfigured = context._messages.filter(
        (m) => m.messageId === "unconfiguredPrimitive"
      )
      expect(unconfigured).toHaveLength(1)
      expect(unconfigured[0].data.primitive).toBe("newfeature")
      expect(unconfigured[0].data.docFile).toBe("newfeature.mdx")
    })
  })

  describe("planned primitives", () => {
    it("skips implementation checks for planned primitives", () => {
      setupMocks({
        docFiles: ["checkpoint.mdx"],
        existingFiles: false,
      })

      const context = createContext(
        {
          registryPath: "primitives-registry.json",
          docsDir: "apps/docs/content/docs/primitives",
        },
        "/project/apps/cli/src/commands/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("reports when planned primitive has unexpected implementations", () => {
      const registryWithPlanned = {
        checkpoint: {
          planned: true,
          cli: "apps/cli/src/commands/checkpoint.ts",
          required: [],
        },
      }

      setupMocks({
        docFiles: ["checkpoint.mdx"],
        registry: registryWithPlanned,
        existingFiles: true,
      })

      const context = createContext(
        {
          registryPath: "primitives-registry.json",
          docsDir: "apps/docs/content/docs/primitives",
        },
        "/project/apps/cli/src/commands/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const planned = context._messages.filter(
        (m) => m.messageId === "plannedPrimitiveHasImpl"
      )
      expect(planned).toHaveLength(1)
      expect(planned[0].data.interfaces).toContain("cli")
    })
  })

  describe("file skipping", () => {
    it("skips non-TS files", () => {
      setupMocks({ existingFiles: false })

      const context = createContext(
        { registryPath: "primitives-registry.json" },
        "/project/package.json"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips test files", () => {
      setupMocks({ existingFiles: false })

      const context = createContext(
        { registryPath: "primitives-registry.json" },
        "/project/apps/cli/src/commands/task.test.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips files not under apps/", () => {
      setupMocks({ existingFiles: false })

      const context = createContext(
        { registryPath: "primitives-registry.json" },
        "/project/packages/core/src/utils.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("empty required array", () => {
    it("reports nothing when required is empty", () => {
      const reg = {
        bulk: {
          cli: "apps/cli/src/commands/bulk.ts",
          required: [],
        },
      }

      setupMocks({
        docFiles: ["bulk.mdx"],
        registry: reg,
        existingFiles: false,
      })

      const context = createContext(
        { registryPath: "primitives-registry.json" },
        "/project/apps/cli/src/commands/bulk.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("array paths", () => {
    it("passes when one of multiple paths exists", () => {
      const reg = {
        ready: {
          cli: ["apps/cli/src/commands/task.ts", "apps/cli/src/commands/task-v2.ts"],
          mcp: "apps/mcp-server/src/tools/task.ts",
          required: ["cli", "mcp"],
        },
      }

      setupMocks({
        docFiles: ["ready.mdx"],
        registry: reg,
        existingFiles: (p) => {
          if (p.includes("task-v2.ts")) return true
          if (p.includes("task.ts") && p.includes("cli")) return false
          return true
        },
      })

      const context = createContext(
        { registryPath: "primitives-registry.json" },
        "/project/apps/mcp-server/src/tools/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("graceful error handling", () => {
    it("handles missing registry file", () => {
      fs.readdirSync.mockReturnValue(["ready.mdx"])
      fs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT")
      })
      fs.existsSync.mockReturnValue(true)

      const context = createContext(
        { registryPath: "nonexistent.json" },
        "/project/apps/cli/src/commands/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      // Should report unconfigured since registry is empty
      const unconfigured = context._messages.filter(
        (m) => m.messageId === "unconfiguredPrimitive"
      )
      expect(unconfigured.length).toBeGreaterThanOrEqual(1)
    })

    it("handles missing docs directory", () => {
      fs.readdirSync.mockImplementation(() => {
        throw new Error("ENOENT")
      })
      fs.readFileSync.mockReturnValue(JSON.stringify(REGISTRY))
      fs.existsSync.mockReturnValue(true)

      const context = createContext(
        { registryPath: "primitives-registry.json" },
        "/project/apps/cli/src/commands/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      // No primitives discovered, no errors
      expect(context._messages).toHaveLength(0)
    })
  })

  describe("index.mdx excluded", () => {
    it("does not treat index.mdx as a primitive", () => {
      setupMocks({
        docFiles: ["index.mdx", "ready.mdx"],
      })

      const context = createContext({
        registryPath: "primitives-registry.json",
        docsDir: "apps/docs/content/docs/primitives",
      })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const indexReports = context._messages.filter(
        (m) => m.data && m.data.primitive === "index"
      )
      expect(indexReports).toHaveLength(0)
    })
  })
})
