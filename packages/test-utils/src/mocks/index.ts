/**
 * Mock services for testing.
 *
 * @module @tx/test-utils/mocks
 */

// Anthropic mock
export {
  createMockAnthropic,
  createMockAnthropicForExtraction,
  type MockMessage,
  type MockAnthropicCall,
  type MockAnthropicResponse,
  type MockAnthropicConfig,
  type MockAnthropicResult
} from "./anthropic.mock.js"

// TODO: Implement in tx-b28e5324 (PRD-013: Implement mock services)
// export { MockAstGrepService } from './ast-grep.mock.js'
// export { MockFileSystem } from './file-system.mock.js'
// export { MockGit } from './git.mock.js'
