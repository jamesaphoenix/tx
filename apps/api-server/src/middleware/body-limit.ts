/**
 * Body Size Limit Middleware
 *
 * Prevents DoS via memory exhaustion by enforcing request body size limits.
 * - 1MB for standard API endpoints (tasks, learnings, runs)
 * - 5MB for spec batch ingestion endpoints (raw framework output)
 * - 10MB for sync endpoints (bulk data import/export)
 *
 * Uses two mechanisms:
 * 1. Content-Length header check for early rejection (fast path)
 * 2. MaxBodySize context for safety during body parsing (handles chunked encoding)
 */

import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import * as IncomingMessage from "@effect/platform/HttpIncomingMessage"
import { Effect, Option } from "effect"

/** Default body size limit: 1MB */
export const DEFAULT_MAX_BYTES = 1 * 1024 * 1024

/** Sync endpoint body size limit: 10MB */
export const SYNC_MAX_BYTES = 10 * 1024 * 1024

/** Spec batch endpoint body size limit: 5MB */
export const SPEC_BATCH_MAX_BYTES = 5 * 1024 * 1024

/**
 * Get the max body size limit based on the request path.
 * Sync endpoints get a higher limit (10MB) since they handle bulk data.
 * Spec batch endpoint gets 5MB for framework-native payloads.
 * All other endpoints get 1MB.
 * @internal Exported for testing.
 */
export const getMaxBytes = (url: string): number => {
  if (url.startsWith("/api/sync")) return SYNC_MAX_BYTES
  if (url.startsWith("/api/spec/batch")) return SPEC_BATCH_MAX_BYTES
  return DEFAULT_MAX_BYTES
}

/**
 * Body size limit middleware.
 *
 * Rejects requests with Content-Length exceeding the limit with 413 Payload Too Large.
 * Also sets MaxBodySize context as a safety net during body parsing
 * (handles chunked transfer encoding where Content-Length is absent).
 */
export const bodyLimitMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const maxBytes = getMaxBytes(request.url)

    const contentLength = request.headers["content-length"]
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (!isNaN(size) && size > maxBytes) {
        return yield* HttpServerResponse.json(
          { error: { code: "PAYLOAD_TOO_LARGE", message: `Request body exceeds maximum size of ${maxBytes} bytes` } },
          { status: 413 },
        ).pipe(Effect.orDie)
      }
    }

    // Set MaxBodySize for safety during body parsing (handles chunked transfer encoding)
    return yield* IncomingMessage.withMaxBodySize(httpApp, Option.some(maxBytes))
  }),
)
