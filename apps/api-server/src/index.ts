/**
 * @jamesaphoenix/tx-api-server Library Entry Point
 *
 * This module provides the library exports for @jamesaphoenix/tx-api-server without
 * auto-starting the server. Use this for programmatic access.
 *
 * For CLI usage (auto-start), use: node dist/server.js
 */

// API definition and error types
export {
  TxApi,
  NotFound,
  BadRequest,
  InternalError,
  Unauthorized,
  Forbidden,
  ServiceUnavailable,
  mapCoreError,
  HealthGroup,
  TasksGroup,
  LearningsGroup,
  RunsGroup,
  SyncGroup,
} from "./api.js"

// Server layer factory
export { makeServerLive } from "./server-lib.js"

// Route handler layers
export { TasksLive } from "./routes/tasks.js"
export { HealthLive } from "./routes/health.js"
export { LearningsLive } from "./routes/learnings.js"
export { RunsLive } from "./routes/runs.js"
export { SyncLive } from "./routes/sync.js"
