import { describe, expect, it } from "vitest"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const cli = resolve("apps/cli/src/cli.ts")

describe("task namespace", () => {
  it("rejects old syntax before opening a database [INV-LEAN-001] [INV-REQ-LEAN-001]", () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-old-task-"))
    try {
      const result = spawnSync("bun", [cli, "add", "Must not exist", "--json"], { cwd, encoding: "utf8" })
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain("tx task add")
      expect(existsSync(join(cwd, ".tx/tasks.db"))).toBe(false)
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })

  it("exposes nested task help without creating state [INV-LEAN-001] [INV-REQ-LEAN-001]", () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-task-help-"))
    try {
      const result = spawnSync("bun", [cli, "task", "dep", "--help"], { cwd, encoding: "utf8" })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx task dep block")
      expect(existsSync(join(cwd, ".tx/tasks.db"))).toBe(false)
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })
})
