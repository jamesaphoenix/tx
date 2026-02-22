import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Effect } from "effect"
import {
  LlmService,
  LlmServiceNoop,
  LlmServiceAuto,
} from "@jamesaphoenix/tx-core"
import { normalizeClaudeDebugLogPath } from "../../packages/core/src/utils/claude-debug-log.js"

const CLAUDE_DEBUG_LOG_ENV = "CLAUDE_CODE_DEBUG_LOGS_DIR"
const originalClaudeDebugLogPath = process.env[CLAUDE_DEBUG_LOG_ENV]

const prepareClaudeDebugLogPathForAgentSdk = (): void => {
  normalizeClaudeDebugLogPath()
}

const restoreClaudeDebugLogPath = (): void => {
  if (originalClaudeDebugLogPath === undefined) {
    delete process.env[CLAUDE_DEBUG_LOG_ENV]
    return
  }

  process.env[CLAUDE_DEBUG_LOG_ENV] = originalClaudeDebugLogPath
}

describe("LlmService", () => {
  describe("LlmServiceNoop", () => {
    it("complete fails with LlmUnavailableError", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LlmService
          return yield* Effect.either(svc.complete({ prompt: "Hello" }))
        }).pipe(Effect.provide(LlmServiceNoop))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("LlmUnavailableError")
      }
    })

    it("isAvailable returns false", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LlmService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(LlmServiceNoop))
      )

      expect(available).toBe(false)
    })
  })

  describe("LlmServiceAuto", () => {
    it("detects available backend", async () => {
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LlmService
          return yield* svc.isAvailable()
        }).pipe(Effect.provide(LlmServiceAuto))
      )

      // If Agent SDK or ANTHROPIC_API_KEY is available, should be true
      // Otherwise false (noop fallback)
      expect(typeof available).toBe("boolean")
    })
  })
})

// Check if a real LLM backend is available
const llmAvailable = await (async () => {
  try {
    prepareClaudeDebugLogPathForAgentSdk()
    const completionWorked = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LlmService
        const available = yield* svc.isAvailable()
        if (!available) {
          return false
        }

        const completion = yield* Effect.either(
          svc.complete({
            prompt: "Reply with exactly: ok",
            maxTokens: 16,
          })
        )

        return completion._tag === "Right"
      }).pipe(Effect.provide(LlmServiceAuto))
    )
    return completionWorked
  } catch {
    return false
  }
})()

afterAll(() => {
  restoreClaudeDebugLogPath()
})

describe.skipIf(!llmAvailable)("LlmServiceAuto (real backend)", () => {
  beforeAll(() => {
    prepareClaudeDebugLogPathForAgentSdk()
  })

  it("completes a simple prompt", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LlmService
        return yield* svc.complete({
          prompt: "What is 2+2? Reply with just the number.",
          maxTokens: 64,
        })
      }).pipe(Effect.provide(LlmServiceAuto))
    )

    expect(result.text.length).toBeGreaterThan(0)
    expect(typeof result.model).toBe("string")
    expect(result.text).toContain("4")
  }, 30_000)

  it("completes with structured output", async () => {
    const schema = {
      type: "object",
      properties: {
        answer: { type: "number" },
        explanation: { type: "string" },
      },
      required: ["answer", "explanation"],
      additionalProperties: false,
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LlmService
        return yield* svc.complete({
          prompt: "What is 2+2? Provide the answer and a brief explanation.",
          maxTokens: 256,
          jsonSchema: schema,
        })
      }).pipe(Effect.provide(LlmServiceAuto))
    )

    expect(result.text.length).toBeGreaterThan(0)
    const parsed = JSON.parse(result.text)
    expect(parsed.answer).toBe(4)
    expect(typeof parsed.explanation).toBe("string")
  }, 60_000)

  it("isAvailable returns true", async () => {
    const available = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LlmService
        return yield* svc.isAvailable()
      }).pipe(Effect.provide(LlmServiceAuto))
    )

    expect(available).toBe(true)
  })

  it("returns durationMs in result", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LlmService
        return yield* svc.complete({
          prompt: "Say hello.",
          maxTokens: 32,
        })
      }).pipe(Effect.provide(LlmServiceAuto))
    )

    expect(result.durationMs).toBeDefined()
    expect(result.durationMs!).toBeGreaterThan(0)
  }, 30_000)
})
