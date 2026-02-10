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
import { AgentError } from "../errors.js"

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
  Effect.gen(function* () {
    // Dynamic import of Claude Agent SDK
    const queryFn = yield* Effect.tryPromise({
      try: async () => {
        // @ts-ignore - @anthropic-ai/claude-agent-sdk is an optional peer dependency
        const mod = await import("@anthropic-ai/claude-agent-sdk")
        return mod.query as (opts: { prompt: string; options?: unknown }) => AsyncIterable<unknown>
      },
      catch: (e) =>
        new AgentError({
          agent: "agent-service",
          reason: `@anthropic-ai/claude-agent-sdk not installed: ${e instanceof Error ? e.message : String(e)}`,
        }),
    })

    return {
      run: (config, onMessage) =>
        Effect.tryPromise({
          try: async () => {
            let text = ""
            let structuredOutput: Record<string, unknown> | null = null
            let errorMessage: string | null = null

            for await (const message of queryFn({
              prompt: config.prompt,
              options: config.options,
            })) {
              // Forward message to callback for transcript logging
              if (onMessage) {
                onMessage(message)
              }

              const msg = message as {
                type?: string
                subtype?: string
                result?: string
                structured_output?: Record<string, unknown>
                errors?: string[]
              }

              if (msg.type === "result") {
                if (msg.subtype === "success") {
                  text = msg.result ?? ""
                  structuredOutput = msg.structured_output ?? null
                } else {
                  errorMessage =
                    msg.errors?.join(", ") ?? msg.subtype ?? "unknown error"
                }
              }
            }

            if (errorMessage) {
              return Promise.reject(new Error(`Agent SDK error: ${errorMessage}`))
            }

            return { text, structuredOutput }
          },
          catch: (e) =>
            new AgentError({
              agent: "agent-service",
              reason: `Agent SDK call failed: ${e instanceof Error ? e.message : String(e)}`,
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
