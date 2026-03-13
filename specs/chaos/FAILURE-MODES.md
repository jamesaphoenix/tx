# tx Failure Mode Documentation

This document catalogs known failure modes in tx, their detection methods, and recovery procedures. These failure modes were discovered through chaos engineering testing.

## Overview

tx is designed to be resilient to common failure scenarios. This document serves as a reference for:
- Understanding potential failure points
- Detecting failures through monitoring and testing
- Implementing recovery procedures

---

## Failure Mode Categories

### 1. Claim Race Conditions

**Description**: Multiple workers attempt to claim the same task simultaneously.

**Potential Impact**:
- Data corruption if multiple workers work on the same task
- Wasted compute if work is duplicated

**Detection**:
- Monitor for multiple active claims on the same task
- Check for "AlreadyClaimedError" frequency in logs

**Recovery**:
- The claim system uses database-level constraints to ensure only one winner
- Losing workers receive `AlreadyClaimedError` and should request a different task

**Prevention**:
- SQLite's atomic operations ensure claim atomicity
- Claims are checked before insert with `INSERT ... WHERE NOT EXISTS`

**Test Coverage**: `test/chaos/claim-race.test.ts`

---

### 2. Dead Worker Claims (Orphan Claims)

**Description**: A worker dies while holding a claim, leaving the task in limbo.

**Potential Impact**:
- Tasks become stuck in "claimed" state indefinitely
- Work queue throughput decreases

**Detection**:
- Monitor heartbeat timestamps in `workers` table
- Check `last_heartbeat_at < NOW() - threshold`
- Query for claims from workers with stale heartbeats

**Recovery**:
```sql
-- Find orphan claims
SELECT c.task_id, c.worker_id, w.last_heartbeat_at
FROM task_claims c
JOIN workers w ON c.worker_id = w.id
WHERE c.status = 'active'
  AND w.last_heartbeat_at < datetime('now', '-15 minutes');

-- Expire orphan claims
UPDATE task_claims
SET status = 'expired'
WHERE id IN (
  SELECT c.id FROM task_claims c
  JOIN workers w ON c.worker_id = w.id
  WHERE c.status = 'active'
    AND w.last_heartbeat_at < datetime('now', '-15 minutes')
);
```

**Prevention**:
- Workers should send heartbeats every 30-60 seconds
- Claims have lease expiration times
- Orchestrator periodically runs `ClaimService.getExpired()` and expires stale claims

**Test Coverage**: `test/chaos/worker-failure.test.ts`

---

### 3. Lease Expiration During Work

**Description**: A worker's lease expires while still working on a task.

**Potential Impact**:
- Another worker may claim the task, causing duplicate work
- Partial work may be lost or overwritten

**Detection**:
- Log `LeaseExpiredError` when renewal fails
- Monitor time between claim and completion

**Recovery**:
- Worker should checkpoint progress before lease expires
- Use `ClaimService.renew()` to extend lease

**Prevention**:
- Set appropriate lease duration (default: 30 minutes)
- Implement automatic lease renewal in worker loops
- Use `tx checkpoint` to save progress

**Test Coverage**: `test/chaos/claim-race.test.ts`

---

### 4. Circular Dependencies

**Description**: Task A blocks Task B, which blocks Task A (or longer chains).

**Potential Impact**:
- Tasks become permanently blocked
- Work queue deadlock

**Detection**:
- `CircularDependencyError` thrown at dependency creation
- BFS cycle detection at insert time

**Recovery**:
- Cannot occur due to prevention (see below)
- If manually corrupted, remove offending dependency

**Prevention**:
- Database CHECK constraint: `blocker_id != blocked_id`
- BFS cycle detection in `DependencyService.addBlocker()`
- Foreign key constraints ensure valid task references

**Test Coverage**: `test/chaos/invariants.test.ts`

---

### 5. Self-Blocking Tasks

**Description**: A task is configured to block itself.

**Potential Impact**:
- Task can never become ready
- Permanent block on that task

**Detection**:
- `ValidationError` thrown at dependency creation
- SQL CHECK constraint violation

**Recovery**:
- Cannot occur due to prevention (see below)
- If manually corrupted: `DELETE FROM task_dependencies WHERE blocker_id = blocked_id`

**Prevention**:
- Database CHECK constraint: `CHECK (blocker_id != blocked_id)`
- Service-level validation before insert

**Test Coverage**: `test/chaos/invariants.test.ts`, `test/integration/core.test.ts`

---

### 6. State Corruption

**Description**: Invalid data in the database (invalid status, malformed JSON, etc.)

**Types of Corruption**:
| Type | Description | Risk Level |
|------|-------------|------------|
| `invalid_status` | Status field contains non-enum value | High |
| `invalid_json` | Metadata field contains malformed JSON | Medium |
| `negative_score` | Score is negative | Low |
| `future_timestamp` | Timestamp in the future | Low |
| `self_reference` | parent_id = id | Medium |
| `orphaned_dependency` | Dependency references non-existent task | High |

**Detection**:
- Validation at read time
- Periodic integrity checks
- Application errors when parsing

**Recovery**:
```sql
-- Find invalid statuses
SELECT id, status FROM tasks
WHERE status NOT IN ('backlog', 'ready', 'planning', 'active', 'blocked', 'review', 'human_needs_to_review', 'done');

-- Find invalid JSON
-- (Requires application-level parsing)

-- Find self-references
SELECT id FROM tasks WHERE parent_id = id;

-- Find orphaned dependencies
SELECT * FROM task_dependencies td
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE id = td.blocker_id)
   OR NOT EXISTS (SELECT 1 FROM tasks WHERE id = td.blocked_id);
```

**Prevention**:
- Database constraints (CHECK, FOREIGN KEY)
- Service-level validation
- Type-safe APIs

**Test Coverage**: `test/chaos/state-corruption.test.ts`

---

### 7. Partial Writes

**Description**: A batch operation fails partway through, leaving partial data.

**Potential Impact**:
- Inconsistent state
- Data loss
- Broken relationships

**Detection**:
- Transaction failures in logs
- Unexpected row counts after operations

**Recovery**:
- If using transactions: automatic rollback
- If not using transactions: manual cleanup required

**Prevention**:
- Always use transactions for multi-row operations
- SQLite WAL mode ensures durability
- Better-sqlite3's `transaction()` helper

**Test Coverage**: `test/chaos/state-corruption.test.ts`

---

### 8. JSONL Sync Conflicts

**Description**: Conflicting changes between local database and JSONL sync file.

**Potential Impact**:
- Data loss if older version wins
- Inconsistent state across machines

**Detection**:
- Sync import returns `conflicts > 0`
- Timestamp comparison in sync log

**Recovery**:
- Last-write-wins by default (newer timestamp)
- Manual review for critical conflicts
- Re-export to regenerate JSONL

**Prevention**:
- Use sequential timestamps
- Avoid concurrent edits on same task
- Sync frequently

**Test Coverage**: `test/chaos/sync-replay.test.ts`, `test/integration/sync.test.ts`

---

### 9. Double Completion

**Description**: A task is marked complete more than once.

**Potential Impact**:
- Updated completion timestamp
- Potential metric inaccuracies

**Detection**:
- Warning when completing already-done task
- Audit log showing multiple completion events

**Recovery**:
- Generally benign (idempotent)
- Review if unexpected

**Prevention**:
- Check status before completing
- Service layer validates transitions

**Test Coverage**: `test/chaos/claim-race.test.ts`

---

## Stress Test Results

The following performance characteristics were observed under stress testing:

| Scenario | Task Count | Duration | Notes |
|----------|------------|----------|-------|
| Bulk create | 1,000 | < 1s | In-memory SQLite |
| Bulk create | 5,000 | < 5s | Batched inserts |
| Ready detection | 1,000 tasks | < 2s | With 20% dependencies |
| Race (10 workers) | 1 task | < 100ms | Single winner guaranteed |
| Concurrent races | 5 tasks | < 200ms | Each has single winner |

### Performance Invariants

1. **Claim atomicity**: Always exactly one winner per task
2. **Ready detection**: O(n) where n = task count
3. **Dependency check**: O(d) where d = dependency count

---

## Monitoring Recommendations

### Key Metrics to Monitor

1. **Claim health**:
   - Active claims count
   - Expired claims count
   - Average claim duration

2. **Worker health**:
   - Worker count by status
   - Heartbeat staleness
   - Tasks completed per worker

3. **Queue health**:
   - Ready task count
   - Blocked task count
   - Average time in queue

4. **Error rates**:
   - AlreadyClaimedError frequency
   - CircularDependencyError frequency
   - TaskNotFoundError frequency

### Alerting Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Stale heartbeats | > 5 workers | > 20% of workers |
| Expired claims | > 10/hour | > 50/hour |
| Blocked tasks | > 50% of total | > 80% of total |
| Error rate | > 1% | > 5% |

---

## Recovery Procedures

### Full Database Recovery

If the database is corrupted beyond repair:

1. Stop all workers
2. Export any salvageable data: `tx sync export /backup/tasks.jsonl`
3. Delete corrupted database: `rm .tx/tasks.db`
4. Re-initialize: `tx init`
5. Import backup: `tx sync import /backup/tasks.jsonl`
6. Restart workers

### Orphan Claim Cleanup

```bash
# Find and expire all orphan claims
tx orphan-cleanup --dry-run  # Preview
tx orphan-cleanup --execute  # Execute
```

Or via SQL:
```sql
BEGIN TRANSACTION;
UPDATE task_claims
SET status = 'expired'
WHERE status = 'active'
  AND worker_id IN (
    SELECT id FROM workers
    WHERE last_heartbeat_at < datetime('now', '-15 minutes')
  );
COMMIT;
```

---

## Chaos Test Suite Location

All chaos tests are located in `test/chaos/`:

| File | Purpose |
|------|---------|
| `claim-race.test.ts` | Race conditions, claim conflicts |
| `state-corruption.test.ts` | Data corruption, recovery |
| `sync-replay.test.ts` | JSONL sync determinism |
| `worker-failure.test.ts` | Heartbeat failures, orphans |
| `stress.test.ts` | Load testing, performance |
| `invariants.test.ts` | DOCTRINE rule validation |

Run chaos tests:
```bash
bun run test -- test/chaos/
```
