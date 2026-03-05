import { describe, it, expect } from "vitest"
import { generateUlid, isUlid } from "@jamesaphoenix/tx-core"

describe("ULID utility", () => {
  it("generates 26-character Crockford ULIDs", () => {
    const id = generateUlid()
    expect(id).toHaveLength(26)
    expect(isUlid(id)).toBe(true)
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it("produces unique IDs across a large sample", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      ids.add(generateUlid())
    }
    expect(ids.size).toBe(5000)
  })

  it("is lexicographically sortable by timestamp prefix", () => {
    const a = generateUlid(Date.UTC(2026, 0, 1, 0, 0, 0))
    const b = generateUlid(Date.UTC(2026, 0, 1, 0, 0, 1))
    const c = generateUlid(Date.UTC(2026, 0, 1, 0, 0, 2))

    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  it("returns false for non-ULID strings", () => {
    expect(isUlid("not-a-ulid")).toBe(false)
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAVx")).toBe(false)
  })
})
