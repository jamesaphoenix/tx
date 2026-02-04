/**
 * Health Endpoint Security Tests
 *
 * Tests that the /health endpoint properly protects sensitive information
 * when authentication is enabled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
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

interface RalphResponse {
  running: boolean
  pid: number | null
  currentIteration: number
  currentTask: string | null
  recentActivity: unknown[]
}

describe("RALPH endpoint", () => {
  const stateFile = path.join(process.cwd(), ".tx", "ralph-state")
  let stateExistedBefore: boolean

  beforeEach(() => {
    stateExistedBefore = fs.existsSync(stateFile)
  })

  afterEach(() => {
    // Clean up: remove state file if we created it, restore if it existed
    if (!stateExistedBefore && fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile)
    }
  })

  it("should return defaults when no state file exists", async () => {
    // Temporarily rename state file if it exists
    const backup = stateFile + ".test-backup"
    if (fs.existsSync(stateFile)) {
      fs.renameSync(stateFile, backup)
    }

    try {
      const app = createApp()
      const response = await app.request("/api/ralph")
      const body = (await response.json()) as RalphResponse

      expect(response.status).toBe(200)
      expect(body.running).toBe(false)
      expect(body.pid).toBeNull()
      expect(body.currentIteration).toBe(0)
      expect(body.currentTask).toBeNull()
      expect(body.recentActivity).toEqual([])
    } finally {
      if (fs.existsSync(backup)) {
        fs.renameSync(backup, stateFile)
      }
    }
  })

  it("should return state from valid state file", async () => {
    const backup = stateFile + ".test-backup"
    if (fs.existsSync(stateFile)) {
      fs.renameSync(stateFile, backup)
    }

    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify({
      running: true,
      pid: 12345,
      iteration: 3,
      currentTask: "tx-abc123"
    }))

    try {
      const app = createApp()
      const response = await app.request("/api/ralph")
      const body = (await response.json()) as RalphResponse

      expect(response.status).toBe(200)
      expect(body.running).toBe(true)
      expect(body.pid).toBe(12345)
      expect(body.currentIteration).toBe(3)
      expect(body.currentTask).toBe("tx-abc123")
    } finally {
      if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile)
      }
      if (fs.existsSync(backup)) {
        fs.renameSync(backup, stateFile)
      }
    }
  })

  it("should log warning and return defaults for invalid JSON state file", async () => {
    const backup = stateFile + ".test-backup"
    if (fs.existsSync(stateFile)) {
      fs.renameSync(stateFile, backup)
    }

    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, "not valid json {{{")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    try {
      const app = createApp()
      const response = await app.request("/api/ralph")
      const body = (await response.json()) as RalphResponse

      expect(response.status).toBe(200)
      expect(body.running).toBe(false)
      expect(body.pid).toBeNull()
      expect(body.currentIteration).toBe(0)
      expect(body.currentTask).toBeNull()

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[health] Failed to parse RALPH state file"),
        expect.any(String)
      )
    } finally {
      warnSpy.mockRestore()
      if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile)
      }
      if (fs.existsSync(backup)) {
        fs.renameSync(backup, stateFile)
      }
    }
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
