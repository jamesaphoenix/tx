# PRD-013: Test Utilities Package

## Overview

Centralize all test utilities, factories, fixtures, and helpers into a single `@tx/test-utils` package. Provides consistent testing patterns across the monorepo.

## Problem Statement

- Test helpers are duplicated across packages
- No consistent pattern for creating test data
- LLM test caching is ad-hoc
- Database setup/teardown logic repeated everywhere
- Fixture ID generation inconsistent
- No shared mocks for external services

## Solution: `@tx/test-utils` Package

```
packages/test-utils/
├── src/
│   ├── index.ts              # Public exports
│   ├── database.ts           # Test database helpers
│   ├── factories/            # Entity factories
│   │   ├── learning.ts
│   │   ├── task.ts
│   │   ├── anchor.ts
│   │   ├── edge.ts
│   │   └── candidate.ts
│   ├── fixtures/             # SHA256-based fixtures
│   │   ├── fixture-id.ts
│   │   └── snapshots.ts
│   ├── llm-cache/            # LLM response caching
│   │   ├── cache.ts
│   │   └── recorder.ts
│   ├── mocks/                # Service mocks
│   │   ├── anthropic.ts
│   │   ├── ast-grep.ts
│   │   └── file-system.ts
│   ├── assertions/           # Custom assertions
│   │   └── effect.ts
│   └── setup.ts              # Global test setup
└── package.json
```

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| TU-001 | SHA256-based deterministic fixture IDs | P0 |
| TU-002 | In-memory SQLite database factory | P0 |
| TU-003 | Entity factories for all core types | P0 |
| TU-004 | LLM response caching with SHA256 keys | P0 |
| TU-005 | CLI for cache management | P0 |
| TU-006 | Effect-TS test runners and assertions | P0 |
| TU-007 | Mock services for external dependencies | P1 |
| TU-008 | Temporary file system helpers | P1 |
| TU-009 | Snapshot testing for LLM outputs | P1 |
| TU-010 | Test data generators (faker integration) | P2 |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| TU-NFR-001 | Test database creation | <50ms |
| TU-NFR-002 | Fixture ID computation | <1ms |
| TU-NFR-003 | LLM cache lookup | <5ms |
| TU-NFR-004 | Zero external dependencies in mocks | 100% |

### Test Co-location Requirements

Tests MUST be co-located alongside their source files for discoverability and maintenance:

| ID | Requirement | Priority |
|----|-------------|----------|
| TU-COL-001 | Unit tests co-located with source files | P0 |
| TU-COL-002 | Integration tests in `__tests__/` or `.test.ts` suffix | P0 |
| TU-COL-003 | ESLint rule enforces co-location | P0 |

**Co-location Convention:**

```
packages/core/src/services/
├── learning-service.ts           # Service implementation
├── learning-service.test.ts      # Unit tests (co-located)
├── task-service.ts
├── task-service.test.ts
└── __tests__/                    # Integration tests (optional grouping)
    └── learning-service.integration.test.ts
```

**Naming Conventions:**

| Test Type | File Pattern | Location |
|-----------|--------------|----------|
| Unit test | `*.test.ts` | Same directory as source |
| Integration test | `*.integration.test.ts` | Same directory or `__tests__/` |
| E2E test | `*.e2e.test.ts` | `test/e2e/` directory |

**Benefits of Co-location:**

1. **Discoverability**: Tests are immediately visible when viewing source files
2. **Maintenance**: Easier to update tests when modifying source
3. **IDE Support**: Better autocomplete and navigation
4. **Code Review**: Changes and tests visible together in PRs
5. **Refactoring**: Move source + test together as a unit

**Anti-patterns (DO NOT):**

```
# BAD: Separate test directory mirrors source structure
src/services/learning-service.ts
test/services/learning-service.test.ts  # ❌ Not co-located

# BAD: All tests in root test folder
test/unit/learning-service.test.ts  # ❌ Hard to find

# GOOD: Co-located
src/services/learning-service.ts
src/services/learning-service.test.ts  # ✅ Right next to source
```

## Core Components

### 1. Fixture ID Generation

Deterministic IDs for reproducible tests:

```typescript
// packages/test-utils/src/fixtures/fixture-id.ts

import * as crypto from 'crypto'

/**
 * Generate deterministic fixture ID from name.
 * Same name always produces same ID.
 */
export const fixtureId = (name: string): string => {
  const hash = crypto.createHash('sha256').update(name).digest('hex')
  return `tx-${hash.slice(0, 8)}`
}

/**
 * Generate fixture ID with namespace.
 * Useful for avoiding collisions across test files.
 */
export const namespacedFixtureId = (namespace: string, name: string): string => {
  return fixtureId(`${namespace}:${name}`)
}

// Usage:
// fixtureId('task-1') -> 'tx-a1b2c3d4' (always same)
// fixtureId('task-2') -> 'tx-e5f6g7h8' (always same)
```

### 2. Test Database

In-memory SQLite with migrations:

```typescript
// packages/test-utils/src/database.ts

import Database from 'better-sqlite3'
import { Effect, Layer } from 'effect'
import { SqliteClient } from '@tx/core'

export interface TestDatabase {
  db: Database.Database
  client: SqliteClient
  close: () => Promise<void>
  reset: () => Promise<void>
  query: <T>(sql: string, params?: any[]) => T[]
}

/**
 * Create in-memory test database with all migrations applied.
 */
export const createTestDatabase = async (): Promise<TestDatabase> => {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')

  // Run all migrations
  await runMigrations(db)

  return {
    db,
    client: { db } as SqliteClient,
    close: async () => db.close(),
    reset: async () => {
      // Truncate all tables
      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all() as { name: string }[]

      for (const { name } of tables) {
        db.exec(`DELETE FROM ${name}`)
      }
    },
    query: (sql, params = []) => db.prepare(sql).all(...params)
  }
}

/**
 * Create test database Layer for Effect.
 */
export const TestDatabaseLayer = Layer.scoped(
  SqliteClient,
  Effect.acquireRelease(
    Effect.promise(() => createTestDatabase().then(td => td.client)),
    (client) => Effect.promise(() => (client as any).db?.close?.())
  )
)

/**
 * Run migrations up to specific version.
 */
export const runMigrations = async (
  db: Database.Database,
  upTo?: string
): Promise<void> => {
  const migrations = await loadMigrations()

  for (const migration of migrations) {
    if (upTo && migration.name > upTo) break
    db.exec(migration.sql)
  }
}
```

### 3. Entity Factories

Consistent test data creation:

```typescript
// packages/test-utils/src/factories/learning.ts

import { Effect } from 'effect'
import { Learning, LearningService } from '@tx/core'
import { fixtureId } from '../fixtures/fixture-id.js'

export interface LearningFactoryOptions {
  id?: string
  content?: string
  category?: string
  sourceType?: string
  sourceRef?: string
  embedding?: Float32Array
  createdAt?: Date
}

let learningCounter = 0

export const createTestLearning = (
  db: TestDatabase,
  options: LearningFactoryOptions = {}
): Effect.Effect<Learning, never, never> =>
  Effect.gen(function* () {
    learningCounter++
    const name = options.content || `Test Learning ${learningCounter}`

    const learning = {
      id: options.id ? parseInt(options.id.replace('tx-', ''), 16) : learningCounter,
      content: name,
      category: options.category || 'testing',
      sourceType: options.sourceType || 'manual',
      sourceRef: options.sourceRef || null,
      embedding: options.embedding || null,
      helpfulCount: 0,
      notHelpfulCount: 0,
      usageCount: 0,
      createdAt: options.createdAt || new Date(),
      updatedAt: new Date()
    }

    db.query(`
      INSERT INTO learnings (id, content, category, source_type, source_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [learning.id, learning.content, learning.category, learning.sourceType, learning.sourceRef, learning.createdAt.toISOString(), learning.updatedAt.toISOString()])

    return learning
  })

/**
 * Create multiple learnings at once.
 */
export const createTestLearnings = (
  db: TestDatabase,
  count: number,
  options: LearningFactoryOptions = {}
): Effect.Effect<Learning[], never, never> =>
  Effect.all(
    Array.from({ length: count }, (_, i) =>
      createTestLearning(db, { ...options, content: `${options.content || 'Learning'} ${i + 1}` })
    )
  )
```

```typescript
// packages/test-utils/src/factories/task.ts

import { Task } from '@tx/core'
import { fixtureId } from '../fixtures/fixture-id.js'

export interface TaskFactoryOptions {
  id?: string
  title?: string
  description?: string
  status?: string
  priority?: number
  parentId?: string
}

export const createTestTask = (
  db: TestDatabase,
  options: TaskFactoryOptions = {}
): Effect.Effect<Task, never, never> =>
  Effect.gen(function* () {
    const id = options.id || fixtureId(`task-${Date.now()}-${Math.random()}`)

    const task = {
      id,
      title: options.title || `Test Task ${id}`,
      description: options.description || '',
      status: options.status || 'backlog',
      priority: options.priority || 500,
      parentId: options.parentId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    db.query(`
      INSERT INTO tasks (id, title, description, status, priority_score, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [task.id, task.title, task.description, task.status, task.priority, task.parentId, task.createdAt.toISOString(), task.updatedAt.toISOString()])

    return task
  })
```

```typescript
// packages/test-utils/src/factories/index.ts

export * from './learning.js'
export * from './task.js'
export * from './anchor.js'
export * from './edge.js'
export * from './candidate.js'

// Convenience re-exports
export { fixtureId, namespacedFixtureId } from '../fixtures/fixture-id.js'
```

### 4. LLM Response Caching

Cache expensive LLM calls by SHA256:

```typescript
// packages/test-utils/src/llm-cache/cache.ts

import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

const CACHE_DIR = 'test/fixtures/llm-cache'

export interface CacheEntry<T> {
  inputHash: string
  input: string
  response: T
  model: string
  cachedAt: string
  version: number
}

/**
 * Compute SHA256 hash of input for cache key.
 */
export const hashInput = (input: string): string => {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Get cached LLM response or execute and cache.
 */
export const cachedLLMCall = async <T>(
  input: string,
  model: string,
  call: () => Promise<T>,
  options: { version?: number; forceRefresh?: boolean } = {}
): Promise<T> => {
  if (process.env.TX_NO_LLM_CACHE === '1' || options.forceRefresh) {
    return call()
  }

  const inputHash = hashInput(input)
  const cacheFile = path.join(CACHE_DIR, `${inputHash}.json`)

  // Check cache
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf-8')) as CacheEntry<T>

    // Version mismatch = cache miss
    if (options.version && cached.version !== options.version) {
      throw new Error('Version mismatch')
    }

    console.log(`[LLM Cache HIT] ${inputHash.slice(0, 12)}...`)
    return cached.response
  } catch {
    // Cache miss
  }

  console.log(`[LLM Cache MISS] ${inputHash.slice(0, 12)}... calling ${model}`)
  const response = await call()

  // Store in cache
  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(cacheFile, JSON.stringify({
    inputHash,
    input: input.slice(0, 1000), // Truncate for readability
    response,
    model,
    cachedAt: new Date().toISOString(),
    version: options.version || 1
  } satisfies CacheEntry<T>, null, 2))

  return response
}

/**
 * Wrap an extractor/verifier to use caching.
 */
export const withCache = <TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options: { model: string; serialize?: (input: TInput) => string }
) => {
  const serialize = options.serialize || JSON.stringify

  return async (input: TInput): Promise<TOutput> => {
    return cachedLLMCall(
      serialize(input),
      options.model,
      () => fn(input)
    )
  }
}
```

```typescript
// packages/test-utils/src/llm-cache/cli.ts

import * as fs from 'fs/promises'
import * as path from 'path'

const CACHE_DIR = 'test/fixtures/llm-cache'

export interface CacheStats {
  count: number
  totalBytes: number
  oldestDate: Date | null
  newestDate: Date | null
  byModel: Record<string, number>
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
    byModel: {}
  }

  for (const file of files) {
    const filePath = path.join(CACHE_DIR, file)
    const stat = await fs.stat(filePath)
    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))

    stats.totalBytes += stat.size
    stats.byModel[content.model] = (stats.byModel[content.model] || 0) + 1

    const date = new Date(content.cachedAt)
    if (!stats.oldestDate || date < stats.oldestDate) stats.oldestDate = date
    if (!stats.newestDate || date > stats.newestDate) stats.newestDate = date
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
} = {}): Promise<number> => {
  if (options.all) {
    await fs.rm(CACHE_DIR, { recursive: true, force: true })
    await fs.mkdir(CACHE_DIR, { recursive: true })
    return -1 // Unknown count
  }

  const files = await fs.readdir(CACHE_DIR).catch(() => [])
  let deleted = 0

  for (const file of files) {
    const filePath = path.join(CACHE_DIR, file)
    const stat = await fs.stat(filePath)
    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))

    const shouldDelete =
      (options.olderThan && new Date(content.cachedAt) < options.olderThan) ||
      (options.model && content.model === options.model)

    if (shouldDelete) {
      await fs.unlink(filePath)
      deleted++
    }
  }

  return deleted
}
```

### 5. Effect Test Helpers

Run Effects in tests easily:

```typescript
// packages/test-utils/src/assertions/effect.ts

import { Effect, Exit, Layer, Runtime } from 'effect'

/**
 * Run an Effect and return the result.
 * Throws on failure for test assertions.
 */
export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E, any>,
  ...layers: Layer.Layer<any, any, any>[]
): Promise<A> => {
  const fullLayer = layers.length > 0
    ? layers.reduce((acc, layer) => Layer.merge(acc, layer))
    : Layer.empty

  const runnable = effect.pipe(Effect.provide(fullLayer as any))
  const exit = await Effect.runPromiseExit(runnable)

  if (Exit.isFailure(exit)) {
    const error = exit.cause
    throw new Error(`Effect failed: ${JSON.stringify(error)}`)
  }

  return exit.value
}

/**
 * Run an Effect and expect it to fail.
 */
export const runEffectFail = async <A, E>(
  effect: Effect.Effect<A, E, any>,
  ...layers: Layer.Layer<any, any, any>[]
): Promise<E> => {
  const fullLayer = layers.length > 0
    ? layers.reduce((acc, layer) => Layer.merge(acc, layer))
    : Layer.empty

  const runnable = effect.pipe(Effect.provide(fullLayer as any))
  const exit = await Effect.runPromiseExit(runnable)

  if (Exit.isSuccess(exit)) {
    throw new Error(`Expected Effect to fail, but it succeeded with: ${JSON.stringify(exit.value)}`)
  }

  return exit.cause as any as E
}

/**
 * Create test context with database and common services.
 */
export const createTestContext = async () => {
  const db = await createTestDatabase()

  return {
    db,
    run: <A, E>(effect: Effect.Effect<A, E, any>) =>
      runEffect(effect, TestDatabaseLayer),
    cleanup: () => db.close()
  }
}
```

### 6. Mock Services

Mocks for external dependencies:

```typescript
// packages/test-utils/src/mocks/anthropic.ts

import { Layer } from 'effect'

export interface MockAnthropicOptions {
  responses?: Record<string, any>
  defaultResponse?: any
  shouldFail?: boolean
  failureMessage?: string
}

export const createMockAnthropic = (options: MockAnthropicOptions = {}) => {
  const calls: Array<{ model: string; messages: any[] }> = []

  return {
    calls,
    messages: {
      create: async (params: { model: string; messages: any[] }) => {
        calls.push(params)

        if (options.shouldFail) {
          throw new Error(options.failureMessage || 'Mock API failure')
        }

        const key = JSON.stringify(params.messages)
        const response = options.responses?.[key] || options.defaultResponse || {
          content: [{ type: 'text', text: '[]' }]
        }

        return response
      }
    }
  }
}

// Usage:
// const mockAnthropic = createMockAnthropic({
//   defaultResponse: { content: [{ type: 'text', text: '[{"content":"test"}]' }] }
// })
```

```typescript
// packages/test-utils/src/mocks/ast-grep.ts

import { Layer, Effect } from 'effect'
import { AstGrepService, SymbolInfo } from '@tx/core'

export interface MockAstGrepOptions {
  symbols?: Record<string, SymbolInfo[]>
  imports?: Record<string, any[]>
}

export const MockAstGrepService = (options: MockAstGrepOptions = {}) =>
  Layer.succeed(
    AstGrepService,
    {
      findSymbols: (filePath) =>
        Effect.succeed(options.symbols?.[filePath] || []),
      getImports: (filePath) =>
        Effect.succeed(options.imports?.[filePath] || []),
      matchPattern: () => Effect.succeed([])
    }
  )
```

### 7. Temporary File Helpers

```typescript
// packages/test-utils/src/temp-files.ts

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface TempDir {
  path: string
  writeFile: (name: string, content: string) => Promise<string>
  readFile: (name: string) => Promise<string>
  exists: (name: string) => Promise<boolean>
  cleanup: () => Promise<void>
}

/**
 * Create a temporary directory for test files.
 */
export const createTempDir = async (prefix = 'tx-test-'): Promise<TempDir> => {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  return {
    path: dirPath,

    writeFile: async (name, content) => {
      const filePath = path.join(dirPath, name)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content)
      return filePath
    },

    readFile: (name) => fs.readFile(path.join(dirPath, name), 'utf-8'),

    exists: (name) =>
      fs.access(path.join(dirPath, name)).then(() => true).catch(() => false),

    cleanup: () => fs.rm(dirPath, { recursive: true, force: true })
  }
}
```

## CLI Commands

```bash
# Show cache statistics
tx test:cache-stats
# Output:
# LLM Cache Statistics:
#   Entries: 142
#   Size: 3.2 MB
#   Oldest: 2024-01-15
#   Newest: 2024-02-01
#   By model:
#     claude-sonnet-4: 98
#     claude-haiku: 44

# Clear all caches
tx test:clear-cache --all

# Clear caches older than 30 days
tx test:clear-cache --older-than "30 days"

# Clear caches for specific model
tx test:clear-cache --model claude-haiku

# Run tests without cache (force fresh LLM calls)
TX_NO_LLM_CACHE=1 pnpm test

# Run tests and record new cache entries
TX_LLM_CACHE_RECORD=1 pnpm test
```

## Usage Examples

### Basic Test Setup

```typescript
import {
  createTestDatabase,
  createTestLearning,
  createTestTask,
  fixtureId,
  runEffect,
  createTempDir
} from '@tx/test-utils'

describe('MyFeature', () => {
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

  it('should do something', async () => {
    const learning = await runEffect(
      createTestLearning(db, { content: 'Test learning' })
    )

    expect(learning.id).toBeDefined()
    expect(learning.content).toBe('Test learning')
  })
})
```

### With LLM Caching

```typescript
import { cachedLLMCall, createTestDatabase } from '@tx/test-utils'

describe('LLM Feature', () => {
  it('should extract candidates', async () => {
    const transcript = 'User: Fix bug\nAssistant: I found the issue...'

    const candidates = await cachedLLMCall(
      transcript,
      'claude-sonnet-4',
      async () => {
        // Real API call - only runs on cache miss
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: extractionPrompt(transcript) }]
        })
        return parseResponse(response)
      }
    )

    expect(candidates.length).toBeGreaterThan(0)
  })
})
```

### With Mocks

```typescript
import { MockAstGrepService, createTestDatabase, runEffect } from '@tx/test-utils'

describe('Symbol Extraction', () => {
  it('should find symbols', async () => {
    const mockSymbols = {
      'src/auth.ts': [
        { name: 'validateToken', kind: 'function', line: 10, exported: true }
      ]
    }

    const result = await runEffect(
      anchorService.createAnchor({
        learningId: 1,
        filePath: 'src/auth.ts',
        anchorType: 'symbol',
        anchorValue: 'validateToken'
      }),
      MockAstGrepService({ symbols: mockSymbols })
    )

    expect(result.symbolFqname).toBe('src/auth.ts::validateToken')
  })
})
```

## Dependencies

- **Depends on**: None (foundational package)
- **Blocks**: All other packages use this for testing

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test setup time | <100ms | Benchmark |
| LLM cache hit rate | >90% in CI | Monitoring |
| Code duplication | 0 test helpers in app packages | Lint rule |
| Coverage of factories | 100% of core entities | Audit |

## Non-Goals

- Production runtime utilities (test-only package)
- Browser test support (Node.js only)
- Visual regression testing
- Performance benchmarking framework

## References

- [Vitest documentation](https://vitest.dev/)
- [Effect testing patterns](https://effect.website/docs/guides/testing)
- DD-007: Testing Strategy
