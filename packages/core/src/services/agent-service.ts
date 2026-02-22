/**
 * AgentService — Effect wrapper around @anthropic-ai/claude-agent-sdk query()
 *
 * Provides a typed Effect interface for dispatching sub-agents with structured
 * output schemas, tool permissions, and transcript streaming.
 *
 * Backends:
 * - Live: Real Agent SDK calls via dynamic import
 * - Noop: Returns empty results (tests, core commands)
 */

import { Context, Effect, Layer } from "effect"
import { execFileSync, spawn } from "node:child_process"
import { AgentError } from "../errors.js"
import { normalizeClaudeDebugLogPath } from "../utils/claude-debug-log.js"

// =============================================================================
// Types
// =============================================================================

export interface AgentRunConfig {
  readonly prompt: string
  readonly options?: {
    readonly tools?: readonly string[]
    readonly permissionMode?: string
    readonly allowDangerouslySkipPermissions?: boolean
    readonly model?: string
    readonly maxTurns?: number
    readonly persistSession?: boolean
    readonly outputFormat?: {
      readonly type: string
      readonly schema: Record<string, unknown>
    }
  }
}

export interface AgentRunResult {
  readonly text: string
  readonly structuredOutput: Record<string, unknown> | null
}

export type AgentMessageCallback = (message: unknown) => void

// =============================================================================
// Service Definition
// =============================================================================

/**
 * AgentService dispatches sub-agents via the Claude Agent SDK.
 */
export class AgentService extends Context.Tag("AgentService")<
  AgentService,
  {
    readonly run: (
      config: AgentRunConfig,
      onMessage?: AgentMessageCallback
    ) => Effect.Effect<AgentRunResult, AgentError>
  }
>() {}

// =============================================================================
// Live Implementation
// =============================================================================

/**
 * Live implementation using @anthropic-ai/claude-agent-sdk.
 * Dynamic import — agent SDK is an optional peer dependency.
 */
export const AgentServiceLive = Layer.effect(
  AgentService,
  Effect.sync(() => {
    type QueryFn = (opts: { prompt: string; options?: unknown }) => AsyncIterable<unknown>

    let cachedQueryFn: QueryFn | null = null
    let attemptedQueryImport = false
    let queryImportError: string | null = null

    const asNonEmptyString = (value: unknown): string | null =>
      typeof value === "string" && value.trim().length > 0 ? value.trim() : null

    const messageTextFromContent = (value: unknown): string | null => {
      if (!Array.isArray(value)) return null
      for (const entry of value) {
        if (!entry || typeof entry !== "object") continue
        const record = entry as Record<string, unknown>
        if (record.type === "text") {
          const textValue = asNonEmptyString(record.text)
          if (textValue) return textValue
        }
      }
      return null
    }

    const extractMessageText = (message: Record<string, unknown>): string | null => {
      const messageRecord =
        message.message && typeof message.message === "object"
          ? message.message as Record<string, unknown>
          : null
      if (!messageRecord) return null
      return messageTextFromContent(messageRecord.content)
    }

    const isAuthenticationFailure = (text: string): boolean =>
      /not logged in|\/login|authentication_failed|auth/i.test(text)

    const parseStructuredOutputFromText = (text: string): Record<string, unknown> | null => {
      const trimmed = text.trim()
      if (!trimmed) return null

      const candidates: string[] = [trimmed]
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (fenced?.[1]) {
        candidates.push(fenced[1].trim())
      }

      const firstBrace = trimmed.indexOf("{")
      const lastBrace = trimmed.lastIndexOf("}")
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
      }

      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(candidate)
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>
          }
        } catch {
          // Continue trying candidates.
        }
      }

      return null
    }

    const runWithCodexCli = async (
      config: AgentRunConfig,
      onMessage?: AgentMessageCallback
    ): Promise<AgentRunResult> => {
      const needsJson = config.options?.outputFormat?.type === "json_schema"
      const prompt = needsJson
        ? `${config.prompt}\n\nReturn ONLY a valid JSON object matching this schema:\n${JSON.stringify(config.options?.outputFormat?.schema ?? {}, null, 2)}`
        : config.prompt

      const args = ["exec", "--skip-git-repo-check", "--full-auto", prompt]

      return await new Promise<AgentRunResult>((resolve, reject) => {
        const child = spawn("codex", args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        })

        let stdout = ""
        let stderr = ""
        let exited = false

        child.stdout.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString()
        })

        child.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString()
        })

        child.on("error", (error) => {
          if (exited) return
          exited = true
          reject(new Error(`Codex CLI launch failed: ${error.message}`))
        })

        child.on("close", (code) => {
          if (exited) return
          exited = true

          const stdoutText = stdout.trim()
          const stderrText = stderr.trim()
          const combined = stdoutText || stderrText

          if (onMessage && combined) {
            onMessage({
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "text", text: combined }],
              },
            })
          }

          if (code !== 0) {
            reject(new Error(`Codex CLI failed (exit ${code}): ${combined || "no output"}`))
            return
          }

          resolve({
            text: stdoutText,
            structuredOutput: needsJson ? parseStructuredOutputFromText(stdoutText) : null,
          })
        })
      })
    }

    const isPidLive = (pid: number): boolean => {
      if (!Number.isFinite(pid) || pid <= 0) {
        return false
      }
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }

    const terminateClaudeSdkChildren = async (): Promise<void> => {
      let childPids: number[] = []
      try {
        const raw = execFileSync("pgrep", ["-P", String(process.pid)], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim()
        childPids = raw
          .split(/\s+/)
          .map((entry) => Number(entry))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
      } catch {
        return
      }

      const targets: number[] = []
      for (const pid of childPids) {
        try {
          const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim()
          if (cmd.includes("@anthropic-ai/claude-agent-sdk/cli.js")) {
            targets.push(pid)
          }
        } catch {
          // Child exited between discovery and inspection.
        }
      }

      for (const pid of targets) {
        try {
          process.kill(pid, "SIGTERM")
        } catch {
          // Ignore races if process already exited.
        }
      }

      if (targets.length > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 200)
        })
      }

      for (const pid of targets) {
        if (!isPidLive(pid)) continue
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // Ignore races if process already exited.
        }
      }
    }

    const loadClaudeQueryFn = async (): Promise<QueryFn | null> => {
      if (attemptedQueryImport) {
        return cachedQueryFn
      }
      attemptedQueryImport = true

      try {
        normalizeClaudeDebugLogPath()
        // @ts-ignore - @anthropic-ai/claude-agent-sdk is an optional peer dependency
        const mod = await import("@anthropic-ai/claude-agent-sdk")
        cachedQueryFn = mod.query as QueryFn
        return cachedQueryFn
      } catch (e) {
        queryImportError = `@anthropic-ai/claude-agent-sdk unavailable: ${e instanceof Error ? e.message : String(e)}`
        cachedQueryFn = null
        return null
      }
    }

    return {
      run: (config, onMessage) =>
        Effect.tryPromise({
          try: async () => {
            normalizeClaudeDebugLogPath()
            const queryFn = await loadClaudeQueryFn()

            if (!queryFn) {
              return await runWithCodexCli(config, onMessage)
            }

            let text = ""
            let structuredOutput: Record<string, unknown> | null = null
            let errorMessage: string | null = null

            try {
              for await (const message of queryFn({
                prompt: config.prompt,
                options: config.options,
              })) {
                if (onMessage) {
                  onMessage(message)
                }

                const msg = message as {
                  type?: string
                  subtype?: string
                  result?: string
                  structured_output?: Record<string, unknown>
                  errors?: string[]
                  is_error?: boolean
                  error?: string
                  message?: {
                    content?: Array<{ type?: string; text?: string }>
                  }
                }

                if (asNonEmptyString(msg.error)) {
                  const inlineText = asNonEmptyString(msg.result)
                  const nestedText = extractMessageText(message as Record<string, unknown>)
                  errorMessage = nestedText ?? inlineText ?? `Agent SDK error: ${String(msg.error)}`
                  break
                }

                if (msg.type === "result") {
                  const errorText =
                    (Array.isArray(msg.errors) ? msg.errors.find((entry) => asNonEmptyString(entry)) : null)
                    ?? asNonEmptyString(msg.result)
                    ?? (msg.subtype ? `Agent SDK ${msg.subtype}` : "Agent SDK unknown error")

                  if (msg.is_error === true || msg.subtype !== "success") {
                    errorMessage = errorText
                    break
                  }

                  text = msg.result ?? ""
                  structuredOutput = msg.structured_output ?? null
                }
              }
            } catch (e) {
              errorMessage = `Agent SDK stream failed: ${e instanceof Error ? e.message : String(e)}`
            }

            if (errorMessage) {
              if (isAuthenticationFailure(errorMessage)) {
                await terminateClaudeSdkChildren()
                return await runWithCodexCli(config, onMessage)
              }
              return Promise.reject(new Error(`Agent SDK error: ${errorMessage}`))
            }

            return { text, structuredOutput }
          },
          catch: (e) =>
            new AgentError({
              agent: "agent-service",
              reason: `Agent SDK call failed: ${e instanceof Error ? e.message : String(e)}${queryImportError ? ` (${queryImportError})` : ""}`,
              cause: e,
            }),
        }),
    }
  })
)

// =============================================================================
// Noop Implementation
// =============================================================================

/**
 * Noop implementation — returns empty results for all agent runs.
 * Used in test layers and core commands where no agent dispatch is needed.
 */
export const AgentServiceNoop = Layer.succeed(AgentService, {
  run: (_config, _onMessage) =>
    Effect.succeed({ text: "", structuredOutput: null }),
})
