/**
 * @tx/api-server Library Entry Point
 *
 * This module provides the library exports for @tx/api-server without
 * auto-starting the server. Use this for programmatic access.
 *
 * For CLI usage (auto-start), use: node dist/server.js
 */

// Re-export app creation
export { createApp, startServer } from "./server-lib.js"

// Re-export runtime management
export {
  initRuntime,
  disposeRuntime,
  runEffect,
  getRuntime,
  getDbPath,
} from "./runtime.js"
export type { ApiServices } from "./runtime.js"
