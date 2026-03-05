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

const MAX_ERROR_LOG_STRING_LENGTH = 2048
const MAX_ERROR_LOG_ARRAY_ITEMS = 25
const MAX_ERROR_LOG_OBJECT_KEYS = 50
const MAX_ERROR_LOG_DEPTH = 4
const MAX_ERROR_LOG_STACK_LENGTH = 8192
const MAX_MCP_RESPONSE_TEXT_LENGTH = 128_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const truncateLogString = (value: string): string => {
  if (value.length <= MAX_ERROR_LOG_STRING_LENGTH) return value
  return `${value.slice(0, MAX_ERROR_LOG_STRING_LENGTH)}…[truncated ${value.length - MAX_ERROR_LOG_STRING_LENGTH} chars]`
}

const truncateLogStack = (value: string): string => {
  if (value.length <= MAX_ERROR_LOG_STACK_LENGTH) return value
  return `${value.slice(0, MAX_ERROR_LOG_STACK_LENGTH)}…[truncated ${value.length - MAX_ERROR_LOG_STACK_LENGTH} chars]`
}

const truncateResponseText = (value: string): string => {
  if (value.length <= MAX_MCP_RESPONSE_TEXT_LENGTH) return value
  return `${value.slice(0, MAX_MCP_RESPONSE_TEXT_LENGTH)}…[truncated ${value.length - MAX_MCP_RESPONSE_TEXT_LENGTH} chars]`
}

const sanitizeForErrorLog = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown => {
  if (typeof value === "string") return truncateLogString(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value
  }
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function") return "[Function]"
  if (depth >= MAX_ERROR_LOG_DEPTH) return "[TruncatedDepth]"

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ERROR_LOG_ARRAY_ITEMS).map((item) =>
      sanitizeForErrorLog(item, depth + 1, seen)
    )
    if (value.length > MAX_ERROR_LOG_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_ERROR_LOG_ARRAY_ITEMS} more items truncated]`)
    }
    return items
  }

  if (!isRecord(value)) {
    return String(value)
  }

  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  const entries = Object.entries(value)
  const trimmedEntries = entries.slice(0, MAX_ERROR_LOG_OBJECT_KEYS)
  const out: Record<string, unknown> = {}
  for (const [key, item] of trimmedEntries) {
    out[key] = sanitizeForErrorLog(item, depth + 1, seen)
  }
  if (entries.length > MAX_ERROR_LOG_OBJECT_KEYS) {
    out.__truncatedKeys = entries.length - MAX_ERROR_LOG_OBJECT_KEYS
  }
  return out
}

const sanitizeErrorArgs = (args: Record<string, unknown>): Record<string, unknown> => {
  const sanitized = sanitizeForErrorLog(args, 0, new WeakSet<object>())
  return isRecord(sanitized) ? sanitized : { value: sanitized }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Safely stringify a value, handling circular references.
 * Circular references are replaced with "[Circular]".
 */
export const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()

  const replacer = (_key: string, val: unknown): unknown => {
    if (typeof val === "bigint") {
      return val.toString()
    }
    if (val !== null && typeof val === "object") {
      if (seen.has(val)) {
        return "[Circular]"
      }
      seen.add(val)
    }
    return val
  }

  try {
    const serialized = JSON.stringify(value, replacer)
    return serialized ?? String(value)
  } catch {
    return "\"[Unserializable]\""
  }
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
    { type: "text" as const, text: truncateResponseText(text) },
    { type: "text" as const, text: truncateResponseText(safeStringify(data)) }
  ],
  isError: false
})

/**
 * Format an error MCP response with structured error data.
 */
export const mcpError = (error: unknown): McpResponse => ({
  content: [{
    type: "text" as const,
    text: truncateResponseText(`Error: ${extractErrorMessage(error)}`)
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
  message: truncateLogString(extractErrorMessage(error)),
  stack: truncateLogStack(formatErrorWithStack(error)),
  tool,
  args: sanitizeErrorArgs(args),
  timestamp: new Date().toISOString()
})

/**
 * Log a structured error to stderr.
 * MCP uses stdio for protocol communication so stderr is the correct channel.
 */
export const logToolError = (structured: StructuredError): void => {
  console.error(safeStringify(structured))
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
      {
        type: "text" as const,
        text: truncateResponseText(`Error [${structured.errorType}]: ${structured.message}`),
      },
      { type: "text" as const, text: truncateResponseText(structured.stack) },
      { type: "text" as const, text: truncateResponseText(safeStringify(structured)) }
    ],
    isError: true
  }
}
