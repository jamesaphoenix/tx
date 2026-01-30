/**
 * CORS Middleware Configuration
 *
 * Configures Cross-Origin Resource Sharing for the API.
 */

import { cors } from "hono/cors"

/**
 * CORS options configurable via environment variables.
 */
export interface CorsOptions {
  /** Allowed origins (comma-separated in env, or "*" for all) */
  allowOrigin?: string | string[]
  /** Allowed HTTP methods */
  allowMethods?: string[]
  /** Allowed request headers */
  allowHeaders?: string[]
  /** Headers exposed to the client */
  exposeHeaders?: string[]
  /** Max age for preflight cache (seconds) */
  maxAge?: number
  /** Whether to allow credentials */
  credentials?: boolean
}

/**
 * Get CORS configuration from environment or use defaults.
 */
const getCorsConfig = (): CorsOptions => {
  const originEnv = process.env.TX_API_CORS_ORIGIN
  const origin = originEnv
    ? originEnv === "*"
      ? "*"
      : originEnv.split(",").map(o => o.trim())
    : "*"

  return {
    allowOrigin: origin,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
    exposeHeaders: ["X-Total-Count", "X-Next-Cursor"],
    maxAge: 86400, // 24 hours
    credentials: process.env.TX_API_CORS_CREDENTIALS === "true"
  }
}

/**
 * Create configured CORS middleware.
 */
export const corsMiddleware = () => {
  const config = getCorsConfig()

  return cors({
    origin: config.allowOrigin ?? "*",
    allowMethods: config.allowMethods,
    allowHeaders: config.allowHeaders,
    exposeHeaders: config.exposeHeaders,
    maxAge: config.maxAge,
    credentials: config.credentials
  })
}
