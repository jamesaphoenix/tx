/**
 * Mock FileSystemService for testing.
 *
 * Provides configurable mock FileSystemService with in-memory storage,
 * initial file fixtures, and failure injection for testing services
 * that depend on file system operations.
 *
 * Note: Uses inline types until FileSystemService is exported from @tx/core.
 *
 * @module @tx/test-utils/mocks/file-system
 */

import { Context, Effect, Layer } from "effect"
import { Data } from "effect"

// ============================================================================
// Error Type
// ============================================================================

/**
 * Error type for file system operations.
 */
export class MockFileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly reason: string
  readonly path?: string
  readonly cause?: unknown
}> {
  get message() {
    return this.path
      ? `File system error at '${this.path}': ${this.reason}`
      : `File system error: ${this.reason}`
  }
}

// ============================================================================
// Service Tag (mirrors FileSystemService from @tx/core)
// ============================================================================

/**
 * Mock FileSystemService tag for dependency injection.
 */
export class MockFileSystemServiceTag extends Context.Tag("FileSystemService")<
  MockFileSystemServiceTag,
  {
    readonly readFile: (path: string) => Effect.Effect<string, MockFileSystemError>
    readonly writeFile: (path: string, content: string) => Effect.Effect<void, MockFileSystemError>
    readonly exists: (path: string) => Effect.Effect<boolean, MockFileSystemError>
    readonly mkdir: (path: string) => Effect.Effect<void, MockFileSystemError>
    readonly readdir: (path: string) => Effect.Effect<readonly string[], MockFileSystemError>
  }
>() {}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for the MockFileSystem.
 */
export interface MockFileSystemConfig {
  /**
   * Initial files to populate the in-memory file system.
   * Keys are file paths, values are file contents.
   */
  initialFiles?: Map<string, string>
  /**
   * Initial directories to create.
   * Set of directory paths. If not provided, directories are auto-created
   * based on file paths in initialFiles.
   */
  initialDirectories?: Set<string>
  /**
   * When true, all operations will fail with an error.
   */
  shouldFail?: boolean
  /**
   * Custom error message when shouldFail is true.
   * Defaults to "Mock FileSystem error".
   */
  failureMessage?: string
  /**
   * Map of specific operations to fail.
   * Keys: "readFile", "writeFile", "exists", "mkdir", "readdir"
   * Values: error message for that operation
   */
  failuresByOperation?: Map<string, string>
  /**
   * Map of specific paths to fail on.
   * Keys: file/directory paths
   * Values: error message when accessing that path
   */
  failuresByPath?: Map<string, string>
}

/**
 * Result returned by MockFileSystem factory.
 */
export interface MockFileSystemResult {
  /**
   * Effect Layer providing the mock FileSystemService.
   */
  layer: Layer.Layer<MockFileSystemServiceTag>
  /**
   * Array of all readFile calls made (paths).
   */
  readFileCalls: string[]
  /**
   * Array of all writeFile calls made.
   */
  writeFileCalls: Array<{ path: string; content: string }>
  /**
   * Array of all exists calls made (paths).
   */
  existsCalls: string[]
  /**
   * Array of all mkdir calls made (paths).
   */
  mkdirCalls: string[]
  /**
   * Array of all readdir calls made (paths).
   */
  readdirCalls: string[]
  /**
   * Get the current in-memory file contents.
   */
  getFiles: () => Map<string, string>
  /**
   * Get the current in-memory directories.
   */
  getDirectories: () => Set<string>
  /**
   * Reset all call tracking arrays and restore initial state.
   */
  reset: () => void
  /**
   * Get total number of all calls made.
   */
  getCallCount: () => number
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the parent directory path from a file path.
 */
const getParentDir = (path: string): string | null => {
  const normalized = path.replace(/\\/g, "/")
  const lastSlash = normalized.lastIndexOf("/")
  if (lastSlash <= 0) return null
  return normalized.substring(0, lastSlash)
}

/**
 * Get the basename (file/dir name) from a path.
 */
const getBasename = (path: string): string => {
  const normalized = path.replace(/\\/g, "/")
  const lastSlash = normalized.lastIndexOf("/")
  return lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1)
}

/**
 * Extract all parent directories from a path.
 */
const extractParentDirs = (path: string): string[] => {
  const dirs: string[] = []
  let current = getParentDir(path)
  while (current) {
    dirs.push(current)
    current = getParentDir(current)
  }
  return dirs
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a mock FileSystemService for testing.
 *
 * @example
 * ```typescript
 * // Basic usage - empty file system
 * const mock = MockFileSystem()
 * const program = Effect.gen(function* () {
 *   const fs = yield* MockFileSystemServiceTag
 *   yield* fs.writeFile("/tmp/test.txt", "hello")
 *   return yield* fs.readFile("/tmp/test.txt")
 * })
 * const result = await Effect.runPromise(Effect.provide(program, mock.layer))
 * expect(result).toBe("hello")
 * ```
 *
 * @example
 * ```typescript
 * // With initial files
 * const mock = MockFileSystem({
 *   initialFiles: new Map([
 *     ["/app/config.json", '{"debug": true}'],
 *     ["/app/data.txt", "Hello World"]
 *   ])
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With failure injection
 * const mock = MockFileSystem({
 *   shouldFail: true,
 *   failureMessage: "Disk full"
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With path-specific failures
 * const mock = MockFileSystem({
 *   failuresByPath: new Map([
 *     ["/protected/secret.txt", "Permission denied"]
 *   ])
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With operation-specific failures
 * const mock = MockFileSystem({
 *   failuresByOperation: new Map([
 *     ["writeFile", "Read-only file system"]
 *   ])
 * })
 * ```
 */
export const MockFileSystem = (config: MockFileSystemConfig = {}): MockFileSystemResult => {
  // Call tracking arrays
  const readFileCalls: string[] = []
  const writeFileCalls: Array<{ path: string; content: string }> = []
  const existsCalls: string[] = []
  const mkdirCalls: string[] = []
  const readdirCalls: string[] = []

  // In-memory storage
  const files = new Map<string, string>(config.initialFiles)
  const directories = new Set<string>(config.initialDirectories)

  // Auto-create directories from initial files
  if (config.initialFiles) {
    for (const filePath of config.initialFiles.keys()) {
      for (const dir of extractParentDirs(filePath)) {
        directories.add(dir)
      }
    }
  }

  // Store initial state for reset
  const initialFiles = new Map(files)
  const initialDirectories = new Set(directories)

  /**
   * Check for failure conditions.
   */
  const checkFailure = (
    operation: string,
    path?: string
  ): Effect.Effect<void, MockFileSystemError> =>
    Effect.gen(function* () {
      // Check for global failure
      if (config.shouldFail) {
        return yield* Effect.fail(
          new MockFileSystemError({
            reason: config.failureMessage || "Mock FileSystem error",
            path
          })
        )
      }

      // Check for operation-specific failure
      const opFailure = config.failuresByOperation?.get(operation)
      if (opFailure) {
        return yield* Effect.fail(
          new MockFileSystemError({
            reason: opFailure,
            path
          })
        )
      }

      // Check for path-specific failure
      if (path) {
        const pathFailure = config.failuresByPath?.get(path)
        if (pathFailure) {
          return yield* Effect.fail(
            new MockFileSystemError({
              reason: pathFailure,
              path
            })
          )
        }
      }
    })

  const layer = Layer.succeed(MockFileSystemServiceTag, {
    readFile: (path) =>
      Effect.gen(function* () {
        readFileCalls.push(path)
        yield* checkFailure("readFile", path)

        const content = files.get(path)
        if (content === undefined) {
          return yield* Effect.fail(
            new MockFileSystemError({
              reason: "ENOENT: no such file or directory",
              path
            })
          )
        }
        return content
      }),

    writeFile: (path, content) =>
      Effect.gen(function* () {
        writeFileCalls.push({ path, content })
        yield* checkFailure("writeFile", path)

        // Auto-create parent directories
        for (const dir of extractParentDirs(path)) {
          directories.add(dir)
        }

        files.set(path, content)
      }),

    exists: (path) =>
      Effect.gen(function* () {
        existsCalls.push(path)
        yield* checkFailure("exists", path)

        return files.has(path) || directories.has(path)
      }),

    mkdir: (path) =>
      Effect.gen(function* () {
        mkdirCalls.push(path)
        yield* checkFailure("mkdir", path)

        // Create all parent directories recursively
        for (const dir of extractParentDirs(path)) {
          directories.add(dir)
        }
        directories.add(path)
      }),

    readdir: (path) =>
      Effect.gen(function* () {
        readdirCalls.push(path)
        yield* checkFailure("readdir", path)

        // Check if directory exists
        if (!directories.has(path)) {
          return yield* Effect.fail(
            new MockFileSystemError({
              reason: "ENOENT: no such file or directory",
              path
            })
          )
        }

        const entries: string[] = []
        const normalizedPath = path.replace(/\\/g, "/")

        // Find files directly in this directory
        for (const filePath of files.keys()) {
          const parent = getParentDir(filePath)
          if (parent === normalizedPath) {
            entries.push(getBasename(filePath))
          }
        }

        // Find subdirectories directly in this directory
        for (const dirPath of directories) {
          const parent = getParentDir(dirPath)
          if (parent === normalizedPath && dirPath !== normalizedPath) {
            entries.push(getBasename(dirPath))
          }
        }

        return entries
      })
  })

  return {
    layer,
    readFileCalls,
    writeFileCalls,
    existsCalls,
    mkdirCalls,
    readdirCalls,
    getFiles: () => new Map(files),
    getDirectories: () => new Set(directories),
    reset: () => {
      readFileCalls.length = 0
      writeFileCalls.length = 0
      existsCalls.length = 0
      mkdirCalls.length = 0
      readdirCalls.length = 0
      files.clear()
      directories.clear()
      for (const [k, v] of initialFiles) {
        files.set(k, v)
      }
      for (const d of initialDirectories) {
        directories.add(d)
      }
      // Re-add auto-created dirs from initial files
      for (const filePath of initialFiles.keys()) {
        for (const dir of extractParentDirs(filePath)) {
          directories.add(dir)
        }
      }
    },
    getCallCount: () =>
      readFileCalls.length +
      writeFileCalls.length +
      existsCalls.length +
      mkdirCalls.length +
      readdirCalls.length
  }
}
