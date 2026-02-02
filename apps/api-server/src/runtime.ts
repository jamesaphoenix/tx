/**
 * API Server Runtime Management
 *
 * Provides Effect runtime lifecycle management for the HTTP API server.
 * The runtime is initialized once at startup and shared across all requests.
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
  AttemptService,
  RunRepository
} from "@tx/core"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ApiServices =
  | TaskService
  | ReadyService
  | DependencyService
  | HierarchyService
  | LearningService
  | FileLearningService
  | SyncService
  | AttemptService
  | RunRepository

// -----------------------------------------------------------------------------
// Runtime State
// -----------------------------------------------------------------------------

let managedRuntime: ManagedRuntime.ManagedRuntime<ApiServices, any> | null = null
let currentDbPath: string | null = null

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

  currentDbPath = dbPath
  const appLayer = makeAppLayer(dbPath)
  managedRuntime = ManagedRuntime.make(appLayer)
}

/**
 * Run an Effect using the pre-built runtime.
 * Must call initRuntime() first.
 */
export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, ApiServices>
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
export const getRuntime = (): ManagedRuntime.ManagedRuntime<ApiServices, any> | null => {
  return managedRuntime
}

/**
 * Get the current database path.
 * Returns null if runtime not initialized.
 */
export const getDbPath = (): string | null => {
  return currentDbPath
}

/**
 * Dispose of the runtime and release resources.
 * Call when shutting down the server.
 */
export const disposeRuntime = async (): Promise<void> => {
  if (managedRuntime) {
    await managedRuntime.dispose()
    managedRuntime = null
    currentDbPath = null
  }
}
