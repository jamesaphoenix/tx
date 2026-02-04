/**
 * API Server Runtime
 *
 * Re-exports server layer factory for programmatic access.
 * With the Effect HttpApi architecture, the server lifecycle is managed
 * by Effect's runtime — no ManagedRuntime bridge needed.
 */

export { makeServerLive } from "./server-lib.js"
export { TxApi } from "./api.js"
