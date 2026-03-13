# DD-013: Test Utilities Package - Implementation

## Overview

Implementation details for the `@tx/test-utils` package that centralizes all test utilities, factories, fixtures, and helpers across the monorepo.

## Package Structure

```
packages/test-utils/
├── src/
│   ├── index.ts                    # Public exports
│   ├── database/
│   │   ├── index.ts
│   │   ├── test-database.ts        # In-memory SQLite
│   │   ├── migrations.ts           # Migration runner
│   │   └── seed.ts                 # Seed data helpers
│   ├── factories/
│   │   ├── index.ts
│   │   ├── learning.factory.ts
│   │   ├── task.factory.ts
│   │   ├── anchor.factory.ts
│   │   ├── edge.factory.ts
│   │   ├── candidate.factory.ts
│   │   └── base.factory.ts         # Factory base class
│   ├── fixtures/
│   │   ├── index.ts
│   │   ├── fixture-id.ts           # SHA256-based IDs
│   │   └── fixture-data.ts         # Static fixture data
│   ├── llm-cache/
│   │   ├── index.ts
│   │   ├── cache.ts                # Cache read/write
│   │   ├── hash.ts                 # SHA256 hashing
│   │   └── cli.ts                  # Cache management CLI
│   ├── mocks/
│   │   ├── index.ts
│   │   ├── anthropic.mock.ts
│   │   ├── openai.mock.ts
│   │   ├── ast-grep.mock.ts
│   │   ├── file-system.mock.ts
│   │   └── git.mock.ts
│   ├── helpers/
│   │   ├── index.ts
│   │   ├── effect.ts               # Effect test runners
│   │   ├── temp-files.ts           # Temp directory helpers
│   │   ├── wait.ts                 # Async wait helpers
│   │   └── matchers.ts             # Custom Vitest matchers
│   └── setup/
│       ├── index.ts
│       ├── vitest.setup.ts         # Global setup
│       └── env.ts                  # Test env configuration
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Core Implementations

### Test Database

```typescript
// packages/test-utils/src/database/test-database.ts

import Database from 'better-sqlite3'
import { Effect, Layer, Context } from 'effect'
import * as path from 'path'
import * as fs from 'fs'

export interface TestDatabase {
  readonly db: Database.Database
  readonly close: () => Effect.Effect<void, never>
  readonly reset: () => Effect.Effect<void, never>
  readonly query: <T = any>(sql: string, params?: any[]) => T[]
  readonly exec: (sql: string) => void
  readonly transaction: <T>(fn: () => T) => T
}

export class TestDatabaseService extends Context.Tag('TestDatabaseService')<
  TestDatabaseService,
  TestDatabase
>() {}

/**
 * Create in-memory test database with all migrations.
 */
export const createTestDatabase = (): Effect.Effect<TestDatabase, Error> =>
  Effect.gen(function* () {
    const db = new Database(':memory:')

    // Enable WAL mode for better concurrent access
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Run migrations
    yield* runAllMigrations(db)

    const testDb: TestDatabase = {
      db,

      close: () => Effect.sync(() => db.close()),

      reset: () =>
        Effect.sync(() => {
          const tables = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type='table'
              AND name NOT LIKE 'sqlite_%'
              AND name NOT LIKE '_migrations'
          `).all() as { name: string }[]

          db.exec('PRAGMA foreign_keys = OFF')
          for (const { name } of tables) {
            db.exec(`DELETE FROM ${name}`)
          }
          db.exec('PRAGMA foreign_keys = ON')
        }),

      query: (sql, params = []) => db.prepare(sql).all(...params) as any[],

      exec: (sql) => db.exec(sql),

      transaction: (fn) => db.transaction(fn)()
    }

    return testDb
  })

/**
 * Create test database Layer for dependency injection.
 */
export const TestDatabaseLive = Layer.scoped(
  TestDatabaseService,
  Effect.acquireRelease(
    createTestDatabase(),
    (db) => db.close()
  )
)

/**
 * Run all migrations from packages/core/migrations.
 */
const runAllMigrations = (db: Database.Database): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => {
      // Create migrations tracking table
      db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)

      // Find migration files
      const migrationsDir = path.resolve(__dirname, '../../../../core/migrations')
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort()

      // Apply each migration
      for (const file of files) {
        const applied = db.prepare(
          'SELECT 1 FROM _migrations WHERE name = ?'
        ).get(file)

        if (!applied) {
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
          db.exec(sql)
          db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
        }
      }
    },
    catch: (e) => new Error(`Migration failed: ${e}`)
  })
```

### Fixture ID Generation

```typescript
// packages/test-utils/src/fixtures/fixture-id.ts

import * as crypto from 'crypto'

/**
 * Generate deterministic fixture ID from name.
 * Same name always produces same ID across test runs.
 *
 * @example
 * fixtureId('auth-task') // -> 'tx-a1b2c3d4'
 * fixtureId('auth-task') // -> 'tx-a1b2c3d4' (same)
 */
export const fixtureId = (name: string): string => {
  const hash = crypto.createHash('sha256').update(name).digest('hex')
  return `tx-${hash.slice(0, 8)}`
}

/**
 * Generate fixture ID with namespace to avoid collisions.
 *
 * @example
 * namespacedFixtureId('task-service.test', 'task-1') // -> 'tx-c3d4e5f6'
 */
export const namespacedFixtureId = (namespace: string, name: string): string => {
  return fixtureId(`${namespace}::${name}`)
}

/**
 * Generate sequential IDs within a namespace.
 * Useful for creating multiple related fixtures.
 *
 * @example
 * const ids = sequentialFixtureIds('tasks', 5)
 * // -> ['tx-a1...', 'tx-b2...', 'tx-c3...', 'tx-d4...', 'tx-e5...']
 */
export const sequentialFixtureIds = (namespace: string, count: number): string[] => {
  return Array.from({ length: count }, (_, i) =>
    namespacedFixtureId(namespace, `${i + 1}`)
  )
}

/**
 * Generate fixture ID from object content.
 * Useful for content-addressed fixtures.
 */
export const contentFixtureId = (content: object): string => {
  const json = JSON.stringify(content, Object.keys(content).sort())
  return fixtureId(json)
}
```

### Entity Factories

```typescript
// packages/test-utils/src/factories/base.factory.ts

import { Effect } from 'effect'
import { TestDatabase } from '../database/test-database.js'

export interface FactoryOptions {
  db: TestDatabase
}

export abstract class BaseFactory<TEntity, TCreateOptions> {
  protected counter = 0
  protected db: TestDatabase

  constructor(options: FactoryOptions) {
    this.db = options.db
  }

  abstract create(options?: Partial<TCreateOptions>): Effect.Effect<TEntity, never>

  async createMany(count: number, options?: Partial<TCreateOptions>): Promise<TEntity[]> {
    const entities: TEntity[] = []
    for (let i = 0; i < count; i++) {
      const entity = await Effect.runPromise(this.create(options))
      entities.push(entity)
    }
    return entities
  }

  protected nextId(): number {
    return ++this.counter
  }

  reset(): void {
    this.counter = 0
  }
}
```

```typescript
// packages/test-utils/src/factories/learning.factory.ts

import { Effect } from 'effect'
import { Learning } from '@tx/core'
import { BaseFactory, FactoryOptions } from './base.factory.js'
import { fixtureId } from '../fixtures/fixture-id.js'

export interface CreateLearningOptions {
  id?: number
  content?: string
  category?: string
  sourceType?: 'manual' | 'run' | 'import'
  sourceRef?: string | null
  embedding?: Buffer | null
  helpfulCount?: number
  notHelpfulCount?: number
  usageCount?: number
  createdAt?: Date
}

export class LearningFactory extends BaseFactory<Learning, CreateLearningOptions> {
  create(options: Partial<CreateLearningOptions> = {}): Effect.Effect<Learning, never> {
    return Effect.sync(() => {
      const id = options.id ?? this.nextId()
      const now = new Date()

      const learning: Learning = {
        id,
        content: options.content ?? `Test learning ${id}`,
        category: options.category ?? 'testing',
        sourceType: options.sourceType ?? 'manual',
        sourceRef: options.sourceRef ?? null,
        embedding: options.embedding ?? null,
        helpfulCount: options.helpfulCount ?? 0,
        notHelpfulCount: options.notHelpfulCount ?? 0,
        usageCount: options.usageCount ?? 0,
        createdAt: options.createdAt ?? now,
        updatedAt: now
      }

      this.db.exec(`
        INSERT INTO learnings (id, content, category, source_type, source_ref, embedding, helpful_count, not_helpful_count, usage_count, created_at, updated_at)
        VALUES (${id}, '${learning.content}', '${learning.category}', '${learning.sourceType}', ${learning.sourceRef ? `'${learning.sourceRef}'` : 'NULL'}, NULL, ${learning.helpfulCount}, ${learning.notHelpfulCount}, ${learning.usageCount}, '${learning.createdAt.toISOString()}', '${learning.updatedAt.toISOString()}')
      `)

      return learning
    })
  }

  /**
   * Create learning with specific content for search testing.
   */
  withContent(content: string, options: Partial<CreateLearningOptions> = {}) {
    return this.create({ ...options, content })
  }

  /**
   * Create learning with embedding for vector search testing.
   */
  withEmbedding(embedding: number[], options: Partial<CreateLearningOptions> = {}) {
    const buffer = Buffer.from(new Float32Array(embedding).buffer)
    return this.create({ ...options, embedding: buffer })
  }
}

// Convenience function
export const createTestLearning = (
  db: TestDatabase,
  options: Partial<CreateLearningOptions> = {}
): Effect.Effect<Learning, never> => {
  const factory = new LearningFactory({ db })
  return factory.create(options)
}

export const createTestLearnings = async (
  db: TestDatabase,
  count: number,
  options: Partial<CreateLearningOptions> = {}
): Promise<Learning[]> => {
  const factory = new LearningFactory({ db })
  return factory.createMany(count, options)
}
```

```typescript
// packages/test-utils/src/factories/edge.factory.ts

import { Effect } from 'effect'
import { GraphEdge, EdgeType, NodeType } from '@tx/core'
import { BaseFactory, FactoryOptions } from './base.factory.js'

export interface CreateEdgeOptions {
  id?: number
  edgeType?: EdgeType
  sourceType?: NodeType
  sourceId?: string
  targetType?: NodeType
  targetId?: string
  weight?: number
  metadata?: Record<string, unknown>
}

export class EdgeFactory extends BaseFactory<GraphEdge, CreateEdgeOptions> {
  create(options: Partial<CreateEdgeOptions> = {}): Effect.Effect<GraphEdge, never> {
    return Effect.sync(() => {
      const id = options.id ?? this.nextId()
      const now = new Date()

      const edge: GraphEdge = {
        id,
        edgeType: options.edgeType ?? 'SIMILAR_TO',
        sourceType: options.sourceType ?? 'learning',
        sourceId: options.sourceId ?? String(id),
        targetType: options.targetType ?? 'learning',
        targetId: options.targetId ?? String(id + 1),
        weight: options.weight ?? 1.0,
        metadata: options.metadata ?? {},
        createdAt: now,
        invalidatedAt: null
      }

      this.db.exec(`
        INSERT INTO learning_edges (id, edge_type, source_type, source_id, target_type, target_id, weight, metadata, created_at)
        VALUES (${id}, '${edge.edgeType}', '${edge.sourceType}', '${edge.sourceId}', '${edge.targetType}', '${edge.targetId}', ${edge.weight}, '${JSON.stringify(edge.metadata)}', '${now.toISOString()}')
      `)

      return edge
    })
  }

  /**
   * Create edge between two learnings.
   */
  betweenLearnings(
    sourceId: number,
    targetId: number,
    edgeType: EdgeType = 'SIMILAR_TO',
    weight = 1.0
  ) {
    return this.create({
      edgeType,
      sourceType: 'learning',
      sourceId: String(sourceId),
      targetType: 'learning',
      targetId: String(targetId),
      weight
    })
  }

  /**
   * Create anchor edge from learning to file.
   */
  anchorToFile(learningId: number, filePath: string, weight = 1.0) {
    return this.create({
      edgeType: 'ANCHORED_TO',
      sourceType: 'learning',
      sourceId: String(learningId),
      targetType: 'file',
      targetId: filePath,
      weight
    })
  }
}

// Convenience functions
export const createTestEdge = (
  db: TestDatabase,
  options: Partial<CreateEdgeOptions> = {}
): Effect.Effect<GraphEdge, never> => {
  const factory = new EdgeFactory({ db })
  return factory.create(options)
}

export const createEdgeBetweenLearnings = (
  db: TestDatabase,
  sourceId: number,
  targetId: number,
  edgeType: EdgeType = 'SIMILAR_TO',
  weight = 1.0
): Effect.Effect<GraphEdge, never> => {
  const factory = new EdgeFactory({ db })
  return factory.betweenLearnings(sourceId, targetId, edgeType, weight)
}
```

### LLM Cache Implementation

```typescript
// packages/test-utils/src/llm-cache/cache.ts

import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

const DEFAULT_CACHE_DIR = 'test/fixtures/llm-cache'

export interface LLMCacheConfig {
  cacheDir?: string
  enabled?: boolean
  version?: number
}

export interface CacheEntry<T> {
  inputHash: string
  inputPreview: string
  response: T
  model: string
  cachedAt: string
  version: number
  durationMs?: number
}

let globalConfig: LLMCacheConfig = {
  cacheDir: DEFAULT_CACHE_DIR,
  enabled: process.env.TX_NO_LLM_CACHE !== '1',
  version: 1
}

/**
 * Configure LLM cache globally.
 */
export const configureLLMCache = (config: Partial<LLMCacheConfig>): void => {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Compute SHA256 hash of input.
 */
export const hashInput = (input: string): string => {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Get cache file path for input.
 */
const getCachePath = (inputHash: string): string => {
  return path.join(globalConfig.cacheDir!, `${inputHash}.json`)
}

/**
 * Read from cache.
 */
export const readCache = async <T>(inputHash: string): Promise<CacheEntry<T> | null> => {
  if (!globalConfig.enabled) return null

  try {
    const cachePath = getCachePath(inputHash)
    const content = await fs.readFile(cachePath, 'utf-8')
    const entry = JSON.parse(content) as CacheEntry<T>

    // Version check
    if (entry.version !== globalConfig.version) {
      return null
    }

    return entry
  } catch {
    return null
  }
}

/**
 * Write to cache.
 */
export const writeCache = async <T>(
  inputHash: string,
  input: string,
  response: T,
  model: string,
  durationMs?: number
): Promise<void> => {
  if (!globalConfig.enabled) return

  const entry: CacheEntry<T> = {
    inputHash,
    inputPreview: input.slice(0, 500),
    response,
    model,
    cachedAt: new Date().toISOString(),
    version: globalConfig.version!,
    durationMs
  }

  const cachePath = getCachePath(inputHash)
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify(entry, null, 2))
}

/**
 * Execute with cache.
 */
export const cachedLLMCall = async <T>(
  input: string,
  model: string,
  call: () => Promise<T>
): Promise<T> => {
  const inputHash = hashInput(input)

  // Try cache
  const cached = await readCache<T>(inputHash)
  if (cached) {
    console.log(`[LLM Cache HIT] ${inputHash.slice(0, 12)}... (${model})`)
    return cached.response
  }

  // Cache miss - execute
  console.log(`[LLM Cache MISS] ${inputHash.slice(0, 12)}... calling ${model}`)
  const startTime = Date.now()
  const response = await call()
  const durationMs = Date.now() - startTime

  // Store in cache
  await writeCache(inputHash, input, response, model, durationMs)

  return response
}

/**
 * Wrap a function with caching.
 */
export const withLLMCache = <TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: {
    model: string
    serialize?: (...args: TArgs) => string
  }
): ((...args: TArgs) => Promise<TResult>) => {
  const serialize = options.serialize || ((...args) => JSON.stringify(args))

  return async (...args: TArgs): Promise<TResult> => {
    const input = serialize(...args)
    return cachedLLMCall(input, options.model, () => fn(...args))
  }
}
```

```typescript
// packages/test-utils/src/llm-cache/cli.ts

import * as fs from 'fs/promises'
import * as path from 'path'
import { CacheEntry } from './cache.js'

const CACHE_DIR = 'test/fixtures/llm-cache'

export interface CacheStats {
  count: number
  totalBytes: number
  oldestDate: Date | null
  newestDate: Date | null
  byModel: Record<string, number>
  avgDurationMs: number | null
}

/**
 * Get cache statistics.
 */
export const getCacheStats = async (): Promise<CacheStats> => {
  const files = await fs.readdir(CACHE_DIR).catch(() => [])

  const stats: CacheStats = {
    count: files.length,
    totalBytes: 0,
    oldestDate: null,
    newestDate: null,
    byModel: {},
    avgDurationMs: null
  }

  let totalDuration = 0
  let durationCount = 0

  for (const file of files) {
    if (!file.endsWith('.json')) continue

    const filePath = path.join(CACHE_DIR, file)
    const stat = await fs.stat(filePath)
    const content = JSON.parse(await fs.readFile(filePath, 'utf-8')) as CacheEntry<unknown>

    stats.totalBytes += stat.size
    stats.byModel[content.model] = (stats.byModel[content.model] || 0) + 1

    const date = new Date(content.cachedAt)
    if (!stats.oldestDate || date < stats.oldestDate) stats.oldestDate = date
    if (!stats.newestDate || date > stats.newestDate) stats.newestDate = date

    if (content.durationMs) {
      totalDuration += content.durationMs
      durationCount++
    }
  }

  if (durationCount > 0) {
    stats.avgDurationMs = totalDuration / durationCount
  }

  return stats
}

/**
 * Clear cache entries.
 */
export const clearCache = async (options: {
  olderThan?: Date
  model?: string
  all?: boolean
} = {}): Promise<{ deleted: number }> => {
  if (options.all) {
    await fs.rm(CACHE_DIR, { recursive: true, force: true })
    await fs.mkdir(CACHE_DIR, { recursive: true })
    return { deleted: -1 }
  }

  const files = await fs.readdir(CACHE_DIR).catch(() => [])
  let deleted = 0

  for (const file of files) {
    if (!file.endsWith('.json')) continue

    const filePath = path.join(CACHE_DIR, file)
    const content = JSON.parse(await fs.readFile(filePath, 'utf-8')) as CacheEntry<unknown>

    const shouldDelete =
      (options.olderThan && new Date(content.cachedAt) < options.olderThan) ||
      (options.model && content.model === options.model)

    if (shouldDelete) {
      await fs.unlink(filePath)
      deleted++
    }
  }

  return { deleted }
}

/**
 * Format stats for display.
 */
export const formatCacheStats = (stats: CacheStats): string => {
  const lines = [
    'LLM Cache Statistics:',
    `  Entries: ${stats.count}`,
    `  Size: ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`,
  ]

  if (stats.oldestDate) {
    lines.push(`  Oldest: ${stats.oldestDate.toISOString().split('T')[0]}`)
  }
  if (stats.newestDate) {
    lines.push(`  Newest: ${stats.newestDate.toISOString().split('T')[0]}`)
  }
  if (stats.avgDurationMs) {
    lines.push(`  Avg duration: ${stats.avgDurationMs.toFixed(0)}ms`)
  }

  if (Object.keys(stats.byModel).length > 0) {
    lines.push('  By model:')
    for (const [model, count] of Object.entries(stats.byModel)) {
      lines.push(`    ${model}: ${count}`)
    }
  }

  return lines.join('\n')
}
```

### Effect Test Helpers

```typescript
// packages/test-utils/src/helpers/effect.ts

import { Effect, Exit, Layer, Cause, Runtime } from 'effect'

/**
 * Run an Effect and return the result.
 * Throws on failure for test assertions.
 */
export const runEffect = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, any, any>
): Promise<A> => {
  const runnable = layer
    ? Effect.provide(effect, layer)
    : effect

  const exit = await Effect.runPromiseExit(runnable as Effect.Effect<A, E, never>)

  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause)
    throw error
  }

  return exit.value
}

/**
 * Run an Effect and expect it to fail with specific error.
 */
export const runEffectFail = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, any, any>
): Promise<E> => {
  const runnable = layer
    ? Effect.provide(effect, layer)
    : effect

  const exit = await Effect.runPromiseExit(runnable as Effect.Effect<A, E, never>)

  if (Exit.isSuccess(exit)) {
    throw new Error(`Expected Effect to fail, but succeeded with: ${JSON.stringify(exit.value)}`)
  }

  return Cause.squash(exit.cause) as E
}

/**
 * Run an Effect and return Either-style result.
 */
export const runEffectEither = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, any, any>
): Promise<{ ok: true; value: A } | { ok: false; error: E }> => {
  const runnable = layer
    ? Effect.provide(effect, layer)
    : effect

  const exit = await Effect.runPromiseExit(runnable as Effect.Effect<A, E, never>)

  if (Exit.isSuccess(exit)) {
    return { ok: true, value: exit.value }
  }

  return { ok: false, error: Cause.squash(exit.cause) as E }
}

/**
 * Assert that an Effect succeeds with specific value.
 */
export const expectEffectSuccess = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  expected: A,
  layer?: Layer.Layer<R, any, any>
): Promise<void> => {
  const result = await runEffect(effect, layer)
  expect(result).toEqual(expected)
}

/**
 * Assert that an Effect fails with specific error type.
 */
export const expectEffectFailure = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  errorTag: string,
  layer?: Layer.Layer<R, any, any>
): Promise<void> => {
  const error = await runEffectFail(effect, layer)
  expect((error as any)._tag).toBe(errorTag)
}
```

### Temporary Files Helper

```typescript
// packages/test-utils/src/helpers/temp-files.ts

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface TempDir {
  readonly path: string
  writeFile(relativePath: string, content: string): Promise<string>
  writeJson(relativePath: string, data: unknown): Promise<string>
  readFile(relativePath: string): Promise<string>
  readJson<T>(relativePath: string): Promise<T>
  exists(relativePath: string): Promise<boolean>
  mkdir(relativePath: string): Promise<string>
  ls(relativePath?: string): Promise<string[]>
  cleanup(): Promise<void>
}

/**
 * Create temporary directory for test files.
 */
export const createTempDir = async (prefix = 'tx-test-'): Promise<TempDir> => {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  const resolve = (relativePath: string) => path.join(dirPath, relativePath)

  return {
    path: dirPath,

    async writeFile(relativePath, content) {
      const fullPath = resolve(relativePath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf-8')
      return fullPath
    },

    async writeJson(relativePath, data) {
      return this.writeFile(relativePath, JSON.stringify(data, null, 2))
    },

    async readFile(relativePath) {
      return fs.readFile(resolve(relativePath), 'utf-8')
    },

    async readJson<T>(relativePath) {
      const content = await this.readFile(relativePath)
      return JSON.parse(content) as T
    },

    async exists(relativePath) {
      try {
        await fs.access(resolve(relativePath))
        return true
      } catch {
        return false
      }
    },

    async mkdir(relativePath) {
      const fullPath = resolve(relativePath)
      await fs.mkdir(fullPath, { recursive: true })
      return fullPath
    },

    async ls(relativePath = '.') {
      return fs.readdir(resolve(relativePath))
    },

    async cleanup() {
      await fs.rm(dirPath, { recursive: true, force: true })
    }
  }
}

/**
 * Write test file with TypeScript content.
 */
export const writeTestTypeScriptFile = async (
  tempDir: TempDir,
  relativePath: string,
  content: string
): Promise<string> => {
  // Ensure .ts extension
  const filePath = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`
  return tempDir.writeFile(filePath, content)
}

/**
 * Create test source files for ast-grep testing.
 */
export const createTestSourceFiles = async (
  tempDir: TempDir,
  files: Record<string, string>
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {}

  for (const [relativePath, content] of Object.entries(files)) {
    result[relativePath] = await tempDir.writeFile(relativePath, content)
  }

  return result
}
```

### Mock Services

```typescript
// packages/test-utils/src/mocks/anthropic.mock.ts

export interface MockMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface MockAnthropicCall {
  model: string
  messages: MockMessage[]
  max_tokens?: number
}

export interface MockAnthropicConfig {
  responses?: Map<string, any>
  defaultResponse?: any
  shouldFail?: boolean
  failureError?: Error
  latencyMs?: number
}

/**
 * Create mock Anthropic client for testing.
 */
export const createMockAnthropic = (config: MockAnthropicConfig = {}) => {
  const calls: MockAnthropicCall[] = []

  const client = {
    messages: {
      create: async (params: MockAnthropicCall) => {
        calls.push(params)

        if (config.latencyMs) {
          await new Promise(resolve => setTimeout(resolve, config.latencyMs))
        }

        if (config.shouldFail) {
          throw config.failureError || new Error('Mock Anthropic API error')
        }

        // Check for specific response
        const key = JSON.stringify(params.messages)
        if (config.responses?.has(key)) {
          return config.responses.get(key)
        }

        // Return default response
        return config.defaultResponse || {
          id: 'mock-msg-id',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '[]' }],
          model: params.model,
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      }
    }
  }

  return {
    client,
    calls,
    reset: () => calls.length = 0,
    getCallCount: () => calls.length,
    getLastCall: () => calls[calls.length - 1]
  }
}

/**
 * Create mock that returns specific extraction results.
 */
export const createMockAnthropicForExtraction = (
  candidates: Array<{ content: string; confidence: string; category: string }>
) => {
  return createMockAnthropic({
    defaultResponse: {
      id: 'mock-msg-id',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(candidates) }],
      model: 'claude-sonnet-4',
      usage: { input_tokens: 100, output_tokens: 50 }
    }
  })
}
```

### Global Test Setup

```typescript
// packages/test-utils/src/setup/vitest.setup.ts

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { configureLLMCache } from '../llm-cache/cache.js'

// Configure LLM cache based on environment
beforeAll(() => {
  configureLLMCache({
    enabled: process.env.TX_NO_LLM_CACHE !== '1',
    version: parseInt(process.env.TX_LLM_CACHE_VERSION || '1', 10)
  })
})

// Custom matchers
expect.extend({
  toBeValidFixtureId(received: string) {
    const pass = /^tx-[a-f0-9]{8}$/.test(received)
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid fixture ID`
        : `expected ${received} to be a valid fixture ID (tx-xxxxxxxx)`
    }
  },

  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be within range ${floor} - ${ceiling}`
        : `expected ${received} to be within range ${floor} - ${ceiling}`
    }
  }
})

// Type declarations for custom matchers
declare module 'vitest' {
  interface Assertion<T = any> {
    toBeValidFixtureId(): T
    toBeWithinRange(floor: number, ceiling: number): T
  }
}
```

## Public API

```typescript
// packages/test-utils/src/index.ts

// Database
export { createTestDatabase, TestDatabaseService, TestDatabaseLive } from './database/test-database.js'
export type { TestDatabase } from './database/test-database.js'

// Fixtures
export { fixtureId, namespacedFixtureId, sequentialFixtureIds, contentFixtureId } from './fixtures/fixture-id.js'

// Factories
export { createTestLearning, createTestLearnings, LearningFactory } from './factories/learning.factory.js'
export { createTestTask, createTestTasks, TaskFactory } from './factories/task.factory.js'
export { createTestEdge, createEdgeBetweenLearnings, EdgeFactory } from './factories/edge.factory.js'
export { createTestAnchor, AnchorFactory } from './factories/anchor.factory.js'
export { createTestCandidate, CandidateFactory } from './factories/candidate.factory.js'

// LLM Cache
export { cachedLLMCall, withLLMCache, hashInput, configureLLMCache } from './llm-cache/cache.js'
export { getCacheStats, clearCache, formatCacheStats } from './llm-cache/cli.js'

// Effect Helpers
export { runEffect, runEffectFail, runEffectEither, expectEffectSuccess, expectEffectFailure } from './helpers/effect.js'

// Temp Files
export { createTempDir, writeTestTypeScriptFile, createTestSourceFiles } from './helpers/temp-files.js'
export type { TempDir } from './helpers/temp-files.js'

// Mocks
export { createMockAnthropic, createMockAnthropicForExtraction } from './mocks/anthropic.mock.js'
export { MockAstGrepService } from './mocks/ast-grep.mock.js'
export { MockFileSystem } from './mocks/file-system.mock.js'

// Re-export setup for vitest.config.ts
export { default as vitestSetup } from './setup/vitest.setup.js'
```

## Usage in Tests

```typescript
// Example: packages/core/test/learning-service.test.ts

import {
  createTestDatabase,
  createTestLearning,
  createTestLearnings,
  runEffect,
  fixtureId,
  createTempDir
} from '@tx/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('LearningService', () => {
  let db: TestDatabase
  let tempDir: TempDir

  beforeEach(async () => {
    db = await createTestDatabase()
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await db.close()
    await tempDir.cleanup()
  })

  it('should create and retrieve learning', async () => {
    const learning = await runEffect(
      createTestLearning(db, { content: 'Test content' })
    )

    expect(learning.content).toBe('Test content')
    expect(learning.id).toBeDefined()
  })

  it('should use deterministic fixture IDs', () => {
    const id1 = fixtureId('my-test-learning')
    const id2 = fixtureId('my-test-learning')

    expect(id1).toBe(id2) // Same input = same output
    expect(id1).toBeValidFixtureId()
  })
})
```

## ESLint Rules for Test Quality

### require-factory-parity

Enforces that every exported type/interface has a corresponding factory function:

```javascript
// eslint-plugin-tx/rules/require-factory-parity.js

/**
 * Scans packages/types/src for exported interfaces
 * Checks for corresponding createTest<Entity> factory functions
 * Reports missing factories
 */

// Configuration
{
  'tx/require-factory-parity': ['error', {
    typePaths: ['packages/types/src', 'src/schemas'],
    factoryPaths: ['test/fixtures.ts', 'packages/test-utils/src/factories'],
    ignoredEntities: ['TaskTree', 'TaskCursor', 'TaskFilter', 'ContextResult']
  }]
}

// Example error:
// Missing test factory for entity "Anchor". Create createTestAnchor() in test utilities.
```

Entity detection:
- Extracts `export interface Entity` declarations
- Filters out helper types: `*Row`, `*Input`, `*Query`, `*Result`, `*Filter`, `*With*`
- Matches against `createTest<Entity>` or `<Entity>Factory` patterns

### require-colocated-tests

Enforces test co-location alongside source files:

```javascript
// eslint-plugin-tx/rules/require-colocated-tests.js

// Configuration
{
  'tx/require-colocated-tests': ['warn', {
    enforcePaths: ['packages/*/src', 'apps/*/src', 'src/services'],
    ignorePaths: ['node_modules', 'dist', 'test/integration', 'test/e2e'],
    ignorePatterns: ['index.ts', '*.d.ts', 'types.ts', 'constants.ts'],
    minLinesForTest: 20,
    allowTestsDirectory: true
  }]
}

// Example error:
// Missing co-located test file for "learning-service.ts".
// Expected: "learning-service.test.ts" or "__tests__/learning-service.test.ts"
```

Co-location rules:
- Source file: `packages/core/src/services/learning-service.ts`
- Test file: `packages/core/src/services/learning-service.test.ts` (preferred)
- Or: `packages/core/src/services/__tests__/learning-service.test.ts` (allowed)

Benefits:
1. **Discoverability**: Tests visible alongside source in file tree
2. **Maintenance**: Changes and tests modified together
3. **IDE support**: Better autocomplete and navigation
4. **Code review**: PRs show source and test changes together
5. **Refactoring**: Move source + test as a unit

### Integration Test Examples

```typescript
// packages/test-utils/test/factory-parity.integration.test.ts

import { describe, it, expect } from 'vitest'
import {
  createTestLearning,
  createTestTask,
  createTestEdge,
  createTestAnchor,
  createTestDatabase
} from '../src'

describe('Factory Parity', () => {
  it('should have factory for Learning type', async () => {
    const db = await createTestDatabase()
    const learning = await createTestLearning(db, { content: 'Test' })
    expect(learning.id).toBeDefined()
    expect(learning.content).toBe('Test')
  })

  it('should have factory for Task type', async () => {
    const db = await createTestDatabase()
    const task = await createTestTask(db, { title: 'Test Task' })
    expect(task.id).toMatch(/^tx-[a-f0-9]{8}$/)
  })

  it('should have factory for GraphEdge type', async () => {
    const db = await createTestDatabase()
    const edge = await createTestEdge(db, {
      edgeType: 'SIMILAR_TO',
      sourceId: '1',
      targetId: '2'
    })
    expect(edge.edgeType).toBe('SIMILAR_TO')
  })

  it('should have factory for Anchor type', async () => {
    const db = await createTestDatabase()
    const anchor = await createTestAnchor(db, {
      learningId: 1,
      filePath: 'src/test.ts',
      anchorType: 'symbol',
      anchorValue: 'testFunction'
    })
    expect(anchor.filePath).toBe('src/test.ts')
  })
})
```

```typescript
// packages/test-utils/test/colocated-tests.integration.test.ts

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Test Co-location Verification', () => {
  const checkColocatedTest = (sourcePath: string): boolean => {
    const testPath = sourcePath.replace(/\.ts$/, '.test.ts')
    const testsDir = path.join(path.dirname(sourcePath), '__tests__',
      path.basename(sourcePath).replace(/\.ts$/, '.test.ts'))
    return fs.existsSync(testPath) || fs.existsSync(testsDir)
  }

  it('should have co-located tests for packages/core/src/services', () => {
    const servicesDir = 'packages/core/src/services'
    const services = fs.readdirSync(servicesDir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')

    for (const service of services) {
      const sourcePath = path.join(servicesDir, service)
      expect(checkColocatedTest(sourcePath)).toBe(true)
    }
  })

  it('should have co-located tests for packages/types/src', () => {
    const typesDir = 'packages/types/src'
    const typeFiles = fs.readdirSync(typesDir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')

    // Types may not need tests, but if they have complex logic, they should
    for (const typeFile of typeFiles) {
      const sourcePath = path.join(typesDir, typeFile)
      const content = fs.readFileSync(sourcePath, 'utf-8')
      const lines = content.split('\n').length

      // Only check files with significant logic (>50 lines)
      if (lines > 50) {
        expect(checkColocatedTest(sourcePath)).toBe(true)
      }
    }
  })
})
```

## References

- PRD-013: Test Utilities Package
- DD-007: Testing Strategy
- [Vitest documentation](https://vitest.dev/)
- [Effect testing patterns](https://effect.website/docs/guides/testing)
