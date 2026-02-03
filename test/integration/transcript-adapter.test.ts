import { describe, it, expect } from "vitest"
import {
  ClaudeCodeAdapter,
  GenericJSONLAdapter,
  getAdapter,
  registerAdapter,
  type TranscriptAdapter
} from "@jamesaphoenix/tx-core/services"

/**
 * Sample Claude Code stream-json transcript lines.
 * Based on actual --output-format stream-json output.
 */
const sampleClaudeCodeLines = [
  // User message
  JSON.stringify({
    type: "user",
    timestamp: "2026-01-30T17:38:14.831Z",
    message: {
      role: "user",
      content: "Read the task file and implement it"
    }
  }),
  // Assistant thinking (should be captured in messages)
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-30T17:38:18.380Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "I'll read the task details first" },
        { type: "text", text: "Let me read the task file." }
      ]
    }
  }),
  // Tool use
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-30T17:38:19.369Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01WSLaQF3pwTz2NmwVXhsEg2",
          name: "Read",
          input: { file_path: "/project/task.md" }
        }
      ]
    }
  }),
  // Tool result
  JSON.stringify({
    type: "user",
    timestamp: "2026-01-30T17:38:20.100Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01WSLaQF3pwTz2NmwVXhsEg2",
          content: "# Task: Implement feature X"
        }
      ]
    }
  }),
  // Another tool use (Bash)
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-30T17:38:21.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_011VgLJRCaYRbYGmZQ1P6UXv",
          name: "Bash",
          input: { command: "npm run build", description: "Build the project" }
        }
      ]
    }
  }),
  // Tool result for Bash
  JSON.stringify({
    type: "user",
    timestamp: "2026-01-30T17:38:25.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_011VgLJRCaYRbYGmZQ1P6UXv",
          content: "Build succeeded"
        }
      ]
    }
  }),
  // Final assistant message
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-30T17:38:26.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "The build completed successfully." }]
    }
  })
]

/**
 * Sample generic JSONL format (not Claude Code specific).
 */
const sampleGenericLines = [
  JSON.stringify({
    role: "user",
    timestamp: "2026-01-30T10:00:00.000Z",
    content: "Hello, can you help me?"
  }),
  JSON.stringify({
    role: "assistant",
    timestamp: "2026-01-30T10:00:01.000Z",
    content: "Sure, I'd be happy to help!"
  }),
  JSON.stringify({
    tool: "ReadFile",
    timestamp: "2026-01-30T10:00:02.000Z",
    input: { path: "/file.txt" },
    result: "File contents here"
  }),
  JSON.stringify({
    name: "WriteFile",
    timestamp: "2026-01-30T10:00:03.000Z",
    args: { path: "/output.txt", content: "Hello" }
  })
]

describe("ClaudeCodeAdapter", () => {
  describe("canHandle", () => {
    it("handles agent types containing 'claude'", () => {
      expect(ClaudeCodeAdapter.canHandle("claude-code")).toBe(true)
      expect(ClaudeCodeAdapter.canHandle("claude")).toBe(true)
      expect(ClaudeCodeAdapter.canHandle("my-claude-agent")).toBe(true)
    })

    it("handles agent types starting with 'tx-'", () => {
      expect(ClaudeCodeAdapter.canHandle("tx-implementer")).toBe(true)
      expect(ClaudeCodeAdapter.canHandle("tx-decomposer")).toBe(true)
      expect(ClaudeCodeAdapter.canHandle("tx-planner")).toBe(true)
    })

    it("rejects unrelated agent types", () => {
      expect(ClaudeCodeAdapter.canHandle("codex")).toBe(false)
      expect(ClaudeCodeAdapter.canHandle("gpt-4")).toBe(false)
      expect(ClaudeCodeAdapter.canHandle("custom-agent")).toBe(false)
    })
  })

  describe("parseToolCalls", () => {
    it("extracts tool calls from stream-json transcript", () => {
      const toolCalls = ClaudeCodeAdapter.parseToolCalls(sampleClaudeCodeLines)

      expect(toolCalls).toHaveLength(2)

      // First tool call: Read
      expect(toolCalls[0].name).toBe("Read")
      expect(toolCalls[0].id).toBe("toolu_01WSLaQF3pwTz2NmwVXhsEg2")
      expect(toolCalls[0].input).toEqual({ file_path: "/project/task.md" })
      expect(toolCalls[0].timestamp).toBe("2026-01-30T17:38:19.369Z")
      expect(toolCalls[0].result).toBe("# Task: Implement feature X")

      // Second tool call: Bash
      expect(toolCalls[1].name).toBe("Bash")
      expect(toolCalls[1].id).toBe("toolu_011VgLJRCaYRbYGmZQ1P6UXv")
      expect(toolCalls[1].input).toEqual({ command: "npm run build", description: "Build the project" })
      expect(toolCalls[1].result).toBe("Build succeeded")
    })

    it("handles empty input", () => {
      const toolCalls = ClaudeCodeAdapter.parseToolCalls([])
      expect(toolCalls).toHaveLength(0)
    })

    it("handles invalid JSON gracefully", () => {
      const lines = [
        "not valid json",
        JSON.stringify({ type: "assistant", timestamp: "2026-01-30T17:38:19.369Z", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } }),
        "{ broken json"
      ]
      const toolCalls = ClaudeCodeAdapter.parseToolCalls(lines)
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe("Read")
    })

    it("handles tool calls without results", () => {
      const lines = [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-30T17:38:19.369Z",
          message: {
            content: [{ type: "tool_use", id: "orphan", name: "Edit", input: { file: "test.ts" } }]
          }
        })
      ]
      const toolCalls = ClaudeCodeAdapter.parseToolCalls(lines)
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].result).toBeUndefined()
    })
  })

  describe("parseMessages", () => {
    it("extracts messages from stream-json transcript", () => {
      const messages = ClaudeCodeAdapter.parseMessages(sampleClaudeCodeLines)

      // Should have: 1 user message + 2 assistant messages (thinking+text, final text)
      // Tool result entries are skipped
      expect(messages).toHaveLength(3)

      // First user message
      expect(messages[0].role).toBe("user")
      expect(messages[0].content).toBe("Read the task file and implement it")
      expect(messages[0].timestamp).toBe("2026-01-30T17:38:14.831Z")

      // Assistant thinking + text
      expect(messages[1].role).toBe("assistant")
      expect(messages[1].content).toContain("I'll read the task details first")
      expect(messages[1].content).toContain("Let me read the task file.")

      // Final assistant message
      expect(messages[2].role).toBe("assistant")
      expect(messages[2].content).toBe("The build completed successfully.")
    })

    it("skips entries that only contain tool_use", () => {
      const lines = [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-30T17:38:19.369Z",
          message: {
            content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }]
          }
        })
      ]
      const messages = ClaudeCodeAdapter.parseMessages(lines)
      expect(messages).toHaveLength(0)
    })

    it("skips entries that only contain tool_result", () => {
      const lines = [
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-30T17:38:20.100Z",
          message: {
            content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }]
          }
        })
      ]
      const messages = ClaudeCodeAdapter.parseMessages(lines)
      expect(messages).toHaveLength(0)
    })

    it("handles empty input", () => {
      const messages = ClaudeCodeAdapter.parseMessages([])
      expect(messages).toHaveLength(0)
    })
  })
})

describe("GenericJSONLAdapter", () => {
  describe("canHandle", () => {
    it("handles any agent type (fallback)", () => {
      expect(GenericJSONLAdapter.canHandle("anything")).toBe(true)
      expect(GenericJSONLAdapter.canHandle("codex")).toBe(true)
      expect(GenericJSONLAdapter.canHandle("")).toBe(true)
    })
  })

  describe("parseToolCalls", () => {
    it("extracts tool calls from generic format", () => {
      const toolCalls = GenericJSONLAdapter.parseToolCalls(sampleGenericLines)

      expect(toolCalls).toHaveLength(2)

      // Tool call with 'tool' field
      expect(toolCalls[0].name).toBe("ReadFile")
      expect(toolCalls[0].input).toEqual({ path: "/file.txt" })
      expect(toolCalls[0].result).toBe("File contents here")

      // Tool call with 'name' field and 'args'
      expect(toolCalls[1].name).toBe("WriteFile")
      expect(toolCalls[1].input).toEqual({ path: "/output.txt", content: "Hello" })
    })

    it("handles various input field names", () => {
      const lines = [
        JSON.stringify({ tool: "A", input: { x: 1 } }),
        JSON.stringify({ name: "B", args: { y: 2 } }),
        JSON.stringify({ function: "C", arguments: { z: 3 } })
      ]
      const toolCalls = GenericJSONLAdapter.parseToolCalls(lines)

      expect(toolCalls).toHaveLength(3)
      expect(toolCalls[0].name).toBe("A")
      expect(toolCalls[0].input).toEqual({ x: 1 })
      expect(toolCalls[1].name).toBe("B")
      expect(toolCalls[1].input).toEqual({ y: 2 })
      expect(toolCalls[2].name).toBe("C")
      expect(toolCalls[2].input).toEqual({ z: 3 })
    })
  })

  describe("parseMessages", () => {
    it("extracts messages from generic format", () => {
      const messages = GenericJSONLAdapter.parseMessages(sampleGenericLines)

      expect(messages).toHaveLength(2)

      expect(messages[0].role).toBe("user")
      expect(messages[0].content).toBe("Hello, can you help me?")

      expect(messages[1].role).toBe("assistant")
      expect(messages[1].content).toBe("Sure, I'd be happy to help!")
    })

    it("handles various content field names", () => {
      const lines = [
        JSON.stringify({ role: "user", content: "content field" }),
        JSON.stringify({ role: "assistant", text: "text field" }),
        JSON.stringify({ type: "user", message: "message field" })
      ]
      const messages = GenericJSONLAdapter.parseMessages(lines)

      expect(messages).toHaveLength(3)
      expect(messages[0].content).toBe("content field")
      expect(messages[1].content).toBe("text field")
      expect(messages[2].content).toBe("message field")
    })
  })
})

describe("getAdapter", () => {
  it("returns ClaudeCodeAdapter for claude agent types", () => {
    const adapter = getAdapter("claude-code")
    expect(adapter).toBe(ClaudeCodeAdapter)
  })

  it("returns ClaudeCodeAdapter for tx- agent types", () => {
    const adapter = getAdapter("tx-implementer")
    expect(adapter).toBe(ClaudeCodeAdapter)
  })

  it("returns GenericJSONLAdapter for unknown agent types", () => {
    const adapter = getAdapter("codex")
    expect(adapter).toBe(GenericJSONLAdapter)
  })

  it("returns GenericJSONLAdapter for empty agent type", () => {
    const adapter = getAdapter("")
    expect(adapter).toBe(GenericJSONLAdapter)
  })
})

describe("registerAdapter", () => {
  it("allows registering custom adapters with priority", () => {
    // Create a custom adapter for "codex" agent type
    const customAdapter: TranscriptAdapter = {
      canHandle: (agentType) => agentType === "codex",
      parseToolCalls: () => [{ timestamp: "test", name: "custom", input: {} }],
      parseMessages: () => [{ timestamp: "test", role: "user", content: "custom" }]
    }

    // Register it
    registerAdapter(customAdapter)

    // Now "codex" should use the custom adapter
    const adapter = getAdapter("codex")
    expect(adapter.canHandle("codex")).toBe(true)
    const toolCalls = adapter.parseToolCalls([])
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].name).toBe("custom")
  })
})
