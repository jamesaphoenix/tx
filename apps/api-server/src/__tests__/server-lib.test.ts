/**
 * Server Library Tests
 *
 * Tests for server configuration and module exports.
 * Note: makeServerLive and route layers require bun:sqlite (via tx-core)
 * and can only be tested with `bun test`. These tests cover the parts
 * that work in Node.js vitest.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { isAuthEnabled } from "../middleware/auth.js"
import { getCorsConfig } from "../middleware/cors.js"

// =============================================================================
// Auth Configuration Tests
// =============================================================================

describe("Server auth configuration", () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {
      TX_API_PORT: process.env.TX_API_PORT,
      TX_API_HOST: process.env.TX_API_HOST,
      TX_DB_PATH: process.env.TX_DB_PATH,
      TX_API_KEY: process.env.TX_API_KEY,
      TX_API_CORS_ORIGIN: process.env.TX_API_CORS_ORIGIN,
      TX_API_CORS_CREDENTIALS: process.env.TX_API_CORS_CREDENTIALS,
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it("should detect auth enabled via TX_API_KEY", () => {
    process.env.TX_API_KEY = "my-secret-key"
    expect(isAuthEnabled()).toBe(true)
  })

  it("should detect auth disabled when TX_API_KEY not set", () => {
    delete process.env.TX_API_KEY
    expect(isAuthEnabled()).toBe(false)
  })

  it("should detect auth disabled for empty TX_API_KEY", () => {
    process.env.TX_API_KEY = ""
    expect(isAuthEnabled()).toBe(false)
  })
})

// =============================================================================
// CORS Configuration Tests
// =============================================================================

describe("CORS configuration", () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {
      TX_API_CORS_ORIGIN: process.env.TX_API_CORS_ORIGIN,
      TX_API_CORS_CREDENTIALS: process.env.TX_API_CORS_CREDENTIALS,
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it("should default to localhost origins when TX_API_CORS_ORIGIN is not set", () => {
    delete process.env.TX_API_CORS_ORIGIN
    const config = getCorsConfig()
    expect(config.allowedOrigins).toEqual([
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
    ])
    // Must NOT include wildcard by default
    expect(config.allowedOrigins).not.toContain("*")
  })

  it("should allow wildcard only when explicitly set to *", () => {
    process.env.TX_API_CORS_ORIGIN = "*"
    const config = getCorsConfig()
    expect(config.allowedOrigins).toEqual(["*"])
  })

  it("should parse comma-separated origins", () => {
    process.env.TX_API_CORS_ORIGIN = "https://app.example.com, https://admin.example.com"
    const config = getCorsConfig()
    expect(config.allowedOrigins).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ])
  })

  it("should handle single custom origin", () => {
    process.env.TX_API_CORS_ORIGIN = "https://myapp.com"
    const config = getCorsConfig()
    expect(config.allowedOrigins).toEqual(["https://myapp.com"])
  })

  it("should enable credentials when TX_API_CORS_CREDENTIALS is true", () => {
    process.env.TX_API_CORS_CREDENTIALS = "true"
    const config = getCorsConfig()
    expect(config.credentials).toBe(true)
  })

  it("should disable credentials by default", () => {
    delete process.env.TX_API_CORS_CREDENTIALS
    const config = getCorsConfig()
    expect(config.credentials).toBe(false)
  })
})

// =============================================================================
// API Definition Exports Tests (no bun:sqlite dependency)
// =============================================================================

describe("API definition exports", () => {
  it("should export TxApi class from api.ts", async () => {
    const { TxApi } = await import("../api.js")
    expect(TxApi).toBeDefined()
  })

  it("should export all error types from api.ts", async () => {
    const { NotFound, BadRequest, InternalError, Unauthorized, Forbidden, ServiceUnavailable } = await import("../api.js")
    expect(NotFound).toBeDefined()
    expect(BadRequest).toBeDefined()
    expect(InternalError).toBeDefined()
    expect(Unauthorized).toBeDefined()
    expect(Forbidden).toBeDefined()
    expect(ServiceUnavailable).toBeDefined()
  })

  it("should export mapCoreError from api.ts", async () => {
    const { mapCoreError } = await import("../api.js")
    expect(mapCoreError).toBeDefined()
    expect(typeof mapCoreError).toBe("function")
  })

  it("should export all API groups from api.ts", async () => {
    const { HealthGroup, TasksGroup, LearningsGroup, RunsGroup, SyncGroup } = await import("../api.js")
    expect(HealthGroup).toBeDefined()
    expect(TasksGroup).toBeDefined()
    expect(LearningsGroup).toBeDefined()
    expect(RunsGroup).toBeDefined()
    expect(SyncGroup).toBeDefined()
  })
})
