import { Context, Effect, Layer } from "effect"
import { ExtractionUnavailableError } from "../errors.js"
import { LlmService } from "./llm-service.js"
import type {
  TranscriptChunk,
  ExtractedCandidate,
  ExtractionResult,
  CandidateConfidence,
  CandidateCategory
} from "@jamesaphoenix/tx-types"

/**
 * The prompt template for learning candidate extraction.
 * Designed to extract actionable, generalizable learnings from Claude Code transcripts.
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

Rules:
- Skip generic advice (things any developer knows)
- Skip context-specific details that won't generalize
- Prefer actionable "do X when Y" format
- Maximum 5 learnings per transcript
- If no meaningful learnings found, return empty candidates array`

/** JSON Schema for structured output from the candidate extraction LLM call */
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          content: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string", enum: ["architecture", "testing", "performance", "security", "debugging", "tooling", "patterns", "other"] },
        },
        required: ["content", "confidence", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const

/**
 * Valid confidence levels for validation.
 */
const VALID_CONFIDENCES: readonly CandidateConfidence[] = ["high", "medium", "low"]

/**
 * Valid categories for validation.
 */
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

/**
 * Validate and normalize an extracted candidate from LLM response.
 * Returns null if the candidate is invalid.
 */
const validateCandidate = (raw: unknown): ExtractedCandidate | null => {
  if (!raw || typeof raw !== "object") return null

  const obj = raw as Record<string, unknown>

  // Validate content
  if (typeof obj.content !== "string" || obj.content.trim().length === 0) return null
  const content = obj.content.trim()

  // Skip if content is too short (likely not actionable)
  if (content.length < 10) return null

  // Validate confidence
  const rawConfidence = String(obj.confidence || "").toLowerCase()
  const confidence: CandidateConfidence = VALID_CONFIDENCES.includes(rawConfidence as CandidateConfidence)
    ? (rawConfidence as CandidateConfidence)
    : "medium" // Default to medium if invalid

  // Validate category
  const rawCategory = String(obj.category || "").toLowerCase()
  const category: CandidateCategory = VALID_CATEGORIES.includes(rawCategory as CandidateCategory)
    ? (rawCategory as CandidateCategory)
    : "other" // Default to other if invalid

  return { content, confidence, category }
}

/**
 * CandidateExtractorService extracts learning candidates from Claude Code transcripts.
 *
 * This service uses the centralized LlmService to analyze transcript content and identify:
 * - Technical decisions with rationale
 * - Gotchas and pitfalls to avoid
 * - Patterns that worked well
 * - Future improvements
 *
 * Design: Following DD-006 patterns for LLM integration with centralized LlmService.
 *
 * @see PRD-015 for the JSONL daemon and knowledge promotion pipeline
 */
export class CandidateExtractorService extends Context.Tag("CandidateExtractorService")<
  CandidateExtractorService,
  {
    /**
     * Extract learning candidates from a transcript chunk.
     * Returns structured candidates with confidence and category.
     */
    readonly extract: (chunk: TranscriptChunk) => Effect.Effect<ExtractionResult, ExtractionUnavailableError>
    /** Check if extraction functionality is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Noop implementation - returns empty results without LLM processing.
 * Used when no LLM backend is configured or for testing.
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
 * Live implementation using centralized LlmService.
 * Backend-agnostic — works with Agent SDK, Anthropic, or any LlmService backend.
 */
export const CandidateExtractorServiceLive = Layer.effect(
  CandidateExtractorService,
  Effect.gen(function* () {
    const llmService = yield* LlmService

    return {
      extract: (chunk) =>
        Effect.gen(function* () {
          const startTime = Date.now()

          // Build prompt with transcript content
          const prompt = EXTRACTION_PROMPT.replace("{transcript_excerpt}", chunk.content)

          const result = yield* llmService.complete({
            prompt,
            maxTokens: 1024,
            jsonSchema: EXTRACTION_SCHEMA,
          }).pipe(
            Effect.mapError((e) => new ExtractionUnavailableError({
              reason: `LLM completion failed: ${e.reason}`
            }))
          )

          // Structured outputs guarantee valid JSON matching the schema
          const parsed = JSON.parse(result.text) as { candidates: unknown[] }

          // Validate and normalize each candidate (schema guarantees structure, but validate content quality)
          const candidates: ExtractedCandidate[] = parsed.candidates
            .map(validateCandidate)
            .filter((c): c is ExtractedCandidate => c !== null)
            .slice(0, 5) // Max 5 candidates per chunk

          return {
            candidates,
            sourceChunk: chunk,
            wasExtracted: true,
            metadata: {
              model: result.model,
              tokensUsed: result.tokensUsed ?? 0,
              durationMs: result.durationMs ?? (Date.now() - startTime)
            }
          }
        }),

      isAvailable: () => llmService.isAvailable()
    }
  })
)

/**
 * Auto-detecting layer — uses Live if LlmService is available, Noop otherwise.
 */
export const CandidateExtractorServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    const opt = yield* Effect.serviceOption(LlmService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const }))
    )

    if (opt._tag === "Some") {
      const available = yield* opt.value.isAvailable()
      if (available) return CandidateExtractorServiceLive
    }
    return CandidateExtractorServiceNoop
  })
)
