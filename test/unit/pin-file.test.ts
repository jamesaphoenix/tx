/**
 * Pin File Utilities — Unit Tests
 *
 * Tests pure functions for parsing, inserting, updating, and removing
 * <tx-pin> blocks in markdown content.
 */
import { describe, it, expect } from "vitest"
import {
  parseBlocks,
  hasBlock,
  upsertBlock,
  removeBlock,
  syncBlocks
} from "../../packages/core/src/utils/pin-file.js"

describe("parseBlocks", () => {
  it("returns empty map for content with no blocks", () => {
    const result = parseBlocks("# Hello\n\nSome content\n")
    expect(result.size).toBe(0)
  })

  it("parses a single block", () => {
    const content = `# Header\n\n<tx-pin id="auth">\nUse JWT tokens\n</tx-pin>\n`
    const result = parseBlocks(content)
    expect(result.size).toBe(1)
    expect(result.get("auth")).toBe("\nUse JWT tokens\n")
  })

  it("parses multiple blocks", () => {
    const content = [
      "# Header",
      "",
      '<tx-pin id="auth">',
      "Use JWT",
      "</tx-pin>",
      "",
      '<tx-pin id="api">',
      "Use REST",
      "</tx-pin>",
    ].join("\n")
    const result = parseBlocks(content)
    expect(result.size).toBe(2)
    expect(result.has("auth")).toBe(true)
    expect(result.has("api")).toBe(true)
  })

  it("handles empty block content", () => {
    const content = '<tx-pin id="empty"></tx-pin>'
    const result = parseBlocks(content)
    expect(result.size).toBe(1)
    expect(result.get("empty")).toBe("")
  })

  it("handles multiline block content", () => {
    const content = [
      '<tx-pin id="rules">',
      "## Rules",
      "",
      "- Rule 1",
      "- Rule 2",
      "</tx-pin>",
    ].join("\n")
    const result = parseBlocks(content)
    expect(result.get("rules")).toContain("- Rule 1")
    expect(result.get("rules")).toContain("- Rule 2")
  })
})

describe("hasBlock", () => {
  it("returns true when block exists", () => {
    const content = '<tx-pin id="test">\ncontent\n</tx-pin>'
    expect(hasBlock(content, "test")).toBe(true)
  })

  it("returns false when block does not exist", () => {
    const content = '<tx-pin id="other">\ncontent\n</tx-pin>'
    expect(hasBlock(content, "test")).toBe(false)
  })

  it("returns false for empty content", () => {
    expect(hasBlock("", "test")).toBe(false)
  })
})

describe("upsertBlock", () => {
  it("appends block to empty content", () => {
    const result = upsertBlock("", "test", "Hello world")
    expect(result).toContain('<tx-pin id="test">')
    expect(result).toContain("Hello world")
    expect(result).toContain("</tx-pin>")
  })

  it("appends block after existing content", () => {
    const result = upsertBlock("# Header\n\nExisting content", "test", "New pin")
    expect(result).toContain("# Header")
    expect(result).toContain("Existing content")
    expect(result).toContain('<tx-pin id="test">')
    expect(result).toContain("New pin")
  })

  it("replaces existing block in-place", () => {
    const original = [
      "# Header",
      "",
      '<tx-pin id="test">',
      "Old content",
      "</tx-pin>",
      "",
      "# Footer",
    ].join("\n")
    const result = upsertBlock(original, "test", "New content")
    expect(result).toContain("New content")
    expect(result).not.toContain("Old content")
    expect(result).toContain("# Header")
    expect(result).toContain("# Footer")
  })

  it("does not affect other blocks when replacing", () => {
    const original = [
      '<tx-pin id="a">',
      "Content A",
      "</tx-pin>",
      "",
      '<tx-pin id="b">',
      "Content B",
      "</tx-pin>",
    ].join("\n")
    const result = upsertBlock(original, "a", "Updated A")
    expect(result).toContain("Updated A")
    expect(result).toContain("Content B")
    expect(result).not.toContain("Content A")
  })
})

describe("removeBlock", () => {
  it("removes an existing block", () => {
    const content = [
      "# Header",
      "",
      '<tx-pin id="test">',
      "Content",
      "</tx-pin>",
      "",
      "# Footer",
    ].join("\n")
    const result = removeBlock(content, "test")
    expect(result).not.toContain("tx-pin")
    expect(result).toContain("# Header")
    expect(result).toContain("# Footer")
  })

  it("returns content unchanged when block not found", () => {
    const content = "# Header\n\nSome content\n"
    expect(removeBlock(content, "nonexistent")).toBe(content)
  })

  it("handles removing the only block", () => {
    const content = '<tx-pin id="only">\nContent\n</tx-pin>\n'
    const result = removeBlock(content, "only")
    expect(result).not.toContain("tx-pin")
  })

  it("does not affect other blocks", () => {
    const content = [
      '<tx-pin id="keep">',
      "Keep me",
      "</tx-pin>",
      "",
      '<tx-pin id="remove">',
      "Remove me",
      "</tx-pin>",
    ].join("\n")
    const result = removeBlock(content, "remove")
    expect(result).toContain("Keep me")
    expect(result).not.toContain("Remove me")
  })
})

describe("syncBlocks", () => {
  it("adds missing blocks to empty content", () => {
    const pins = new Map([
      ["auth", "Use JWT"],
      ["api", "Use REST"],
    ])
    const result = syncBlocks("", pins)
    expect(result).toContain('<tx-pin id="auth">')
    expect(result).toContain("Use JWT")
    expect(result).toContain('<tx-pin id="api">')
    expect(result).toContain("Use REST")
  })

  it("removes stale blocks not in desired set", () => {
    const content = [
      '<tx-pin id="old">',
      "Old content",
      "</tx-pin>",
    ].join("\n")
    const pins = new Map<string, string>()
    const result = syncBlocks(content, pins)
    expect(result).not.toContain("tx-pin")
    expect(result).not.toContain("Old content")
  })

  it("updates changed blocks", () => {
    const content = [
      '<tx-pin id="auth">',
      "Old auth",
      "</tx-pin>",
    ].join("\n")
    const pins = new Map([["auth", "New auth"]])
    const result = syncBlocks(content, pins)
    expect(result).toContain("New auth")
    expect(result).not.toContain("Old auth")
  })

  it("preserves non-pin content", () => {
    const content = [
      "# My Project",
      "",
      "Some manual documentation.",
      "",
      '<tx-pin id="old">',
      "Old pin",
      "</tx-pin>",
    ].join("\n")
    const pins = new Map([["new-pin", "New content"]])
    const result = syncBlocks(content, pins)
    expect(result).toContain("# My Project")
    expect(result).toContain("Some manual documentation.")
    expect(result).toContain("New content")
    expect(result).not.toContain("Old pin")
  })

  it("is idempotent when nothing changes", () => {
    const content = [
      "# Header",
      "",
      '<tx-pin id="auth">',
      "\nUse JWT\n",
      "</tx-pin>",
    ].join("\n")
    const pins = new Map([["auth", "Use JWT"]])
    const first = syncBlocks(content, pins)
    const second = syncBlocks(first, pins)
    expect(second).toBe(first)
  })

  it("handles empty pins map (removes all)", () => {
    const content = [
      '<tx-pin id="a">',
      "Content A",
      "</tx-pin>",
      "",
      '<tx-pin id="b">',
      "Content B",
      "</tx-pin>",
    ].join("\n")
    const result = syncBlocks(content, new Map())
    expect(result).not.toContain("tx-pin")
  })
})
