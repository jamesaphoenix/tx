import { afterEach, describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveWorkspaceContext } from "./workspace-context.js"

describe("resolveWorkspaceContext", () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ":memory:",
    "file::memory:?cache=shared",
  ])("preserves the SQLite virtual database path %s", (dbPath) => {
    const root = mkdtempSync(join(tmpdir(), "tx-workspace-context-"))
    roots.push(root)

    const context = resolveWorkspaceContext({
      cwd: root,
      stateRoot: root,
      contentRoot: root,
      dbPath,
    })

    expect(context.dbPath).toBe(dbPath)
    expect(context.resolvedDbPath).toBe(dbPath)
    expect(existsSync(join(root, dbPath))).toBe(false)
  })
})
