import { describe, it, expect } from "vitest"
import { DatabaseError } from "@jamesaphoenix/tx"
describe("DatabaseError Structure", () => {
  it("preserves the original cause", () => {
    const originalError = new Error("SQLite constraint violation")
    const dbError = new DatabaseError({ cause: originalError })

    expect(dbError._tag).toBe("DatabaseError")
    expect(dbError.cause).toBe(originalError)
  })

  it("message includes cause string representation", () => {
    const originalError = new Error("SQLite constraint violation")
    const dbError = new DatabaseError({ cause: originalError })

    expect(dbError.message).toContain("SQLite constraint violation")
  })

  it("handles non-Error causes", () => {
    const dbError = new DatabaseError({ cause: "string error" })

    expect(dbError._tag).toBe("DatabaseError")
    expect(dbError.cause).toBe("string error")
    expect(dbError.message).toContain("string error")
  })
})
