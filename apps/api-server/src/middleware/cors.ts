/**
 * CORS Configuration
 *
 * Provides CORS configuration for the API server.
 * Default: localhost-only origins. Set TX_API_CORS_ORIGIN="*" for wildcard (not recommended in production).
 */

/** Default CORS origins: localhost on common dev ports. Never wildcard by default. */
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:5173",
]

export const getCorsConfig = () => {
  const originEnv = process.env.TX_API_CORS_ORIGIN
  return {
    allowedOrigins: originEnv
      ? originEnv === "*"
        ? ["*" as const]
        : originEnv.split(",").map((o) => o.trim())
      : DEFAULT_CORS_ORIGINS,
    allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const,
    allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
    exposedHeaders: ["X-Total-Count", "X-Next-Cursor"],
    maxAge: 86400,
    credentials: process.env.TX_API_CORS_CREDENTIALS === "true",
  }
}
