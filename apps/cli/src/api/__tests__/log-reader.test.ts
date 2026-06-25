/**
 * Log Reader Tests
 *
 * Tests path traversal protection in isAllowedRunPath.
 * Verifies prefix match (startsWith) instead of substring match (includes).
 */

import { describe, it, expect } from "vitest"
import { resolve } from "node:path"
import { isAllowedRunPath } from "../utils/log-reader.js"

const cwd = process.cwd()
const runsDir = resolve(cwd, ".tx", "runs")

describe("isAllowedRunPath", () => {
  describe("accepts valid paths under .tx/runs/", () => {
    it("should accept a file directly under .tx/runs/", () => {
      expect(isAllowedRunPath(`${runsDir}/stdout.log`)).toBe(true)
    })

    it("should accept a file in a run subdirectory", () => {
      expect(isAllowedRunPath(`${runsDir}/run-abc12345/stdout.log`)).toBe(true)
    })

    it("should accept a nested file under .tx/runs/", () => {
      expect(isAllowedRunPath(`${runsDir}/run-abc12345/logs/stderr.log`)).toBe(true)
    })
  })

  describe("rejects paths outside .tx/runs/", () => {
    it("should reject an absolute path outside the project", () => {
      expect(isAllowedRunPath("/etc/passwd")).toBe(false)
    })

    it("should reject a path under .tx/ but not .tx/runs/", () => {
      expect(isAllowedRunPath(resolve(cwd, ".tx", "tasks.db"))).toBe(false)
    })

    it("should reject the runs directory itself (no trailing file)", () => {
      // runsDir alone should not match — startsWith(runsDir + sep) requires a child
      expect(isAllowedRunPath(runsDir)).toBe(false)
    })
  })

  describe("rejects substring bypass attacks", () => {
    it("should reject a path from a different project containing /.tx/runs/", () => {
      // This is the key attack vector: a different project's .tx/runs/ passes
      // an includes() check but fails a startsWith() check
      expect(isAllowedRunPath("/other/project/.tx/runs/evil.log")).toBe(false)
    })

    it("should reject a crafted path with .tx/runs/ as a non-prefix substring", () => {
      expect(isAllowedRunPath("/evil/.tx/runs/payload")).toBe(false)
    })

    it("should reject a path with .. that resolves outside .tx/runs/", () => {
      // resolve() normalizes the .., so this becomes cwd/.tx/tasks.db
      expect(isAllowedRunPath(`${runsDir}/../tasks.db`)).toBe(false)
    })

    it("should reject a directory name that starts with 'runs' but is different", () => {
      // e.g., .tx/runs-evil/ should not match .tx/runs/
      expect(isAllowedRunPath(resolve(cwd, ".tx", "runs-evil", "file.log"))).toBe(false)
    })
  })
})
