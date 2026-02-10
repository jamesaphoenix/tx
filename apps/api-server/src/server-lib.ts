/**
 * TX API Server Library
 *
 * REST/HTTP API server using Effect HttpApi.
 * Provides HTTP interface for task management, learnings, runs, and sync.
 *
 * This module provides the library API. For CLI usage, see server.ts.
 */

import { HttpApiBuilder } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"
import { createServer } from "node:http"
import { makeAppLayer, LlmServiceNoop } from "@jamesaphoenix/tx-core"
import { TasksLive } from "./routes/tasks.js"
import { HealthLive } from "./routes/health.js"
import { LearningsLive } from "./routes/learnings.js"
import { RunsLive } from "./routes/runs.js"
import { SyncLive } from "./routes/sync.js"
import { MessagesLive } from "./routes/messages.js"
import { CyclesLive } from "./routes/cycles.js"
import { DocsLive } from "./routes/docs.js"
import { TxApi } from "./api.js"
import { authMiddleware, isAuthEnabled } from "./middleware/auth.js"
import { bodyLimitMiddleware } from "./middleware/body-limit.js"
import { getCorsConfig } from "./middleware/cors.js"

// -----------------------------------------------------------------------------
// API Implementation Layer
// -----------------------------------------------------------------------------

/**
 * Combines all route handler groups into the full API implementation.
 */
const ApiLive = HttpApiBuilder.api(TxApi).pipe(
  Layer.provide(TasksLive),
  Layer.provide(HealthLive),
  Layer.provide(LearningsLive),
  Layer.provide(RunsLive),
  Layer.provide(SyncLive),
  Layer.provide(MessagesLive),
  Layer.provide(CyclesLive),
  Layer.provide(DocsLive),
)

// -----------------------------------------------------------------------------
// Server Layer Factory
// -----------------------------------------------------------------------------

/**
 * Create the full server Layer with all dependencies resolved.
 *
 * The returned Layer, when launched, starts the HTTP server and keeps
 * it alive until the process receives a termination signal.
 */
export const makeServerLive = (options: {
  port?: number
  dbPath?: string
  hostname?: string
}) => {
  const port = options.port ?? parseInt(process.env.TX_API_PORT ?? "3001", 10)
  const host = options.hostname ?? process.env.TX_API_HOST ?? "127.0.0.1"
  const dbPath = options.dbPath ?? process.env.TX_DB_PATH ?? ".tx/tasks.db"

  const appLayer = makeAppLayer(dbPath)

  return HttpApiBuilder.serve().pipe(
    Layer.provide(HttpApiBuilder.middleware(bodyLimitMiddleware)),
    Layer.provide(HttpApiBuilder.middlewareCors(getCorsConfig())),
    Layer.provide(HttpApiBuilder.middleware(authMiddleware)),
    Layer.provide(ApiLive),
    Layer.provide(appLayer),
    Layer.provide(LlmServiceNoop),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port, host })),
  )
}

// -----------------------------------------------------------------------------
// CLI Support
// -----------------------------------------------------------------------------

const HELP_TEXT = `
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
  TX_API_CORS_ORIGIN       Allowed CORS origins (comma-separated, default: localhost only)
                           Use "*" to allow all origins (not recommended for production)

Examples:
  tx-api                           # Start with defaults
  tx-api --port 8080               # Start on port 8080
  tx-api --db /path/to/tasks.db    # Use custom database
  TX_API_KEY=secret tx-api         # Enable API key auth
`

/**
 * Parse command line arguments and launch the server.
 * Exported for use by the CLI entry point.
 */
export const main = (): void => {
  const args = process.argv.slice(2)
  let port: number | undefined
  let dbPath: string | undefined
  let hostname: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    if ((arg === "--port" || arg === "-p") && nextArg) {
      port = parseInt(nextArg, 10)
      i++
    } else if (arg === "--db" && nextArg) {
      dbPath = nextArg
      i++
    } else if (arg === "--host") {
      if (nextArg && !nextArg.startsWith("-")) {
        hostname = nextArg
        i++
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(HELP_TEXT)
      process.exit(0)
    }
  }

  const resolvedPort = port ?? parseInt(process.env.TX_API_PORT ?? "3001", 10)
  const resolvedHost = hostname ?? process.env.TX_API_HOST ?? "127.0.0.1"
  const resolvedDb = dbPath ?? process.env.TX_DB_PATH ?? ".tx/tasks.db"

  const authStatus = isAuthEnabled() ? " (auth enabled)" : ""
  console.log(`TX API Server running at http://${resolvedHost}:${resolvedPort}${authStatus}`)
  console.log(`  Database: ${resolvedDb}`)

  const ServerLive = makeServerLive({
    port: resolvedPort,
    dbPath: resolvedDb,
    hostname: resolvedHost,
  })

  NodeRuntime.runMain(Layer.launch(ServerLive))
}
