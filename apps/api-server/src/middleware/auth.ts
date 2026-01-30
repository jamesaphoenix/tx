/**
 * Authentication Middleware
 *
 * Provides optional API key authentication for securing endpoints.
 * Authentication is disabled by default; enable by setting TX_API_KEY env var.
 */

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
 * Constant-time string comparison to prevent timing attacks.
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}
