# PRD-003: Dependency & Blocking System

**Status**: Draft
**Priority**: P0 (Must Have)
**Owner**: TBD
**Last Updated**: 2025-01-28

---

## Problem Statement

Tasks have dependencies - you can't deploy before testing, can't test before building. Current task systems either:

1. **Ignore dependencies** - agents work on blocked tasks, wasting effort
2. **Use implicit ordering** - brittle, breaks when tasks are reordered
3. **Require manual tracking** - humans must remember what blocks what

We need **explicit dependency graphs** where tasks can block other tasks, and agents automatically skip blocked work.

---

## Core Concepts

### Blocking Relationship
```
Task A "blocks" Task B
  = Task B cannot start until Task A is done
  = Task B is "blocked by" Task A
```

### Ready Detection
A task is **ready** when:
1. Status is `backlog`, `ready`, or `planning`
2. All tasks that block it have status `done`
3. (Optional) Parent task is not `blocked`

### Critical Path
The chain of blocking relationships that determines the minimum time to completion. Higher scores should go to tasks that unblock the most other tasks.

---

## Use Cases

### Case 1: Sequential Work
```
tx-001: Design database schema (ready)
tx-002: Implement migrations (blocked by tx-001)
tx-003: Write seed data (blocked by tx-002)
```
Agent queries `tx ready` → gets tx-001 only.

### Case 2: Parallel Work with Join
```
tx-010: Build API endpoint (ready)
tx-011: Build UI component (ready)
tx-012: Integration tests (blocked by tx-010, tx-011)
```
Agent can work on tx-010 and tx-011 in parallel. tx-012 becomes ready only when both are done.

### Case 3: Unblocking Cascade
```
tx-020: Core library (blocks: tx-021, tx-022, tx-023)
```
Completing tx-020 unblocks three tasks at once - it should have high priority.

---

## Requirements

### Dependency Operations

| ID | Requirement | CLI Command |
|----|-------------|-------------|
| D-001 | Add blocker | `tx block <task> <blocker>` |
| D-002 | Remove blocker | `tx unblock <task> <blocker>` |
| D-003 | List blockers | `tx blockers <task>` |
| D-004 | List tasks this blocks | `tx blocking <task>` |

### Ready Detection

| ID | Requirement | CLI Command |
|----|-------------|-------------|
| D-005 | List all ready tasks, sorted by score | `tx ready` |
| D-006 | Limit ready results | `tx ready --limit=5` |
| D-007 | Check if specific task is ready | `tx is-ready <id>` |
| D-008 | Include blocking count in output | Automatic |

### Constraints

| ID | Constraint | Enforcement |
|----|------------|-------------|
| D-009 | No self-blocking (task can't block itself) | CHECK constraint |
| D-010 | No circular dependencies | Validation on insert |
| D-011 | Deleting blocker auto-unblocks | CASCADE DELETE |

---

## Blocking Score Bonus

Tasks that block many others should score higher:
```
score_adjustment = base_score + (blocking_count * 25)
```

This ensures agents prioritize unblocking work.

---

## API Examples

### Add Dependencies
```bash
# Task tx-002 is blocked by tx-001
tx block tx-002 tx-001

# Task tx-003 is blocked by tx-002
tx block tx-003 tx-002

# Multiple blockers
tx block tx-012 tx-010
tx block tx-012 tx-011
```

### Query Dependencies
```bash
$ tx blockers tx-012
tx-012 is blocked by:
  - tx-010: Build API endpoint [active]
  - tx-011: Build UI component [active]

$ tx blocking tx-010
tx-010 blocks:
  - tx-012: Integration tests [blocked]
```

### Ready Detection
```bash
$ tx ready
3 ready task(s):
  tx-a1b2c3 [850] Implement JWT validation (unblocks 2)
    blocked by: (none)
    blocks: tx-d4e5f6, tx-g7h8i9
  tx-d4e5f6 [720] Add login endpoint
    blocked by: (none)
    blocks: tx-j0k1l2

$ tx ready --json
[
  {
    "id": "tx-a1b2c3",
    "blockedBy": [],
    "blocks": ["tx-d4e5f6", "tx-g7h8i9"],
    "isReady": true
  }
]
```

---

## Data Model

```sql
-- Dependency relationships
CREATE TABLE task_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)  -- No self-blocking
);
```

```typescript
// Response always includes dependency info
interface TaskWithDeps {
  id: TaskId
  // ... other fields
  blockedBy: TaskId[]  // Tasks that block this one
  blocks: TaskId[]     // Tasks this one blocks
  isReady: boolean     // Computed: no open blockers
}
```

---

## Circular Dependency Prevention

```typescript
async function addBlocker(taskId: TaskId, blockerId: TaskId): Promise<void> {
  // Check for self-blocking
  if (taskId === blockerId) {
    throw new ValidationError("Task cannot block itself")
  }

  // Check for cycles: would blockerId end up waiting on taskId?
  const wouldCycle = await wouldCreateCycle(taskId, blockerId)
  if (wouldCycle) {
    throw new CircularDependencyError({ taskId, blockerId })
  }

  // Safe to add
  await db.insert("task_dependencies", { blocker_id: blockerId, blocked_id: taskId })
}
```

---

## Related Documents

- [PRD-001: Core Task Management](./PRD-001-core-task-management.md)
- [PRD-004: Task Scoring & Prioritization](./PRD-004-task-scoring-prioritization.md)
- [PRD-008: Observability & OpenTelemetry](./PRD-008-observability-opentelemetry.md)
- [DD-004: Ready Detection Algorithm](../design/DD-004-ready-detection-algorithm.md)
- [DD-008: OpenTelemetry Integration](../design/DD-008-opentelemetry-integration.md)
