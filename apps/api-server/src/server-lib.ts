/**
 * TX API Server Library
 *
 * REST/HTTP API server with OpenAPI documentation.
 * Provides HTTP interface for task management, learnings, runs, and sync.
 *
 * This module provides the library API. For CLI usage, see server.ts.
 */

import { OpenAPIHono } from "@hono/zod-openapi"
import { swaggerUI } from "@hono/swagger-ui"
import { serve } from "@hono/node-server"
import { initRuntime, disposeRuntime } from "./runtime.js"
import { errorHandler, notFoundHandler } from "./middleware/error.js"
import { corsMiddleware } from "./middleware/cors.js"
import { authMiddleware, isAuthEnabled } from "./middleware/auth.js"
import { rateLimitMiddleware, isRateLimitEnabled } from "./middleware/rate-limit.js"
import { healthRouter } from "./routes/health.js"
import { tasksRouter } from "./routes/tasks.js"
import { runsRouter } from "./routes/runs.js"
import { learningsRouter } from "./routes/learnings.js"
import { syncRouter } from "./routes/sync.js"

// -----------------------------------------------------------------------------
// Signal Handler State (prevents handler accumulation/memory leak)
// -----------------------------------------------------------------------------

// Store handler references so we can remove them before adding new ones
let currentSigintHandler: (() => void) | null = null
let currentSigtermHandler: (() => void) | null = null

/**
 * Remove any existing signal handlers to prevent accumulation.
 * Called before registering new handlers.
 */
const removeSignalHandlers = (): void => {
  if (currentSigintHandler) {
    process.removeListener("SIGINT", currentSigintHandler)
    currentSigintHandler = null
  }
  if (currentSigtermHandler) {
    process.removeListener("SIGTERM", currentSigtermHandler)
    currentSigtermHandler = null
  }
}

// -----------------------------------------------------------------------------
// App Creation
// -----------------------------------------------------------------------------

/**
 * Create the Hono app with all routes and middleware.
 */
export const createApp = (): OpenAPIHono => {
  const app = new OpenAPIHono()

  // Global middleware
  app.use("*", corsMiddleware())
  app.use("*", rateLimitMiddleware)
  app.use("*", errorHandler)
  app.use("/api/*", authMiddleware)

  // Mount routers
  app.route("/", healthRouter)
  app.route("/", tasksRouter)
  app.route("/", runsRouter)
  app.route("/", learningsRouter)
  app.route("/", syncRouter)

  // OpenAPI documentation
  app.doc("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "TX API",
      version: "0.1.0",
      description: "REST API for tx task management system"
    },
    servers: [
      { url: "http://localhost:3001", description: "Local development" }
    ],
    tags: [
      { name: "Health", description: "Health check and statistics" },
      { name: "Tasks", description: "Task CRUD and dependency management" },
      { name: "Runs", description: "Agent run tracking" },
      { name: "Learnings", description: "Learnings and file learnings" },
      { name: "File Learnings", description: "File-specific learnings" },
      { name: "Sync", description: "JSONL sync operations" }
    ]
  })

  // Swagger UI
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }))

  // Not found handler
  app.notFound(notFoundHandler)

  return app
}

// -----------------------------------------------------------------------------
// Server Lifecycle
// -----------------------------------------------------------------------------

/**
 * Start the API server.
 */
export const startServer = async (options: {
  port?: number
  dbPath?: string
  hostname?: string
}): Promise<void> => {
  const port = options.port ?? parseInt(process.env.TX_API_PORT ?? "3001", 10)
  const hostname = options.hostname ?? process.env.TX_API_HOST ?? "127.0.0.1"
  const dbPath = options.dbPath ?? process.env.TX_DB_PATH ?? ".tx/tasks.db"

  // Initialize Effect runtime
  await initRuntime(dbPath)

  const app = createApp()

  // Track shutdown state
  let isShuttingDown = false

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log(`\n${signal} received, shutting down...`)

    try {
      await disposeRuntime()
    } catch (error) {
      console.error("Error during shutdown:", error)
    }

    process.exit(0)
  }

  // Remove any existing handlers to prevent accumulation (memory leak fix)
  removeSignalHandlers()

  // Register shutdown handlers and store references for cleanup
  currentSigintHandler = () => gracefulShutdown("SIGINT")
  currentSigtermHandler = () => gracefulShutdown("SIGTERM")
  process.on("SIGINT", currentSigintHandler)
  process.on("SIGTERM", currentSigtermHandler)

  // Start server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname
  })

  const authStatus = isAuthEnabled() ? " auth" : ""
  const rateLimitStatus = isRateLimitEnabled() ? " rate-limit" : ""
  const enabledFeatures = [authStatus, rateLimitStatus].filter(Boolean).join(",")
  const statusSuffix = enabledFeatures ? ` (${enabledFeatures.trim()} enabled)` : ""
  console.log(`TX API Server running at http://${hostname}:${port}${statusSuffix}`)
  console.log(`  OpenAPI docs: http://${hostname}:${port}/api/docs`)
  console.log(`  Database: ${dbPath}`)

  // Keep server running
  await new Promise<void>((resolve) => {
    server.on("close", resolve)
  })
}

// -----------------------------------------------------------------------------
// CLI Support Functions
// -----------------------------------------------------------------------------

/**
 * Parse command line arguments and start the server.
 * Exported for use by the CLI entry point.
 */
export const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  let port: number | undefined
  let dbPath: string | undefined
  let hostname: string | undefined

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    if ((arg === "--port" || arg === "-p") && nextArg) {
      port = parseInt(nextArg, 10)
      i++
    } else if (arg === "--db" && nextArg) {
      dbPath = nextArg
      i++
    } else if ((arg === "--host" || arg === "-h") && nextArg && !nextArg.startsWith("-")) {
      hostname = nextArg
      i++
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
tx-api - TX REST API Server

Usage:
  tx-api [options]

Options:
  --port, -p <port>  Port to listen on (default: 3001, env: TX_API_PORT)
  --host <host>      Hostname to bind to (default: localhost, env: TX_API_HOST)
  --db <path>        Path to SQLite database (default: .tx/tasks.db, env: TX_DB_PATH)
  --help, -h         Show this help message

Environment Variables:
  TX_API_PORT              Server port (default: 3001)
  TX_API_HOST              Server hostname (default: localhost)
  TX_DB_PATH               Database path (default: .tx/tasks.db)
  TX_API_KEY               API key for authentication (optional)
  TX_API_CORS_ORIGIN       Allowed CORS origins (comma-separated, default: *)
  TX_API_RATE_LIMIT        Max requests per window (enables rate limiting)
  TX_API_RATE_LIMIT_WINDOW Window size in seconds (default: 60)
  TX_API_TRUST_PROXY       Trust X-Forwarded-For headers (default: false)
                           Only set to 'true' when behind a trusted proxy!

Examples:
  tx-api                           # Start with defaults
  tx-api --port 8080               # Start on port 8080
  tx-api --db /path/to/tasks.db    # Use custom database
  TX_API_KEY=secret tx-api         # Enable API key auth
  TX_API_RATE_LIMIT=100 tx-api     # Enable rate limiting (100 req/min)
`)
      process.exit(0)
    }
  }

  await startServer({ port, dbPath, hostname })
}
