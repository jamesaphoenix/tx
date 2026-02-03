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
  createMockAnthropic,
  createMockAnthropicForExtraction,
  type MockAnthropicCall,
  type MockAnthropicResponse
} from "./anthropic.mock.js"
import {
  MockAstGrepService,
  MockAstGrepServiceTag,
  MockAstGrepError,
  type MockSymbolInfo,
  type MockImportInfo
} from "./ast-grep.mock.js"
import {
  MockFileSystem,
  MockFileSystemServiceTag,
  MockFileSystemError
} from "./file-system.mock.js"
import { runEffect, runEffectEither, expectEffectFailure } from "../helpers/effect.js"

// =============================================================================
// createMockAnthropic Tests
// =============================================================================

describe("createMockAnthropic", () => {
  describe("call tracking", () => {
    it("records all calls", async () => {
      const mock = createMockAnthropic()

      await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        max_tokens: 256,
        messages: [{ role: "user", content: "Hello" }]
      })

      await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        max_tokens: 512,
        messages: [{ role: "user", content: "World" }]
      })

      expect(mock.calls).toHaveLength(2)
      expect(mock.getCallCount()).toBe(2)
    })

    it("stores call parameters correctly", async () => {
      const mock = createMockAnthropic()

      await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        max_tokens: 256,
        messages: [
          { role: "user", content: "First message" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Second message" }
        ]
      })

      expect(mock.calls[0]).toEqual({
        model: "claude-haiku-4-20250514",
        max_tokens: 256,
        messages: [
          { role: "user", content: "First message" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Second message" }
        ]
      })
    })

    it("getLastCall returns the most recent call", async () => {
      const mock = createMockAnthropic()

      await mock.client.messages.create({
        model: "model-a",
        messages: [{ role: "user", content: "First" }]
      })

      await mock.client.messages.create({
        model: "model-b",
        messages: [{ role: "user", content: "Second" }]
      })

      const lastCall = mock.getLastCall()
      expect(lastCall?.model).toBe("model-b")
      expect(lastCall?.messages[0].content).toBe("Second")
    })

    it("getLastCall returns undefined when no calls made", () => {
      const mock = createMockAnthropic()
      expect(mock.getLastCall()).toBeUndefined()
    })

    it("reset clears all tracked calls", async () => {
      const mock = createMockAnthropic()

      await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        messages: [{ role: "user", content: "Hello" }]
      })

      expect(mock.calls).toHaveLength(1)
      mock.reset()
      expect(mock.calls).toHaveLength(0)
      expect(mock.getCallCount()).toBe(0)
    })
  })

  describe("response fixtures", () => {
    it("returns default minimal response when no config", async () => {
      const mock = createMockAnthropic()

      const response = await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        messages: [{ role: "user", content: "Hello" }]
      })

      expect(response.id).toBe("mock-msg-id")
      expect(response.type).toBe("message")
      expect(response.role).toBe("assistant")
      expect(response.model).toBe("claude-haiku-4-20250514")
      expect(response.content).toHaveLength(1)
      expect(response.content[0].type).toBe("text")
    })

    it("returns configured defaultResponse", async () => {
      const customResponse: MockAnthropicResponse = {
        id: "custom-id",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Custom response text" }],
        model: "claude-haiku-4-20250514",
        usage: { input_tokens: 100, output_tokens: 50 }
      }

      const mock = createMockAnthropic({ defaultResponse: customResponse })

      const response = await mock.client.messages.create({
        model: "any-model",
        messages: [{ role: "user", content: "Anything" }]
      })

      expect(response).toEqual(customResponse)
    })

    it("returns specific response for matching messages", async () => {
      const specificResponse: MockAnthropicResponse = {
        id: "specific-id",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Specific answer" }],
        model: "claude-haiku-4-20250514"
      }

      const messages = [{ role: "user", content: "Specific question" }]
      const responses = new Map<string, MockAnthropicResponse>([
        [JSON.stringify(messages), specificResponse]
      ])

      const mock = createMockAnthropic({ responses })

      const response = await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        messages: messages as MockAnthropicCall["messages"]
      })

      expect(response.id).toBe("specific-id")
      expect(response.content[0].text).toBe("Specific answer")
    })

    it("falls back to defaultResponse when specific response not found", async () => {
      const defaultResponse: MockAnthropicResponse = {
        id: "default-id",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Default" }],
        model: "claude-haiku-4-20250514"
      }

      const responses = new Map<string, MockAnthropicResponse>([
        [JSON.stringify([{ role: "user", content: "Match" }]), {
          id: "match-id",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Matched" }],
          model: "claude-haiku-4-20250514"
        }]
      ])

      const mock = createMockAnthropic({ responses, defaultResponse })

      const response = await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        messages: [{ role: "user", content: "No match" }]
      })

      expect(response.id).toBe("default-id")
    })
  })

  describe("failure injection", () => {
    it("throws error when shouldFail is true", async () => {
      const mock = createMockAnthropic({ shouldFail: true })

      await expect(
        mock.client.messages.create({
          model: "claude-haiku-4-20250514",
          messages: [{ role: "user", content: "Hello" }]
        })
      ).rejects.toThrow("Mock Anthropic API error")
    })

    it("throws custom failureMessage", async () => {
      const mock = createMockAnthropic({
        shouldFail: true,
        failureMessage: "Rate limit exceeded"
      })

      await expect(
        mock.client.messages.create({
          model: "claude-haiku-4-20250514",
          messages: [{ role: "user", content: "Hello" }]
        })
      ).rejects.toThrow("Rate limit exceeded")
    })

    it("throws custom failureError", async () => {
      const customError = new Error("Custom error object")
      const mock = createMockAnthropic({
        shouldFail: true,
        failureError: customError
      })

      await expect(
        mock.client.messages.create({
          model: "claude-haiku-4-20250514",
          messages: [{ role: "user", content: "Hello" }]
        })
      ).rejects.toBe(customError)
    })

    it("failureError takes precedence over failureMessage", async () => {
      const customError = new Error("Custom error wins")
      const mock = createMockAnthropic({
        shouldFail: true,
        failureMessage: "This should not be used",
        failureError: customError
      })

      await expect(
        mock.client.messages.create({
          model: "claude-haiku-4-20250514",
          messages: [{ role: "user", content: "Hello" }]
        })
      ).rejects.toBe(customError)
    })

    it("still tracks calls when failing", async () => {
      const mock = createMockAnthropic({ shouldFail: true })

      try {
        await mock.client.messages.create({
          model: "claude-haiku-4-20250514",
          messages: [{ role: "user", content: "Hello" }]
        })
      } catch {
        // Expected
      }

      expect(mock.calls).toHaveLength(1)
    })
  })

  describe("latency simulation", () => {
    it("delays response by configured latencyMs", async () => {
      const mock = createMockAnthropic({ latencyMs: 100 })

      const start = Date.now()
      await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        messages: [{ role: "user", content: "Hello" }]
      })
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(95) // Allow small timing variance
    })
  })

  describe("createMockAnthropicForExtraction", () => {
    it("returns candidates as JSON text in response", async () => {
      const candidates = [
        { content: "Always use transactions", confidence: "high", category: "patterns" },
        { content: "Test database migrations", confidence: "medium", category: "testing" }
      ]

      const mock = createMockAnthropicForExtraction(candidates)

      const response = await mock.client.messages.create({
        model: "claude-haiku-4-20250514",
        messages: [{ role: "user", content: "Extract learnings" }]
      })

      expect(response.content[0].text).toBe(JSON.stringify(candidates))
      expect(JSON.parse(response.content[0].text!)).toEqual(candidates)
    })
  })
})

// =============================================================================
// MockAstGrepService Tests
// =============================================================================

describe("MockAstGrepService", () => {
  describe("findSymbols", () => {
    it("returns fixture data for configured file path", async () => {
      const symbols: MockSymbolInfo[] = [
        { name: "main", kind: "function", line: 1, exported: true },
        { name: "Helper", kind: "class", line: 10, exported: false }
      ]

      const mock = MockAstGrepService({
        symbols: new Map([["src/index.ts", symbols]])
      })

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.findSymbols("src/index.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual(symbols)
      expect(mock.findSymbolsCalls).toContain("src/index.ts")
    })

    it("returns empty array when no fixtures configured", async () => {
      const mock = MockAstGrepService()

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.findSymbols("src/unknown.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual([])
    })

    it("returns defaultSymbols for unconfigured paths", async () => {
      const defaultSymbols: MockSymbolInfo[] = [
        { name: "default", kind: "function", line: 1, exported: true }
      ]

      const mock = MockAstGrepService({ defaultSymbols })

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.findSymbols("any/path.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual(defaultSymbols)
    })
  })

  describe("getImports", () => {
    it("returns fixture data for configured file path", async () => {
      const imports: MockImportInfo[] = [
        { source: "effect", specifiers: ["Effect", "Layer"], kind: "static" },
        { source: "./utils", specifiers: ["helper"], kind: "static" }
      ]

      const mock = MockAstGrepService({
        imports: new Map([["src/index.ts", imports]])
      })

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.getImports("src/index.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual(imports)
      expect(mock.getImportsCalls).toContain("src/index.ts")
    })

    it("returns empty array when no fixtures configured", async () => {
      const mock = MockAstGrepService()

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.getImports("src/unknown.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual([])
    })

    it("returns defaultImports for unconfigured paths", async () => {
      const defaultImports: MockImportInfo[] = [
        { source: "default-module", specifiers: ["*"], kind: "static" }
      ]

      const mock = MockAstGrepService({ defaultImports })

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.getImports("any/path.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual(defaultImports)
    })
  })

  describe("matchPattern", () => {
    it("returns matches for specific pattern+path key", async () => {
      const matches = [
        { file: "src/index.ts", line: 5, column: 1, text: "export function", captures: {} }
      ]

      const mock = MockAstGrepService({
        matches: new Map([["export $NAME::src/index.ts", matches]])
      })

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.matchPattern("export $NAME", "src/index.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual(matches)
      expect(mock.matchPatternCalls).toContainEqual({
        pattern: "export $NAME",
        path: "src/index.ts"
      })
    })

    it("returns matches for pattern-only key", async () => {
      const matches = [
        { file: "any.ts", line: 1, column: 1, text: "function foo", captures: { NAME: "foo" } }
      ]

      const mock = MockAstGrepService({
        matches: new Map([["function $NAME", matches]])
      })

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.matchPattern("function $NAME", "src/any.ts")
      })

      const result = await runEffect(effect, mock.layer)
      expect(result).toEqual(matches)
    })
  })

  describe("call tracking", () => {
    it("tracks all calls made", async () => {
      const mock = MockAstGrepService()

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        yield* astGrep.findSymbols("file1.ts")
        yield* astGrep.getImports("file2.ts")
        yield* astGrep.matchPattern("pattern", "file3.ts")
        return "done"
      })

      await runEffect(effect, mock.layer)

      expect(mock.findSymbolsCalls).toEqual(["file1.ts"])
      expect(mock.getImportsCalls).toEqual(["file2.ts"])
      expect(mock.matchPatternCalls).toEqual([{ pattern: "pattern", path: "file3.ts" }])
      expect(mock.getCallCount()).toBe(3)
    })

    it("reset clears all tracked calls", async () => {
      const mock = MockAstGrepService()

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        yield* astGrep.findSymbols("file.ts")
        return "done"
      })

      await runEffect(effect, mock.layer)
      expect(mock.getCallCount()).toBe(1)

      mock.reset()
      expect(mock.findSymbolsCalls).toHaveLength(0)
      expect(mock.getCallCount()).toBe(0)
    })
  })

  describe("failure injection", () => {
    it("fails all operations when shouldFail is true", async () => {
      const mock = MockAstGrepService({
        shouldFail: true,
        failureMessage: "ast-grep not installed"
      })

      const effect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.findSymbols("file.ts")
      })

      const error = await expectEffectFailure<MockAstGrepError>(effect as any, mock.layer as any)
      expect(error._tag).toBe("AstGrepError")
      expect(error.reason).toBe("ast-grep not installed")
    })

    it("fails specific operations via failuresByOperation", async () => {
      const mock = MockAstGrepService({
        failuresByOperation: new Map([["findSymbols", "Parse error"]])
      })

      // findSymbols should fail
      const findSymbolsEffect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.findSymbols("file.ts")
      })

      const findSymbolsResult = await runEffectEither(findSymbolsEffect, mock.layer)
      expect(Either.isLeft(findSymbolsResult)).toBe(true)

      // getImports should succeed
      const getImportsEffect = Effect.gen(function* () {
        const astGrep = yield* MockAstGrepServiceTag
        return yield* astGrep.getImports("file.ts")
      })

      const getImportsResult = await runEffectEither(getImportsEffect, mock.layer)
      expect(Either.isRight(getImportsResult)).toBe(true)
    })
  })
})

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
