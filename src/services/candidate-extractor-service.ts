import { Context, Effect, Layer, Config, Option } from "effect"
import { ExtractionUnavailableError } from "../errors.js"

// =============================================================================
// Types (defined locally for the root package)
// =============================================================================

/**
 * Confidence level for extracted learning candidates.
 */
type CandidateConfidence = "high" | "medium" | "low"

/**
 * Category of the extracted learning.
 */
type CandidateCategory =
  | "architecture"
  | "testing"
  | "performance"
  | "security"
  | "debugging"
  | "tooling"
  | "patterns"
  | "other"

/**
 * A chunk of transcript content to be analyzed for learning extraction.
 */
interface TranscriptChunk {
  readonly content: string
  readonly sourceFile: string
  readonly sourceRunId?: string | null
  readonly sourceTaskId?: string | null
  readonly byteOffset?: number
  readonly lineRange?: { start: number; end: number }
}

/**
 * A learning candidate extracted from a transcript by the LLM.
 */
interface ExtractedCandidate {
  readonly content: string
  readonly confidence: CandidateConfidence
  readonly category: CandidateCategory
}

/**
 * Result of candidate extraction from a transcript chunk.
 */
interface ExtractionResult {
  readonly candidates: readonly ExtractedCandidate[]
  readonly sourceChunk: TranscriptChunk
  readonly wasExtracted: boolean
  readonly metadata?: {
    readonly model?: string
    readonly tokensUsed?: number
    readonly durationMs?: number
  }
}

// =============================================================================
// SDK Types (imported dynamically)
// =============================================================================

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
    }): Promise<AnthropicMessage>
  }
}

interface OpenAIMessage {
  choices: Array<{
    message: { content: string | null }
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface OpenAIClient {
  chat: {
    completions: {
      create(params: {
        model: string
        max_tokens: number
        messages: Array<{ role: string; content: string }>
        response_format?: { type: string }
      }): Promise<OpenAIMessage>
    }
  }
}

// =============================================================================
// Constants
// =============================================================================

/**
 * The prompt template for learning candidate extraction.
 * @see PRD-015 for specification
 */
const EXTRACTION_PROMPT = `Analyze this Claude Code session transcript and extract actionable learnings.

<transcript>
{transcript_excerpt}
</transcript>

Extract learnings that meet these criteria:
1. **Technical decisions**: Describes a choice and its rationale
2. **Gotchas/pitfalls**: Something to avoid next time
3. **Patterns that worked**: Reusable approaches
4. **Future improvements**: Things to do differently

For each learning, provide:
- content: The learning text (1-3 sentences, actionable)
- confidence: "high" (certain, tested), "medium" (likely useful), "low" (speculative)
- category: One of [architecture, testing, performance, security, debugging, tooling, patterns, other]

Return JSON array:
[
  {
    "content": "Always wrap database operations in transactions to ensure atomicity",
    "confidence": "high",
    "category": "patterns"
  }
]

Rules:
- Skip generic advice (things any developer knows)
- Skip context-specific details that won't generalize
- Prefer actionable "do X when Y" format
- Maximum 5 learnings per transcript
- If no meaningful learnings found, return empty array: []`

const VALID_CONFIDENCES: readonly CandidateConfidence[] = ["high", "medium", "low"]

const VALID_CATEGORIES: readonly CandidateCategory[] = [
  "architecture",
  "testing",
  "performance",
  "security",
  "debugging",
  "tooling",
  "patterns",
  "other"
]

// =============================================================================
// Utilities
// =============================================================================

/**
 * Parse LLM JSON response, handling common formatting issues.
 */
const parseLlmJson = <T>(raw: string): T | null => {
  try { return JSON.parse(raw) } catch { /* continue */ }

  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch && fenceMatch[1]) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch { /* continue */ }
  }

  const jsonStart = raw.search(/[[{]/)
  if (jsonStart >= 0) {
    const candidate = raw.slice(jsonStart)
    try { return JSON.parse(candidate) } catch { /* continue */ }

    const openChar = candidate[0]
    const closeChar = openChar === "[" ? "]" : "}"
    const lastClose = candidate.lastIndexOf(closeChar)
    if (lastClose > 0) {
      try { return JSON.parse(candidate.slice(0, lastClose + 1)) } catch { /* continue */ }
    }
  }

  return null
}

/**
 * Validate and normalize an extracted candidate from LLM response.
 */
const validateCandidate = (raw: unknown): ExtractedCandidate | null => {
  if (!raw || typeof raw !== "object") return null

  const obj = raw as Record<string, unknown>

  if (typeof obj.content !== "string" || obj.content.trim().length === 0) return null
  const content = obj.content.trim()

  if (content.length < 10) return null

  const rawConfidence = String(obj.confidence || "").toLowerCase()
  const confidence: CandidateConfidence = VALID_CONFIDENCES.includes(rawConfidence as CandidateConfidence)
    ? (rawConfidence as CandidateConfidence)
    : "medium"

  const rawCategory = String(obj.category || "").toLowerCase()
  const category: CandidateCategory = VALID_CATEGORIES.includes(rawCategory as CandidateCategory)
    ? (rawCategory as CandidateCategory)
    : "other"

  return { content, confidence, category }
}

// =============================================================================
// Service Definition
// =============================================================================

/**
 * CandidateExtractorService extracts learning candidates from Claude Code transcripts.
 *
 * @see PRD-015 for the JSONL daemon and knowledge promotion pipeline
 */
export class CandidateExtractorService extends Context.Tag("CandidateExtractorService")<
  CandidateExtractorService,
  {
    readonly extract: (chunk: TranscriptChunk) => Effect.Effect<ExtractionResult, ExtractionUnavailableError>
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

// =============================================================================
// Implementations
// =============================================================================

/**
 * Noop implementation - returns empty results without LLM processing.
 */
export const CandidateExtractorServiceNoop = Layer.succeed(
  CandidateExtractorService,
  {
    extract: (chunk) => Effect.succeed({
      candidates: [],
      sourceChunk: chunk,
      wasExtracted: false
    }),
    isAvailable: () => Effect.succeed(false)
  }
)

/**
 * Anthropic (Claude) implementation.
 */
export const CandidateExtractorServiceAnthropic = Layer.effect(
  CandidateExtractorService,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(
      Effect.mapError(() => new ExtractionUnavailableError({
        reason: "ANTHROPIC_API_KEY environment variable is not set"
      }))
    )

    let client: AnthropicClient | null = null

    const ensureClient = Effect.gen(function* () {
      if (client) return client

      const Anthropic = yield* Effect.tryPromise({
        try: async () => {
          // @ts-expect-error - @anthropic-ai/sdk is an optional peer dependency
          const mod = await import("@anthropic-ai/sdk")
          return mod.default
        },
        catch: () => new ExtractionUnavailableError({
          reason: "@anthropic-ai/sdk is not installed"
        })
      })

      client = new Anthropic({ apiKey }) as unknown as AnthropicClient
      return client
    })

    return {
      extract: (chunk) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const anthropic = yield* ensureClient

          const prompt = EXTRACTION_PROMPT.replace("{transcript_excerpt}", chunk.content)

          const response = yield* Effect.tryPromise({
            try: () => anthropic.messages.create({
              model: "claude-haiku-4-20250514",
              max_tokens: 1024,
              messages: [{
                role: "user",
                content: prompt
              }]
            }),
            catch: (e) => new ExtractionUnavailableError({
              reason: `Anthropic API call failed: ${String(e)}`
            })
          })

          const textContent = response.content.find(c => c.type === "text")
          if (!textContent || !textContent.text) {
            return {
              candidates: [],
              sourceChunk: chunk,
              wasExtracted: true,
              metadata: {
                model: "claude-haiku-4-20250514",
                tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
                durationMs: Date.now() - startTime
              }
            }
          }

          const rawCandidates = parseLlmJson<unknown[]>(textContent.text)
          if (!rawCandidates || !Array.isArray(rawCandidates)) {
            return {
              candidates: [],
              sourceChunk: chunk,
              wasExtracted: true,
              metadata: {
                model: "claude-haiku-4-20250514",
                tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
                durationMs: Date.now() - startTime
              }
            }
          }

          const candidates: ExtractedCandidate[] = rawCandidates
            .map(validateCandidate)
            .filter((c): c is ExtractedCandidate => c !== null)
            .slice(0, 5)

          return {
            candidates,
            sourceChunk: chunk,
            wasExtracted: true,
            metadata: {
              model: "claude-haiku-4-20250514",
              tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
              durationMs: Date.now() - startTime
            }
          }
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)

/**
 * OpenAI (GPT) implementation.
 */
export const CandidateExtractorServiceOpenAI = Layer.effect(
  CandidateExtractorService,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("OPENAI_API_KEY").pipe(
      Effect.mapError(() => new ExtractionUnavailableError({
        reason: "OPENAI_API_KEY environment variable is not set"
      }))
    )

    let client: OpenAIClient | null = null

    const ensureClient = Effect.gen(function* () {
      if (client) return client

      const OpenAI = yield* Effect.tryPromise({
        try: async () => {
          // @ts-expect-error - openai is an optional peer dependency
          const mod = await import("openai")
          return mod.default
        },
        catch: () => new ExtractionUnavailableError({
          reason: "openai package is not installed"
        })
      })

      client = new OpenAI({ apiKey }) as unknown as OpenAIClient
      return client
    })

    return {
      extract: (chunk) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const openai = yield* ensureClient

          const prompt = EXTRACTION_PROMPT.replace("{transcript_excerpt}", chunk.content)

          const response = yield* Effect.tryPromise({
            try: () => openai.chat.completions.create({
              model: "gpt-4o-mini",
              max_tokens: 1024,
              messages: [{
                role: "user",
                content: prompt
              }],
              response_format: { type: "json_object" }
            }),
            catch: (e) => new ExtractionUnavailableError({
              reason: `OpenAI API call failed: ${String(e)}`
            })
          })

          const textContent = response.choices[0]?.message?.content
          if (!textContent) {
            return {
              candidates: [],
              sourceChunk: chunk,
              wasExtracted: true,
              metadata: {
                model: "gpt-4o-mini",
                tokensUsed: (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
                durationMs: Date.now() - startTime
              }
            }
          }

          const parsed = parseLlmJson<unknown>(textContent)
          let rawCandidates: unknown[] = []

          if (Array.isArray(parsed)) {
            rawCandidates = parsed
          } else if (parsed && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>
            const arrayField = Object.values(obj).find(Array.isArray)
            if (arrayField) {
              rawCandidates = arrayField as unknown[]
            }
          }

          const candidates: ExtractedCandidate[] = rawCandidates
            .map(validateCandidate)
            .filter((c): c is ExtractedCandidate => c !== null)
            .slice(0, 5)

          return {
            candidates,
            sourceChunk: chunk,
            wasExtracted: true,
            metadata: {
              model: "gpt-4o-mini",
              tokensUsed: (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
              durationMs: Date.now() - startTime
            }
          }
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)

/**
 * Auto-detecting layer that selects the appropriate backend based on environment.
 */
export const CandidateExtractorServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    const anthropicKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(Effect.option)

    if (Option.isSome(anthropicKey) && anthropicKey.value.trim().length > 0) {
      return CandidateExtractorServiceAnthropic
    }

    const openaiKey = yield* Config.string("OPENAI_API_KEY").pipe(Effect.option)

    if (Option.isSome(openaiKey) && openaiKey.value.trim().length > 0) {
      return CandidateExtractorServiceOpenAI
    }

    return CandidateExtractorServiceNoop
  })
)
