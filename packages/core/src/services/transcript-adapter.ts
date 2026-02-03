/**
 * TranscriptAdapter - Abstracts parsing of LLM transcript formats.
 *
 * Different LLM tools produce different transcript formats:
 * - Claude Code: JSONL with stream-json format
 * - Future: Codex, Cursor, custom agents
 *
 * Adapters provide a unified interface for extracting tool calls
 * and messages regardless of the source format.
 *
 * → DD-019: Primitive 3 (Transcript Adapters)
 */

/**
 * Represents a parsed tool call from a transcript.
 */
export interface ToolCall {
  /** ISO timestamp of when the tool call occurred */
  readonly timestamp: string
  /** Name of the tool (e.g., "Read", "Bash", "Edit") */
  readonly name: string
  /** Input parameters passed to the tool */
  readonly input: Record<string, unknown>
  /** Tool call ID for correlation with results */
  readonly id?: string
  /** Result of the tool call, if available */
  readonly result?: string
}

/**
 * Represents a parsed message from a transcript.
 */
export interface Message {
  /** ISO timestamp of when the message occurred */
  readonly timestamp: string
  /** Role of the message sender */
  readonly role: "user" | "assistant"
  /** Text content of the message */
  readonly content: string
}

/**
 * Interface for adapters that parse different transcript formats.
 * Implement this to support new LLM tools.
 */
export interface TranscriptAdapter {
  /**
   * Parse tool calls from transcript lines.
   * @param lines - Raw JSONL lines from the transcript file
   * @returns Array of parsed tool calls
   */
  readonly parseToolCalls: (lines: readonly string[]) => readonly ToolCall[]

  /**
   * Parse messages from transcript lines.
   * @param lines - Raw JSONL lines from the transcript file
   * @returns Array of parsed messages
   */
  readonly parseMessages: (lines: readonly string[]) => readonly Message[]

  /**
   * Check if this adapter can handle the given agent type.
   * Used for adapter registry selection.
   * @param agentType - The agent type from runs.agent column
   * @returns true if this adapter can parse transcripts from this agent
   */
  readonly canHandle: (agentType: string) => boolean
}

/**
 * Helper to safely parse a JSON line, returning null on error.
 */
const safeParseJson = (line: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Extract text content from Claude Code message content array.
 * Content can be a string or an array of content blocks.
 */
const extractTextContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text?: string; thinking?: string } =>
          typeof block === "object" && block !== null
      )
      .map((block) => {
        if (block.type === "text" && typeof block.text === "string") {
          return block.text
        }
        if (block.type === "thinking" && typeof block.thinking === "string") {
          return block.thinking
        }
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

/**
 * ClaudeCodeAdapter - Parses Claude Code's --output-format stream-json.
 *
 * Format details:
 * - Each line is a JSON object with a top-level `type` field
 * - Tool calls: type="assistant" with message.content[].type="tool_use"
 * - Messages: type="user" or type="assistant"
 * - Timestamps are at the top level
 */
export const ClaudeCodeAdapter: TranscriptAdapter = {
  canHandle: (agentType) =>
    agentType.includes("claude") ||
    agentType.includes("tx-") ||
    agentType === "claude-code",

  parseToolCalls: (lines) => {
    const toolCalls: ToolCall[] = []
    const toolResults = new Map<string, string>()

    // First pass: collect tool results
    for (const line of lines) {
      const entry = safeParseJson(line)
      if (!entry) continue

      // Tool results come as type="user" with content[].type="tool_result"
      if (entry.type === "user") {
        const message = entry.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>).type === "tool_result"
            ) {
              const toolResult = block as Record<string, unknown>
              const toolUseId = toolResult.tool_use_id as string | undefined
              const resultContent = toolResult.content
              if (toolUseId && typeof resultContent === "string") {
                toolResults.set(toolUseId, resultContent)
              }
            }
          }
        }
      }
    }

    // Second pass: collect tool calls
    for (const line of lines) {
      const entry = safeParseJson(line)
      if (!entry) continue

      // Tool calls come as type="assistant" with content[].type="tool_use"
      if (entry.type === "assistant") {
        const timestamp = (entry.timestamp as string) ?? new Date().toISOString()
        const message = entry.message as Record<string, unknown> | undefined
        const content = message?.content

        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>).type === "tool_use"
            ) {
              const toolUse = block as Record<string, unknown>
              const id = toolUse.id as string | undefined
              const name = toolUse.name as string | undefined
              const input = (toolUse.input as Record<string, unknown>) ?? {}

              if (name) {
                toolCalls.push({
                  timestamp,
                  name,
                  input,
                  id,
                  result: id ? toolResults.get(id) : undefined
                })
              }
            }
          }
        }
      }
    }

    return toolCalls
  },

  parseMessages: (lines) => {
    const messages: Message[] = []

    for (const line of lines) {
      const entry = safeParseJson(line)
      if (!entry) continue

      const timestamp = (entry.timestamp as string) ?? new Date().toISOString()

      if (entry.type === "user") {
        const message = entry.message as Record<string, unknown> | undefined
        if (!message) continue

        // Skip tool results - those are handled in parseToolCalls
        const content = message.content
        if (Array.isArray(content)) {
          const hasOnlyToolResults = content.every(
            (block) =>
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>).type === "tool_result"
          )
          if (hasOnlyToolResults) continue
        }

        const text = extractTextContent(message.content)
        if (text) {
          messages.push({
            timestamp,
            role: "user",
            content: text
          })
        }
      } else if (entry.type === "assistant") {
        const message = entry.message as Record<string, unknown> | undefined
        if (!message) continue

        // Skip entries that only contain tool_use blocks
        const content = message.content
        if (Array.isArray(content)) {
          const hasOnlyToolUse = content.every(
            (block) =>
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>).type === "tool_use"
          )
          if (hasOnlyToolUse) continue
        }

        const text = extractTextContent(message.content)
        if (text) {
          messages.push({
            timestamp,
            role: "assistant",
            content: text
          })
        }
      }
    }

    return messages
  }
}

/**
 * GenericJSONLAdapter - Fallback adapter for unknown JSONL formats.
 *
 * Attempts to parse common patterns:
 * - Tool calls: entries with `tool`, `name`, or `function` fields
 * - Messages: entries with `role` or `type` indicating user/assistant
 *
 * Less strict parsing to handle various custom formats.
 */
export const GenericJSONLAdapter: TranscriptAdapter = {
  canHandle: () => true, // Always matches as fallback

  parseToolCalls: (lines) => {
    const toolCalls: ToolCall[] = []

    for (const line of lines) {
      const entry = safeParseJson(line)
      if (!entry) continue

      // Look for common tool call patterns
      const name =
        (entry.tool as string) ??
        (entry.name as string) ??
        (entry.function as string) ??
        ((entry.tool_call as Record<string, unknown>)?.name as string)

      if (name) {
        toolCalls.push({
          timestamp: (entry.timestamp as string) ?? new Date().toISOString(),
          name,
          input:
            (entry.input as Record<string, unknown>) ??
            (entry.args as Record<string, unknown>) ??
            (entry.arguments as Record<string, unknown>) ??
            ((entry.tool_call as Record<string, unknown>)
              ?.arguments as Record<string, unknown>) ??
            {},
          id: entry.id as string | undefined,
          result: entry.result as string | undefined
        })
      }
    }

    return toolCalls
  },

  parseMessages: (lines) => {
    const messages: Message[] = []

    for (const line of lines) {
      const entry = safeParseJson(line)
      if (!entry) continue

      // Determine role from common patterns
      const role =
        (entry.role as string) ??
        (entry.type as string) ??
        (entry.sender as string)

      if (role === "user" || role === "assistant") {
        const content =
          (entry.content as string) ??
          (entry.text as string) ??
          (entry.message as string)

        if (content) {
          messages.push({
            timestamp: (entry.timestamp as string) ?? new Date().toISOString(),
            role,
            content
          })
        }
      }
    }

    return messages
  }
}

/**
 * Registry of available transcript adapters.
 * Order matters - first matching adapter is used.
 */
const adapters: readonly TranscriptAdapter[] = [
  ClaudeCodeAdapter,
  // Future: CodexAdapter, CursorAdapter, etc.
  GenericJSONLAdapter // Fallback - always matches
]

/**
 * Get the appropriate adapter for the given agent type.
 * Returns GenericJSONLAdapter if no specific adapter matches.
 *
 * @param agentType - The agent type from runs.agent column
 * @returns The adapter to use for parsing transcripts
 */
export function getAdapter(agentType: string): TranscriptAdapter {
  return adapters.find((a) => a.canHandle(agentType)) ?? GenericJSONLAdapter
}

/**
 * Register a custom adapter at the beginning of the registry.
 * Custom adapters take precedence over built-in ones.
 *
 * @param adapter - The adapter to register
 */
export function registerAdapter(adapter: TranscriptAdapter): void {
  // Insert at the beginning, before GenericJSONLAdapter fallback
  ;(adapters as TranscriptAdapter[]).unshift(adapter)
}
