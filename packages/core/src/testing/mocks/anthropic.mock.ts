/**
 * Mock Anthropic client for testing.
 *
 * Provides configurable mock Anthropic clients with call tracking,
 * response fixtures, and failure injection for testing services
 * that depend on the Anthropic API.
 *
 * @module @tx/test-utils/mocks/anthropic
 */

/**
 * Message structure matching Anthropic SDK format.
 */
export interface MockMessage {
  role: "user" | "assistant"
  content: string
}

/**
 * Tracked API call parameters.
 */
export interface MockAnthropicCall {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
}

/**
 * Response structure matching Anthropic SDK format.
 */
export interface MockAnthropicResponse {
  id: string
  type: "message"
  role: "assistant"
  content: Array<{ type: string; text?: string }>
  model: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Configuration options for the mock Anthropic client.
 */
export interface MockAnthropicConfig {
  /**
   * Map of specific responses keyed by JSON-serialized messages.
   * Allows returning different responses for different inputs.
   */
  responses?: Map<string, MockAnthropicResponse>
  /**
   * Default response when no specific response matches.
   * If not provided, returns an empty array response.
   */
  defaultResponse?: MockAnthropicResponse
  /**
   * When true, all API calls will throw an error.
   */
  shouldFail?: boolean
  /**
   * Custom error message when shouldFail is true.
   * Defaults to "Mock Anthropic API error".
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
 * Result returned by createMockAnthropic.
 */
export interface MockAnthropicResult {
  /**
   * The mock client that can be used in place of the real Anthropic SDK.
   */
  client: {
    messages: {
      create(params: MockAnthropicCall): Promise<MockAnthropicResponse>
    }
  }
  /**
   * Array of all calls made to the mock client.
   * Useful for assertions about API usage.
   */
  calls: MockAnthropicCall[]
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
  getLastCall: () => MockAnthropicCall | undefined
}

/**
 * Create a mock Anthropic client for testing.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const mock = createMockAnthropic()
 * const response = await mock.client.messages.create({
 *   model: "claude-haiku-4-20250514",
 *   max_tokens: 256,
 *   messages: [{ role: "user", content: "Hello" }]
 * })
 * expect(mock.calls).toHaveLength(1)
 * ```
 *
 * @example
 * ```typescript
 * // With custom response
 * const mock = createMockAnthropic({
 *   defaultResponse: {
 *     id: "test-id",
 *     type: "message",
 *     role: "assistant",
 *     content: [{ type: "text", text: "Custom response" }],
 *     model: "claude-haiku-4-20250514",
 *     usage: { input_tokens: 10, output_tokens: 5 }
 *   }
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With failure injection
 * const mock = createMockAnthropic({
 *   shouldFail: true,
 *   failureMessage: "Rate limit exceeded"
 * })
 * await expect(mock.client.messages.create(params)).rejects.toThrow("Rate limit exceeded")
 * ```
 */
export const createMockAnthropic = (config: MockAnthropicConfig = {}): MockAnthropicResult => {
  const calls: MockAnthropicCall[] = []

  const client = {
    messages: {
      create: async (params: MockAnthropicCall): Promise<MockAnthropicResponse> => {
        // Track the call
        calls.push(params)

        // Simulate latency if configured
        if (config.latencyMs) {
          await new Promise(resolve => setTimeout(resolve, config.latencyMs))
        }

        // Handle failure injection
        if (config.shouldFail) {
          throw config.failureError || new Error(config.failureMessage || "Mock Anthropic API error")
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
          id: "mock-msg-id",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "[]" }],
          model: params.model,
          usage: { input_tokens: 10, output_tokens: 5 }
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
 * Create a mock Anthropic client configured to return specific extraction candidates.
 *
 * This is a convenience factory for testing CandidateExtractorService and similar
 * services that expect JSON array responses from the LLM.
 *
 * @example
 * ```typescript
 * const mock = createMockAnthropicForExtraction([
 *   { content: "Always use transactions", confidence: "high", category: "patterns" },
 *   { content: "Test database migrations", confidence: "medium", category: "testing" }
 * ])
 *
 * // The mock will return these candidates as JSON text
 * const response = await mock.client.messages.create({ ... })
 * // response.content[0].text === '[{"content":"Always use transactions",...}]'
 * ```
 */
export const createMockAnthropicForExtraction = (
  candidates: Array<{ content: string; confidence: string; category: string }>
): MockAnthropicResult => {
  return createMockAnthropic({
    defaultResponse: {
      id: "mock-extraction-id",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify(candidates) }],
      model: "claude-haiku-4-20250514",
      usage: { input_tokens: 100, output_tokens: 50 }
    }
  })
}
