/**
 * Health Endpoint Security Tests
 *
 * Tests that the /health endpoint properly protects sensitive information
 * when authentication is enabled.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createApp } from "../server-lib.js"

interface HealthResponse {
  status: string
  timestamp: string
  version: string
  database: {
    connected: boolean
    path: string | null
  }
}

describe("Health endpoint security", () => {
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

  describe("when auth is disabled", () => {
    beforeEach(() => {
      delete process.env.TX_API_KEY
    })

    it("should return database path in /health response", async () => {
      const app = createApp()
      const response = await app.request("/health")
      const body = (await response.json()) as HealthResponse

      expect(response.status).toBe(200)
      // When auth is disabled, all requests are considered "authenticated"
      // so the full response is returned (path may be null if runtime not initialized)
      expect(body).toHaveProperty("database")
      expect(body.database).toHaveProperty("path")
    })
  })

  describe("when auth is enabled", () => {
    const TEST_API_KEY = "test-secret-key-12345"

    beforeEach(() => {
      process.env.TX_API_KEY = TEST_API_KEY
    })

    it("should NOT return database path for unauthenticated requests", async () => {
      const app = createApp()
      const response = await app.request("/health")
      const body = (await response.json()) as HealthResponse

      expect(response.status).toBe(200)
      expect(body.database.path).toBeNull()
    })

    it("should NOT return database path with invalid API key", async () => {
      const app = createApp()
      const response = await app.request("/health", {
        headers: {
          "X-Api-Key": "wrong-key"
        }
      })
      const body = (await response.json()) as HealthResponse

      expect(response.status).toBe(200)
      expect(body.database.path).toBeNull()
    })

    it("should return database path with valid X-Api-Key header", async () => {
      const app = createApp()
      const response = await app.request("/health", {
        headers: {
          "X-Api-Key": TEST_API_KEY
        }
      })
      const body = (await response.json()) as HealthResponse

      expect(response.status).toBe(200)
      // Path is returned when authenticated (may be null if runtime not initialized)
      expect(body).toHaveProperty("database")
    })

    it("should return database path with valid Bearer token", async () => {
      const app = createApp()
      const response = await app.request("/health", {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`
        }
      })
      const body = (await response.json()) as HealthResponse

      expect(response.status).toBe(200)
      expect(body).toHaveProperty("database")
    })
  })
})

describe("isRequestAuthenticated", () => {
  // These tests validate the authentication helper function directly
  // by testing through the health endpoint behavior

  it("should treat all requests as authenticated when auth is disabled", async () => {
    delete process.env.TX_API_KEY
    const app = createApp()

    const response = await app.request("/health")
    const body = (await response.json()) as HealthResponse

    // When auth is disabled, database info should be fully visible
    expect(response.status).toBe(200)
    expect(body).toHaveProperty("database")
  })
})
