/**
 * Integration tests for Context Pins (`tx pin`).
 *
 * Tests cover:
 * - Pin CRUD (set, get, remove, list)
 * - File sync (write/update/remove <tx-pin> blocks in target files)
 * - Target file configuration
 * - Idempotent sync
 * - Path validation
 * - Edge cases
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { PinService } from "@jamesaphoenix/tx-core"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { rmSync } from "node:fs"

// Helper: create a temp directory WITHIN the project root (required by path validation)
const createTempDir = (): string => {
  const base = join(process.cwd(), ".tx", "pin-test")
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, "run-"))
}

describe("Context Pins Integration", () => {
  let shared: SharedTestLayerResult
  let tempDir: string

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    tempDir = createTempDir()
  })

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true }) } catch { /* ignore */ }
  })

  // ===========================================================================
  // 1. Pin CRUD
  // ===========================================================================

  describe("Pin CRUD", () => {
    it("set creates a new pin", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          // Configure targets to temp dir so sync doesn't touch real files
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          const pin = yield* svc.set("auth-patterns", "Use JWT tokens")
          return pin
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.id).toBe("auth-patterns")
      expect(result.content).toBe("Use JWT tokens")
      expect(result.createdAt).toBeTruthy()
      expect(result.updatedAt).toBeTruthy()
    })

    it("set upserts existing pin with new content", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          const v1 = yield* svc.set("auth-patterns", "Version 1")
          const v2 = yield* svc.set("auth-patterns", "Version 2")
          return { v1, v2 }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.v1.content).toBe("Version 1")
      expect(result.v2.content).toBe("Version 2")
      expect(result.v2.id).toBe("auth-patterns")
    })

    it("get returns pin by ID", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          yield* svc.set("test-pin", "Hello world")
          return yield* svc.get("test-pin")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).not.toBeNull()
      expect(result!.id).toBe("test-pin")
      expect(result!.content).toBe("Hello world")
    })

    it("get returns null for missing pin", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          return yield* svc.get("nonexistent")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBeNull()
    })

    it("remove deletes a pin", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          yield* svc.set("to-delete", "Temporary content")
          const deleted = yield* svc.remove("to-delete")
          const after = yield* svc.get("to-delete")
          return { deleted, after }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.deleted).toBe(true)
      expect(result.after).toBeNull()
    })

    it("remove returns false for missing pin", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          return yield* svc.remove("nonexistent")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBe(false)
    })

    it("list returns all pins", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          yield* svc.set("pin-a", "Content A")
          yield* svc.set("pin-b", "Content B")
          yield* svc.set("pin-c", "Content C")
          return yield* svc.list()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(3)
      const ids = result.map(p => p.id)
      expect(ids).toContain("pin-a")
      expect(ids).toContain("pin-b")
      expect(ids).toContain("pin-c")
    })
  })

  // ===========================================================================
  // 2. File Sync
  // ===========================================================================

  describe("File Sync", () => {
    it("sync writes pin blocks to target file", async () => {
      const targetFile = join(tempDir, "CLAUDE.md")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([targetFile])
          yield* svc.set("auth", "Use JWT tokens")
          yield* svc.set("api", "Use REST conventions")
        }).pipe(Effect.provide(shared.layer))
      )

      const content = readFileSync(targetFile, "utf-8")
      expect(content).toContain('<tx-pin id="auth">')
      expect(content).toContain("Use JWT tokens")
      expect(content).toContain("</tx-pin>")
      expect(content).toContain('<tx-pin id="api">')
      expect(content).toContain("Use REST conventions")
    })

    it("sync removes stale blocks after pin removal", async () => {
      const targetFile = join(tempDir, "CLAUDE.md")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([targetFile])
          yield* svc.set("temp-pin", "Will be removed")
          // Pin exists in file now
        }).pipe(Effect.provide(shared.layer))
      )

      let content = readFileSync(targetFile, "utf-8")
      expect(content).toContain('<tx-pin id="temp-pin">')

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.remove("temp-pin")
        }).pipe(Effect.provide(shared.layer))
      )

      content = readFileSync(targetFile, "utf-8")
      expect(content).not.toContain("tx-pin")
      expect(content).not.toContain("Will be removed")
    })

    it("sync is idempotent", async () => {
      const targetFile = join(tempDir, "CLAUDE.md")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([targetFile])
          yield* svc.set("stable-pin", "Stable content")
        }).pipe(Effect.provide(shared.layer))
      )

      const first = readFileSync(targetFile, "utf-8")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.sync()
        }).pipe(Effect.provide(shared.layer))
      )

      const second = readFileSync(targetFile, "utf-8")
      expect(second).toBe(first)
    })

    it("sync creates missing target file", async () => {
      const targetFile = join(tempDir, "subdir", "AGENTS.md")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([targetFile])
          yield* svc.set("new-file-pin", "Created via sync")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(existsSync(targetFile)).toBe(true)
      const content = readFileSync(targetFile, "utf-8")
      expect(content).toContain('<tx-pin id="new-file-pin">')
      expect(content).toContain("Created via sync")
    })

    it("sync preserves non-pin content in target file", async () => {
      const targetFile = join(tempDir, "CLAUDE.md")
      writeFileSync(targetFile, "# My Project\n\nSome manual documentation.\n\n## Other Notes\n\nKeep this.\n")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([targetFile])
          yield* svc.set("injected", "Injected content")
        }).pipe(Effect.provide(shared.layer))
      )

      const content = readFileSync(targetFile, "utf-8")
      expect(content).toContain("# My Project")
      expect(content).toContain("Some manual documentation.")
      expect(content).toContain("Keep this.")
      expect(content).toContain('<tx-pin id="injected">')
      expect(content).toContain("Injected content")
    })

    it("sync writes to multiple target files", async () => {
      const claude = join(tempDir, "CLAUDE.md")
      const agents = join(tempDir, "AGENTS.md")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([claude, agents])
          yield* svc.set("shared-pin", "Shared content")
        }).pipe(Effect.provide(shared.layer))
      )

      for (const file of [claude, agents]) {
        const content = readFileSync(file, "utf-8")
        expect(content).toContain('<tx-pin id="shared-pin">')
        expect(content).toContain("Shared content")
      }
    })
  })

  // ===========================================================================
  // 3. Target File Configuration
  // ===========================================================================

  describe("Target Configuration", () => {
    it("getTargetFiles returns configured targets after setTargetFiles", async () => {
      const target = join(tempDir, "CUSTOM.md")
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([target])
          return yield* svc.getTargetFiles()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toContain("CUSTOM.md")
    })

    it("setTargetFiles + getTargetFiles roundtrips", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([
            join(tempDir, "A.md"),
            join(tempDir, "B.md"),
          ])
          return yield* svc.getTargetFiles()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toContain("A.md")
      expect(result[1]).toContain("B.md")
    })

    it("setTargetFiles rejects empty array", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          return yield* svc.setTargetFiles([]).pipe(
            Effect.map(() => "should-not-reach"),
            Effect.catchAll((e) => Effect.succeed(`error: ${e._tag}`))
          )
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBe("error: ValidationError")
    })
  })

  // ===========================================================================
  // 4. Validation
  // ===========================================================================

  describe("Validation", () => {
    it("rejects invalid pin IDs", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          return yield* svc.set("INVALID_UPPERCASE", "content").pipe(
            Effect.map(() => "should-not-reach"),
            Effect.catchAll((e) => Effect.succeed(`error: ${e._tag}`))
          )
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBe("error: ValidationError")
    })

    it("rejects pin ID starting with hyphen", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          return yield* svc.set("-bad-start", "content").pipe(
            Effect.map(() => "should-not-reach"),
            Effect.catchAll((e) => Effect.succeed(`error: ${e._tag}`))
          )
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBe("error: ValidationError")
    })

    it("accepts valid kebab-case pin IDs", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([join(tempDir, "CLAUDE.md")])
          const pin = yield* svc.set("valid.kebab-case_id.01", "content")
          return pin
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.id).toBe("valid.kebab-case_id.01")
    })
  })

  // ===========================================================================
  // 5. Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    it("handles multiline pin content", async () => {
      const targetFile = join(tempDir, "CLAUDE.md")
      const multiline = [
        "## Authentication Rules",
        "",
        "- Always use JWT",
        "- Store in httpOnly cookies",
        "- Rotate refresh tokens",
      ].join("\n")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([targetFile])
          yield* svc.set("auth-rules", multiline)
        }).pipe(Effect.provide(shared.layer))
      )

      const content = readFileSync(targetFile, "utf-8")
      expect(content).toContain("## Authentication Rules")
      expect(content).toContain("- Always use JWT")
      expect(content).toContain("- Rotate refresh tokens")
    })

    it("handles updating a pin from multiline to single-line", async () => {
      const targetFile = join(tempDir, "CLAUDE.md")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          yield* svc.setTargetFiles([targetFile])
          yield* svc.set("evolving", "Line 1\nLine 2\nLine 3")
          yield* svc.set("evolving", "Single line")
        }).pipe(Effect.provide(shared.layer))
      )

      const content = readFileSync(targetFile, "utf-8")
      expect(content).toContain("Single line")
      expect(content).not.toContain("Line 1")
    })

    it("list returns empty array when no pins exist", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* PinService
          return yield* svc.list()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toEqual([])
    })
  })
})
