/**
 * Mock AstGrepService for testing.
 *
 * Provides configurable mock AstGrepService with symbol fixtures,
 * import fixtures, pattern match fixtures, and failure injection
 * for testing services that depend on ast-grep code intelligence.
 *
 * Note: Uses inline types until AstGrepService is exported from @tx/core (tx-cf0f3c40).
 *
 * @module @tx/test-utils/mocks/ast-grep
 */

import { Context, Effect, Layer } from "effect"
import { Data } from "effect"

// ============================================================================
// Inline types (until AstGrepService is exported from @tx/core)
// ============================================================================

/**
 * Symbol kind - one of the valid code construct types.
 */
export type MockSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "variable"
  | "method"
  | "struct"
  | "enum"
  | "trait"
  | "module"

/**
 * Information about an extracted symbol.
 */
export interface MockSymbolInfo {
  /** Symbol name (e.g., function name, class name) */
  readonly name: string
  /** Kind of symbol */
  readonly kind: MockSymbolKind
  /** Line number where the symbol is defined (1-indexed) */
  readonly line: number
  /** Whether the symbol is exported */
  readonly exported: boolean
  /** File path where the symbol is defined (optional, for convenience) */
  readonly filePath?: string
}

/**
 * Import kind - static (import/require) or dynamic (import()).
 */
export type MockImportKind = "static" | "dynamic"

/**
 * Information about an import statement.
 */
export interface MockImportInfo {
  /** Source module path or package name */
  readonly source: string
  /** Imported specifiers (names) */
  readonly specifiers: readonly string[]
  /** Kind of import */
  readonly kind: MockImportKind
}

/**
 * A match result from ast-grep pattern matching.
 */
export interface MockMatch {
  /** File path where the match was found */
  readonly file: string
  /** Line number (1-indexed) */
  readonly line: number
  /** Column number (1-indexed) */
  readonly column: number
  /** Matched text */
  readonly text: string
  /** Named captures from the pattern (e.g., $NAME -> value) */
  readonly captures: Readonly<Record<string, string>>
}

/**
 * Error type for ast-grep operations.
 */
export class MockAstGrepError extends Data.TaggedError("AstGrepError")<{
  readonly reason: string
  readonly cause?: unknown
}> {
  get message() {
    return `AST grep error: ${this.reason}`
  }
}

// ============================================================================
// Service Tag (mirrors AstGrepService from @tx/core)
// ============================================================================

/**
 * Mock AstGrepService tag for dependency injection.
 */
export class MockAstGrepServiceTag extends Context.Tag("AstGrepService")<
  MockAstGrepServiceTag,
  {
    readonly findSymbols: (filePath: string) => Effect.Effect<readonly MockSymbolInfo[], MockAstGrepError>
    readonly getImports: (filePath: string) => Effect.Effect<readonly MockImportInfo[], MockAstGrepError>
    readonly matchPattern: (pattern: string, path: string) => Effect.Effect<readonly MockMatch[], MockAstGrepError>
  }
>() {}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for the MockAstGrepService.
 */
export interface MockAstGrepServiceConfig {
  /**
   * Map of file paths to symbols returned by findSymbols.
   * If a file path is not in the map, returns an empty array.
   */
  symbols?: Map<string, readonly MockSymbolInfo[]>
  /**
   * Default symbols returned for any file not in the symbols map.
   * If not provided, returns an empty array.
   */
  defaultSymbols?: readonly MockSymbolInfo[]
  /**
   * Map of file paths to imports returned by getImports.
   * If a file path is not in the map, returns an empty array.
   */
  imports?: Map<string, readonly MockImportInfo[]>
  /**
   * Default imports returned for any file not in the imports map.
   * If not provided, returns an empty array.
   */
  defaultImports?: readonly MockImportInfo[]
  /**
   * Map of patterns to matches returned by matchPattern.
   * Key format: `${pattern}::${path}` for specific path matches,
   * or just `${pattern}` for pattern-only matches.
   */
  matches?: Map<string, readonly MockMatch[]>
  /**
   * Default matches returned for any pattern not in the matches map.
   * If not provided, returns an empty array.
   */
  defaultMatches?: readonly MockMatch[]
  /**
   * When true, all operations will fail with an error.
   */
  shouldFail?: boolean
  /**
   * Custom error message when shouldFail is true.
   * Defaults to "Mock AstGrep error".
   */
  failureMessage?: string
  /**
   * Map of specific operations to fail.
   * Keys: "findSymbols", "getImports", "matchPattern"
   * Values: error message for that operation
   */
  failuresByOperation?: Map<string, string>
}

/**
 * Result returned by MockAstGrepService factory.
 */
export interface MockAstGrepServiceResult {
  /**
   * Effect Layer providing the mock AstGrepService.
   */
  layer: Layer.Layer<MockAstGrepServiceTag>
  /**
   * Array of all findSymbols calls made.
   */
  findSymbolsCalls: string[]
  /**
   * Array of all getImports calls made.
   */
  getImportsCalls: string[]
  /**
   * Array of all matchPattern calls made.
   */
  matchPatternCalls: Array<{ pattern: string; path: string }>
  /**
   * Reset all call tracking arrays.
   */
  reset: () => void
  /**
   * Get total number of all calls made.
   */
  getCallCount: () => number
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a mock AstGrepService for testing.
 *
 * @example
 * ```typescript
 * // Basic usage - returns empty arrays
 * const mock = MockAstGrepService()
 * const program = Effect.gen(function* () {
 *   const astGrep = yield* MockAstGrepServiceTag
 *   return yield* astGrep.findSymbols("src/index.ts")
 * })
 * const result = await Effect.runPromise(Effect.provide(program, mock.layer))
 * expect(result).toEqual([])
 * ```
 *
 * @example
 * ```typescript
 * // With configured symbols
 * const symbols = new Map([
 *   ["src/index.ts", [
 *     { name: "main", kind: "function", line: 1, exported: true },
 *     { name: "Helper", kind: "class", line: 10, exported: false }
 *   ]]
 * ])
 * const mock = MockAstGrepService({ symbols })
 * ```
 *
 * @example
 * ```typescript
 * // With failure injection
 * const mock = MockAstGrepService({
 *   shouldFail: true,
 *   failureMessage: "ast-grep not installed"
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With operation-specific failures
 * const mock = MockAstGrepService({
 *   failuresByOperation: new Map([
 *     ["findSymbols", "Failed to parse file"]
 *   ])
 * })
 * // findSymbols will fail, but getImports and matchPattern will work
 * ```
 */
export const MockAstGrepService = (config: MockAstGrepServiceConfig = {}): MockAstGrepServiceResult => {
  const findSymbolsCalls: string[] = []
  const getImportsCalls: string[] = []
  const matchPatternCalls: Array<{ pattern: string; path: string }> = []

  const layer = Layer.succeed(MockAstGrepServiceTag, {
    findSymbols: (filePath) =>
      Effect.gen(function* () {
        // Track the call
        findSymbolsCalls.push(filePath)

        // Check for global failure
        if (config.shouldFail) {
          return yield* Effect.fail(
            new MockAstGrepError({
              reason: config.failureMessage || "Mock AstGrep error"
            })
          )
        }

        // Check for operation-specific failure
        const opFailure = config.failuresByOperation?.get("findSymbols")
        if (opFailure) {
          return yield* Effect.fail(new MockAstGrepError({ reason: opFailure }))
        }

        // Return configured symbols or default
        if (config.symbols?.has(filePath)) {
          return config.symbols.get(filePath)!
        }
        return config.defaultSymbols || []
      }),

    getImports: (filePath) =>
      Effect.gen(function* () {
        // Track the call
        getImportsCalls.push(filePath)

        // Check for global failure
        if (config.shouldFail) {
          return yield* Effect.fail(
            new MockAstGrepError({
              reason: config.failureMessage || "Mock AstGrep error"
            })
          )
        }

        // Check for operation-specific failure
        const opFailure = config.failuresByOperation?.get("getImports")
        if (opFailure) {
          return yield* Effect.fail(new MockAstGrepError({ reason: opFailure }))
        }

        // Return configured imports or default
        if (config.imports?.has(filePath)) {
          return config.imports.get(filePath)!
        }
        return config.defaultImports || []
      }),

    matchPattern: (pattern, path) =>
      Effect.gen(function* () {
        // Track the call
        matchPatternCalls.push({ pattern, path })

        // Check for global failure
        if (config.shouldFail) {
          return yield* Effect.fail(
            new MockAstGrepError({
              reason: config.failureMessage || "Mock AstGrep error"
            })
          )
        }

        // Check for operation-specific failure
        const opFailure = config.failuresByOperation?.get("matchPattern")
        if (opFailure) {
          return yield* Effect.fail(new MockAstGrepError({ reason: opFailure }))
        }

        // Try specific pattern+path key first
        const specificKey = `${pattern}::${path}`
        if (config.matches?.has(specificKey)) {
          return config.matches.get(specificKey)!
        }

        // Try pattern-only key
        if (config.matches?.has(pattern)) {
          return config.matches.get(pattern)!
        }

        return config.defaultMatches || []
      })
  })

  return {
    layer,
    findSymbolsCalls,
    getImportsCalls,
    matchPatternCalls,
    reset: () => {
      findSymbolsCalls.length = 0
      getImportsCalls.length = 0
      matchPatternCalls.length = 0
    },
    getCallCount: () => findSymbolsCalls.length + getImportsCalls.length + matchPatternCalls.length
  }
}
