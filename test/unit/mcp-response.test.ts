/**
 * MCP Response Module Unit Tests
 *
 * Tests safeStringify and response formatters, including circular reference handling.
 */
import { describe, it, expect } from "vitest"
import { safeStringify, mcpResponse, mcpError } from "../../apps/mcp-server/src/response.js"

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
