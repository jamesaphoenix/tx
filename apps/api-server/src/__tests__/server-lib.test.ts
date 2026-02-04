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
