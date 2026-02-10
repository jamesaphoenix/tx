/**
 * @jamesaphoenix/tx-agent-sdk Utils Tests
 *
 * Tests for parseDate validation and other utility functions.
 */

import { describe, it, expect } from "vitest"
import { parseDate, TxError } from "./utils.js"

describe("parseDate", () => {
  it("parses valid ISO date strings", () => {
    const date = parseDate("2025-01-15T10:30:00.000Z")
    expect(date).toBeInstanceOf(Date)
    expect(date.toISOString()).toBe("2025-01-15T10:30:00.000Z")
  })

  it("parses date-only strings", () => {
    const date = parseDate("2025-06-01")
    expect(date).toBeInstanceOf(Date)
    expect(isNaN(date.getTime())).toBe(false)
  })

  it("throws TxError for completely invalid strings", () => {
    expect(() => parseDate("not-a-date")).toThrow(TxError)
    expect(() => parseDate("not-a-date")).toThrow("Invalid date string: 'not-a-date'")
  })

  it("throws TxError for empty string", () => {
    expect(() => parseDate("")).toThrow(TxError)
    expect(() => parseDate("")).toThrow("Invalid date string: ''")
  })

  it("throws TxError with VALIDATION_ERROR code", () => {
    try {
      parseDate("garbage")
      expect.fail("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(TxError)
      expect((e as TxError).code).toBe("VALIDATION_ERROR")
    }
  })

  it("throws TxError for partial invalid dates", () => {
    expect(() => parseDate("2025-13-45")).toThrow(TxError)
  })

  it("accepts valid date-time with timezone offset", () => {
    const date = parseDate("2025-03-15T14:00:00+05:00")
    expect(date).toBeInstanceOf(Date)
    expect(isNaN(date.getTime())).toBe(false)
  })
})
