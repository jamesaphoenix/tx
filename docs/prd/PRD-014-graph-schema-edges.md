# PRD-014: Graph RAG - Knowledge Graph Schema and Edge Types

## Overview

This PRD defines the graph data model for connecting learnings to files, tasks, runs, and other learnings. This is the foundational layer for Graph RAG in tx.

## Problem Statement

Current learnings are isolated text blobs:
- No connection to the code they describe
- No provenance tracking (where did this learning come from?)
- No semantic relationships between learnings
- File-learning pattern matching is too coarse (glob only)
- Working on `auth.ts` doesn't surface learnings from related `jwt.ts`

## Solution: Two-Layer Memory with Graph Edges

### Layer 1: Telemetry (High Volume, Ephemeral)
- Raw JSONL from Claude Code transcripts
- Tool calls, errors, decisions
- Retention: days to weeks
- Purpose: debugging, audits, candidate extraction

### Layer 2: Knowledge (Low Volume, Persistent)
- Curated learnings with graph edges
- Retention: months+ (with invalidation)
- Purpose: improve future decisions

### Promotion Pipeline
Telemetry → Candidate Extraction → Promotion Gate → Knowledge Layer

## Core Concepts

### Node Types

| Node Type | Description | Primary Key |
|-----------|-------------|-------------|
| Learning | Atomic unit of knowledge | `learnings.id` |
| File | Source code file | `file_path` |
| Task | tx task | `tasks.id` |
| Run | Agent execution run | `runs.id` |
| Symbol | Code symbol (function, class) | `fqname` |

### Edge Types

| Edge Type | From | To | Purpose |
|-----------|------|-----|---------|
| `ANCHORED_TO` | Learning | File | Code anchoring with multiple strategies |
| `DERIVED_FROM` | Learning | Task/Run | Provenance tracking |
| `IMPORTS` | File | File | Static analysis (ast-grep) |
| `CO_CHANGES_WITH` | File | File | Git co-change correlation |
| `SIMILAR_TO` | Learning | Learning | Semantic clustering |
| `LINKS_TO` | Learning | Learning | Human/auto linking |
| `USED_IN_RUN` | Learning | Run | Feedback: was it helpful? |
| `INVALIDATED_BY` | Learning | Commit | When learning becomes wrong |

### Edge Attributes

All edges have:
- `weight`: 0-1 confidence/strength score
- `metadata`: JSON blob for type-specific data
- `created_at`: Timestamp
- `invalidated_at`: Soft delete timestamp (nullable)

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| GR-001 | Store edges in dedicated tables with proper indexes | P0 |
| GR-002 | Support multiple anchor types per learning (glob, hash, symbol) | P0 |
| GR-003 | Track edge confidence/weight for weighted traversal | P0 |
| GR-004 | Maintain edge history for invalidation recovery | P1 |
| GR-005 | Language-agnostic symbol extraction via ast-grep | P0 |
| GR-006 | Git co-change analysis for file relationships | P1 |
| GR-007 | Expose graph via CLI, MCP, and SDK | P0 |

### Anchoring Strategies

Learnings can be anchored to files using multiple strategies (any combination):

| Strategy | Field | Survives Refactors | Precision |
|----------|-------|-------------------|-----------|
| Glob Pattern | `file_pattern` | Medium | Low |
| Content Hash | `content_hash` | Low (drifts) | High |
| Symbol FQName | `symbol_fqname` | High (if renamed) | High |
| Line Range | `line_start`, `line_end` | Low | High |

**Best Practice**: Use symbol anchor when possible, fallback to hash + glob.

## Data Model

### Migration: `005_graph_edges.sql`

```sql
-- Generic edge storage
CREATE TABLE learning_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_type TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('learning', 'file', 'task', 'run')),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('learning', 'file', 'task', 'run')),
  target_id TEXT NOT NULL,
  weight REAL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
  metadata TEXT,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  UNIQUE(edge_type, source_type, source_id, target_type, target_id)
);

CREATE INDEX idx_edges_source ON learning_edges(source_type, source_id);
CREATE INDEX idx_edges_target ON learning_edges(target_type, target_id);
CREATE INDEX idx_edges_type ON learning_edges(edge_type);

-- File-specific anchoring with rich metadata
CREATE TABLE file_anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learning_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  anchor_type TEXT NOT NULL CHECK (anchor_type IN ('glob', 'hash', 'symbol')),
  anchor_value TEXT NOT NULL,
  content_hash TEXT,  -- SHA256 of anchored content
  line_start INTEGER,
  line_end INTEGER,
  symbol_fqname TEXT,  -- e.g., "src/auth.ts::validateToken"
  last_verified_at TEXT,
  status TEXT DEFAULT 'valid' CHECK (status IN ('valid', 'drifted', 'invalid')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE
);

CREATE INDEX idx_anchors_learning ON file_anchors(learning_id);
CREATE INDEX idx_anchors_file ON file_anchors(file_path);
CREATE INDEX idx_anchors_status ON file_anchors(status);

-- File import graph (from ast-grep analysis)
CREATE TABLE file_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  target_file TEXT NOT NULL,
  import_type TEXT DEFAULT 'static',  -- static, dynamic, re-export
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_file, target_file)
);

CREATE INDEX idx_imports_source ON file_imports(source_file);
CREATE INDEX idx_imports_target ON file_imports(target_file);

-- Git co-change correlation
CREATE TABLE file_cochanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  correlation_score REAL NOT NULL CHECK (correlation_score >= 0 AND correlation_score <= 1),
  commit_count INTEGER DEFAULT 0,
  last_updated_at TEXT,
  UNIQUE(file_a, file_b)
);

CREATE INDEX idx_cochanges_file_a ON file_cochanges(file_a);
CREATE INDEX idx_cochanges_file_b ON file_cochanges(file_b);
```

## API Surface

### CLI Commands

```bash
# Link learning to file
tx graph:link <learning-id> <file-path> [--anchor-type glob|hash|symbol]

# Show learning's graph connections
tx graph:show <learning-id>

# Find neighbors (files, related learnings)
tx graph:neighbors <learning-id> [--depth 2] [--edge-types ANCHORED_TO,SIMILAR_TO]

# Analyze file imports (populate file_imports table)
tx graph:analyze-imports [--path src/]

# Analyze git co-changes
tx graph:analyze-cochanges [--since "3 months ago"]
```

### MCP Tools

```typescript
// Link learning to file
tx_graph_link: { learningId: number, filePath: string, anchorType?: string }

// Get graph neighbors
tx_graph_neighbors: { id: string, type: 'learning' | 'file', depth?: number }

// Analyze imports for a directory
tx_graph_analyze_imports: { path?: string }
```

### Service Interface

```typescript
interface GraphService {
  addEdge: (edge: CreateEdgeInput) => Effect<GraphEdge, DatabaseError>
  getEdges: (nodeId: string, nodeType: NodeType) => Effect<GraphEdge[], DatabaseError>
  traverse: (startId: string, opts: TraverseOptions) => Effect<GraphNode[], DatabaseError>
  invalidateEdge: (edgeId: number) => Effect<void, EdgeNotFoundError | DatabaseError>
}

interface AnchorService {
  createAnchor: (learningId: number, anchor: AnchorInput) => Effect<FileAnchor, DatabaseError>
  verifyAnchor: (anchorId: number) => Effect<AnchorStatus, AnchorNotFoundError | DatabaseError>
  findAnchorsForFile: (filePath: string) => Effect<FileAnchor[], DatabaseError>
}
```

## Symbol Extraction with ast-grep

Use ast-grep for language-agnostic symbol extraction:

```bash
# Find all exported functions in TypeScript
ast-grep --pattern 'export function $NAME($_) { $$$_ }' --json src/

# Find all classes
ast-grep --pattern 'class $NAME { $$$_ }' --json src/

# Find all Effect Context.Tag services
ast-grep --pattern 'class $NAME extends Context.Tag($_)<$_, $_>() {}' --json src/
```

Output parsed and stored as symbol anchors with FQName like:
- `src/services/task-service.ts::TaskService`
- `src/repo/learning-repo.ts::LearningRepository::bm25Search`

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Edge creation latency | <50ms | p95 in production |
| Anchor verification speed | 1000 files/sec | Benchmark |
| Graph query (depth=2) | <100ms | p95 in production |
| Storage overhead per edge | <500 bytes | Average |
| Symbol extraction accuracy | >95% | Manual audit |

## Dependencies

- **Depends on**: PRD-010 (Contextual Learnings System)
- **Blocks**: PRD-015 (JSONL Daemon), PRD-016 (Graph Expansion), PRD-017 (Invalidation)

## Non-Goals

- Full knowledge graph visualization UI (future work)
- Cross-repository graph federation
- Real-time streaming graph updates
- Custom query language (use SQL directly)

## Resolved Questions

1. **Should we support bidirectional edge traversal by default?**
   → **Yes.** Traverse both directions by default. More useful for discovery.

2. **How to handle renamed symbols (track history or re-link)?**
   → **Check existence → search for relocated → update or invalidate.**
   - On verification, check if `symbol_fqname` exists via ast-grep
   - If not found in original file, search all files for the symbol name (fuzzy match)
   - If found in new location → update anchor's `file_path`, log as "relocated"
   - If not found anywhere → mark anchor as "invalid"
   - Keep history in `invalidation_log` for recovery

3. **Should co-change correlation be recomputed on every git pull?**
   → **No. Weekly scheduled recompute.** Too expensive on every pull.
   - Run `tx graph:analyze-cochanges` on schedule (weekly cron)
   - Or on-demand when user requests
   - Cache results with timestamp, surface "stale" warning if >7 days old

## Design Decisions

### Strong ENUMs for Edge Types

Edge types are part of the fixed ontology. Use TypeScript const enum and database CHECK constraint:

```typescript
export const EdgeType = {
  ANCHORED_TO: 'ANCHORED_TO',
  DERIVED_FROM: 'DERIVED_FROM',
  IMPORTS: 'IMPORTS',
  CO_CHANGES_WITH: 'CO_CHANGES_WITH',
  SIMILAR_TO: 'SIMILAR_TO',
  LINKS_TO: 'LINKS_TO',
  USED_IN_RUN: 'USED_IN_RUN',
  INVALIDATED_BY: 'INVALIDATED_BY',
} as const

export type EdgeType = typeof EdgeType[keyof typeof EdgeType]
```

Database enforcement:
```sql
CHECK (edge_type IN ('ANCHORED_TO', 'DERIVED_FROM', 'IMPORTS', 'CO_CHANGES_WITH', 'SIMILAR_TO', 'LINKS_TO', 'USED_IN_RUN', 'INVALIDATED_BY'))
```

This is fixed schema. Not pluggable.

## References

- DD-014: Graph Schema Implementation
- [ast-grep documentation](https://ast-grep.github.io/)
- [Graph RAG paper](https://arxiv.org/abs/2404.16130)
