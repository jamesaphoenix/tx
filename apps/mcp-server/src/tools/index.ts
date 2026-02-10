/**
 * MCP Tools Index
 *
 * Re-exports all tool registration functions and serializers.
 */

// -----------------------------------------------------------------------------
// MCP List Operation Limits
// -----------------------------------------------------------------------------

/**
 * Default limit for MCP list operations when no limit is specified.
 * Prevents unbounded queries from consuming excessive memory.
 */
export const MCP_DEFAULT_LIMIT = 100

/**
 * Maximum allowed limit for MCP list operations.
 * Caps user-provided limits to prevent memory exhaustion.
 */
export const MCP_MAX_LIMIT = 1000

/**
 * Normalize a user-provided limit to be within safe bounds.
 * Returns MCP_DEFAULT_LIMIT if undefined, caps at MCP_MAX_LIMIT otherwise.
 */
export const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined) return MCP_DEFAULT_LIMIT
  return Math.min(Math.max(1, limit), MCP_MAX_LIMIT)
}

// -----------------------------------------------------------------------------
// Tool exports
// -----------------------------------------------------------------------------

export { registerTaskTools, serializeTask } from "./task.js"
export { registerLearningTools, serializeLearning, serializeLearningWithScore, serializeFileLearning } from "./learning.js"
export { registerSyncTools, serializeExportResult, serializeImportResult, serializeSyncStatus, serializeCompactResult } from "./sync.js"
export { registerMessageTools, serializeMessage } from "./message.js"
export { registerDocTools, serializeDoc, serializeDocLink } from "./doc.js"
export { registerInvariantTools } from "./invariant.js"
