/**
 * Mock services unit tests.
 *
 * Tests all mock services for correct behavior:
 * - createMockAnthropic: call tracking, response fixtures, failure injection
 * - MockAstGrepService: findSymbols, getImports, empty results
 * - MockFileSystem: read/write cycle, exists, failure injection
 */

import { describe, it, expect } from "vitest"
import { Effect, Either } from "effect"
import {
  MockFileSystem,
  MockFileSystemServiceTag,
  MockFileSystemError
} from "./file-system.mock.js"
import { runEffect, runEffectEither, expectEffectFailure } from "../helpers/effect.js"

// =============================================================================
// MockFileSystem Tests
// =============================================================================

describe("MockFileSystem", () => {
  describe("read/write cycle", () => {
    it("writes and reads file content correctly", async () => {
      const mock = MockFileSystem()

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        yield* fs.writeFile("/tmp/test.txt", "Hello, World!")
        return yield* fs.readFile("/tmp/test.txt")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toBe("Hello, World!")
    })

    it("overwrites existing file content", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([["/tmp/existing.txt", "Original content"]])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        yield* fs.writeFile("/tmp/existing.txt", "New content")
        return yield* fs.readFile("/tmp/existing.txt")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toBe("New content")
    })

    it("reads initial files correctly", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([
          ["/app/config.json", '{"debug": true}'],
          ["/app/data.txt", "Hello World"]
        ])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        const config = yield* fs.readFile("/app/config.json")
        const data = yield* fs.readFile("/app/data.txt")
        return { config, data }
      })

      const result = await runEffect(effect, mock.layer)
      expect(result.config).toBe('{"debug": true}')
      expect(result.data).toBe("Hello World")
    })

    it("fails to read non-existent file", async () => {
      const mock = MockFileSystem()

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.readFile("/nonexistent.txt")
      })

      const error = await expectEffectFailure<MockFileSystemError>(effect as any, mock.layer as any)
      expect(error._tag).toBe("FileSystemError")
      expect(error.reason).toContain("ENOENT")
      expect(error.path).toBe("/nonexistent.txt")
    })
  })

  describe("exists", () => {
    it("returns true for existing file", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([["/app/exists.txt", "content"]])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.exists("/app/exists.txt")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toBe(true)
    })

    it("returns false for non-existent file", async () => {
      const mock = MockFileSystem()

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.exists("/app/missing.txt")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toBe(false)
    })

    it("returns true for existing directory", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([["/app/src/index.ts", "export {}"]])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.exists("/app/src")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toBe(true)
    })

    it("returns true after file is written", async () => {
      const mock = MockFileSystem()

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        const before = yield* fs.exists("/tmp/new.txt")
        yield* fs.writeFile("/tmp/new.txt", "content")
        const after = yield* fs.exists("/tmp/new.txt")
        return { before, after }
      })

      const result = await runEffect(effect, mock.layer)
      expect(result.before).toBe(false)
      expect(result.after).toBe(true)
    })
  })

  describe("mkdir", () => {
    it("creates directory", async () => {
      const mock = MockFileSystem()

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        yield* fs.mkdir("/app/new-dir")
        return yield* fs.exists("/app/new-dir")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toBe(true)
    })

    it("creates parent directories recursively", async () => {
      const mock = MockFileSystem()

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        yield* fs.mkdir("/app/deep/nested/dir")
        const deep = yield* fs.exists("/app/deep")
        const nested = yield* fs.exists("/app/deep/nested")
        const dir = yield* fs.exists("/app/deep/nested/dir")
        return { deep, nested, dir }
      })

      const result = await runEffect(effect, mock.layer)
      expect(result.deep).toBe(true)
      expect(result.nested).toBe(true)
      expect(result.dir).toBe(true)
    })
  })

  describe("readdir", () => {
    it("lists files in directory", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([
          ["/app/src/a.ts", ""],
          ["/app/src/b.ts", ""],
          ["/app/src/c.ts", ""]
        ])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.readdir("/app/src")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toContain("a.ts")
      expect(result).toContain("b.ts")
      expect(result).toContain("c.ts")
    })

    it("fails for non-existent directory", async () => {
      const mock = MockFileSystem()

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.readdir("/nonexistent")
      })

      const error = await expectEffectFailure<MockFileSystemError>(effect as any, mock.layer as any)
      expect(error._tag).toBe("FileSystemError")
      expect(error.reason).toContain("ENOENT")
    })
  })

  describe("call tracking", () => {
    it("tracks all file system calls", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([["/tmp/test.txt", "content"]])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        yield* fs.exists("/tmp/test.txt")
        yield* fs.readFile("/tmp/test.txt")
        yield* fs.writeFile("/tmp/new.txt", "new content")
        yield* fs.mkdir("/tmp/new-dir")
        return "done"
      })

      await runEffect(effect, mock.layer)

      expect(mock.existsCalls).toEqual(["/tmp/test.txt"])
      expect(mock.readFileCalls).toEqual(["/tmp/test.txt"])
      expect(mock.writeFileCalls).toEqual([{ path: "/tmp/new.txt", content: "new content" }])
      expect(mock.mkdirCalls).toEqual(["/tmp/new-dir"])
      expect(mock.getCallCount()).toBe(4)
    })

    it("getFiles returns current file state", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([["/initial.txt", "initial"]])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        yield* fs.writeFile("/new.txt", "new")
        return "done"
      })

      await runEffect(effect, mock.layer)

      const files = mock.getFiles()
      expect(files.get("/initial.txt")).toBe("initial")
      expect(files.get("/new.txt")).toBe("new")
    })

    it("reset restores initial state", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([["/initial.txt", "initial"]])
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        yield* fs.writeFile("/new.txt", "new")
        yield* fs.writeFile("/initial.txt", "modified")
        return "done"
      })

      await runEffect(effect, mock.layer)

      expect(mock.getFiles().get("/initial.txt")).toBe("modified")
      expect(mock.getFiles().has("/new.txt")).toBe(true)

      mock.reset()

      expect(mock.getFiles().get("/initial.txt")).toBe("initial")
      expect(mock.getFiles().has("/new.txt")).toBe(false)
      expect(mock.getCallCount()).toBe(0)
    })
  })

  describe("failure injection", () => {
    it("fails all operations when shouldFail is true", async () => {
      const mock = MockFileSystem({
        shouldFail: true,
        failureMessage: "Disk full"
      })

      const effect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.readFile("/any.txt")
      })

      const error = await expectEffectFailure<MockFileSystemError>(effect as any, mock.layer as any)
      expect(error._tag).toBe("FileSystemError")
      expect(error.reason).toBe("Disk full")
    })

    it("fails specific operations via failuresByOperation", async () => {
      const mock = MockFileSystem({
        failuresByOperation: new Map([["writeFile", "Read-only file system"]])
      })

      // writeFile should fail
      const writeEffect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.writeFile("/test.txt", "content")
      })

      const writeResult = await runEffectEither(writeEffect, mock.layer)
      expect(Either.isLeft(writeResult)).toBe(true)

      // readFile should succeed (after we have a file)
      const mock2 = MockFileSystem({
        initialFiles: new Map([["/test.txt", "content"]]),
        failuresByOperation: new Map([["writeFile", "Read-only file system"]])
      })

      const readEffect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.readFile("/test.txt")
      })

      const readResult = await runEffectEither(readEffect, mock2.layer)
      expect(Either.isRight(readResult)).toBe(true)
    })

    it("fails on specific paths via failuresByPath", async () => {
      const mock = MockFileSystem({
        initialFiles: new Map([
          ["/allowed.txt", "content"],
          ["/protected/secret.txt", "secret"]
        ]),
        failuresByPath: new Map([["/protected/secret.txt", "Permission denied"]])
      })

      // Reading allowed file should succeed
      const allowedEffect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.readFile("/allowed.txt")
      })

      const allowedResult = await runEffect(allowedEffect, mock.layer)
      expect(allowedResult).toBe("content")

      // Reading protected file should fail
      const protectedEffect = Effect.gen(function* () {
        const fs = yield* MockFileSystemServiceTag
        return yield* fs.readFile("/protected/secret.txt")
      })

      const error = await expectEffectFailure<MockFileSystemError>(protectedEffect as any, mock.layer as any)
      expect(error.reason).toBe("Permission denied")
      expect(error.path).toBe("/protected/secret.txt")
    })
  })
})
