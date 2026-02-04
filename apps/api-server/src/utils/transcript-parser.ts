/**
 * Transcript Parser for Claude JSONL files
 *
 * Parses Claude's conversation transcript files (~/.claude/projects/.../session.jsonl)
 * and converts them to a format suitable for display in the dashboard.
 */

import { Effect } from "effect"
import { readFile, readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

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
 * Parse a Claude transcript JSONL file and extract conversation messages
 */
export const parseTranscript = (path: string): Effect.Effect<ChatMessage[], Error> =>
  Effect.tryPromise({
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

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TranscriptEntry

          // Handle user messages
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
                  messages.push({
                    role: "user",
                    content: item.content || "",
                    type: "tool_result",
                    timestamp: userEntry.timestamp,
                  })
                }
              }
            }
          }

          // Handle assistant messages
          if (entry.type === "assistant") {
            const assistantEntry = entry as TranscriptAssistantMessage
            // Avoid duplicates from the same uuid
            if (seenUuids.has(assistantEntry.uuid)) continue
            seenUuids.add(assistantEntry.uuid)

            const contentItems = assistantEntry.message.content
            if (Array.isArray(contentItems)) {
              for (const item of contentItems) {
                if (item.type === "thinking") {
                  // Skip thinking blocks for cleaner display, but can be included if needed
                  // messages.push({
                  //   role: "assistant",
                  //   content: item.thinking,
                  //   type: "thinking",
                  //   timestamp: assistantEntry.timestamp,
                  // })
                } else if (item.type === "text") {
                  messages.push({
                    role: "assistant",
                    content: item.text,
                    type: "text",
                    timestamp: assistantEntry.timestamp,
                  })
                } else if (item.type === "tool_use") {
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
        } catch {
          // Skip malformed lines
        }
      }

      return messages
    },
    catch: (error) => new Error(`Failed to parse transcript: ${String(error)}`),
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
  // e.g., /Users/foo/project -> -Users-foo-project
  const escapedCwd = cwd.replace(/\//g, "-").replace(/^-/, "")
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
