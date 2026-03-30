import { describe, it, expect } from "vitest"
import { resolve } from "node:path"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  normalizePathSeparators,
  toNormalizedRelativePath,
  resolvePathForComparison,
  isPathWithin,
  resolvePathWithin,
  findTxRoot,
  resolveTxDbPath,
} from "@jamesaphoenix/tx-core"

describe("file-path utils", () => {
  it("normalizes path separators", () => {
    expect(normalizePathSeparators("foo\\bar\\baz.ts")).toBe("foo/bar/baz.ts")
  })

  it("normalizes absolute path to root-relative path", () => {
    const root = resolve(process.cwd(), "tmp")
    const file = resolve(root, "nested", "file.ts")
    expect(toNormalizedRelativePath(root, file)).toBe("nested/file.ts")
  })

  it("normalizes separators for relative inputs", () => {
    expect(toNormalizedRelativePath(process.cwd(), "foo\\bar.ts")).toBe("foo/bar.ts")
  })

  it("resolvePathForComparison falls back when target does not exist", () => {
    const missing = resolve(process.cwd(), ".tx", "runs", "missing.log")
    expect(resolvePathForComparison(missing)).toBe(missing)
  })

  it("checks path containment with optional base-dir handling", () => {
    const base = resolve(process.cwd(), ".tx", "runs")
    const child = resolve(base, "run-123", "stdout.log")
    const sibling = resolve(process.cwd(), ".tx", "tasks.db")

    expect(isPathWithin(base, child)).toBe(true)
    expect(isPathWithin(base, base)).toBe(true)
    expect(isPathWithin(base, base, { allowBaseDir: false })).toBe(false)
    expect(isPathWithin(base, sibling)).toBe(false)
  })

  it("resolves and rejects escaped paths", () => {
    const base = resolve(process.cwd(), ".tx", "runs")
    const child = resolvePathWithin(base, "run-abc/stderr.log")
    const escaped = resolvePathWithin(base, "../tasks.db")

    expect(child).toBe(resolve(base, "run-abc/stderr.log"))
    expect(escaped).toBeNull()
  })

  it("rejects symlink escapes when realpath checks are enabled", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-path-utils-"))

    try {
      const projectRoot = resolve(tempRoot, "project")
      const outsideRoot = resolve(tempRoot, "outside")
      mkdirSync(projectRoot, { recursive: true })
      mkdirSync(outsideRoot, { recursive: true })

      const linkDir = resolve(projectRoot, "linkout")
      symlinkSync(outsideRoot, linkDir, "dir")

      const leaked = resolve(linkDir, "secrets.txt")
      expect(isPathWithin(projectRoot, leaked, { useRealpath: true })).toBe(false)
      expect(resolvePathWithin(projectRoot, "linkout/secrets.txt", { useRealpath: true })).toBeNull()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})

describe("findTxRoot", () => {
  it("finds .git in the same directory", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-root-same-"))
    try {
      mkdirSync(resolve(tempRoot, ".git"), { recursive: true })
      expect(findTxRoot(tempRoot)).toBe(tempRoot)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("finds .git in a parent directory", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-root-parent-"))
    try {
      mkdirSync(resolve(tempRoot, ".git"), { recursive: true })
      const subdir = resolve(tempRoot, "apps", "api")
      mkdirSync(subdir, { recursive: true })
      expect(findTxRoot(subdir)).toBe(tempRoot)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("finds .git in a grandparent directory", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-root-grand-"))
    try {
      mkdirSync(resolve(tempRoot, ".git"), { recursive: true })
      const deep = resolve(tempRoot, "apps", "api", "src", "routes")
      mkdirSync(deep, { recursive: true })
      expect(findTxRoot(deep)).toBe(tempRoot)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("ignores stale .tx in subdirs and finds .git at root", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-root-stale-"))
    try {
      // Root has .git and .tx (the real project root)
      mkdirSync(resolve(tempRoot, ".git"), { recursive: true })
      mkdirSync(resolve(tempRoot, ".tx"), { recursive: true })
      // Nested app has a stale .tx (the bug we're fixing)
      const nestedApp = resolve(tempRoot, "apps", "api")
      mkdirSync(resolve(nestedApp, ".tx"), { recursive: true })
      // Deeper subdir
      const subdir = resolve(nestedApp, "src")
      mkdirSync(subdir, { recursive: true })

      // From subdir, should find root (where .git is), NOT nestedApp
      expect(findTxRoot(subdir)).toBe(tempRoot)
      // From nestedApp, should also find root
      expect(findTxRoot(nestedApp)).toBe(tempRoot)
      // From apps/, should also find root
      expect(findTxRoot(resolve(tempRoot, "apps"))).toBe(tempRoot)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("falls back to startDir when no .git exists anywhere", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-root-none-"))
    try {
      const subdir = resolve(tempRoot, "some", "deep", "path")
      mkdirSync(subdir, { recursive: true })
      expect(findTxRoot(subdir)).toBe(subdir)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("does not create .tx directory as a side effect", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-root-noside-"))
    try {
      mkdirSync(resolve(tempRoot, ".git"), { recursive: true })
      mkdirSync(resolve(tempRoot, ".tx"), { recursive: true })
      const subdir = resolve(tempRoot, "apps", "api")
      mkdirSync(subdir, { recursive: true })

      findTxRoot(subdir)

      // .tx should NOT have been created in the subdir
      const { existsSync: exists } = require("node:fs")
      expect(exists(resolve(subdir, ".tx"))).toBe(false)
      // Only the root .tx should exist
      expect(exists(resolve(tempRoot, ".tx"))).toBe(true)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})

describe("resolveTxDbPath", () => {
  it("returns .tx/tasks.db relative to git root", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-db-path-"))
    try {
      mkdirSync(resolve(tempRoot, ".git"), { recursive: true })
      const subdir = resolve(tempRoot, "apps", "api")
      mkdirSync(subdir, { recursive: true })

      expect(resolveTxDbPath(subdir)).toBe(resolve(tempRoot, ".tx", "tasks.db"))
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("falls back to startDir/.tx/tasks.db when no .git exists", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-db-fallback-"))
    try {
      const subdir = resolve(tempRoot, "project")
      mkdirSync(subdir, { recursive: true })

      expect(resolveTxDbPath(subdir)).toBe(resolve(subdir, ".tx", "tasks.db"))
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("simulates monorepo: subdir command resolves to root db", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "tx-monorepo-"))
    try {
      // Simulate: octospark/ is a git repo with .tx
      mkdirSync(resolve(tempRoot, ".git"), { recursive: true })
      mkdirSync(resolve(tempRoot, ".tx"), { recursive: true })
      writeFileSync(resolve(tempRoot, ".tx", "tasks.db"), "")

      // Simulate: stale .tx in apps/api/ (the bug)
      const apiDir = resolve(tempRoot, "apps", "api")
      mkdirSync(resolve(apiDir, ".tx"), { recursive: true })

      const dbPath = resolveTxDbPath(apiDir)
      // Should resolve to root, NOT the stale subdir .tx
      expect(dbPath).toBe(resolve(tempRoot, ".tx", "tasks.db"))
      expect(dbPath).not.toBe(resolve(apiDir, ".tx", "tasks.db"))
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
