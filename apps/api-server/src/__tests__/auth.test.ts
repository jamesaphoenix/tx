/**
 * Authentication Middleware Tests
 *
 * Tests API key extraction, timing-safe comparison, and middleware behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { isAuthEnabled, extractApiKey, timingSafeEqual, authMiddleware } from "../middleware/auth.js"

// =============================================================================
// isAuthEnabled Tests
// =============================================================================

describe("isAuthEnabled", () => {
  let originalApiKey: string | undefined

  beforeEach(() => {
    originalApiKey = process.env.TX_API_KEY
  })

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.TX_API_KEY
    } else {
      process.env.TX_API_KEY = originalApiKey
    }
  })

  it("should return false when TX_API_KEY is not set", () => {
    delete process.env.TX_API_KEY
    expect(isAuthEnabled()).toBe(false)
  })

  it("should return false when TX_API_KEY is empty string", () => {
    process.env.TX_API_KEY = ""
    expect(isAuthEnabled()).toBe(false)
  })

  it("should return true when TX_API_KEY is set", () => {
    process.env.TX_API_KEY = "test-key-12345"
    expect(isAuthEnabled()).toBe(true)
  })

  it("should return true for any non-empty TX_API_KEY value", () => {
    process.env.TX_API_KEY = "x"
    expect(isAuthEnabled()).toBe(true)
  })
})

// =============================================================================
// extractApiKey Tests
// =============================================================================

describe("extractApiKey", () => {
  it("should extract X-Api-Key header", () => {
    const result = extractApiKey({ "x-api-key": "my-secret" })
    expect(result).toBe("my-secret")
  })

  it("should extract Bearer token from Authorization header", () => {
    const result = extractApiKey({ "authorization": "Bearer my-token" })
    expect(result).toBe("my-token")
  })

  it("should prefer X-Api-Key over Authorization header", () => {
    const result = extractApiKey({
      "x-api-key": "from-x-api-key",
      "authorization": "Bearer from-bearer",
    })
    expect(result).toBe("from-x-api-key")
  })

  it("should return null when no auth headers present", () => {
    const result = extractApiKey({})
    expect(result).toBeNull()
  })

  it("should return null for non-Bearer Authorization header", () => {
    const result = extractApiKey({ "authorization": "Basic dXNlcjpwYXNz" })
    expect(result).toBeNull()
  })

  it("should return null for empty Authorization header", () => {
    const result = extractApiKey({ "authorization": "" })
    expect(result).toBeNull()
  })

  it("should handle undefined header values", () => {
    const result = extractApiKey({ "x-api-key": undefined, "authorization": undefined })
    expect(result).toBeNull()
  })

  it("should extract Bearer token with spaces in the token", () => {
    const result = extractApiKey({ "authorization": "Bearer abc def" })
    expect(result).toBe("abc def")
  })
})

// =============================================================================
// timingSafeEqual Tests
// =============================================================================

describe("timingSafeEqual", () => {
  it("should return true for equal strings", () => {
    expect(timingSafeEqual("secret123", "secret123")).toBe(true)
  })

  it("should return false for different strings of same length", () => {
    expect(timingSafeEqual("secret123", "secret456")).toBe(false)
  })

  it("should return false for different strings of different length", () => {
    expect(timingSafeEqual("short", "longer-string")).toBe(false)
  })

  it("should return true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true)
  })

  it("should return false when one string is empty", () => {
    expect(timingSafeEqual("", "notempty")).toBe(false)
  })

  it("should handle unicode characters", () => {
    expect(timingSafeEqual("héllo", "héllo")).toBe(true)
    expect(timingSafeEqual("héllo", "hello")).toBe(false)
  })

  it("should handle long strings", () => {
    const longStr = "a".repeat(10000)
    expect(timingSafeEqual(longStr, longStr)).toBe(true)
    expect(timingSafeEqual(longStr, "b".repeat(10000))).toBe(false)
  })
})

// =============================================================================
// authMiddleware Tests
// =============================================================================

describe("authMiddleware", () => {
  it("should export authMiddleware as a function", () => {
    expect(authMiddleware).toBeDefined()
    expect(typeof authMiddleware).toBe("function")
  })
})
