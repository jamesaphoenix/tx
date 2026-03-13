# PRD-017: Graph RAG - Anchor Invalidation and Graph Maintenance

## Overview

Detect stale anchors (code changed, symbols moved), soft-delete edges, and provide tools for bulk maintenance. Keep the knowledge graph accurate as the codebase evolves.

## Problem Statement

- Code changes constantly; anchors become stale
- Content hashes drift as code evolves
- Symbols get renamed, moved, or deleted
- Glob patterns may match different files over time
- Stale learnings cause confusion rather than help
- Need automated detection + manual override
- Large refactors can invalidate many anchors at once

## Solution: Multi-Layered Invalidation

```
┌─────────────────────────────────────────────────────────────┐
│                    Invalidation Triggers                    │
├─────────────────────────────────────────────────────────────┤
│  Periodic (daily)  │  On-access (lazy)  │  Manual command  │
│  Agent swarm       │  Git hook          │  Post-refactor   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Verification Engine                       │
├─────────────────────────────────────────────────────────────┤
│  File exists?  │  Hash match?  │  Symbol exists?  │  Glob? │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Resolution Actions                        │
├─────────────────────────────────────────────────────────────┤
│  Valid (no change)  │  Self-heal (update)  │  Soft-delete  │
└─────────────────────────────────────────────────────────────┘
```

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| IM-001 | Periodic anchor verification (configurable interval) | P0 |
| IM-002 | On-access verification (lazy check) | P0 |
| IM-003 | Soft delete (keep history for recovery) | P0 |
| IM-004 | Bulk invalidation via agent swarm | P1 |
| IM-005 | Manual override: force valid/invalid | P0 |
| IM-006 | Notification when anchors drift | P1 |
| IM-007 | Self-healing: auto-update hash after minor edits | P1 |
| IM-008 | Audit log of all invalidation actions | P0 |
| IM-009 | Git hook integration for post-refactor cleanup | P2 |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| IM-NFR-001 | Stale anchor detection rate | >95% within 24h |
| IM-NFR-002 | False positive rate | <5% |
| IM-NFR-003 | Self-healing success rate | >80% for minor edits |
| IM-NFR-004 | Verification throughput | 10K anchors/min |

## Invalidation Types

| Type | Detection | Status | Action |
|------|-----------|--------|--------|
| File Deleted | File doesn't exist | `invalid` | Soft-delete anchor |
| Hash Mismatch | Content hash changed | `drifted` | Try self-heal, else mark drifted |
| Symbol Missing | ast-grep can't find symbol | `invalid` | Soft-delete anchor |
| Symbol Moved | Symbol in different file | `drifted` | Update file path if found |
| Glob Changed | Matches different files | `drifted` | Warn, keep valid |

## Verification Modes

### 1. Periodic Verification

Background job that verifies all anchors on a schedule.

```
Schedule: Daily at 3 AM (configurable)
Process:
  1. Get all anchors with status = 'valid'
  2. For each anchor, run verification
  3. Update status and log changes
  4. Send summary notification if enabled
```

### 2. On-Access Verification (Lazy)

Verify anchor when learning is retrieved, with caching.

```
On learning retrieval:
  1. Check verification cache (TTL: 1 hour)
  2. If cache miss, verify anchor
  3. Update cache
  4. Return learning with freshness indicator
```

### 3. Agent Swarm for Bulk Invalidation

When major refactoring detected (>50 file changes), spawn parallel agents.

```
Trigger: Git hook detects large commit
Process:
  1. Identify affected anchors (by file path)
  2. Partition into batches of 10
  3. Spawn up to 4 concurrent verification agents
  4. Each agent uses LLM to assess: "Does this learning still apply?"
  5. Aggregate results and batch update
```

## Self-Healing Logic

When content hash drifts but context is similar, automatically update.

```
Self-Heal Algorithm:
  1. Content hash doesn't match
  2. Check if symbol FQName still exists
     - If yes, compute new content hash
     - Compare old and new content similarity
  3. If similarity > 0.8:
     - Update hash to new value
     - Log as "self_healed"
     - Keep status = 'valid'
  4. If similarity < 0.8:
     - Mark status = 'drifted'
     - Queue for review
```

### Similarity Computation

```typescript
// Jaccard similarity on tokens
const computeSimilarity = (oldContent: string, newContent: string): number => {
  const oldTokens = new Set(tokenize(oldContent))
  const newTokens = new Set(tokenize(newContent))

  const intersection = new Set([...oldTokens].filter(t => newTokens.has(t)))
  const union = new Set([...oldTokens, ...newTokens])

  return intersection.size / union.size
}
```

## Data Model

### Migration: `007_invalidation.sql`

```sql
-- Invalidation audit log
CREATE TABLE invalidation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor_id INTEGER NOT NULL,
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  detected_by TEXT NOT NULL,  -- 'periodic', 'lazy', 'manual', 'agent', 'git_hook'
  old_content_hash TEXT,
  new_content_hash TEXT,
  similarity_score REAL,
  invalidated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (anchor_id) REFERENCES file_anchors(id)
);

CREATE INDEX idx_invalidation_anchor ON invalidation_log(anchor_id);
CREATE INDEX idx_invalidation_time ON invalidation_log(invalidated_at);
CREATE INDEX idx_invalidation_status ON invalidation_log(new_status);

-- Verification cache
CREATE TABLE verification_cache (
  anchor_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (anchor_id) REFERENCES file_anchors(id)
);

-- Configuration
INSERT INTO learnings_config (key, value) VALUES
  ('verification_interval', '24'),       -- hours
  ('cache_ttl', '3600'),                  -- seconds
  ('self_heal_threshold', '0.8'),         -- similarity
  ('swarm_batch_size', '10'),
  ('swarm_max_concurrent', '4');
```

## API Surface

### CLI Commands

```bash
# Verify all anchors
tx graph:verify

# Verify anchors for specific file(s)
tx graph:verify src/auth.ts

# Verify with verbose output
tx graph:verify --verbose

# Manual invalidation
tx graph:invalidate <anchor-id> --reason "Code removed"

# Restore soft-deleted anchor
tx graph:restore <anchor-id>

# Hard delete old invalid anchors
tx graph:prune --before "30 days ago"

# Show verification status
tx graph:status

# Run agent swarm verification
tx graph:verify --swarm --files-changed 50
```

### Service Interface

```typescript
interface InvalidationService {
  verify: (anchorId: number) => Effect<VerificationResult, AnchorNotFoundError | DatabaseError>
  verifyAll: () => Effect<VerificationSummary, DatabaseError>
  verifyFile: (filePath: string) => Effect<VerificationSummary, DatabaseError>
  invalidate: (anchorId: number, reason: string) => Effect<void, AnchorNotFoundError | DatabaseError>
  restore: (anchorId: number) => Effect<void, AnchorNotFoundError | DatabaseError>
  prune: (olderThan: Date) => Effect<PruneResult, DatabaseError>
}

interface VerificationResult {
  anchorId: number
  oldStatus: AnchorStatus
  newStatus: AnchorStatus
  action: 'unchanged' | 'self_healed' | 'drifted' | 'invalidated'
  reason?: string
  similarity?: number
}

interface VerificationSummary {
  total: number
  valid: number
  drifted: number
  invalid: number
  selfHealed: number
  duration: number
}
```

## Agent Swarm Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SwarmCoordinator                          │
│  detectLargeChange | partitionAnchors | spawnAgents         │
├─────────────────────────────────────────────────────────────┤
│           VerificationAgent (x4 concurrent)                  │
│  loadBatch | verifyWithLLM | reportResults                  │
└─────────────────────────────────────────────────────────────┘
```

### LLM-Assisted Verification

For complex cases, use LLM to assess if learning still applies:

```
Prompt:
  This learning was attached to code that has changed.

  Learning: "{learning_content}"

  Old code context:
  ```
  {old_snippet}
  ```

  New code context:
  ```
  {new_snippet}
  ```

  Does this learning still apply to the new code?
  Respond with JSON: {"applies": true/false, "confidence": 0-1, "reason": "..."}
```

## Git Hook Integration

### Post-Commit Hook

```bash
#!/bin/bash
# .git/hooks/post-commit

# Get changed files
CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD)
FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l)

# If significant change, trigger verification
if [ "$FILE_COUNT" -gt 10 ]; then
  echo "Large commit detected ($FILE_COUNT files). Triggering anchor verification..."
  tx graph:verify --files "$CHANGED_FILES" --async
fi
```

### Claude Code Hook

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": { "tool_name": "Edit" },
        "command": "tx graph:verify --file \"$FILE_PATH\" --quiet"
      }
    ]
  }
}
```

## Notification System

### Drift Notifications

```typescript
interface DriftNotification {
  type: 'single' | 'batch'
  anchors: Array<{
    id: number
    learningId: number
    learningContent: string
    filePath: string
    reason: string
  }>
  detectedAt: Date
}

// Notification channels
interface NotificationChannel {
  send: (notification: DriftNotification) => Effect<void, NotificationError>
}

// Console notification (default)
const ConsoleNotification: NotificationChannel = {
  send: (n) => Effect.sync(() => {
    console.log(`⚠️  ${n.anchors.length} anchor(s) drifted:`)
    for (const a of n.anchors) {
      console.log(`   - Learning #${a.learningId}: ${a.reason}`)
    }
  })
}
```

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Stale detection rate | >95% within 24h | Audit log analysis |
| False positive rate | <5% | Manual review sample |
| Self-heal success | >80% for minor edits | Audit log analysis |
| Verification throughput | 10K anchors/min | Benchmark |
| Swarm efficiency | 4x speedup vs sequential | Benchmark |

## Dependencies

- **Depends on**: PRD-014 (Graph Schema)
- **Blocks**: None

## Security Considerations

1. **Rate limiting**: Prevent swarm from overwhelming LLM API
2. **File access**: Only verify files within project directory
3. **Audit logging**: All invalidation actions logged for accountability

## Non-Goals

- Real-time invalidation (too expensive)
- Cross-repository invalidation
- Automatic learning content updates (only anchors)

## Resolved Questions

1. **How long should soft-deleted anchors be retained?**
   → **90 days.** Then hard delete with `tx graph:prune --before "90 days ago"`.

2. **Should we support "pinned" anchors that never auto-invalidate?**
   → **Yes.** Add `pinned BOOLEAN DEFAULT 0` to `file_anchors` table. Skip auto-invalidation for pinned anchors.

3. **How to handle conflicting verification results from swarm agents?**
   → **Majority vote.** If 3/4 agents say valid, it's valid. Tie = mark for human review.

## Design Decisions

### Pluggable Verifier Interface

LLM-assisted verification should be pluggable like extraction.

```typescript
interface AnchorVerifier {
  verify(input: VerificationInput): Effect<VerificationResult, VerificationError>
}

interface VerificationInput {
  learning: Learning
  oldCode: string
  newCode: string
}

// Default: Agent SDK
const defaultVerifier = agentSdkVerifier({
  model: 'claude-sonnet-4-20250514'
})

// User can swap
const tx = createTx({
  verifier: myGPTVerifier
})
```

### No Built-in Swarm (Example Scripts Instead)

Swarm orchestration is user code, not core primitive. Provide example scripts:

```bash
# examples/swarm/parallel-verify.sh
files=$(git diff --name-only HEAD~1)
echo "$files" | xargs -P 4 -I {} tx graph:verify --files "{}"
```

This is consistent with "primitives, not frameworks" philosophy.

### File Patterns: Glob, Not Regex

```bash
tx graph:verify --files "src/**/*.ts"
tx graph:verify --files "src/auth/*.ts,src/jwt/*.ts"
```

Consistent with PRD-016.

### Pinned Anchors Schema

```sql
ALTER TABLE file_anchors ADD COLUMN pinned BOOLEAN DEFAULT 0;
```

CLI:
```bash
tx graph:pin <anchor-id>
tx graph:unpin <anchor-id>
```

## References

- DD-017: Invalidation Implementation
- PRD-014: Graph Schema
- [Content Hash-Based Deduplication](https://en.wikipedia.org/wiki/Data_deduplication)
