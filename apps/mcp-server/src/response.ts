/**
 * MCP Response Formatters
 *
 * Provides helpers for formatting MCP tool responses.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface McpContent {
  type: "text"
  text: string
}

export interface McpResponse {
  content: McpContent[]
  isError?: boolean
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Safely stringify a value, handling circular references.
 * Circular references are replaced with "[Circular]".
 */
export const safeStringify = (value: unknown): string => {
  const seen = new WeakSet()

  const replacer = (_key: string, val: unknown): unknown => {
    if (val !== null && typeof val === "object") {
      if (seen.has(val)) {
        return "[Circular]"
      }
      seen.add(val)
    }
    return val
  }

  return JSON.stringify(value, replacer)
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
    { type: "text" as const, text: safeStringify(data) }
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
