/**
 * @fileoverview Tests for the require-interface-coverage ESLint rule
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"
import rule from "../rules/require-interface-coverage.js"

// Mock fs.existsSync
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
  },
  existsSync: vi.fn(),
}))

/**
 * Create a mock ESLint context
 * @param {object} options - Rule options
 * @param {string} filename - The filename being linted
 */
function createContext(options = {}, filename = "/project/apps/cli/src/commands/task.ts") {
  const messages = []
  return {
    options: [options],
    filename,
    getFilename: () => filename,
    report: (info) => messages.push(info),
    _messages: messages,
  }
}

/**
 * Create a minimal Program AST node
 */
function createProgramNode() {
  return { type: "Program", body: [] }
}

const SERVICES_CONFIG = {
  services: {
    tasks: {
      cli: "apps/cli/src/commands/task.ts",
      mcp: "apps/mcp-server/src/tools/task.ts",
      api: "apps/api-server/src/routes/tasks.ts",
      sdk: "apps/agent-sdk/src/client.ts",
      required: ["cli", "mcp", "api", "sdk"],
    },
  },
}

describe("require-interface-coverage rule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("meta", () => {
    it("has correct type", () => {
      expect(rule.meta.type).toBe("suggestion")
    })

    it("has messages defined", () => {
      expect(rule.meta.messages.missingInterfaces).toContain("missing interfaces")
      expect(rule.meta.messages.missingInterface).toContain("missing")
    })

    it("has schema for services config", () => {
      expect(rule.meta.schema).toHaveLength(1)
      expect(rule.meta.schema[0].type).toBe("object")
      expect(rule.meta.schema[0].properties.services).toBeDefined()
    })
  })

  describe("1: all required interfaces exist - no error", () => {
    it("reports nothing when all interface files exist", () => {
      fs.existsSync.mockReturnValue(true)

      const context = createContext(SERVICES_CONFIG)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("2: MCP missing - reports missing MCP", () => {
    it("reports missing MCP when its file does not exist", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p.includes("mcp-server")) return false
        return true
      })

      const context = createContext(SERVICES_CONFIG)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(1)
      expect(context._messages[0].messageId).toBe("missingInterfaces")
      expect(context._messages[0].data.service).toBe("tasks")
      expect(context._messages[0].data.interfaces).toBe("mcp")
    })
  })

  describe("3: multiple interfaces missing - reports all", () => {
    it("reports all missing interfaces in a single message", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p.includes("mcp-server")) return false
        if (p.includes("api-server")) return false
        return true
      })

      const context = createContext(SERVICES_CONFIG)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(1)
      expect(context._messages[0].data.interfaces).toBe("mcp, api")
    })
  })

  describe("4: required subset respected", () => {
    it("does not check SDK when not in required list", () => {
      // SDK file does not exist but is not required
      fs.existsSync.mockImplementation((p) => {
        if (p.includes("agent-sdk")) return false
        return true
      })

      const config = {
        services: {
          tasks: {
            cli: "apps/cli/src/commands/task.ts",
            mcp: "apps/mcp-server/src/tools/task.ts",
            api: "apps/api-server/src/routes/tasks.ts",
            sdk: "apps/agent-sdk/src/client.ts",
            required: ["cli", "mcp", "api"], // no sdk
          },
        },
      }

      const context = createContext(config)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("5: required: [] - no enforcement", () => {
    it("reports nothing when required is empty", () => {
      fs.existsSync.mockReturnValue(false)

      const config = {
        services: {
          bulk: {
            cli: "apps/cli/src/commands/bulk.ts",
            required: [],
          },
        },
      }

      const context = createContext(config, "/project/apps/cli/src/commands/bulk.ts")
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("6: non-TS files - skipped", () => {
    it("skips .json files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(SERVICES_CONFIG, "/project/package.json")
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips .md files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(SERVICES_CONFIG, "/project/README.md")
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips .css files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(SERVICES_CONFIG, "/project/styles.css")
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("7: test files - skipped", () => {
    it("skips .test.ts files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(
        SERVICES_CONFIG,
        "/project/apps/cli/src/commands/task.test.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips .spec.ts files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(
        SERVICES_CONFIG,
        "/project/apps/cli/src/commands/task.spec.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips __tests__ directory files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(
        SERVICES_CONFIG,
        "/project/__tests__/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips /test/ directory files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(
        SERVICES_CONFIG,
        "/project/test/integration/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("8: array paths - one exists is enough", () => {
    it("passes when one of multiple paths exists", () => {
      fs.existsSync.mockImplementation((p) => {
        // Only the second path exists
        if (p.includes("task-v2.ts")) return true
        if (p.includes("task.ts") && p.includes("cli")) return false
        return true
      })

      const config = {
        services: {
          tasks: {
            cli: [
              "apps/cli/src/commands/task.ts",
              "apps/cli/src/commands/task-v2.ts",
            ],
            mcp: "apps/mcp-server/src/tools/task.ts",
            required: ["cli", "mcp"],
          },
        },
      }

      const context = createContext(
        config,
        "/project/apps/mcp-server/src/tools/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("fails when none of the array paths exist", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p.includes("cli")) return false
        return true
      })

      const config = {
        services: {
          tasks: {
            cli: [
              "apps/cli/src/commands/task.ts",
              "apps/cli/src/commands/task-v2.ts",
            ],
            mcp: "apps/mcp-server/src/tools/task.ts",
            required: ["cli", "mcp"],
          },
        },
      }

      const context = createContext(
        config,
        "/project/apps/mcp-server/src/tools/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(1)
      expect(context._messages[0].data.interfaces).toBe("cli")
    })
  })

  describe("9: file not related to any service - no error", () => {
    it("reports nothing for unrelated files", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(
        SERVICES_CONFIG,
        "/project/packages/core/src/utils.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("reports nothing when file path does not match any service interface", () => {
      fs.existsSync.mockReturnValue(false)

      const context = createContext(
        SERVICES_CONFIG,
        "/project/apps/dashboard/src/App.tsx"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("edge cases", () => {
    it("handles empty services config", () => {
      const context = createContext({ services: {} })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("handles no options at all", () => {
      const messages = []
      const context = {
        options: [],
        filename: "/project/apps/cli/src/commands/task.ts",
        getFilename: () => "/project/apps/cli/src/commands/task.ts",
        report: (info) => messages.push(info),
        _messages: messages,
      }

      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(messages).toHaveLength(0)
    })

    it("reports missing when interface key is in required but not defined in config", () => {
      fs.existsSync.mockReturnValue(true)

      const config = {
        services: {
          tasks: {
            cli: "apps/cli/src/commands/task.ts",
            // mcp, api, sdk not defined at all
            required: ["cli", "mcp"],
          },
        },
      }

      const context = createContext(config)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(1)
      expect(context._messages[0].data.interfaces).toBe("mcp")
    })

    it("handles multiple services with different missing interfaces", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p.includes("mcp-server/src/tools/task")) return false
        if (p.includes("api-server/src/routes/learnings")) return false
        return true
      })

      const config = {
        services: {
          tasks: {
            cli: "apps/cli/src/commands/task.ts",
            mcp: "apps/mcp-server/src/tools/task.ts",
            required: ["cli", "mcp"],
          },
          learnings: {
            cli: "apps/cli/src/commands/task.ts", // shared file triggers for both
            api: "apps/api-server/src/routes/learnings.ts",
            required: ["cli", "api"],
          },
        },
      }

      // File matches "tasks" via cli path
      const context = createContext(
        config,
        "/project/apps/cli/src/commands/task.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      // "tasks" is missing mcp, "learnings" is missing api
      expect(context._messages).toHaveLength(2)
      const services = context._messages.map((m) => m.data.service)
      expect(services).toContain("tasks")
      expect(services).toContain("learnings")
    })

    it("supports .tsx files", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p.includes("mcp-server")) return false
        return true
      })

      const config = {
        services: {
          tasks: {
            cli: "apps/cli/src/commands/task.tsx",
            mcp: "apps/mcp-server/src/tools/task.ts",
            required: ["cli", "mcp"],
          },
        },
      }

      const context = createContext(
        config,
        "/project/apps/cli/src/commands/task.tsx"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(1)
      expect(context._messages[0].data.interfaces).toBe("mcp")
    })

    it("supports .jsx files", () => {
      fs.existsSync.mockReturnValue(true)

      const config = {
        services: {
          ui: {
            cli: "apps/cli/src/commands/ui.jsx",
            required: ["cli"],
          },
        },
      }

      const context = createContext(
        config,
        "/project/apps/cli/src/commands/ui.jsx"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })
})
