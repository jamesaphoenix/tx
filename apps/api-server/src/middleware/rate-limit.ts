/**
 * Rate Limiting Middleware
 *
 * Provides configurable rate limiting to protect the API from abuse.
 * Uses a sliding window algorithm with in-memory storage.
 *
 * Rate limiting is disabled by default; enable by setting TX_API_RATE_LIMIT env var.
 *
 * SECURITY NOTE: By default, proxy headers (X-Forwarded-For, X-Real-IP) are NOT trusted.
 * Set TX_API_TRUST_PROXY=true ONLY when running behind a trusted reverse proxy.
 * Otherwise, attackers can bypass rate limiting by spoofing these headers.
 */

import type { Context, Next } from "hono"
import type { HttpBindings } from "@hono/node-server"

/**
 * Rate limit configuration options.
 */
export interface RateLimitConfig {
  /** Maximum requests per window (default: 100) */
  max: number
  /** Window size in seconds (default: 60) */
  windowSec: number
  /** Message to return when rate limited */
  message: string
  /** Whether to skip rate limiting for health endpoints */
  skipHealthEndpoints: boolean
  /** Whether to trust proxy headers like X-Forwarded-For (default: false for security) */
  trustProxy: boolean
}

/**
 * IPv4 address pattern (basic validation).
 */
const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/

/**
 * IPv6 address pattern (basic validation - covers common formats).
 */
const IPV6_PATTERN = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$|^::1$|^::$/

/**
 * Validate that a string looks like a valid IP address.
 * This is a basic check to prevent obviously invalid or malicious values.
 */
const isValidIpFormat = (ip: string): boolean => {
  const trimmed = ip.trim()
  return IPV4_PATTERN.test(trimmed) || IPV6_PATTERN.test(trimmed)
}

/**
 * Entry tracking requests within a time window.
 */
interface RateLimitEntry {
  /** Request timestamps within the current window */
  timestamps: number[]
  /** When this entry should be cleaned up */
  expiresAt: number
}

/**
 * In-memory store for rate limit tracking.
 * Uses client IP as the key.
 */
const store = new Map<string, RateLimitEntry>()

/**
 * Cleanup interval for expired entries (5 minutes).
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/**
 * Start cleanup interval on first use.
 */
let cleanupStarted = false

const startCleanup = (): void => {
  if (cleanupStarted) return
  cleanupStarted = true

  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAt < now) {
        store.delete(key)
      }
    }
  }, CLEANUP_INTERVAL_MS).unref()
}

/**
 * Check if rate limiting is enabled.
 */
export const isRateLimitEnabled = (): boolean => {
  return !!process.env.TX_API_RATE_LIMIT
}

/**
 * Check if proxy headers should be trusted.
 * Only enable this when running behind a trusted reverse proxy.
 */
export const isTrustProxyEnabled = (): boolean => {
  return process.env.TX_API_TRUST_PROXY === "true"
}

/**
 * Get rate limit configuration from environment.
 */
const getConfig = (): RateLimitConfig => {
  const envValue = process.env.TX_API_RATE_LIMIT
  const max = envValue ? parseInt(envValue, 10) : 100

  return {
    max: isNaN(max) ? 100 : max,
    windowSec: parseInt(process.env.TX_API_RATE_LIMIT_WINDOW ?? "60", 10) || 60,
    message:
      process.env.TX_API_RATE_LIMIT_MESSAGE ?? "Too many requests, please try again later",
    skipHealthEndpoints: process.env.TX_API_RATE_LIMIT_SKIP_HEALTH !== "false",
    trustProxy: isTrustProxyEnabled()
  }
}

/**
 * Extract client IP from proxy headers (only when trustProxy is enabled).
 * Validates IP format to prevent malicious header values.
 */
const getIpFromProxyHeaders = (c: Context): string | null => {
  // Check X-Forwarded-For header
  const forwarded = c.req.header("X-Forwarded-For")
  if (forwarded) {
    // Take the first IP in the chain (original client)
    const ip = forwarded.split(",")[0].trim()
    if (isValidIpFormat(ip)) {
      return ip
    }
  }

  // Check X-Real-IP header
  const realIp = c.req.header("X-Real-IP")
  if (realIp) {
    const ip = realIp.trim()
    if (isValidIpFormat(ip)) {
      return ip
    }
  }

  return null
}

/**
 * Extract client IP from the connection (socket level).
 * Works with @hono/node-server when HttpBindings are available.
 */
const getConnectionIp = (c: Context<{ Bindings: HttpBindings }>): string | null => {
  try {
    // @hono/node-server exposes socket info via c.env.incoming
    const incoming = c.env?.incoming
    if (incoming?.socket?.remoteAddress) {
      const ip = incoming.socket.remoteAddress
      // Handle IPv6-mapped IPv4 addresses (::ffff:127.0.0.1 -> 127.0.0.1)
      if (ip.startsWith("::ffff:")) {
        return ip.slice(7)
      }
      return ip
    }
  } catch {
    // Connection info not available in this runtime
  }
  return null
}

/**
 * Extract client identifier from request.
 *
 * SECURITY: Only trusts proxy headers (X-Forwarded-For, X-Real-IP) when
 * TX_API_TRUST_PROXY=true. Otherwise, uses the actual connection IP.
 *
 * When running behind a trusted reverse proxy (nginx, cloud load balancer),
 * set TX_API_TRUST_PROXY=true to get the real client IP from headers.
 *
 * When NOT behind a proxy, leave TX_API_TRUST_PROXY unset (default: false)
 * to prevent attackers from bypassing rate limits by spoofing headers.
 */
const getClientId = (c: Context<{ Bindings: HttpBindings }>): string => {
  const config = getConfig()

  // Only trust proxy headers when explicitly enabled
  if (config.trustProxy) {
    const proxyIp = getIpFromProxyHeaders(c)
    if (proxyIp) {
      return proxyIp
    }
  }

  // Try to get the actual connection IP
  const connectionIp = getConnectionIp(c)
  if (connectionIp) {
    return connectionIp
  }

  // Fallback when connection info is not available
  // This is a secure default - all requests share one bucket, so rate limiting still works
  return "unknown"
}

/**
 * Check if the request should be rate limited.
 * Returns the number of remaining requests, or -1 if rate limited.
 */
const checkRateLimit = (clientId: string, config: RateLimitConfig): { remaining: number; resetAt: number } => {
  const now = Date.now()
  const windowMs = config.windowSec * 1000
  const windowStart = now - windowMs

  // Get or create entry for this client
  let entry = store.get(clientId)

  if (!entry) {
    entry = {
      timestamps: [],
      expiresAt: now + windowMs * 2 // Keep entries for 2 windows for sliding window accuracy
    }
    store.set(clientId, entry)
  }

  // Filter out timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart)

  // Update expiration
  entry.expiresAt = now + windowMs * 2

  // Calculate remaining requests
  const remaining = Math.max(0, config.max - entry.timestamps.length)

  // Calculate reset time (when oldest request in window expires)
  const resetAt =
    entry.timestamps.length > 0
      ? Math.ceil((entry.timestamps[0] + windowMs) / 1000)
      : Math.ceil((now + windowMs) / 1000)

  if (entry.timestamps.length >= config.max) {
    return { remaining: -1, resetAt }
  }

  // Record this request
  entry.timestamps.push(now)

  return { remaining: remaining - 1, resetAt }
}

/**
 * Rate limiting middleware.
 * Only applies rate limiting if TX_API_RATE_LIMIT environment variable is set.
 * If not set, all requests are allowed through.
 */
export const rateLimitMiddleware = async (c: Context, next: Next): Promise<void | Response> => {
  // Skip if rate limiting is not enabled
  if (!isRateLimitEnabled()) {
    return next()
  }

  const config = getConfig()

  // Skip health endpoints if configured
  if (config.skipHealthEndpoints) {
    const path = c.req.path
    if (path === "/health" || path === "/api/health" || path === "/healthz") {
      return next()
    }
  }

  // Start cleanup interval
  startCleanup()

  const clientId = getClientId(c)
  const { remaining, resetAt } = checkRateLimit(clientId, config)

  // Set rate limit headers
  c.header("X-RateLimit-Limit", String(config.max))
  c.header("X-RateLimit-Remaining", String(Math.max(0, remaining)))
  c.header("X-RateLimit-Reset", String(resetAt))

  if (remaining < 0) {
    const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000))
    c.header("Retry-After", String(retryAfter))

    return c.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: config.message
        }
      },
      429
    )
  }

  return next()
}

/**
 * Create rate limit middleware with custom configuration.
 * Useful for applying different limits to specific routes.
 */
export const createRateLimitMiddleware = (customConfig: Partial<RateLimitConfig>) => {
  const store = new Map<string, RateLimitEntry>()

  return async (c: Context, next: Next): Promise<void | Response> => {
    const defaultConfig = getConfig()
    const config = { ...defaultConfig, ...customConfig }

    // Start cleanup interval
    startCleanup()

    const clientId = getClientId(c)
    const now = Date.now()
    const windowMs = config.windowSec * 1000
    const windowStart = now - windowMs

    let entry = store.get(clientId)

    if (!entry) {
      entry = {
        timestamps: [],
        expiresAt: now + windowMs * 2
      }
      store.set(clientId, entry)
    }

    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart)
    entry.expiresAt = now + windowMs * 2

    const remaining = Math.max(0, config.max - entry.timestamps.length)
    const resetAt =
      entry.timestamps.length > 0
        ? Math.ceil((entry.timestamps[0] + windowMs) / 1000)
        : Math.ceil((now + windowMs) / 1000)

    c.header("X-RateLimit-Limit", String(config.max))
    c.header("X-RateLimit-Remaining", String(Math.max(0, remaining - 1)))
    c.header("X-RateLimit-Reset", String(resetAt))

    if (entry.timestamps.length >= config.max) {
      const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000))
      c.header("Retry-After", String(retryAfter))

      return c.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: config.message
          }
        },
        429
      )
    }

    entry.timestamps.push(now)
    return next()
  }
}

/**
 * Reset rate limit for a specific client.
 * Useful for testing or administrative purposes.
 */
export const resetRateLimit = (clientId: string): void => {
  store.delete(clientId)
}

/**
 * Clear all rate limit entries.
 * Useful for testing.
 */
export const clearAllRateLimits = (): void => {
  store.clear()
}
