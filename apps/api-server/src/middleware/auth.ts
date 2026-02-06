/**
 * Authentication Middleware
 *
 * Provides optional API key authentication for securing endpoints.
 * Authentication is disabled by default; enable by setting TX_API_KEY env var.
 */

import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"

/**
 * Check if authentication is enabled.
 */
export const isAuthEnabled = (): boolean => !!process.env.TX_API_KEY

/**
 * Extract API key from request headers.
 * Supports both Authorization header (Bearer token) and X-Api-Key header.
 * @internal Exported for testing.
 */
export const extractApiKey = (headers: Record<string, string | undefined>): string | null => {
  const xApiKey = headers["x-api-key"]
  if (xApiKey) return xApiKey

  const authHeader = headers["authorization"]
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7)

  return null
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses Node.js crypto.timingSafeEqual for proper constant-time comparison.
 * @internal Exported for testing.
 */
export const timingSafeEqual = (provided: string, expected: string): boolean => {
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)

  // To avoid leaking length information, always perform a comparison.
  if (providedBuf.length !== expectedBuf.length) {
    cryptoTimingSafeEqual(expectedBuf, expectedBuf)
    return false
  }

  return cryptoTimingSafeEqual(providedBuf, expectedBuf)
}

/**
 * Effect HTTP authentication middleware.
 * Only validates if TX_API_KEY environment variable is set.
 * If not set, all requests pass through.
 */
export const authMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const requiredKey = process.env.TX_API_KEY

    // Skip auth if no API key is configured
    if (!requiredKey) return yield* httpApp

    const request = yield* HttpServerRequest.HttpServerRequest
    const url = request.url

    // Only require auth for /api routes
    if (!url.startsWith("/api")) return yield* httpApp

    const providedKey = extractApiKey(request.headers as unknown as Record<string, string | undefined>)

    if (!providedKey) {
      return yield* HttpServerResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Missing API key. Provide via X-Api-Key header or Authorization: Bearer <key>" } },
        { status: 401 }
      ).pipe(Effect.orDie)
    }

    if (!timingSafeEqual(providedKey, requiredKey)) {
      return yield* HttpServerResponse.json(
        { error: { code: "FORBIDDEN", message: "Invalid API key" } },
        { status: 403 }
      ).pipe(Effect.orDie)
    }

    return yield* httpApp
  })
)
