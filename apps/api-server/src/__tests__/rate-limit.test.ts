/**
 * Rate Limiting Security Tests
 *
 * Tests that rate limiting cannot be bypassed by spoofing X-Forwarded-For headers.
 * The TX_API_TRUST_PROXY environment variable must be explicitly set to trust proxy headers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createApp } from "../server-lib.js"
import { clearAllRateLimits, isTrustProxyEnabled } from "../middleware/rate-limit.js"

describe("Rate limiting security", () => {
  let originalRateLimit: string | undefined
  let originalTrustProxy: string | undefined
  let originalSkipHealth: string | undefined

  beforeEach(() => {
    originalRateLimit = process.env.TX_API_RATE_LIMIT
    originalTrustProxy = process.env.TX_API_TRUST_PROXY
    originalSkipHealth = process.env.TX_API_RATE_LIMIT_SKIP_HEALTH
    // Ensure health endpoints ARE rate limited for testing
    process.env.TX_API_RATE_LIMIT_SKIP_HEALTH = "false"
    clearAllRateLimits()
  })

  afterEach(() => {
    if (originalRateLimit === undefined) {
      delete process.env.TX_API_RATE_LIMIT
    } else {
      process.env.TX_API_RATE_LIMIT = originalRateLimit
    }
    if (originalTrustProxy === undefined) {
      delete process.env.TX_API_TRUST_PROXY
    } else {
      process.env.TX_API_TRUST_PROXY = originalTrustProxy
    }
    if (originalSkipHealth === undefined) {
      delete process.env.TX_API_RATE_LIMIT_SKIP_HEALTH
    } else {
      process.env.TX_API_RATE_LIMIT_SKIP_HEALTH = originalSkipHealth
    }
    clearAllRateLimits()
  })

  describe("isTrustProxyEnabled", () => {
    it("should return false by default", () => {
      delete process.env.TX_API_TRUST_PROXY
      expect(isTrustProxyEnabled()).toBe(false)
    })

    it("should return false for empty string", () => {
      process.env.TX_API_TRUST_PROXY = ""
      expect(isTrustProxyEnabled()).toBe(false)
    })

    it("should return false for 'false'", () => {
      process.env.TX_API_TRUST_PROXY = "false"
      expect(isTrustProxyEnabled()).toBe(false)
    })

    it("should return true only for 'true'", () => {
      process.env.TX_API_TRUST_PROXY = "true"
      expect(isTrustProxyEnabled()).toBe(true)
    })
  })

  describe("when TX_API_TRUST_PROXY is NOT set (secure default)", () => {
    beforeEach(() => {
      delete process.env.TX_API_TRUST_PROXY
      process.env.TX_API_RATE_LIMIT = "2" // Allow only 2 requests
    })

    it("should ignore X-Forwarded-For header (not treated as client identity)", async () => {
      const app = createApp()

      // When trust proxy is off, X-Forwarded-For is ignored
      // Without connection IP available (in test env), each request gets unique anon-{uuid}
      // This means requests are NOT rate limited against each other (no shared bucket)
      const response1 = await app.request("/health", {
        headers: { "X-Forwarded-For": "1.1.1.1" }
      })
      expect(response1.status).toBe(200)

      const response2 = await app.request("/health", {
        headers: { "X-Forwarded-For": "2.2.2.2" }
      })
      expect(response2.status).toBe(200)

      // Third request also succeeds - no shared bucket to exhaust
      // This prevents DoS attacks where one client exhausts the "unknown" bucket
      const response3 = await app.request("/health", {
        headers: { "X-Forwarded-For": "3.3.3.3" }
      })
      expect(response3.status).toBe(200)
    })

    it("should ignore X-Real-IP header (not treated as client identity)", async () => {
      const app = createApp()

      // Without trust proxy, X-Real-IP is ignored
      // Each request gets unique ID, preventing shared bucket exhaustion
      const response1 = await app.request("/health", { headers: { "X-Real-IP": "10.0.0.1" } })
      expect(response1.status).toBe(200)

      const response2 = await app.request("/health", { headers: { "X-Real-IP": "10.0.0.2" } })
      expect(response2.status).toBe(200)

      // Third request also succeeds - no shared bucket DoS vulnerability
      const response3 = await app.request("/health", {
        headers: { "X-Real-IP": "10.0.0.3" }
      })
      expect(response3.status).toBe(200)
    })

    it("should NOT allow shared bucket DoS (security fix)", async () => {
      const app = createApp()

      // Security test: Verify that anonymous requests do NOT share a rate limit bucket
      // Previously, all requests without identifiable IP used "unknown" as client ID,
      // allowing an attacker to exhaust the shared bucket and block all anonymous users.
      // Now each request gets a unique anon-{uuid}, preventing this attack vector.

      // Make many requests - none should be rate limited since each has unique ID
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => app.request("/health"))
      )

      // All requests should succeed (no shared bucket to exhaust)
      responses.forEach((response) => {
        expect(response.status).toBe(200)
      })
    })
  })

  describe("when TX_API_TRUST_PROXY=true", () => {
    beforeEach(() => {
      process.env.TX_API_TRUST_PROXY = "true"
      process.env.TX_API_RATE_LIMIT = "2" // Allow only 2 requests
    })

    it("should use X-Forwarded-For header for rate limiting", async () => {
      const app = createApp()

      // Requests from different IPs should each have their own rate limit bucket
      const response1a = await app.request("/health", {
        headers: { "X-Forwarded-For": "1.1.1.1" }
      })
      const response1b = await app.request("/health", {
        headers: { "X-Forwarded-For": "1.1.1.1" }
      })
      const response1c = await app.request("/health", {
        headers: { "X-Forwarded-For": "1.1.1.1" }
      })

      // First IP should be rate limited after 2 requests
      expect(response1a.status).toBe(200)
      expect(response1b.status).toBe(200)
      expect(response1c.status).toBe(429)

      // Different IP should have fresh rate limit
      const response2 = await app.request("/health", {
        headers: { "X-Forwarded-For": "2.2.2.2" }
      })
      expect(response2.status).toBe(200)
    })

    it("should reject malformed X-Forwarded-For values", async () => {
      const app = createApp()

      // Malformed IPs should fall back to unique anon-{uuid} (no shared bucket)
      // This prevents DoS via malformed headers exhausting a shared bucket
      const response1 = await app.request("/health", {
        headers: { "X-Forwarded-For": "not-an-ip" }
      })
      expect(response1.status).toBe(200)

      const response2 = await app.request("/health", {
        headers: { "X-Forwarded-For": "malicious<script>" }
      })
      expect(response2.status).toBe(200)

      // Each malformed request gets unique ID, so no rate limit triggered
      const response3 = await app.request("/health", {
        headers: { "X-Forwarded-For": "another-invalid" }
      })
      expect(response3.status).toBe(200)
    })

    it("should take first IP from X-Forwarded-For chain", async () => {
      const app = createApp()

      // X-Forwarded-For can contain multiple IPs - should use first (client IP)
      const response1 = await app.request("/health", {
        headers: { "X-Forwarded-For": "1.1.1.1, 2.2.2.2, 3.3.3.3" }
      })
      const response2 = await app.request("/health", {
        headers: { "X-Forwarded-For": "1.1.1.1, 4.4.4.4" }
      })
      const response3 = await app.request("/health", {
        headers: { "X-Forwarded-For": "1.1.1.1" }
      })

      // All requests with same first IP should share bucket
      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)
      expect(response3.status).toBe(429)
    })
  })

  describe("rate limit headers", () => {
    beforeEach(() => {
      process.env.TX_API_RATE_LIMIT = "10"
    })

    it("should include rate limit headers in response", async () => {
      const app = createApp()
      const response = await app.request("/health")

      expect(response.headers.get("X-RateLimit-Limit")).toBe("10")
      expect(response.headers.get("X-RateLimit-Remaining")).toBeDefined()
      expect(response.headers.get("X-RateLimit-Reset")).toBeDefined()
    })

    it("should include Retry-After header when rate limited", async () => {
      process.env.TX_API_RATE_LIMIT = "1"
      // Enable trust proxy to allow rate limiting via X-Forwarded-For
      process.env.TX_API_TRUST_PROXY = "true"
      const app = createApp()

      // Use same IP to trigger rate limiting
      await app.request("/health", { headers: { "X-Forwarded-For": "10.10.10.10" } })
      const response = await app.request("/health", { headers: { "X-Forwarded-For": "10.10.10.10" } })

      expect(response.status).toBe(429)
      expect(response.headers.get("Retry-After")).toBeDefined()
    })
  })
})
