/**
 * @fileoverview Tests for the no-generic-utility-file-names ESLint rule
 */

import { describe, it, expect } from "vitest"
import path from "node:path"
import rule from "../rules/no-generic-utility-file-names.js"

function createContext(filename, options = []) {
  const messages = []
  return {
    getFilename: () => filename,
    options,
    report: (info) => messages.push(info),
    _messages: messages,
  }
}

describe("no-generic-utility-file-names rule", () => {
  const projectRoot = process.cwd()
  const projectFile = (relPath) => path.join(projectRoot, relPath)

  it("reports utils.ts by default", () => {
    const context = createContext(projectFile("packages/core/src/utils.ts"))
    const visitor = rule.create(context)

    visitor.Program({ type: "Program" })

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].messageId).toBe("noGenericUtilityFileName")
  })

  it("reports helpers.ts by default", () => {
    const context = createContext(projectFile("apps/api-server/src/helpers.ts"))
    const visitor = rule.create(context)

    visitor.Program({ type: "Program" })

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].data.fileName).toBe("helpers.ts")
  })

  it("reports case-variant generic utility names", () => {
    const context = createContext(projectFile("packages/core/src/Utils.ts"))
    const visitor = rule.create(context)

    visitor.Program({ type: "Program" })

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].data.fileName).toBe("Utils.ts")
  })

  it("allows explicitly allowlisted files", () => {
    const context = createContext(
      projectFile("apps/agent-sdk/src/utils.ts"),
      [{ allow: ["apps/agent-sdk/src/utils.ts"] }]
    )
    const visitor = rule.create(context)

    expect(visitor.Program).toBeUndefined()
    expect(context._messages).toHaveLength(0)
  })

  it("allows non-generic file names", () => {
    const context = createContext(projectFile("packages/core/src/utils/file-path.ts"))
    const visitor = rule.create(context)

    expect(visitor.Program).toBeUndefined()
    expect(context._messages).toHaveLength(0)
  })

  it("supports custom banned file names", () => {
    const context = createContext(
      projectFile("src/common.ts"),
      [{ bannedFileNames: ["common.ts"] }]
    )
    const visitor = rule.create(context)

    visitor.Program({ type: "Program" })

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].data.fileName).toBe("common.ts")
  })

  it("reports top-level repo helpers via bannedPathPatterns", () => {
    const context = createContext(
      projectFile("packages/core/src/repo/task-repo.helpers.ts"),
      [{ bannedPathPatterns: ["^packages/core/src/(services|repo)/[^/]+\\.helpers\\.ts$"] }]
    )
    const visitor = rule.create(context)

    visitor.Program({ type: "Program" })

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].data.fileName).toBe("task-repo.helpers.ts")
  })

  it("reports top-level service internals via bannedPathPatterns", () => {
    const context = createContext(
      projectFile("packages/core/src/services/task-service-internals.ts"),
      [{ bannedPathPatterns: ["^packages/core/src/(services|repo)/[^/]+-internals\\.ts$"] }]
    )
    const visitor = rule.create(context)

    visitor.Program({ type: "Program" })

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].data.fileName).toBe("task-service-internals.ts")
  })

  it("allows nested service modules when bannedPathPatterns only target top-level files", () => {
    const context = createContext(
      projectFile("packages/core/src/services/task-service/shared.ts"),
      [{ bannedPathPatterns: ["^packages/core/src/(services|repo)/[^/]+\\.helpers\\.ts$"] }]
    )
    const visitor = rule.create(context)

    expect(visitor.Program).toBeUndefined()
    expect(context._messages).toHaveLength(0)
  })

  it("does not over-match allowlisted suffixes outside repo-relative path", () => {
    const context = createContext(
      projectFile("packages/foo/apps/agent-sdk/src/utils.ts"),
      [{ allow: ["apps/agent-sdk/src/utils.ts"] }]
    )
    const visitor = rule.create(context)

    visitor.Program({ type: "Program" })

    expect(context._messages).toHaveLength(1)
    expect(context._messages[0].messageId).toBe("noGenericUtilityFileName")
  })

  it("respects repo-root allowlists even when lint runs from a package subdirectory", () => {
    const originalCwd = process.cwd()
    process.chdir(projectFile("apps/agent-sdk"))
    try {
      const context = createContext(
        projectFile("apps/agent-sdk/src/utils.ts"),
        [{ allow: ["apps/agent-sdk/src/utils.ts"] }]
      )
      const visitor = rule.create(context)

      expect(visitor.Program).toBeUndefined()
      expect(context._messages).toHaveLength(0)
    } finally {
      process.chdir(originalCwd)
    }
  })
})
