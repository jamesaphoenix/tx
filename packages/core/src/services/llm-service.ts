/**
 * LlmService — Centralized LLM completion service
 *
 * Provides a unified Effect interface for text completions, used by
 * CompactionService, QueryExpansionService, CandidateExtractorService, etc.
 *
 * Backends:
 * - AgentSdk: Uses Claude Agent SDK query() with maxTurns=1, no tools (no API key needed)
 * - Anthropic: Direct @anthropic-ai/sdk messages.create() (needs ANTHROPIC_API_KEY)
 * - Noop: Returns failures gracefully (tests, minimal layer)
 * - Auto: Agent SDK → Anthropic → Noop
 */

import { Context, Effect, Layer, Config, Option } from "effect"
import { LlmUnavailableError } from "../errors.js"
import { normalizeClaudeDebugLogPath } from "../utils/claude-debug-log.js"

// =============================================================================
// Types
// =============================================================================

// Domain types — used across service boundaries
// Note: These follow the same interface pattern as other tx services
// (CompactionResult, QueryExpansionResult, etc.)

export interface LlmCompletionRequest {
  /** The prompt to send to the LLM */
  readonly prompt: string
  /** Model to use (default: "claude-haiku-4-20250514") */
  readonly model?: string
  /** Maximum tokens in the response (default: 2048) */
  readonly maxTokens?: number
  /**
   * JSON Schema for structured outputs.
   * When provided, result.text is guaranteed valid JSON matching this schema.
   * Must be an object type at the top level.
   */
  readonly jsonSchema?: Record<string, unknown>
}

export interface LlmCompletionResult {
  /** The LLM's text response */
  readonly text: string
  /** Model that was actually used */
  readonly model: string
  /** Approximate tokens used (if available) */
  readonly tokensUsed?: number
  /** Duration of the LLM call in milliseconds */
  readonly durationMs?: number
}

// Types for Anthropic SDK (imported dynamically — internal, not domain types)
interface AnthropicMessage {
  content: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface AnthropicClient {
  messages: {
    create(params: {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: string }>
      output_config?: {
        format: {
          type: string
          schema: Record<string, unknown>
        }
      }
    }): Promise<AnthropicMessage>
  }
}

// =============================================================================
// Service Definition
// =============================================================================

/**
 * LlmService provides text completions from an LLM backend.
 *
 * This is the single point of contact for all LLM completion calls in tx.
 * Services like CompactionService, QueryExpansionService, and
 * CandidateExtractorService depend on this instead of managing their own
 * SDK clients.
 */
export class LlmService extends Context.Tag("LlmService")<
  LlmService,
  {
    /** Complete a prompt and return the LLM's text response */
    readonly complete: (request: LlmCompletionRequest) => Effect.Effect<LlmCompletionResult, LlmUnavailableError>
    /** Check if LLM functionality is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

// =============================================================================
// Model Mapping
// =============================================================================

/**
 * Map full Anthropic model IDs to Agent SDK shorthands.
 * Agent SDK uses "haiku", "sonnet", "opus" rather than full IDs.
 */
const toAgentSdkModel = (model: string): string | undefined => {
  if (model.includes("haiku")) return "haiku"
  if (model.includes("sonnet")) return "sonnet"
  if (model.includes("opus")) return "opus"
  return undefined
}

// =============================================================================
// Noop Implementation
// =============================================================================

/**
 * Noop implementation — returns failures for all completions.
 * Used in test layers and minimal layers where no LLM is needed.
 */
export const LlmServiceNoop = Layer.succeed(LlmService, {
  complete: (_request) =>
    Effect.fail(new LlmUnavailableError({ reason: "No LLM backend configured" })),
  isAvailable: () => Effect.succeed(false),
})

// =============================================================================
// Agent SDK Implementation
// =============================================================================

/**
 * Agent SDK implementation using Claude Agent SDK query() with maxTurns=1.
 *
 * Self-contained: dynamically imports @anthropic-ai/claude-agent-sdk directly.
 * No ANTHROPIC_API_KEY required — uses Claude Code's built-in authentication.
 */
export const LlmServiceAgentSdk = Layer.effect(
  LlmService,
  Effect.gen(function* () {
    // Dynamic import of Claude Agent SDK (optional peer dependency)
    const queryFn = yield* Effect.tryPromise({
      try: async () => {
        normalizeClaudeDebugLogPath()
        // @ts-ignore - @anthropic-ai/claude-agent-sdk is an optional peer dependency
        const mod = await import("@anthropic-ai/claude-agent-sdk")
        return mod.query as (opts: { prompt: string; options?: unknown }) => AsyncIterable<unknown>
      },
      catch: (e) =>
        new LlmUnavailableError({
          reason: `@anthropic-ai/claude-agent-sdk not installed: ${e instanceof Error ? e.message : String(e)}`,
        }),
    })

    return {
      complete: (request) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const model = request.model ?? "claude-haiku-4-20250514"

          const text = yield* Effect.tryPromise({
            try: async () => {
              normalizeClaudeDebugLogPath()
              let resultText = ""
              let assistantText = ""
              let errorMessage: string | null = null

              // Build options — structured output may need multiple turns
              const options: Record<string, unknown> = {
                model: toAgentSdkModel(model),
              }
              if (request.jsonSchema) {
                options.outputFormat = {
                  type: "json_schema",
                  schema: request.jsonSchema,
                }
              } else {
                // For plain text completions, restrict to 1 turn
                options.maxTurns = 1
              }

              for await (const message of queryFn({
                prompt: request.prompt,
                options,
              })) {
                const msg = message as Record<string, unknown>

                // Capture assistant text from message.message.content blocks
                if (msg.type === "assistant" && msg.message) {
                  const inner = msg.message as { content?: Array<{ type: string; text?: string }> }
                  if (inner.content) {
                    for (const block of inner.content) {
                      if (block.type === "text" && block.text) {
                        assistantText = block.text
                      }
                    }
                  }
                }

                if (msg.type === "result") {
                  if (msg.subtype === "success") {
                    // Prefer structured_output (already parsed) when using jsonSchema
                    if (msg.structured_output) {
                      resultText = JSON.stringify(msg.structured_output as Record<string, unknown>)
                    } else if (typeof msg.result === "string") {
                      resultText = msg.result
                    }
                  } else {
                    const errors = msg.errors as string[] | undefined
                    errorMessage =
                      errors?.join(", ") ?? String(msg.subtype ?? "unknown error")
                  }
                }
              }

              if (errorMessage) {
                return Promise.reject(new Error(`Agent SDK error: ${errorMessage}`))
              }

              // Fall back to assistant text if result was empty
              return resultText || assistantText
            },
            catch: (e) =>
              new LlmUnavailableError({
                reason: `Agent SDK completion failed: ${e instanceof Error ? e.message : String(e)}`,
              }),
          })

          return {
            text,
            model,
            durationMs: Date.now() - startTime,
          }
        }),

      isAvailable: () => Effect.succeed(true),
    }
  })
)

// =============================================================================
// Anthropic SDK Implementation
// =============================================================================

/**
 * Direct Anthropic SDK implementation.
 *
 * Uses @anthropic-ai/sdk with ANTHROPIC_API_KEY for environments without
 * Agent SDK access (e.g., standalone servers, CI pipelines).
 */
export const LlmServiceAnthropic = Layer.effect(
  LlmService,
  Effect.gen(function* () {
    // Read API key from environment
    const apiKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(
      Effect.mapError(
        () =>
          new LlmUnavailableError({
            reason: "ANTHROPIC_API_KEY environment variable is not set",
          })
      )
    )

    // Lazy-load client
    let client: AnthropicClient | null = null

    const ensureClient = Effect.gen(function* () {
      if (client) return client

      const Anthropic = yield* Effect.tryPromise({
        try: async () => {
          // @ts-ignore - @anthropic-ai/sdk is an optional peer dependency
          const mod = await import("@anthropic-ai/sdk")
          return mod.default
        },
        catch: () =>
          new LlmUnavailableError({
            reason: "@anthropic-ai/sdk is not installed",
          }),
      })

      // Cast required: SDK's overloaded create() signatures are structurally
      // incompatible with our simplified AnthropicClient interface
      client = new Anthropic({ apiKey }) as unknown as AnthropicClient
      return client
    })

    return {
      complete: (request) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const anthropic = yield* ensureClient
          const model = request.model ?? "claude-haiku-4-20250514"

          const response = yield* Effect.tryPromise({
            try: () =>
              anthropic.messages.create({
                model,
                max_tokens: request.maxTokens ?? 2048,
                messages: [
                  {
                    role: "user",
                    content: request.prompt,
                  },
                ],
                ...(request.jsonSchema ? {
                  output_config: {
                    format: {
                      type: "json_schema",
                      schema: request.jsonSchema,
                    },
                  },
                } : {}),
              }),
            catch: (e) =>
              new LlmUnavailableError({
                reason: `Anthropic API call failed: ${String(e)}`,
              }),
          })

          const textContent = response.content.find((c) => c.type === "text")
          return {
            text: textContent?.text ?? "",
            model,
            tokensUsed:
              (response.usage?.input_tokens ?? 0) +
              (response.usage?.output_tokens ?? 0),
            durationMs: Date.now() - startTime,
          }
        }),

      isAvailable: () => Effect.succeed(true),
    }
  })
)

// =============================================================================
// Auto-Detecting Implementation
// =============================================================================

/**
 * Auto-detecting layer that selects the best available LLM backend.
 *
 * Priority:
 * 1. Agent SDK available → LlmServiceAgentSdk (no API key needed)
 * 2. ANTHROPIC_API_KEY set → LlmServiceAnthropic
 * 3. Neither → LlmServiceNoop (graceful degradation)
 */
export const LlmServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    // Priority 1: Try Agent SDK (no API key required)
    const agentSdkAvailable = yield* Effect.tryPromise({
      try: async () => {
        normalizeClaudeDebugLogPath()
        // @ts-ignore - @anthropic-ai/claude-agent-sdk is an optional peer dependency
        await import("@anthropic-ai/claude-agent-sdk")
        return true
      },
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    if (agentSdkAvailable) {
      yield* Effect.logDebug("LlmService: Using Agent SDK (no API key required)")
      return LlmServiceAgentSdk
    }

    // Priority 2: Anthropic SDK with API key
    const anthropicKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(
      Effect.option
    )
    if (Option.isSome(anthropicKey) && anthropicKey.value.trim().length > 0) {
      yield* Effect.logDebug(
        "LlmService: Using Anthropic SDK (ANTHROPIC_API_KEY detected)"
      )
      return LlmServiceAnthropic
    }

    // Priority 3: Noop fallback
    yield* Effect.logDebug(
      "LlmService: Using noop (no LLM backend available)"
    )
    return LlmServiceNoop
  })
)
