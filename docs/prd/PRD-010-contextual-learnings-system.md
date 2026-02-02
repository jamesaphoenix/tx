# PRD-010: Contextual Learnings System

**Status**: Draft
**Priority**: P1 (Core Feature)
**Owner**: TBD
**Last Updated**: 2025-01-30

---

## Problem Statement

PRD-006 defined learnings export to CLAUDE.md, but this approach has critical limitations:

1. **Static dumps degrade over time** - All learnings in one file becomes noise
2. **No relevance filtering** - Agent sees all learnings, not just relevant ones
3. **No recency weighting** - Old learnings equal to fresh ones
4. **No outcome tracking** - Can't learn which learnings actually help
5. **Context window waste** - Stuffing irrelevant learnings burns tokens

**What we need**: Dynamic, task-specific retrieval of learnings using hybrid search (BM25 + vector + recency scoring), inspired by qmd.

---

## Solution Overview

A **learnings subsystem** within tx that:

1. **Stores learnings as append-only events** with metadata (source, category, timestamps)
2. **Retrieves contextually relevant learnings** for a specific task using hybrid search
3. **Scores by recency, frequency, and outcome** - not just text similarity
4. **Injects dynamically** via CLI, MCP tools, or Claude Code hooks
5. **Tracks what works** through outcome feedback loop

---

## Core Concepts

### Learning Sources

| Source | Description | Example |
|--------|-------------|---------|
| `compaction` | Auto-generated from task compaction | "JWT tokens should use RS256" |
| `run` | Captured from agent run transcripts | "Rate limit hit at 100 req/min" |
| `manual` | User-added via CLI | "Always run migrations in transaction" |
| `claude_md` | Imported from existing CLAUDE.md | Legacy learnings |

### Relevance Scoring

```
score(learning, task) =
    bm25_weight × normalized_bm25(learning.content, task.title + task.description) +
    vector_weight × cosine_similarity(learning.embedding, task_embedding) +
    recency_weight × (1 - age_days / 30) +
    outcome_boost × learning.outcome_score +
    frequency_boost × log(1 + learning.usage_count)
```

Default weights: `bm25=0.4, vector=0.4, recency=0.2`

### Learning Lifecycle

```
Create → Index (FTS5 + optional vector) → Retrieve → Use → Track Outcome → Re-rank
   ↑                                                              │
   └──────────────────────────────────────────────────────────────┘
```

---

## Requirements

### Learning CRUD

| ID | Requirement | CLI Command |
|----|-------------|-------------|
| CL-001 | Add learning manually | `tx learning:add "content" [-c category]` |
| CL-002 | Search learnings | `tx learning:search "query" [-n limit]` |
| CL-003 | List recent learnings | `tx learning:recent [-n limit]` |
| CL-004 | Record outcome feedback | `tx learning:helpful <id> [--score 0.8]` |
| CL-005 | Import from CLAUDE.md | `tx learning:import [file]` |
| CL-006 | Generate embeddings | `tx learning:embed` |
| CL-025 | View single learning by ID | `tx learning:show <id> [--json]` |

### Task Context Retrieval

| ID | Requirement | CLI Command |
|----|-------------|-------------|
| CL-007 | Get learnings for task | `tx context <task-id>` |
| CL-008 | JSON output | `tx context <task-id> --json` |
| CL-009 | Inject to temp file | `tx context <task-id> --inject` |
| CL-010 | Token budget limit | `tx context <task-id> --max-tokens 2000` |

### Search Capabilities

| ID | Requirement |
|----|-------------|
| CL-011 | BM25 full-text search (always available) |
| CL-012 | Vector semantic search (optional, requires embeddings) |
| CL-013 | Hybrid search with RRF fusion |
| CL-014 | Signal strength check (skip vectors if BM25 confident) |
| CL-015 | Recency bonus for recent learnings |

### MCP Tools

| ID | Requirement | Tool |
|----|-------------|------|
| CL-016 | Get context for task | `tx_context` |
| CL-017 | Add learning | `tx_learning_add` |
| CL-018 | Record outcome | `tx_learning_helpful` |
| CL-019 | Search learnings | `tx_learning_search` |

### Constraints

| ID | Constraint | Rationale |
|----|------------|-----------|
| CL-020 | Core commands work without learnings | Don't break existing functionality |
| CL-021 | BM25 always available | Vector embeddings are optional |
| CL-022 | Learnings are append-only | Event sourcing pattern |
| CL-023 | Local models only | No cloud API for retrieval |
| CL-024 | Token budget enforced | Avoid prompt rot |

---

## Data Model

### Learnings Table

```sql
CREATE TABLE learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('compaction', 'run', 'manual', 'claude_md')),
    source_ref TEXT,                    -- task_id, file path, run_id
    created_at TEXT NOT NULL,
    keywords TEXT,                      -- JSON array for search boost
    category TEXT,                      -- free-form tag (database, auth, api, etc.)
    usage_count INTEGER DEFAULT 0,
    last_used_at TEXT,
    outcome_score REAL,                 -- 0-1 (did this learning help?)
    embedding BLOB                      -- Float32Array (optional)
);
```

### FTS5 Index

```sql
CREATE VIRTUAL TABLE learnings_fts USING fts5(
    content, keywords, category,
    content='learnings', content_rowid='id',
    tokenize='porter unicode61'
);
```

### TypeScript Types

```typescript
interface Learning {
  id: number
  content: string
  sourceType: 'compaction' | 'run' | 'manual' | 'claude_md'
  sourceRef: string | null
  createdAt: Date
  keywords: string[]
  category: string | null
  usageCount: number
  lastUsedAt: Date | null
  outcomeScore: number | null
  embedding: Float32Array | null
}

interface LearningWithScore extends Learning {
  relevanceScore: number  // combined score (0-1)
  bm25Score: number
  vectorScore: number
  recencyScore: number
}

interface ContextResult {
  learnings: LearningWithScore[]
  query: string
  totalMatches: number
  searchDuration: number
}
```

---

## API Examples

### Add Learning

```bash
$ tx learning:add "Always use transactions for multi-step DB operations" -c database
Added learning #42 (category: database)
```

### Search Learnings

```bash
$ tx learning:search "database transactions" -n 5
5 results:

[92%] [database] Always use transactions for multi-step DB operations
[78%] [database] Use savepoints for nested transactions
[65%] [migration] Test rollback paths before deploying
[52%] [database] Index foreign keys for query performance
[41%] [api] Wrap batch inserts in transactions
```

### View Single Learning

When hooks show truncated previews (200 chars), agents can expand specific learnings:

```bash
$ tx learning:show 42
Learning #42
  Content: Always use transactions for multi-step DB operations. This prevents partial updates when errors occur mid-operation. Use BEGIN/COMMIT/ROLLBACK explicitly rather than relying on auto-commit.
  Category: database
  Source: manual (tx-a1b2c3d4)
  Created: 2026-01-15T10:30:00.000Z
  Usage Count: 12
  Outcome Score: 90%
```

### Get Task Context

```bash
$ tx context tx-a1b2c3d4
Context for task tx-a1b2c3d4: "Implement database migration"

Found 4 relevant learnings (23ms):

[85%] [database] Always use transactions for multi-step DB operations
[72%] [migration] Test rollback paths before deploying
[68%] [database] Use IF NOT EXISTS for idempotent migrations
[55%] [database] Index foreign keys for query performance
```

### Inject Context

```bash
$ tx context tx-a1b2c3d4 --inject
Injected 4 learnings to .tx/context.md (estimated 450 tokens)

$ cat .tx/context.md
## Relevant Learnings for Task tx-a1b2c3d4

- [database] Always use transactions for multi-step DB operations
- [migration] Test rollback paths before deploying
- [database] Use IF NOT EXISTS for idempotent migrations
- [database] Index foreign keys for query performance
```

### Record Outcome

```bash
$ tx learning:helpful 42 --score 0.9
Updated learning #42 outcome score to 0.9
```

---

## Learning Flywheel

The system compounds over time:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Learning Flywheel                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Start Task ────► Retrieve Context ────► Inject Learnings              │
│       │                                        │                        │
│       │                                        ▼                        │
│       │                               Agent Works on Task               │
│       │                                        │                        │
│       │                                        ▼                        │
│       │                               Complete Task                     │
│       │                                        │                        │
│       ▼                                        ▼                        │
│  Archive Context ◄─────────────────── Capture New Learnings            │
│       │                                        │                        │
│       │                                        ▼                        │
│       │                               Index & Embed                     │
│       │                                        │                        │
│       └─────────────────► Next Task ◄──────────┘                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Archiving

After each run, archive what was injected:

```
.tx/archive/<task-id>/
  context.md      # What learnings were injected
  outcome.json    # Success/failure, metrics
```

This enables answering: "What context did we give the agent that made it succeed/fail?"

---

## Graceful Degradation

### Without Embeddings

- BM25 search works normally
- `tx learning:embed` prints: "No embedding model configured"
- Vector search falls back to BM25-only
- All other commands work

### Without Any Learnings

- `tx context <task-id>` returns empty list
- `tx learning:search` returns empty list
- No errors, just no results

---

## Related Documents

- [PRD-006: Task Compaction & Learnings](./PRD-006-task-compaction-learnings.md) - Original learnings export
- [PRD-011: Claude Code Hooks Integration](./PRD-011-claude-code-hooks.md) - Hook-based injection
- [DD-010: Learnings Search & Retrieval](../design/DD-010-learnings-search-retrieval.md) - Implementation details
