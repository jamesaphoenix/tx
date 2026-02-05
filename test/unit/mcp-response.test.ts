/**
 * MCP Response Module Unit Tests
 *
 * Tests safeStringify and response formatters, including circular reference handling.
 */
import { describe, it, expect, vi } from "vitest"
import { safeStringify, mcpResponse, mcpError, classifyError, extractErrorMessage, buildStructuredError, handleToolError, formatErrorWithStack } from "../../apps/mcp-server/src/response.js"
import { Data } from "effect"

// -----------------------------------------------------------------------------
// safeStringify Tests
// -----------------------------------------------------------------------------

describe("safeStringify", () => {
  it("stringifies primitive values correctly", () => {
    expect(safeStringify("hello")).toBe('"hello"')
    expect(safeStringify(42)).toBe("42")
    expect(safeStringify(true)).toBe("true")
    expect(safeStringify(false)).toBe("false")
    expect(safeStringify(null)).toBe("null")
  })

  it("stringifies arrays correctly", () => {
    expect(safeStringify([1, 2, 3])).toBe("[1,2,3]")
    expect(safeStringify(["a", "b"])).toBe('["a","b"]')
    expect(safeStringify([])).toBe("[]")
  })

  it("stringifies objects correctly", () => {
    expect(safeStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}')
    expect(safeStringify({})).toBe("{}")
  })

  it("stringifies nested objects correctly", () => {
    const nested = {
      level1: {
        level2: {
          level3: "deep"
        }
      }
    }
    const result = safeStringify(nested)
    expect(JSON.parse(result)).toEqual(nested)
  })

  it("handles circular references in objects", () => {
    const obj: Record<string, unknown> = { name: "test" }
    obj.self = obj // circular reference

    const result = safeStringify(obj)
    expect(() => JSON.parse(result)).not.toThrow()

    const parsed = JSON.parse(result)
    expect(parsed.name).toBe("test")
    expect(parsed.self).toBe("[Circular]")
  })

  it("handles circular references in arrays", () => {
    const arr: unknown[] = [1, 2, 3]
    arr.push(arr) // circular reference

    const result = safeStringify(arr)
    expect(() => JSON.parse(result)).not.toThrow()

    const parsed = JSON.parse(result)
    expect(parsed[0]).toBe(1)
    expect(parsed[1]).toBe(2)
    expect(parsed[2]).toBe(3)
    expect(parsed[3]).toBe("[Circular]")
  })

  it("handles deep circular references", () => {
    const obj: Record<string, unknown> = {
      level1: {
        level2: {
          level3: {}
        }
      }
    }
    // Create circular reference at deep level
    const level2 = (obj.level1 as Record<string, unknown>).level2 as Record<string, unknown>
    level2.level3 = obj

    const result = safeStringify(obj)
    expect(() => JSON.parse(result)).not.toThrow()

    const parsed = JSON.parse(result)
    expect(parsed.level1.level2.level3).toBe("[Circular]")
  })

  it("handles multiple references to same object (not circular)", () => {
    const shared = { value: 42 }
    const obj = {
      first: shared,
      second: shared
    }

    // Note: This will mark the second reference as [Circular] because WeakSet
    // tracks seen objects. This is a known limitation of the simple approach,
    // but it's safe and prevents the JSON.stringify error.
    const result = safeStringify(obj)
    expect(() => JSON.parse(result)).not.toThrow()

    const parsed = JSON.parse(result)
    expect(parsed.first.value).toBe(42)
    // Second reference is marked as circular since we've seen it
    expect(parsed.second).toBe("[Circular]")
  })

  it("handles objects with undefined values", () => {
    const obj = { a: 1, b: undefined, c: 3 }
    const result = safeStringify(obj)
    const parsed = JSON.parse(result)

    // undefined values are omitted by JSON.stringify
    expect(parsed).toEqual({ a: 1, c: 3 })
  })

  it("handles Date objects", () => {
    const date = new Date("2026-01-15T10:00:00.000Z")
    const result = safeStringify({ date })
    const parsed = JSON.parse(result)

    expect(parsed.date).toBe("2026-01-15T10:00:00.000Z")
  })

  it("handles complex nested structure with circular reference", () => {
    interface Node {
      id: number
      children: Node[]
      parent?: Node
    }

    const parent: Node = { id: 1, children: [] }
    const child1: Node = { id: 2, children: [], parent }
    const child2: Node = { id: 3, children: [], parent }
    parent.children.push(child1, child2)

    const result = safeStringify(parent)
    expect(() => JSON.parse(result)).not.toThrow()

    const parsed = JSON.parse(result)
    expect(parsed.id).toBe(1)
    expect(parsed.children).toHaveLength(2)
    expect(parsed.children[0].id).toBe(2)
    expect(parsed.children[0].parent).toBe("[Circular]")
  })
})

// -----------------------------------------------------------------------------
// mcpResponse Tests
// -----------------------------------------------------------------------------

describe("mcpResponse", () => {
  it("returns correct structure with text and data", () => {
    const result = mcpResponse("Task created", { id: "tx-12345678" })

    expect(result.content).toHaveLength(2)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Task created")
    expect(result.content[1].type).toBe("text")
    expect(result.content[1].text).toBe('{"id":"tx-12345678"}')
  })

  it("does not include isError for success responses", () => {
    const result = mcpResponse("Success", {})
    expect(result.isError).toBeUndefined()
  })

  it("handles circular references in data", () => {
    const data: Record<string, unknown> = { name: "test" }
    data.self = data

    const result = mcpResponse("Result", data)

    expect(result.content).toHaveLength(2)
    expect(() => JSON.parse(result.content[1].text)).not.toThrow()

    const parsed = JSON.parse(result.content[1].text)
    expect(parsed.name).toBe("test")
    expect(parsed.self).toBe("[Circular]")
  })

  it("handles arrays with circular references", () => {
    const arr: unknown[] = ["item1", "item2"]
    arr.push(arr)

    const result = mcpResponse("Array result", arr)

    expect(() => JSON.parse(result.content[1].text)).not.toThrow()
    const parsed = JSON.parse(result.content[1].text)
    expect(parsed[0]).toBe("item1")
    expect(parsed[1]).toBe("item2")
    expect(parsed[2]).toBe("[Circular]")
  })

  it("handles complex task-like structures", () => {
    const task = {
      id: "tx-12345678",
      title: "Test task",
      blockedBy: [],
      blocks: [],
      children: [],
      isReady: true
    }

    const result = mcpResponse("Task found", task)

    expect(() => JSON.parse(result.content[1].text)).not.toThrow()
    const parsed = JSON.parse(result.content[1].text)
    expect(parsed.id).toBe("tx-12345678")
    expect(parsed.isReady).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// mcpError Tests
// -----------------------------------------------------------------------------

describe("mcpError", () => {
  it("formats Error instances correctly", () => {
    const error = new Error("Something went wrong")
    const result = mcpError(error)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Error: Something went wrong")
    expect(result.isError).toBe(true)
  })

  it("formats string errors correctly", () => {
    const result = mcpError("String error message")

    expect(result.content[0].text).toBe("Error: String error message")
    expect(result.isError).toBe(true)
  })

  it("formats number errors correctly", () => {
    const result = mcpError(404)

    expect(result.content[0].text).toBe("Error: 404")
    expect(result.isError).toBe(true)
  })

  it("formats object errors correctly", () => {
    const result = mcpError({ code: "NOT_FOUND" })

    expect(result.content[0].text).toBe("Error: [object Object]")
    expect(result.isError).toBe(true)
  })

  it("formats null error correctly", () => {
    const result = mcpError(null)

    expect(result.content[0].text).toBe("Error: null")
    expect(result.isError).toBe(true)
  })

  it("formats undefined error correctly", () => {
    const result = mcpError(undefined)

    expect(result.content[0].text).toBe("Error: undefined")
    expect(result.isError).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// classifyError Tests
// -----------------------------------------------------------------------------

describe("classifyError", () => {
  it("extracts _tag from Effect-TS tagged errors", () => {
    class TestTaggedError extends Data.TaggedError("TestTaggedError")<{
      readonly reason: string
    }> {}

    const error = new TestTaggedError({ reason: "test" })
    expect(classifyError(error)).toBe("TestTaggedError")
  })

  it("uses constructor name for standard Error subclasses", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message)
        this.name = "CustomError"
      }
    }

    expect(classifyError(new CustomError("test"))).toBe("CustomError")
  })

  it("returns 'Error' for plain Error instances", () => {
    expect(classifyError(new Error("test"))).toBe("Error")
  })

  it("returns 'UnknownError' for non-Error values", () => {
    expect(classifyError("a string")).toBe("UnknownError")
    expect(classifyError(42)).toBe("UnknownError")
    expect(classifyError(null)).toBe("UnknownError")
    expect(classifyError(undefined)).toBe("UnknownError")
  })

  it("prefers _tag over constructor name", () => {
    const taggedObj = { _tag: "MyCustomTag", message: "test" }
    expect(classifyError(taggedObj)).toBe("MyCustomTag")
  })
})

// -----------------------------------------------------------------------------
// extractErrorMessage Tests
// -----------------------------------------------------------------------------

describe("extractErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(extractErrorMessage(new Error("hello"))).toBe("hello")
  })

  it("converts non-Error values to string", () => {
    expect(extractErrorMessage("raw string")).toBe("raw string")
    expect(extractErrorMessage(404)).toBe("404")
    expect(extractErrorMessage(null)).toBe("null")
  })
})

// -----------------------------------------------------------------------------
// buildStructuredError Tests
// -----------------------------------------------------------------------------

describe("buildStructuredError", () => {
  it("builds structured error with full context", () => {
    const error = new Error("not found")
    const result = buildStructuredError("tx_show", { id: "tx-abc123" }, error)

    expect(result.errorType).toBe("Error")
    expect(result.message).toBe("not found")
    expect(result.tool).toBe("tx_show")
    expect(result.args).toEqual({ id: "tx-abc123" })
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("classifies Effect-TS tagged errors", () => {
    class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
      readonly id: string
    }> {
      get message() { return `Task not found: ${this.id}` }
    }

    const error = new TaskNotFoundError({ id: "tx-abc123" })
    const result = buildStructuredError("tx_show", { id: "tx-abc123" }, error)

    expect(result.errorType).toBe("TaskNotFoundError")
    expect(result.message).toBe("Task not found: tx-abc123")
  })
})

// -----------------------------------------------------------------------------
// formatErrorWithStack Tests
// -----------------------------------------------------------------------------

describe("formatErrorWithStack", () => {
  it("preserves stack trace from Error instances", () => {
    const error = new Error("something broke")
    const result = formatErrorWithStack(error)

    expect(result).toContain("something broke")
    expect(result).toContain("Error: something broke")
    // Stack trace should include file location
    expect(result).toContain("at ")
  })

  it("falls back to name + message when Error has no stack", () => {
    const error = new Error("no stack")
    error.stack = undefined
    const result = formatErrorWithStack(error)

    expect(result).toBe("Error: no stack")
  })

  it("preserves stack from Error subclasses", () => {
    class DatabaseError extends Error {
      constructor(message: string) {
        super(message)
        this.name = "DatabaseError"
      }
    }

    const error = new DatabaseError("connection refused")
    const result = formatErrorWithStack(error)

    expect(result).toContain("connection refused")
    expect(result).toContain("at ")
  })

  it("formats Effect-TS tagged errors with _tag", () => {
    class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
      readonly id: string
    }> {
      get message() { return `Task not found: ${this.id}` }
    }

    const error = new TaskNotFoundError({ id: "tx-abc123" })
    const result = formatErrorWithStack(error)

    // TaggedError extends Error so has a stack
    expect(result).toContain("Task not found: tx-abc123")
    expect(result).toContain("at ")
  })

  it("formats plain objects with _tag", () => {
    const error = { _tag: "CustomError", message: "custom problem" }
    const result = formatErrorWithStack(error)

    expect(result).toContain("CustomError")
    expect(result).toContain("custom problem")
  })

  it("formats plain objects without _tag", () => {
    const error = { code: "ECONNREFUSED", port: 5432 }
    const result = formatErrorWithStack(error)

    expect(result).toContain("UnknownError")
    expect(result).toContain("ECONNREFUSED")
  })

  it("converts string errors to string", () => {
    expect(formatErrorWithStack("raw string error")).toBe("raw string error")
  })

  it("converts number errors to string", () => {
    expect(formatErrorWithStack(42)).toBe("42")
  })

  it("converts null to string", () => {
    expect(formatErrorWithStack(null)).toBe("null")
  })

  it("converts undefined to string", () => {
    expect(formatErrorWithStack(undefined)).toBe("undefined")
  })
})

// -----------------------------------------------------------------------------
// handleToolError Tests
// -----------------------------------------------------------------------------

describe("handleToolError", () => {
  it("returns structured MCP error response", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = new Error("something broke")
    const result = handleToolError("tx_done", { id: "tx-abc123" }, error)

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(2)
    expect(result.content[0].text).toBe("Error [Error]: something broke")

    const data = JSON.parse(result.content[1].text)
    expect(data.errorType).toBe("Error")
    expect(data.message).toBe("something broke")
    expect(data.tool).toBe("tx_done")
    expect(data.args).toEqual({ id: "tx-abc123" })

    consoleSpy.mockRestore()
  })

  it("logs structured JSON to stderr", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = new Error("db failure")
    handleToolError("tx_add", { title: "My task" }, error)

    expect(consoleSpy).toHaveBeenCalledOnce()
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string)
    expect(logged.errorType).toBe("Error")
    expect(logged.tool).toBe("tx_add")
    expect(logged.message).toBe("db failure")

    consoleSpy.mockRestore()
  })

  it("classifies Effect-TS tagged errors in response", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    class CircularDependencyError extends Data.TaggedError("CircularDependencyError")<{
      readonly taskId: string
      readonly blockerId: string
    }> {
      get message() { return `Circular dependency: ${this.taskId} and ${this.blockerId}` }
    }

    const error = new CircularDependencyError({ taskId: "tx-aaa", blockerId: "tx-bbb" })
    const result = handleToolError("tx_block", { taskId: "tx-aaa", blockerId: "tx-bbb" }, error)

    expect(result.content[0].text).toBe("Error [CircularDependencyError]: Circular dependency: tx-aaa and tx-bbb")

    const data = JSON.parse(result.content[1].text)
    expect(data.errorType).toBe("CircularDependencyError")

    consoleSpy.mockRestore()
  })
})
