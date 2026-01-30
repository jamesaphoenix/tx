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
