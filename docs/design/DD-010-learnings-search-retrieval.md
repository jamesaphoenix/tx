# DD-010: Learnings Search & Retrieval

**Status**: Draft
**Implements**: [PRD-010](../prd/PRD-010-contextual-learnings-system.md)
**Last Updated**: 2025-01-30

---

## Overview

This document describes **how** tx implements the contextual learnings system: hybrid BM25 + vector search with recency scoring, adapted from qmd patterns to Effect-TS.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LearningService                          │
├─────────────────────────────────────────────────────────────────┤
│  create()  │  get()  │  search()  │  hybridSearch()  │  getContextForTask()
├─────────────────────────────────────────────────────────────────┤
│                      LearningRepository                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ bm25Search()  │  vectorSearch()  │  findRecent()          │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      EmbeddingService                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ embed()  │  embedBatch()  │  isAvailable()                │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                       SQLite (tasks.db)                          │
│  learnings │ learnings_fts (FTS5) │ learnings_vec (optional)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Single Learning Retrieval

The `tx learning:show <id>` command provides direct access to a learning's full content.

### Use Case

Claude Code hooks inject learnings truncated to 200 characters to conserve context window. When an agent sees a relevant learning preview, they can expand it:

```bash
# Hook shows: "#218 (81%) Daemon service file generators (launchd plist, systemd..."

$ tx learning:show 218
Learning #218
  Content: Daemon service file generators (launchd plist, systemd unit) follow a consistent pattern in daemon-service.ts: export a PATH constant for install location, define an Options interface with label/executablePath/logPath, and implement a pure generate function returning string XML/INI content. Include XML/special character escaping and expand ~ to homedir() for paths.
  Category: (none)
  Source: manual (tx-64c327cb)
  Created: 2026-02-02T17:39:13.427Z
  Usage Count: 0
```

### Implementation

Uses existing `LearningService.get(id)` method:

```typescript
readonly get: (id: number) => Effect.Effect<Learning, LearningNotFoundError | DatabaseError>
```

This is a simple lookup by primary key - no search or scoring involved.

---

## Database Schema

### Migration 002

```typescript
// src/db.ts
const MIGRATION_002 = `
-- Learnings table (append-only event log)
CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('compaction', 'run', 'manual', 'claude_md')),
    source_ref TEXT,
    created_at TEXT NOT NULL,
    keywords TEXT,
    category TEXT,
    usage_count INTEGER DEFAULT 0,
    last_used_at TEXT,
    outcome_score REAL,
    embedding BLOB
);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    content, keywords, category,
    content='learnings', content_rowid='id',
    tokenize='porter unicode61'
);

-- Triggers to sync FTS
CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts(rowid, content, keywords, category)
    VALUES (new.id, new.content, new.keywords, new.category);
END;

CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, keywords, category)
    VALUES ('delete', old.id, old.content, old.keywords, old.category);
END;

CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, keywords, category)
    VALUES ('delete', old.id, old.content, old.keywords, old.category);
    INSERT INTO learnings_fts(rowid, content, keywords, category)
    VALUES (new.id, new.content, new.keywords, new.category);
END;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_source ON learnings(source_type, source_ref);
CREATE INDEX IF NOT EXISTS idx_learnings_usage ON learnings(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_outcome ON learnings(outcome_score DESC);

-- Config table
CREATE TABLE IF NOT EXISTS learnings_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO learnings_config (key, value) VALUES
    ('bm25_weight', '0.4'),
    ('vector_weight', '0.4'),
    ('recency_weight', '0.2');

UPDATE schema_version SET version = 2, applied_at = datetime('now') WHERE version = 1;
`
```

---

## TypeScript Types

```typescript
// src/schemas/learning.ts

export type LearningSourceType = 'compaction' | 'run' | 'manual' | 'claude_md'

export interface Learning {
  readonly id: number
  readonly content: string
  readonly sourceType: LearningSourceType
  readonly sourceRef: string | null
  readonly createdAt: Date
  readonly keywords: readonly string[]
  readonly category: string | null
  readonly usageCount: number
  readonly lastUsedAt: Date | null
  readonly outcomeScore: number | null
  readonly embedding: Float32Array | null
}

export interface LearningWithScore extends Learning {
  readonly relevanceScore: number
  readonly bm25Score: number
  readonly vectorScore: number
  readonly recencyScore: number
}

export interface LearningRow {
  id: number
  content: string
  source_type: string
  source_ref: string | null
  created_at: string
  keywords: string | null
  category: string | null
  usage_count: number
  last_used_at: string | null
  outcome_score: number | null
  embedding: Buffer | null
}

export const rowToLearning = (row: LearningRow): Learning => ({
  id: row.id,
  content: row.content,
  sourceType: row.source_type as LearningSourceType,
  sourceRef: row.source_ref,
  createdAt: new Date(row.created_at),
  keywords: row.keywords ? JSON.parse(row.keywords) : [],
  category: row.category,
  usageCount: row.usage_count,
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
  outcomeScore: row.outcome_score,
  embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null
})

export interface CreateLearningInput {
  readonly content: string
  readonly sourceType: LearningSourceType
  readonly sourceRef?: string
  readonly keywords?: readonly string[]
  readonly category?: string
}

export interface LearningQuery {
  readonly query: string
  readonly limit?: number
  readonly minScore?: number
  readonly sourceTypes?: readonly LearningSourceType[]
  readonly category?: string
  readonly includeRecent?: number
}

export interface ContextResult {
  readonly learnings: readonly LearningWithScore[]
  readonly query: string
  readonly totalMatches: number
  readonly searchDuration: number
}
```

---

## BM25 Search Implementation

### Three-Tier FTS5 Query Building

Adapted from qmd. Priority: phrase match > proximity match > individual terms.

```typescript
// src/repo/learning-repo.ts

const sanitizeFTS5Term = (term: string): string =>
  term.replace(/[^\w']/g, '')

const buildFTS5Query = (query: string): string => {
  const sanitized = query.replace(/[^\w\s']/g, '').trim()
  const terms = query
    .split(/\s+/)
    .map(sanitizeFTS5Term)
    .filter(t => t.length >= 2)

  if (terms.length === 0) return ""
  if (terms.length === 1) return `"${terms[0]!.replace(/"/g, '""')}"`

  // Three-tier ranking
  const phrase = `"${sanitized.replace(/"/g, '""')}"`
  const quoted = terms.map(t => `"${t.replace(/"/g, '""')}"`)
  const near = `NEAR(${quoted.join(' ')}, 10)` // proximity window = 10 tokens
  const or = quoted.join(' OR ')

  return `(${phrase}) OR (${near}) OR (${or})`
}
```

### BM25 Search Effect

```typescript
export const bm25Search = (query: string, limit: number) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const ftsQuery = buildFTS5Query(query)
    if (!ftsQuery) return []

    const rows = db.prepare(`
      SELECT l.*, bm25(learnings_fts) as bm25_score
      FROM learnings l
      JOIN learnings_fts ON l.id = learnings_fts.rowid
      WHERE learnings_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `).all(ftsQuery, limit * 3) as (LearningRow & { bm25_score: number })[]

    // Normalize scores (BM25 returns negative, lower = better match)
    const maxScore = Math.max(...rows.map(r => Math.abs(r.bm25_score)), 1)
    return rows.map(row => ({
      learning: rowToLearning(row),
      score: Math.abs(row.bm25_score) / maxScore
    }))
  })
```

---

## Vector Search Implementation

### Two-Step Pattern (Critical)

sqlite-vec cannot JOIN during MATCH queries. Must retrieve vector matches first, then fetch documents.

```typescript
export const vectorSearch = (embedding: Float32Array, limit: number) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient

    // Check if any embeddings exist
    const hasEmbeddings = db.prepare(`
      SELECT COUNT(*) as count FROM learnings WHERE embedding IS NOT NULL
    `).get() as { count: number }

    if (hasEmbeddings.count === 0) return []

    // Step 1: Compute similarities in JS (simpler than sqlite-vec)
    const rows = db.prepare(`
      SELECT id, embedding FROM learnings WHERE embedding IS NOT NULL
    `).all() as { id: number; embedding: Buffer }[]

    const similarities = rows.map(row => {
      const stored = new Float32Array(row.embedding.buffer)
      const similarity = cosineSimilarity(embedding, stored)
      return { id: row.id, score: similarity }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3)

    if (similarities.length === 0) return []

    // Step 2: Fetch full learning records
    const ids = similarities.map(s => s.id)
    const placeholders = ids.map(() => '?').join(',')
    const learnings = db.prepare(`
      SELECT * FROM learnings WHERE id IN (${placeholders})
    `).all(...ids) as LearningRow[]

    const scoreMap = new Map(similarities.map(s => [s.id, s.score]))
    return learnings.map(row => ({
      learning: rowToLearning(row),
      score: scoreMap.get(row.id) ?? 0
    }))
  })

const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
```

---

## Reciprocal Rank Fusion (RRF)

Combines multiple ranked lists with position-aware bonuses.

```typescript
// src/services/learning-service.ts

interface RankedResult {
  learning: Learning
  score: number
}

const reciprocalRankFusion = (
  resultLists: RankedResult[][],
  weights: number[] = [],
  k = 60 // decay factor
): RankedResult[] => {
  const scores = new Map<number, {
    learning: Learning
    score: number
    bestRank: number
  }>()

  for (let listIdx = 0; listIdx < resultLists.length; listIdx++) {
    const results = resultLists[listIdx] ?? []
    const weight = weights[listIdx] ?? 1.0

    for (let rank = 0; rank < results.length; rank++) {
      const { learning } = results[rank]!
      // RRF formula: score += weight / (k + rank + 1)
      const rrfScore = weight / (k + rank + 1)
      const existing = scores.get(learning.id)

      if (existing) {
        existing.score += rrfScore
        existing.bestRank = Math.min(existing.bestRank, rank)
      } else {
        scores.set(learning.id, { learning, score: rrfScore, bestRank: rank })
      }
    }
  }

  // Position-aware bonuses (preserve top matches from any list)
  return Array.from(scores.values())
    .map(({ learning, score, bestRank }) => {
      let bonus = 0
      if (bestRank === 0) bonus = 0.05      // #1 rank bonus
      else if (bestRank <= 2) bonus = 0.02   // Top-3 bonus
      return { learning, score: score + bonus }
    })
    .sort((a, b) => b.score - a.score)
}
```

---

## Hybrid Search Service

Full implementation with signal strength optimization.

```typescript
export const hybridSearch = (query: LearningQuery) =>
  Effect.gen(function* () {
    const { query: searchQuery, limit = 10, minScore = 0.3 } = query
    const startTime = Date.now()
    const repo = yield* LearningRepository

    // 1. BM25 search (always available)
    const bm25Results = yield* repo.bm25Search(searchQuery, limit * 3)

    // 2. Signal strength check - skip vectors if BM25 is confident
    if (bm25Results.length > 0) {
      const topScore = bm25Results[0]!.score
      const secondScore = bm25Results[1]?.score ?? 0
      if (topScore >= 0.85 && (topScore - secondScore) >= 0.15) {
        // Strong signal - return BM25 only with recency
        const withRecency = addRecencyScores(bm25Results)
        return formatResult(withRecency, searchQuery, limit, minScore, startTime)
      }
    }

    // 3. Vector search (if embeddings available)
    const embeddingSvc = yield* EmbeddingService
    const hasVectors = yield* embeddingSvc.isAvailable()

    let vecResults: RankedResult[] = []
    if (hasVectors) {
      const queryEmbed = yield* embeddingSvc.embed(searchQuery).pipe(
        Effect.catchAll(() => Effect.succeed(null))
      )
      if (queryEmbed) {
        vecResults = yield* repo.vectorSearch(queryEmbed, limit * 3)
      }
    }

    // 4. RRF fusion (original query weighted 2x)
    const fused = reciprocalRankFusion(
      [bm25Results, vecResults],
      [2.0, 1.0]
    )

    // 5. Add recency scoring
    const withRecency = addRecencyScores(fused)

    return formatResult(withRecency, searchQuery, limit, minScore, startTime)
  })

const addRecencyScores = (results: RankedResult[]): LearningWithScore[] => {
  const now = Date.now()
  const MAX_AGE_DAYS = 30

  return results.map(({ learning, score }) => {
    const ageDays = (now - learning.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    const recencyScore = Math.max(0, 1 - ageDays / MAX_AGE_DAYS)

    // Apply outcome and frequency boosts
    let finalScore = score + recencyScore * 0.2
    if (learning.outcomeScore !== null) {
      finalScore *= (0.8 + 0.4 * learning.outcomeScore)
    }
    if (learning.usageCount > 0) {
      finalScore *= (1 + Math.log10(learning.usageCount + 1) * 0.1)
    }

    return {
      ...learning,
      relevanceScore: finalScore,
      bm25Score: score, // Approximation
      vectorScore: 0,
      recencyScore
    }
  })
}

const formatResult = (
  results: LearningWithScore[],
  query: string,
  limit: number,
  minScore: number,
  startTime: number
): ContextResult => ({
  learnings: results
    .filter(r => r.relevanceScore >= minScore)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit),
  query,
  totalMatches: results.length,
  searchDuration: Date.now() - startTime
})
```

---

## Task Context Retrieval

Main entry point for getting learnings relevant to a task.

```typescript
export const getContextForTask = (taskId: TaskId) =>
  Effect.gen(function* () {
    const taskSvc = yield* TaskService
    const task = yield* taskSvc.getWithDeps(taskId)

    // Build search query from task metadata
    const queryParts = [
      task.title,
      task.description,
      task.metadata.category as string | undefined
    ].filter(Boolean)

    // Include parent context if exists
    if (task.parentId) {
      const parent = yield* taskSvc.get(task.parentId).pipe(Effect.catchAll(() => Effect.succeed(null)))
      if (parent) queryParts.push(parent.title)
    }

    const searchQuery = queryParts.join(" ")

    // Retrieve contextual learnings
    const context = yield* hybridSearch({
      query: searchQuery,
      limit: 10,
      minScore: 0.25,
      includeRecent: 3
    })

    // Record usage for tracking
    const repo = yield* LearningRepository
    for (const learning of context.learnings) {
      yield* repo.incrementUsage(learning.id).pipe(Effect.ignore)
    }

    return context
  })
```

---

## Embedding Service

Lazy-loaded local embedding model with noop fallback.

```typescript
// src/services/embedding-service.ts

export class EmbeddingService extends Context.Tag("EmbeddingService")<
  EmbeddingService,
  {
    readonly embed: (text: string) => Effect.Effect<Float32Array, EmbeddingUnavailableError>
    readonly embedBatch: (texts: readonly string[]) => Effect.Effect<readonly Float32Array[], EmbeddingUnavailableError>
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

// Noop fallback - always returns failure
export const EmbeddingServiceNoop = Layer.succeed(
  EmbeddingService,
  {
    embed: () => Effect.fail(new EmbeddingUnavailableError({ reason: "No embedding model configured" })),
    embedBatch: () => Effect.fail(new EmbeddingUnavailableError({ reason: "No embedding model configured" })),
    isAvailable: () => Effect.succeed(false)
  }
)

// Live implementation with node-llama-cpp (lazy loaded)
export const EmbeddingServiceLive = Layer.scoped(
  EmbeddingService,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<{
      context: LlamaEmbeddingContext | null
      lastActivity: number
    }>({
      context: null,
      lastActivity: Date.now()
    })

    const ensureContext = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (state.context) {
        yield* Ref.update(stateRef, s => ({ ...s, lastActivity: Date.now() }))
        return state.context
      }

      // Lazy load llama.cpp
      const { getLlama } = yield* Effect.tryPromise({
        try: () => import("node-llama-cpp"),
        catch: () => new EmbeddingUnavailableError({ reason: "node-llama-cpp not installed" })
      })

      const llama = yield* Effect.tryPromise({
        try: () => getLlama(),
        catch: (e) => new EmbeddingUnavailableError({ reason: String(e) })
      })

      const model = yield* Effect.tryPromise({
        try: () => llama.loadModel({
          modelPath: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf"
        }),
        catch: (e) => new EmbeddingUnavailableError({ reason: String(e) })
      })

      const context = yield* Effect.tryPromise({
        try: () => model.createEmbeddingContext({ threads: 4 }),
        catch: (e) => new EmbeddingUnavailableError({ reason: String(e) })
      })

      yield* Ref.set(stateRef, { context, lastActivity: Date.now() })
      return context
    })

    // Nomic-style task prefix formatting
    const formatQuery = (text: string) => `task: search result | query: ${text}`
    const formatDoc = (text: string) => `text: ${text}`

    return {
      embed: (text) =>
        Effect.gen(function* () {
          const ctx = yield* ensureContext
          const result = yield* Effect.tryPromise({
            try: () => ctx.getEmbeddingFor(formatQuery(text)),
            catch: (e) => new EmbeddingUnavailableError({ reason: String(e) })
          })
          return new Float32Array(result.vector)
        }),

      embedBatch: (texts) =>
        Effect.gen(function* () {
          const ctx = yield* ensureContext
          const results: Float32Array[] = []
          for (const text of texts) {
            const result = yield* Effect.tryPromise({
              try: () => ctx.getEmbeddingFor(formatDoc(text)),
              catch: (e) => new EmbeddingUnavailableError({ reason: String(e) })
            })
            yield* Ref.update(stateRef, s => ({ ...s, lastActivity: Date.now() }))
            results.push(new Float32Array(result.vector))
          }
          return results
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)
```

---

## Testing

### BM25 Search Tests

```typescript
describe("LearningRepository.bm25Search", () => {
  it("finds exact phrase match", async () => {
    await seedLearning(db, "Always use transactions for multi-step operations")
    const results = await runEffect(repo.bm25Search("use transactions", 5))
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].learning.content).toContain("transactions")
  })

  it("three-tier query ranks phrase > near > terms", async () => {
    await seedLearning(db, "use transactions for operations")
    await seedLearning(db, "transactions are useful for operations")
    await seedLearning(db, "use for transactions")

    const results = await runEffect(repo.bm25Search("use transactions for operations", 5))
    // Exact phrase match should rank highest
    expect(results[0].learning.content).toBe("use transactions for operations")
  })
})
```

### Hybrid Search Tests

```typescript
describe("LearningService.hybridSearch", () => {
  it("returns BM25-only when confident", async () => {
    await seedLearning(db, "JWT tokens should use RS256")
    const result = await runEffect(svc.hybridSearch({ query: "JWT RS256", limit: 5 }))
    expect(result.learnings.length).toBeGreaterThan(0)
    expect(result.searchDuration).toBeLessThan(100)
  })

  it("applies recency bonus", async () => {
    await seedLearning(db, "old learning", { createdAt: daysAgo(60) })
    await seedLearning(db, "new learning", { createdAt: daysAgo(1) })

    const results = await runEffect(svc.hybridSearch({ query: "learning", limit: 5 }))
    // New learning should rank higher due to recency
    expect(results.learnings[0].content).toContain("new")
  })
})
```

---

## Related Documents

- [PRD-010: Contextual Learnings System](../prd/PRD-010-contextual-learnings-system.md)
- [DD-002: Effect-TS Service Layer](./DD-002-effect-ts-service-layer.md)
- [DD-006: LLM Integration](./DD-006-llm-integration.md)
