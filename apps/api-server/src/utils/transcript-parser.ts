/**
 * Transcript Parser for Claude JSONL files
 *
 * Parses Claude's conversation transcript files (~/.claude/projects/.../session.jsonl)
 * and converts them to a format suitable for display in the dashboard.
 */

import { Effect } from "effect"
import { readFile, readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

// Types for Claude transcript entries
interface TranscriptUserMessage {
  type: "user"
  message: {
    role: "user"
    content: string | Array<{ type: string; tool_use_id?: string; content?: string }>
  }
  timestamp: string
  uuid: string
}

interface ThinkingContent {
  type: "thinking"
  thinking: string
}

interface TextContent {
  type: "text"
  text: string
}

interface ToolUseContent {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

type AssistantContentItem = ThinkingContent | TextContent | ToolUseContent

interface TranscriptAssistantMessage {
  type: "assistant"
  message: {
    role: "assistant"
    content: AssistantContentItem[]
  }
  timestamp: string
  uuid: string
}

type TranscriptEntry = TranscriptUserMessage | TranscriptAssistantMessage | { type: string }

// Output format for dashboard
export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string | unknown
  type?: "tool_use" | "tool_result" | "text" | "thinking"
  tool_name?: string
  timestamp?: string
}

/**
 * Validate that a transcript path is under an allowed directory.
 * Prevents arbitrary file reads via path traversal.
 *
 * Allowed directories: ~/.claude/ and any .tx/ directory.
 */
export const isAllowedTranscriptPath = (filePath: string): boolean => {
  const homeDir = process.env.HOME || ""
  if (!homeDir) return false

  const expandedPath = filePath.replace(/^~/, homeDir)
  const resolved = resolve(expandedPath)

  const claudeDir = resolve(join(homeDir, ".claude"))

  // Allow paths under ~/.claude/
  if (resolved.startsWith(claudeDir + "/")) return true

  // Allow paths under any .tx/ directory
  if (resolved.includes("/.tx/")) return true

  return false
}

/**
 * Parse a Claude transcript JSONL file and extract conversation messages
 */
export const parseTranscript = (path: string): Effect.Effect<ChatMessage[], Error> =>
  Effect.gen(function* () {
    // Security: validate path is under allowed directories before any file I/O
    if (!isAllowedTranscriptPath(path)) {
      return yield* Effect.fail(
        new Error("Path traversal attempt: transcript path must be under ~/.claude/ or .tx/")
      )
    }

    return yield* Effect.tryPromise({
      try: async () => {
        // Expand ~ to home directory
        const expandedPath = path.replace(/^~/, process.env.HOME || "")

        if (!existsSync(expandedPath)) {
          return []
        }

        const content = await readFile(expandedPath, "utf-8")
      const lines = content.split("\n").filter((line) => line.trim())

      const messages: ChatMessage[] = []
      const seenUuids = new Set<string>()
      // Map tool_use_id -> tool_name so we can label tool results
      const toolNameById = new Map<string, string>()

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TranscriptEntry

          // Handle assistant messages first to build tool name map
          if (entry.type === "assistant") {
            const assistantEntry = entry as TranscriptAssistantMessage
            // Avoid duplicates from the same uuid
            if (seenUuids.has(assistantEntry.uuid)) continue
            seenUuids.add(assistantEntry.uuid)

            const contentItems = assistantEntry.message.content
            if (Array.isArray(contentItems)) {
              for (const item of contentItems) {
                if (item.type === "thinking") {
                  // Skip thinking blocks for cleaner display
                } else if (item.type === "text") {
                  // Skip empty text blocks (e.g., assistant messages with only thinking content)
                  if (!item.text || item.text.trim() === "") continue
                  messages.push({
                    role: "assistant",
                    content: item.text,
                    type: "text",
                    timestamp: assistantEntry.timestamp,
                  })
                } else if (item.type === "tool_use") {
                  // Track tool name by ID for correlating with results
                  toolNameById.set(item.id, item.name)
                  messages.push({
                    role: "assistant",
                    content: item.input,
                    type: "tool_use",
                    tool_name: item.name,
                    timestamp: assistantEntry.timestamp,
                  })
                }
              }
            }
          }

          // Handle user messages (tool results come as user messages)
          if (entry.type === "user") {
            const userEntry = entry as TranscriptUserMessage
            // Avoid duplicates from the same uuid
            if (seenUuids.has(userEntry.uuid)) continue
            seenUuids.add(userEntry.uuid)

            const content = userEntry.message.content
            if (typeof content === "string") {
              messages.push({
                role: "user",
                content: content,
                timestamp: userEntry.timestamp,
              })
            } else if (Array.isArray(content)) {
              // Handle tool results in user messages
              for (const item of content) {
                if (item.type === "tool_result") {
                  // Look up the tool name from the corresponding tool_use
                  const toolName = item.tool_use_id
                    ? toolNameById.get(item.tool_use_id)
                    : undefined
                  // tool_result content can be a string, an array of content blocks, or undefined
                  // Claude API sends arrays like [{type: "text", text: "..."}] for multi-block results
                  let resultContent: string = ""
                  const rawContent = item.content as unknown
                  if (typeof rawContent === "string") {
                    resultContent = rawContent
                  } else if (Array.isArray(rawContent)) {
                    // Extract text from content blocks: [{type: "text", text: "..."}]
                    resultContent = (rawContent as Array<{ type: string; text?: string }>)
                      .filter((block) => block.type === "text")
                      .map((block) => block.text ?? "")
                      .join("\n")
                  }
                  messages.push({
                    role: "user",
                    content: resultContent,
                    type: "tool_result",
                    tool_name: toolName,
                    timestamp: userEntry.timestamp,
                  })
                }
              }
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      return messages
    },
    catch: (error) => new Error(`Failed to parse transcript: ${String(error)}`),
  })
  })

/**
 * Check if a transcript file exists
 */
export const transcriptExists = (path: string): boolean => {
  const expandedPath = path.replace(/^~/, process.env.HOME || "")
  return existsSync(expandedPath)
}

/**
 * Find a transcript file that matches a run's time window.
 * Looks in ~/.claude/projects/<escaped-cwd>/ for JSONL files modified during the run.
 *
 * @param cwd - The working directory (used to find Claude's project directory)
 * @param startedAt - When the run started
 * @param endedAt - When the run ended (optional, uses now if not set)
 * @returns Path to the matching transcript, or null if none found
 */
export const findMatchingTranscript = async (
  cwd: string,
  startedAt: Date,
  endedAt?: Date | null
): Promise<string | null> => {
  const homeDir = process.env.HOME || ""
  if (!homeDir) return null

  // Convert cwd to Claude's escaped directory format
  // Claude CLI replaces ALL non-alphanumeric chars with dashes:
  // /Users/foo/my_project -> -Users-foo-my-project
  const escapedCwd = cwd.replace(/[^a-zA-Z0-9]/g, "-")
  const claudeProjectDir = join(homeDir, ".claude", "projects", escapedCwd)

  if (!existsSync(claudeProjectDir)) {
    return null
  }

  try {
    const files = await readdir(claudeProjectDir)
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"))

    if (jsonlFiles.length === 0) return null

    const startTime = startedAt.getTime()
    // Allow a 5-minute buffer for the run to end
    const endTime = endedAt ? endedAt.getTime() + 5 * 60 * 1000 : Date.now() + 5 * 60 * 1000

    // Find files modified within the run's time window
    const candidates: { path: string; mtime: number }[] = []

    for (const file of jsonlFiles) {
      const filePath = join(claudeProjectDir, file)
      try {
        const stats = await stat(filePath)
        const mtime = stats.mtime.getTime()

        // File was modified during the run window (with 1 minute buffer before start)
        if (mtime >= startTime - 60 * 1000 && mtime <= endTime) {
          candidates.push({ path: filePath, mtime })
        }
      } catch {
        // Skip files we can't stat
      }
    }

    if (candidates.length === 0) return null

    // Return the most recently modified file (most likely to be the run's transcript)
    candidates.sort((a, b) => b.mtime - a.mtime)
    return candidates[0].path
  } catch {
    return null
  }
}
