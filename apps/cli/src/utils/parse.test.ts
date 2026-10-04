import { describe, it, expect } from "vitest"
import { opt, flag, parseIntOpt, parseFloatOpt, type Flags } from "./parse.js"
import { CliUserError } from "../cli-errors.js"

describe("opt", () => {
  it("returns string value for matching flag", () => {
    const flags: Flags = { limit: "10", json: true }
    expect(opt(flags, "limit")).toBe("10")
  })

  it("returns undefined for boolean flag", () => {
    const flags: Flags = { json: true }
    expect(opt(flags, "json")).toBeUndefined()
  })

  it("returns undefined for missing flag", () => {
    const flags: Flags = {}
    expect(opt(flags, "limit")).toBeUndefined()
  })

  it("returns first matching flag when multiple names given", () => {
    const flags: Flags = { n: "5" }
    expect(opt(flags, "limit", "n")).toBe("5")
  })

  it("prefers earlier name in list", () => {
    const flags: Flags = { limit: "10", n: "5" }
    expect(opt(flags, "limit", "n")).toBe("10")
  })
})

describe("flag", () => {
  it("returns true when flag is set", () => {
    const flags: Flags = { json: true }
    expect(flag(flags, "json")).toBe(true)
  })

  it("returns false when flag is not set", () => {
    const flags: Flags = {}
    expect(flag(flags, "json")).toBe(false)
  })

  it("returns false when flag is a string value", () => {
    const flags: Flags = { json: "true" }
    expect(flag(flags, "json")).toBe(false)
  })

  it("returns true if any name matches", () => {
    const flags: Flags = { h: true }
    expect(flag(flags, "help", "h")).toBe(true)
  })
})

describe("parseIntOpt", () => {
  it("returns undefined when flag is not present", () => {
    const flags: Flags = {}
    expect(parseIntOpt(flags, "limit", "limit", "n")).toBeUndefined()
  })

  it("returns parsed integer for valid value", () => {
    const flags: Flags = { limit: "42" }
    expect(parseIntOpt(flags, "limit", "limit")).toBe(42)
  })

  it("returns parsed integer for short alias", () => {
    const flags: Flags = { n: "5" }
    expect(parseIntOpt(flags, "limit", "limit", "n")).toBe(5)
  })

  it("throws CliUserError for non-numeric value", () => {
    const flags: Flags = { limit: "abc" }
    expect(() => parseIntOpt(flags, "limit", "limit")).toThrow(CliUserError)
  })

  it("throws CliUserError for empty string value", () => {
    const flags: Flags = { limit: "" }
    expect(() => parseIntOpt(flags, "limit", "limit")).toThrow(CliUserError)
  })

  it("parses negative integers", () => {
    const flags: Flags = { score: "-5" }
    expect(parseIntOpt(flags, "score", "score")).toBe(-5)
  })

  it("parses zero", () => {
    const flags: Flags = { limit: "0" }
    expect(parseIntOpt(flags, "limit", "limit")).toBe(0)
  })

  it("rejects float values", () => {
    const flags: Flags = { limit: "3.7" }
    expect(() => parseIntOpt(flags, "limit", "limit")).toThrow(CliUserError)
  })

  it("ignores boolean flags", () => {
    const flags: Flags = { limit: true }
    expect(parseIntOpt(flags, "limit", "limit")).toBeUndefined()
  })
})

describe("parseFloatOpt", () => {
  it("returns undefined when flag is not present", () => {
    const flags: Flags = {}
    expect(parseFloatOpt(flags, "score", "score")).toBeUndefined()
  })

  it("returns parsed float for valid value", () => {
    const flags: Flags = { score: "0.75" }
    expect(parseFloatOpt(flags, "score", "score")).toBe(0.75)
  })

  it("returns parsed float for integer value", () => {
    const flags: Flags = { "min-score": "3" }
    expect(parseFloatOpt(flags, "min-score", "min-score")).toBe(3)
  })

  it("throws CliUserError for non-numeric value", () => {
    const flags: Flags = { score: "high" }
    expect(() => parseFloatOpt(flags, "score", "score")).toThrow(CliUserError)
  })

  it("parses negative floats", () => {
    const flags: Flags = { score: "-0.5" }
    expect(parseFloatOpt(flags, "score", "score")).toBe(-0.5)
  })

  it("parses zero", () => {
    const flags: Flags = { score: "0" }
    expect(parseFloatOpt(flags, "score", "score")).toBe(0)
  })

  it("throws CliUserError for Infinity", () => {
    const flags: Flags = { score: "Infinity" }
    expect(() => parseFloatOpt(flags, "score", "score")).toThrow(CliUserError)
  })

  it("throws CliUserError for -Infinity", () => {
    const flags: Flags = { score: "-Infinity" }
    expect(() => parseFloatOpt(flags, "score", "score")).toThrow(CliUserError)
  })

  it.each(["0.5invalid", "1.2.3", " "])("rejects malformed number %j", (value) => {
    expect(() => parseFloatOpt({ score: value }, "score", "score")).toThrow(CliUserError)
  })

  it("ignores boolean flags", () => {
    const flags: Flags = { score: true }
    expect(parseFloatOpt(flags, "score", "score")).toBeUndefined()
  })
})
