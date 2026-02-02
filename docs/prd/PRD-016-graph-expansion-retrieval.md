# PRD-016: Graph RAG - Graph-Expanded Retrieval

## Overview

Enhance the existing hybrid search with graph expansion. Use RRF seeds to traverse the knowledge graph and surface related learnings that pure text retrieval would miss.

## Problem Statement

Current search finds direct matches only:
- Misses learnings about related files
- Misses learnings from similar past runs
- No exploitation of semantic clusters
- Working on `auth.ts` should surface learnings from related `jwt.ts`
- Pure RRF doesn't understand code relationships

## Solution: Graph-Expanded Retrieval

```
Query → RRF Hybrid Search → Top-K Seeds
                              ↓
                    Graph Expansion (N hops)
                              ↓
                    Dedupe + Diversify
                              ↓
                    Final Re-ranking
                              ↓
                         Results
```

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| GE-001 | Configurable expansion depth (default: 2) | P0 |
| GE-002 | Edge-type filtering (include/exclude specific types) | P0 |
| GE-003 | Weight decay per hop (configurable, default: 0.7) | P0 |
| GE-004 | Max expansion nodes limit (default: 100) | P0 |
| GE-005 | Integrate seamlessly with existing RRF pipeline | P0 |
| GE-006 | Context-aware file expansion (open file → related learnings) | P1 |
| GE-007 | Feedback edges: USED_IN_RUN tracking | P0 |
| GE-008 | MMR-style diversification to avoid redundant results | P1 |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| GE-NFR-001 | Expansion latency overhead | <50ms for depth=2 |
| GE-NFR-002 | Graph traversal efficiency | 1000 edges/10ms |
| GE-NFR-003 | Memory for expansion | <10MB per query |

## Expansion Algorithm

### BFS with Score Decay

```
function expandFromSeeds(seeds: Learning[], opts: ExpansionOptions) {
  visited = Set(seeds.map(s => s.id))
  results = []
  frontier = seeds.map(s => ({ learning: s, score: s.rrfScore, hops: 0 }))

  for (hop = 1; hop <= opts.depth; hop++) {
    nextFrontier = []

    for (node in frontier) {
      edges = getOutgoingEdges(node.learning.id)
      edges = filterByType(edges, opts.edgeTypes)

      for (edge in edges) {
        if (visited.has(edge.targetId)) continue
        if (results.length >= opts.maxNodes) break

        visited.add(edge.targetId)
        targetLearning = getLearning(edge.targetId)

        newScore = node.score * edge.weight * opts.decayFactor

        results.push({
          learning: targetLearning,
          score: newScore,
          hops: hop,
          path: [...node.path, edge.targetId],
          sourceEdge: edge.edgeType
        })

        nextFrontier.push(...)
      }
    }

    frontier = nextFrontier
  }

  return results.sort(byScore).slice(0, opts.maxNodes)
}
```

### Score Decay Visualization

```
Hop 0 (seeds):     Score = RRF score (1.0 normalized)
Hop 1:             Score = RRF * edge_weight * 0.7
Hop 2:             Score = RRF * edge_weight * 0.7 * edge_weight * 0.7
Hop 3:             Score = RRF * ... * 0.7³ = RRF * ~0.34
```

## Context-Aware File Expansion

When an agent opens a file, automatically retrieve relevant learnings:

```
1. Get learnings ANCHORED_TO this file
2. Expand via IMPORTS edges to related files
3. Expand via CO_CHANGES_WITH for co-edited files
4. Merge and rank by combined score
```

### Example Flow

```
Agent opens: src/services/auth-service.ts

Step 1: Direct anchors
  → "Always validate JWT expiry before processing"
  → "Use constant-time comparison for token signatures"

Step 2: Import expansion
  src/services/auth-service.ts IMPORTS src/utils/crypto.ts
  src/utils/crypto.ts has anchor:
    → "bcrypt cost factor should be at least 12"

Step 3: Co-change expansion
  auth-service.ts CO_CHANGES_WITH jwt-middleware.ts (0.8 correlation)
  jwt-middleware.ts has anchor:
    → "Set short token lifetime (15min) for access tokens"

Final: 4 learnings, ranked by score
```

## Feedback Loop: USED_IN_RUN Edges

Track which injected learnings led to successful outcomes.

### Recording Feedback

```typescript
// After run completes
const recordFeedback = (runId: string, contextResult: ContextResult, helpful: boolean[]) =>
  Effect.gen(function* () {
    for (let i = 0; i < contextResult.learnings.length; i++) {
      yield* graphService.addEdge({
        edgeType: 'USED_IN_RUN',
        sourceType: 'learning',
        sourceId: String(contextResult.learnings[i].id),
        targetType: 'run',
        targetId: runId,
        weight: helpful[i] ? 1.0 : 0.0,
        metadata: { position: i, helpful: helpful[i] }
      })
    }
  })
```

### Using Feedback in Scoring

```typescript
// Boost learnings that have been helpful in past runs
const feedbackBoost = (learningId: number) =>
  Effect.gen(function* () {
    const usedEdges = yield* graphService.getEdges(
      String(learningId),
      'learning',
      { edgeTypes: ['USED_IN_RUN'] }
    )

    const helpfulCount = usedEdges.filter(e => e.metadata.helpful).length
    const totalCount = usedEdges.length

    if (totalCount === 0) return 0

    // Bayesian average with prior
    const prior = 0.5
    const priorWeight = 2
    return (helpfulCount + prior * priorWeight) / (totalCount + priorWeight)
  })
```

## API Changes

### LearningQuery Extension

```typescript
interface LearningQuery {
  query: string
  limit?: number
  minScore?: number

  // New: Graph expansion options
  graphExpansion?: {
    enabled: boolean
    depth?: number           // Default: 2
    edgeTypes?: EdgeType[]   // Filter to specific types
    decayFactor?: number     // Default: 0.7
    maxNodes?: number        // Default: 100
  }

  // New: Context-aware options
  contextFiles?: string[]    // Files currently being edited
}
```

### Response Extension

```typescript
interface LearningWithScore extends Learning {
  relevanceScore: number
  bm25Score: number
  vectorScore: number
  recencyScore: number
  rrfScore: number

  // New: Graph expansion info
  expansionHops?: number      // 0 = direct match, 1+ = expanded
  expansionPath?: string[]    // Path from seed to this learning
  sourceEdge?: EdgeType       // Edge type that led here
  feedbackScore?: number      // Helpfulness score from past runs
}
```

### CLI Extension

```bash
# Search with graph expansion
tx learning:search "authentication" --expand --depth 2

# Get context with expansion for specific files
tx context <task-id> --expand --files src/auth.ts,src/jwt.ts

# Show expansion details
tx learning:search "auth" --expand --verbose
```

## Diversification (MMR)

Prevent returning 10 variations of the same learning.

### Maximal Marginal Relevance

```
For each position i in results:
  Select item that maximizes:
    λ * relevance(item, query) - (1-λ) * max_similarity(item, selected_items)

Where:
  λ = 0.7 (balance relevance vs diversity)
  similarity = cosine(embedding_a, embedding_b)
```

### Implementation

```typescript
const diversify = (candidates: LearningWithScore[], limit: number, lambda = 0.7) => {
  const selected: LearningWithScore[] = []
  const remaining = [...candidates]

  while (selected.length < limit && remaining.length > 0) {
    let bestScore = -Infinity
    let bestIdx = 0

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].relevanceScore
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map(s => cosineSim(s.embedding, remaining[i].embedding)))

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim

      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIdx = i
      }
    }

    selected.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }

  return selected
}
```

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Recall improvement | +20% vs pure RRF | A/B test |
| Expansion latency | <50ms for depth=2 | p95 |
| Graph traversal | 1000 edges/10ms | Benchmark |
| Feedback coverage | 100% of runs tracked | Monitoring |
| Diversification | Max 2 same-category in top 5 | Audit |

## Dependencies

- **Depends on**: PRD-014 (Graph Schema), PRD-015 (Populated graph)
- **Blocks**: None (enhancement to existing retrieval)

## Non-Goals

- Real-time graph updates during retrieval
- Cross-repository expansion
- Custom expansion strategies per user

## Resolved Questions

1. **Should expansion use bidirectional traversal?**
   → **Yes.** Traverse both incoming and outgoing edges. More useful for discovery.

2. **How to handle cycles in the graph?**
   → **Visited set.** Standard BFS cycle prevention. Skip already-visited nodes. Simple and effective.

3. **Should feedback edges expire after N days?**
   → **No.** Keep forever. If needed later, add weight decay (e.g., `0.9^months_old`). KISS for now.

## Design Decisions

### File Patterns: Glob, Not Regex

Use glob patterns for file matching. More familiar, less error-prone.

```bash
tx context tx-abc --expand --files "src/auth/**/*.ts"
tx context tx-abc --expand --files "src/auth.ts,src/jwt.ts"
```

Use `fast-glob` or `picomatch` under the hood. Regex is overkill for file paths.

### Pluggable Retriever Interface

Retrieval should be pluggable. Users have existing vector DBs.

```typescript
interface Retriever {
  search(query: string, options?: SearchOptions): Effect<Learning[], RetrievalError>
}

// Default: BM25 + vector on SQLite
const defaultRetriever = hybridRetriever(sqliteDb)

// User can swap
const tx = createTx({
  retriever: myPineconeRetriever
})
```

## References

- DD-016: Graph Expansion Implementation
- PRD-014: Graph Schema
- [MMR: Maximal Marginal Relevance](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf)
