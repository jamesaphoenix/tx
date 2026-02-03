/**
 * Mock OpenAI client for testing.
 *
 * Provides configurable mock OpenAI clients with call tracking,
 * response fixtures, and failure injection for testing services
 * that depend on the OpenAI API.
 *
 * @module @tx/test-utils/mocks/openai
 */

/**
 * Message structure matching OpenAI SDK format.
 */
export interface MockOpenAIMessage {
  role: "user" | "assistant" | "system"
  content: string
}

/**
 * Tracked API call parameters for chat completions.
 */
export interface MockOpenAIChatCall {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  response_format?: { type: string }
}

/**
 * Response structure matching OpenAI SDK format.
 */
export interface MockOpenAIChatResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: "assistant"
      content: string | null
    }
    finish_reason: "stop" | "length" | "content_filter" | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Configuration options for the mock OpenAI client.
 */
export interface MockOpenAIConfig {
  /**
   * Map of specific responses keyed by JSON-serialized messages.
   * Allows returning different responses for different inputs.
   */
  responses?: Map<string, MockOpenAIChatResponse>
  /**
   * Default response when no specific response matches.
   * If not provided, returns an empty array response.
   */
  defaultResponse?: MockOpenAIChatResponse
  /**
   * When true, all API calls will throw an error.
   */
  shouldFail?: boolean
  /**
   * Custom error message when shouldFail is true.
   * Defaults to "Mock OpenAI API error".
   */
  failureMessage?: string
  /**
   * Custom error to throw when shouldFail is true.
   * Takes precedence over failureMessage.
   */
  failureError?: Error
  /**
   * Simulated latency in milliseconds.
   * Useful for testing timeout handling.
   */
  latencyMs?: number
}

/**
 * Result returned by createMockOpenAI.
 */
export interface MockOpenAIResult {
  /**
   * The mock client that can be used in place of the real OpenAI SDK.
   */
  client: {
    chat: {
      completions: {
        create(params: MockOpenAIChatCall): Promise<MockOpenAIChatResponse>
      }
    }
  }
  /**
   * Array of all calls made to the mock client.
   * Useful for assertions about API usage.
   */
  calls: MockOpenAIChatCall[]
  /**
   * Reset the calls array to empty.
   */
  reset: () => void
  /**
   * Get the total number of calls made.
   */
  getCallCount: () => number
  /**
   * Get the most recent call made, or undefined if no calls.
   */
  getLastCall: () => MockOpenAIChatCall | undefined
}

/**
 * Create a mock OpenAI client for testing.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const mock = createMockOpenAI()
 * const response = await mock.client.chat.completions.create({
 *   model: "gpt-4o-mini",
 *   max_tokens: 256,
 *   messages: [{ role: "user", content: "Hello" }]
 * })
 * expect(mock.calls).toHaveLength(1)
 * ```
 *
 * @example
 * ```typescript
 * // With custom response
 * const mock = createMockOpenAI({
 *   defaultResponse: {
 *     id: "test-id",
 *     object: "chat.completion",
 *     created: Date.now(),
 *     model: "gpt-4o-mini",
 *     choices: [{
 *       index: 0,
 *       message: { role: "assistant", content: "Custom response" },
 *       finish_reason: "stop"
 *     }],
 *     usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
 *   }
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With failure injection
 * const mock = createMockOpenAI({
 *   shouldFail: true,
 *   failureMessage: "Rate limit exceeded"
 * })
 * await expect(mock.client.chat.completions.create(params)).rejects.toThrow("Rate limit exceeded")
 * ```
 */
export const createMockOpenAI = (config: MockOpenAIConfig = {}): MockOpenAIResult => {
  const calls: MockOpenAIChatCall[] = []

  const client = {
    chat: {
      completions: {
        create: async (params: MockOpenAIChatCall): Promise<MockOpenAIChatResponse> => {
          // Track the call
          calls.push(params)

          // Simulate latency if configured
          if (config.latencyMs) {
            await new Promise(resolve => setTimeout(resolve, config.latencyMs))
          }

          // Handle failure injection
          if (config.shouldFail) {
            throw config.failureError || new Error(config.failureMessage || "Mock OpenAI API error")
          }

          // Check for specific response by message content
          if (config.responses) {
            const key = JSON.stringify(params.messages)
            const specificResponse = config.responses.get(key)
            if (specificResponse) {
              return specificResponse
            }
          }

          // Return default response or a minimal valid response
          return config.defaultResponse || {
            id: "mock-chatcmpl-id",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: "[]"
              },
              finish_reason: "stop"
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          }
        }
      }
    }
  }

  return {
    client,
    calls,
    reset: () => {
      calls.length = 0
    },
    getCallCount: () => calls.length,
    getLastCall: () => calls[calls.length - 1]
  }
}

/**
 * Create a mock OpenAI client configured to return specific extraction candidates.
 *
 * This is a convenience factory for testing CandidateExtractorService and similar
 * services that expect JSON array responses from the LLM.
 *
 * Note: OpenAI with json_object mode may wrap responses in an object, so this
 * helper returns the array wrapped as { candidates: [...] }.
 *
 * @example
 * ```typescript
 * const mock = createMockOpenAIForExtraction([
 *   { content: "Always use transactions", confidence: "high", category: "patterns" },
 *   { content: "Test database migrations", confidence: "medium", category: "testing" }
 * ])
 *
 * // The mock will return these candidates as JSON text
 * const response = await mock.client.chat.completions.create({ ... })
 * // response.choices[0].message.content === '{"candidates":[{"content":"Always use transactions",...}]}'
 * ```
 */
export const createMockOpenAIForExtraction = (
  candidates: Array<{ content: string; confidence: string; category: string }>
): MockOpenAIResult => {
  return createMockOpenAI({
    defaultResponse: {
      id: "mock-extraction-id",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o-mini",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          // OpenAI with json_object mode often wraps in an object
          content: JSON.stringify({ candidates })
        },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }
  })
}

/**
 * Create a mock OpenAI client that returns raw JSON array (for direct array responses).
 *
 * @example
 * ```typescript
 * const mock = createMockOpenAIForExtractionRaw([
 *   { content: "Always use transactions", confidence: "high", category: "patterns" }
 * ])
 * ```
 */
export const createMockOpenAIForExtractionRaw = (
  candidates: Array<{ content: string; confidence: string; category: string }>
): MockOpenAIResult => {
  return createMockOpenAI({
    defaultResponse: {
      id: "mock-extraction-raw-id",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o-mini",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify(candidates)
        },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }
  })
}
