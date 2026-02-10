/**
 * MCP Response Formatters
 *
 * Provides helpers for formatting MCP tool responses.
 * Includes structured error classification and logging for tool handlers.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface McpContent {
  type: "text"
  text: string
}

export interface McpResponse {
  [key: string]: unknown
  content: McpContent[]
  isError: boolean
}

/**
 * Return type for MCP tool handler functions.
 * Structurally identical to McpResponse — extracted here to avoid duplication
 * across tool modules (task.ts, sync.ts, learning.ts).
 */
export type McpToolResult = McpResponse

export interface StructuredError {
  errorType: string
  message: string
  stack: string
  tool: string
  args: Record<string, unknown>
  timestamp: string
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
// Error Classification
// -----------------------------------------------------------------------------

/**
 * Extract the error type tag from an error.
 * Effect-TS tagged errors have a `_tag` property.
 * Falls back to the constructor name or "UnknownError".
 */
export const classifyError = (error: unknown): string => {
  if (error !== null && typeof error === "object" && "_tag" in error && typeof error._tag === "string") {
    return error._tag
  }
  if (error instanceof Error) {
    return error.constructor.name === "Error" ? "Error" : error.constructor.name
  }
  return "UnknownError"
}

/**
 * Extract the error message from an error value.
 */
export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

// -----------------------------------------------------------------------------
// Stack Trace Preservation
// -----------------------------------------------------------------------------

/**
 * Format an error with its full stack trace preserved.
 * Handles Error instances, Effect-TS tagged errors, and arbitrary thrown values.
 *
 * - Effect-TS tagged errors: replaces generic "Error" header with _tag + message, preserves stack
 * - Error instances: uses `.stack` (which includes name + message + trace)
 * - Objects without stack: uses classifyError + extractErrorMessage + safeStringify
 * - Primitives: converts to string
 */
export const formatErrorWithStack = (error: unknown): string => {
  // Effect-TS tagged errors: _tag check before instanceof Error
  // because TaggedError extends Error but .stack header is generic "Error"
  if (error !== null && typeof error === "object" && "_tag" in error && typeof error._tag === "string") {
    const tag = error._tag
    const message = extractErrorMessage(error)
    if (error instanceof Error && error.stack) {
      // Replace the generic "Error" first line with tag: message
      const lines = error.stack.split("\n")
      lines[0] = `${tag}: ${message}`
      return lines.join("\n")
    }
    return `${tag}: ${message}`
  }
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }
  if (error !== null && typeof error === "object") {
    return `${classifyError(error)}: ${extractErrorMessage(error)}\n${safeStringify(error)}`
  }
  return String(error)
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
  ],
  isError: false
})

/**
 * Format an error MCP response with structured error data.
 */
export const mcpError = (error: unknown): McpResponse => ({
  content: [{
    type: "text" as const,
    text: `Error: ${extractErrorMessage(error)}`
  }],
  isError: true
})

// -----------------------------------------------------------------------------
// Structured Error Logging
// -----------------------------------------------------------------------------

/**
 * Build a structured error object with full context.
 */
export const buildStructuredError = (
  tool: string,
  args: Record<string, unknown>,
  error: unknown
): StructuredError => ({
  errorType: classifyError(error),
  message: extractErrorMessage(error),
  stack: formatErrorWithStack(error),
  tool,
  args,
  timestamp: new Date().toISOString()
})

/**
 * Log a structured error to stderr.
 * MCP uses stdio for protocol communication so stderr is the correct channel.
 */
export const logToolError = (structured: StructuredError): void => {
  console.error(JSON.stringify(structured))
}

/**
 * Handle a tool error: log structured context to stderr and return
 * a structured MCP error response with error type and details.
 *
 * Use this in tool handler catch blocks instead of inline error formatting.
 */
export const handleToolError = (
  tool: string,
  args: Record<string, unknown>,
  error: unknown
): McpResponse => {
  const structured = buildStructuredError(tool, args, error)
  logToolError(structured)
  return {
    content: [
      { type: "text" as const, text: `Error [${structured.errorType}]: ${structured.message}` },
      { type: "text" as const, text: structured.stack },
      { type: "text" as const, text: safeStringify(structured) }
    ],
    isError: true
  }
}
