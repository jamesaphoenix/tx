#!/usr/bin/env node
/**
 * TX MCP Server
 *
 * Model Context Protocol server for AI agent integration.
 * Provides task management, learnings, and file learnings tools.
 *
 * Usage:
 *   tx-mcp                    # Start with default database path
 *   tx-mcp --db /path/to.db   # Start with custom database path
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { initRuntime, disposeRuntime } from "./runtime.js"
import { registerTaskTools } from "./tools/task.js"
import { registerLearningTools } from "./tools/learning.js"
import { registerSyncTools } from "./tools/sync.js"

// Re-export for library consumers
export { initRuntime, disposeRuntime, runEffect, getRuntime } from "./runtime.js"
export type { McpServices } from "./runtime.js"
export { mcpResponse, mcpError } from "./response.js"
export type { McpContent, McpResponse } from "./response.js"
export { registerTaskTools, serializeTask } from "./tools/task.js"
export { registerLearningTools, serializeLearning, serializeLearningWithScore, serializeFileLearning } from "./tools/learning.js"
export { registerSyncTools, serializeExportResult, serializeImportResult, serializeSyncStatus, serializeCompactResult } from "./tools/sync.js"

// -----------------------------------------------------------------------------
// Server Creation
// -----------------------------------------------------------------------------

/**
 * Create the MCP server with all tool registrations.
 */
export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "tx",
    version: "0.1.0"
  })

  // Register all tools
  registerTaskTools(server)
  registerLearningTools(server)
  registerSyncTools(server)

  return server
}

// -----------------------------------------------------------------------------
// Server Lifecycle
// -----------------------------------------------------------------------------

/**
 * Start the MCP server with stdio transport.
 * Initializes runtime and begins accepting tool calls.
 * Registers graceful shutdown handlers for SIGINT/SIGTERM.
 */
export const startMcpServer = async (dbPath = ".tx/tasks.db"): Promise<void> => {
  // Initialize runtime (runs migrations, builds service layer ONCE)
  await initRuntime(dbPath)

  const server = createMcpServer()
  const transport = new StdioServerTransport()

  // Track shutdown state to prevent multiple cleanup attempts
  let isShuttingDown = false

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return
    }
    isShuttingDown = true

    try {
      // Close the MCP server connection
      await server.close()
    } catch (error) {
      // Log error but continue shutdown
      console.error(`MCP server close error during ${signal}:`, error)
    }

    try {
      // Dispose of the Effect runtime (releases database connections)
      await disposeRuntime()
    } catch (error) {
      // Log error but continue shutdown
      console.error(`Runtime dispose error during ${signal}:`, error)
    }

    process.exit(0)
  }

  // Register shutdown handlers
  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

  await server.connect(transport)
}

// -----------------------------------------------------------------------------
// CLI Entry Point
// -----------------------------------------------------------------------------

/**
 * Parse command line arguments and start the server.
 */
const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  let dbPath = ".tx/tasks.db"

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" && args[i + 1]) {
      dbPath = args[i + 1]
      i++
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
tx-mcp - TX MCP Server

Usage:
  tx-mcp [options]

Options:
  --db <path>    Path to SQLite database (default: .tx/tasks.db)
  --help, -h     Show this help message

Environment:
  The server communicates via stdio using the Model Context Protocol.
  Configure your MCP client to spawn this process.
`)
      process.exit(0)
    }
  }

  await startMcpServer(dbPath)
}

// Run if executed directly
main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
