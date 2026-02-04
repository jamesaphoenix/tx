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
import { healthRouter } from "./routes/health.js"
import { tasksRouter } from "./routes/tasks.js"
import { runsRouter } from "./routes/runs.js"
import { learningsRouter } from "./routes/learnings.js"
import { syncRouter } from "./routes/sync.js"

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
      { url: "http://localhost:3456", description: "Local development" }
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
  const port = options.port ?? parseInt(process.env.TX_API_PORT ?? "3456", 10)
  const hostname = options.hostname ?? process.env.TX_API_HOST ?? "0.0.0.0"
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

  // Register shutdown handlers
  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

  // Start server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname
  })

  const authStatus = isAuthEnabled() ? " (auth enabled)" : ""
  console.log(`TX API Server running at http://${hostname}:${port}${authStatus}`)
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
  --port, -p <port>  Port to listen on (default: 3456, env: TX_API_PORT)
  --host <host>      Hostname to bind to (default: localhost, env: TX_API_HOST)
  --db <path>        Path to SQLite database (default: .tx/tasks.db, env: TX_DB_PATH)
  --help, -h         Show this help message

Environment Variables:
  TX_API_PORT        Server port (default: 3456)
  TX_API_HOST        Server hostname (default: localhost)
  TX_DB_PATH         Database path (default: .tx/tasks.db)
  TX_API_KEY         API key for authentication (optional)
  TX_API_CORS_ORIGIN Allowed CORS origins (comma-separated, default: *)

Examples:
  tx-api                           # Start with defaults
  tx-api --port 8080               # Start on port 8080
  tx-api --db /path/to/tasks.db    # Use custom database
  TX_API_KEY=secret tx-api         # Enable API key auth
`)
      process.exit(0)
    }
  }

  await startServer({ port, dbPath, hostname })
}
