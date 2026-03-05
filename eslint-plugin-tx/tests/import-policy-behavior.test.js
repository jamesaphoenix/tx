/**
 * @fileoverview Behavioral regression tests for import policy enforcement.
 */

import { describe, expect, it } from "vitest"
import { ESLint } from "eslint"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "../..")

const lintText = async (code) => {
  const eslint = new ESLint({ cwd: projectRoot })
  const [result] = await eslint.lintText(code, {
    filePath: path.join(projectRoot, "test", "fixtures", "import-policy-fixture.ts"),
  })
  return result.messages
}

describe("eslint import policy behavior", () => {
  it("blocks deep tx-core require() paths", async () => {
    const messages = await lintText(`
      const core = require("@jamesaphoenix/tx-core/src/services/index")
      void core
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks fs module.require() bypasses", async () => {
    const messages = await lintText(`
      const fsModule = module.require("fs")
      void fsModule
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks deep tx-core module.require() bypasses", async () => {
    const messages = await lintText(`
      const core = module.require("@jamesaphoenix/tx-core/src/services/index")
      void core
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks require alias assignment bypasses", async () => {
    const messages = await lintText(`
      let req
      req = require
      const fsModule = req("fs")
      void fsModule
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks deep tx-core dynamic imports", async () => {
    const messages = await lintText(`
      const core = await import("@jamesaphoenix/tx-core/src/services/index")
      void core
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks template-literal fs dynamic imports", async () => {
    const messages = await lintText(`
      const fsModule = await import(\`fs\`)
      void fsModule
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks computed dynamic import() specifiers", async () => {
    const messages = await lintText(`
      const mod = await import("f" + "s")
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks computed require() specifiers", async () => {
    const messages = await lintText(`
      const name = "fs"
      const mod = require(name)
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks aliasing module.require() for bypasses", async () => {
    const messages = await lintText(`
      const rq = module.require
      const mod = rq("fs")
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks aliasing the module object for require() bypasses", async () => {
    const messages = await lintText(`
      const m = module
      const mod = m.require("fs")
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks module['require']() bypasses", async () => {
    const messages = await lintText(`
      const mod = module["require"]("fs")
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks createRequire() bypasses", async () => {
    const messages = await lintText(`
      import { createRequire } from "node:module"
      const req = createRequire(import.meta.url)
      const mod = req("fs")
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks namespace createRequire() bypasses", async () => {
    const messages = await lintText(`
      import * as Module from "node:module"
      const req = Module.createRequire(import.meta.url)
      const mod = req("fs")
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("blocks wrapped require() call bypasses", async () => {
    const messages = await lintText(`
      const mod = (0, require)("fs")
      void mod
    `)

    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("allows node:fs imports", async () => {
    const messages = await lintText(`
      import { readFileSync } from "node:fs"
      void readFileSync
    `)

    const importPolicyErrors = messages.filter((m) =>
      ["no-restricted-imports", "no-restricted-modules", "no-restricted-syntax"].includes(m.ruleId ?? "")
    )

    expect(importPolicyErrors).toHaveLength(0)
  })

  it("keeps repo-root allowlist stable when lint cwd differs", async () => {
    const originalCwd = process.cwd()
    process.chdir(path.join(projectRoot, "apps", "agent-sdk"))
    try {
      const eslint = new ESLint({ cwd: projectRoot })
      const [result] = await eslint.lintText("export const x = 1\n", {
        filePath: path.join(projectRoot, "apps", "agent-sdk", "src", "utils.ts"),
      })
      const messages = result.messages.filter((m) => m.ruleId === "tx/no-generic-utility-file-names")
      expect(messages).toHaveLength(0)
    } finally {
      process.chdir(originalCwd)
    }
  })
})
