/**
 * MCP Server Infrastructure
 *
 * Provides:
 * - initRuntime: Initialize Effect runtime ONCE at startup
 * - runEffect: Run Effect using the pre-built runtime
 * - mcpResponse/mcpError: Format MCP responses
 * - createMcpServer/startMcpServer: Server lifecycle
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Effect, ManagedRuntime } from "effect"

import { TaskService } from "../services/task-service.js"
import { ReadyService } from "../services/ready-service.js"
import { DependencyService } from "../services/dep-service.js"
import { HierarchyService } from "../services/hierarchy-service.js"
import { makeAppLayer } from "../layer.js"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type McpServices = TaskService | ReadyService | DependencyService | HierarchyService

export interface McpContent {
  type: "text"
  text: string
}

export interface McpResponse {
  content: McpContent[]
  isError?: boolean
}

// -----------------------------------------------------------------------------
// Runtime
// -----------------------------------------------------------------------------

let managedRuntime: ManagedRuntime.ManagedRuntime<McpServices, never> | null = null

/**
 * Initialize the Effect runtime ONCE at server startup.
 * Creates the full service layer with database connection.
 */
export const initRuntime = async (dbPath = ".tx/tasks.db"): Promise<void> => {
  if (managedRuntime) {
    return // Already initialized
  }

  const appLayer = makeAppLayer(dbPath)
  managedRuntime = ManagedRuntime.make(appLayer)
}

/**
 * Run an Effect using the pre-built runtime.
 * Must call initRuntime() first.
 */
export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, McpServices>
): Promise<A> => {
  if (!managedRuntime) {
    throw new Error("Runtime not initialized. Call initRuntime() first.")
  }
  return managedRuntime.runPromise(effect)
}

/**
 * Get the current runtime for advanced use cases.
 * Returns null if not initialized.
 */
export const getRuntime = (): ManagedRuntime.ManagedRuntime<McpServices, never> | null => {
  return managedRuntime
}

/**
 * Dispose of the runtime and release resources.
 * Call when shutting down the server.
 */
export const disposeRuntime = async (): Promise<void> => {
  if (managedRuntime) {
    await managedRuntime.dispose()
    managedRuntime = null
  }
}

// -----------------------------------------------------------------------------
// Response Formatters
// -----------------------------------------------------------------------------

/**
 * Format a successful MCP response with text summary and JSON data.
 */
export const mcpResponse = (text: string, data: unknown): McpResponse => ({
  content: [
    { type: "text" as const, text },
    { type: "text" as const, text: JSON.stringify(data) }
  ]
})

/**
 * Format an error MCP response.
 */
export const mcpError = (error: unknown): McpResponse => ({
  content: [{
    type: "text" as const,
    text: `Error: ${error instanceof Error ? error.message : String(error)}`
  }],
  isError: true
})

// -----------------------------------------------------------------------------
// Server Creation
// -----------------------------------------------------------------------------

/**
 * Create the MCP server with tool registrations.
 * Tools are registered here (will be expanded in subsequent tasks).
 */
export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "tx",
    version: "0.1.0"
  })

  // Tools will be registered here in subsequent tasks
  // See: tx-5452e877 (Register core MCP tools)

  return server
}

/**
 * Start the MCP server with stdio transport.
 * Initializes runtime and begins accepting tool calls.
 */
export const startMcpServer = async (dbPath = ".tx/tasks.db"): Promise<void> => {
  // Initialize runtime (runs migrations, builds service layer ONCE)
  await initRuntime(dbPath)

  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
