/**
 * Authentication Middleware
 *
 * Provides optional API key authentication for securing endpoints.
 * Authentication is disabled by default; enable by setting TX_API_KEY env var.
 */

import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto"
import type { Context, Next } from "hono"
import { HTTPException } from "hono/http-exception"

/**
 * Check if authentication is enabled.
 */
export const isAuthEnabled = (): boolean => {
  return !!process.env.TX_API_KEY
}

/**
 * Get the configured API key.
 */
const getApiKey = (): string | undefined => {
  return process.env.TX_API_KEY
}

/**
 * Extract API key from request.
 * Supports both Authorization header (Bearer token) and X-Api-Key header.
 */
const extractApiKey = (c: Context): string | null => {
  // Check X-Api-Key header first
  const xApiKey = c.req.header("X-Api-Key")
  if (xApiKey) {
    return xApiKey
  }

  // Check Authorization header (Bearer token)
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  return null
}

/**
 * API key authentication middleware.
 * Only validates if TX_API_KEY environment variable is set.
 * If not set, all requests are allowed through.
 */
export const authMiddleware = async (c: Context, next: Next): Promise<void | Response> => {
  const requiredKey = getApiKey()

  // Skip auth if no API key is configured
  if (!requiredKey) {
    return next()
  }

  const providedKey = extractApiKey(c)

  if (!providedKey) {
    throw new HTTPException(401, {
      message: "Missing API key. Provide via X-Api-Key header or Authorization: Bearer <key>"
    })
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(providedKey, requiredKey)) {
    throw new HTTPException(403, {
      message: "Invalid API key"
    })
  }

  return next()
}

/**
 * Check if a request has valid authentication.
 * Returns true if auth is disabled OR if request has valid API key.
 * Use this for endpoints that should work without auth but expose more info when authenticated.
 */
export const isRequestAuthenticated = (c: Context): boolean => {
  const requiredKey = getApiKey()

  // If no API key configured, consider all requests "authenticated" (auth disabled)
  if (!requiredKey) {
    return true
  }

  const providedKey = extractApiKey(c)
  if (!providedKey) {
    return false
  }

  return timingSafeEqual(providedKey, requiredKey)
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses Node.js crypto.timingSafeEqual for proper constant-time comparison.
 */
const timingSafeEqual = (provided: string, expected: string): boolean => {
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)

  // To avoid leaking length information, always perform a comparison.
  // If lengths differ, compare expected against itself (still constant-time) then return false.
  if (providedBuf.length !== expectedBuf.length) {
    cryptoTimingSafeEqual(expectedBuf, expectedBuf)
    return false
  }

  return cryptoTimingSafeEqual(providedBuf, expectedBuf)
}
