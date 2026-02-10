/**
 * MCP Server Runtime Management
 *
 * Provides Effect runtime lifecycle management for the MCP server.
 * The runtime is initialized once at startup and shared across all tool calls.
 */

import { Effect, ManagedRuntime } from "effect"
import {
  makeAppLayer,
  TaskService,
  ReadyService,
  DependencyService,
  HierarchyService,
  LearningService,
  FileLearningService,
  SyncService,
  MessageService,
  DocService
} from "@jamesaphoenix/tx-core"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type McpServices =
  | TaskService
  | ReadyService
  | DependencyService
  | HierarchyService
  | LearningService
  | FileLearningService
  | SyncService
  | MessageService
  | DocService

// -----------------------------------------------------------------------------
// Runtime State
// -----------------------------------------------------------------------------

let managedRuntime: ManagedRuntime.ManagedRuntime<McpServices, any> | null = null

// -----------------------------------------------------------------------------
// Runtime Lifecycle
// -----------------------------------------------------------------------------

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
    return Promise.reject(new Error("Runtime not initialized. Call initRuntime() first."))
  }
  return managedRuntime.runPromise(effect)
}

/**
 * Get the current runtime for advanced use cases.
 * Returns null if not initialized.
 */
export const getRuntime = (): ManagedRuntime.ManagedRuntime<McpServices, any> | null => {
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
