import { describe, it, expect } from "vitest"
import { resolve } from "node:path"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  normalizePathSeparators,
  toNormalizedRelativePath,
  resolvePathForComparison,
  isPathWithin,
  resolvePathWithin,
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
