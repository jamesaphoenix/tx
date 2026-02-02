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

// AstGrep mock
export {
  MockAstGrepService,
  MockAstGrepServiceTag,
  MockAstGrepError,
  type MockSymbolKind,
  type MockSymbolInfo,
  type MockImportKind,
  type MockImportInfo,
  type MockMatch,
  type MockAstGrepServiceConfig,
  type MockAstGrepServiceResult
} from "./ast-grep.mock.js"

// TODO: Implement remaining mocks in tx-b28e5324 (PRD-013: Implement mock services)
// export { MockFileSystem } from './file-system.mock.js'
// export { MockGit } from './git.mock.js'
