# PRD-018: Worker Orchestration System

**Status**: Draft
**Priority**: P1 (Should Have)
**Owner**: TBD
**Last Updated**: 2026-02-02

---

## Problem Statement

The current `ralph.sh` approach has fundamental limitations that prevent reliable autonomous agent operation:

| Problem | Current State | Impact |
|---------|--------------|--------|
| No heartbeats | Workers die silently | Tasks stuck in 'running' forever |
| No orphan detection | PID-based checks only | State drift when processes crash |
| No graceful shutdown | Abrupt termination | Inconsistent state, lost progress |
| No state reconciliation | Manual cleanup required | Human intervention needed |
| Single worker | Sequential processing | Cannot scale to multiple agents |
| No backpressure | Tasks dispatched blindly | System overload |

Kubernetes solved these problems for containers. We need the same patterns for agent workers.

---

## Target Users

| User Type | Primary Actions | Frequency |
|-----------|-----------------|-----------|
| AI Agents | Register as worker, claim tasks, send heartbeats | Continuous |
| Human Engineers | Start/stop orchestrator, view worker status, scale pool | Daily |
| CI/CD Systems | Trigger orchestrator, check health | On events |

---

## Goals

1. **Reliable worker health tracking** via heartbeat protocol
2. **Automatic orphan detection** and task recovery
3. **Graceful shutdown** with state preservation
4. **Parallel workers** with configurable pool size
5. **Primitives, not frameworks** - composable building blocks

---

## Non-Goals

- Cloud deployment (future: remote workers)
- Auto-scaling based on queue depth (future)
- Distributed consensus (single orchestrator only)
- External message queue (SQLite is sufficient)

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Orphan detection latency | <60s | Time from worker death to task recovery |
| Worker registration latency | <100ms | P95 via CLI |
| Heartbeat overhead | <1% CPU | Per worker |
| Graceful shutdown time | <30s | All workers stopped cleanly |
| Task throughput | 3x current | With 3 parallel workers |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Orchestrator                           │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Registration│  │ Health       │  │ Reconciliation    │  │
│  │ Manager     │  │ Monitor      │  │ Loop              │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Task Queue (SQLite)                     │   │
│  │  - Priority ordering                                 │   │
│  │  - Lease-based claims                               │   │
│  │  - Claim expiration                                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
    ┌──────────┐         ┌──────────┐         ┌──────────┐
    │ Worker 1 │         │ Worker 2 │         │ Worker N │
    │ ┌──────┐ │         │ ┌──────┐ │         │ ┌──────┐ │
    │ │Claude│ │         │ │Claude│ │         │ │Claude│ │
    │ └──────┘ │         │ └──────┘ │         │ └──────┘ │
    │ Heartbeat│         │ Heartbeat│         │ Heartbeat│
    └──────────┘         └──────────┘         └──────────┘
```

---

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| WO-001 | Workers register with orchestrator on startup | P0 |
| WO-002 | Workers send heartbeats every 30s (configurable) | P0 |
| WO-003 | Orchestrator marks workers dead after 2 missed heartbeats | P0 |
| WO-004 | Tasks use lease-based claims (30 min default, renewable) | P0 |
| WO-005 | Expired leases auto-release tasks back to queue | P0 |
| WO-006 | Reconciliation loop runs every 60s to detect orphans | P0 |
| WO-007 | Graceful shutdown: workers finish current task before exit | P0 |
| WO-008 | Configurable worker pool size (1-N) | P0 |
| WO-009 | Worker status visible via CLI (`tx worker status`) | P0 |
| WO-010 | Orchestrator can run as daemon or foreground | P1 |
| WO-011 | Workers can be local processes or remote (future) | P2 |
| WO-012 | Rate limiting / backpressure based on queue depth | P1 |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| WO-NFR-001 | Heartbeat latency | <100ms |
| WO-NFR-002 | Orchestrator memory | <50MB |
| WO-NFR-003 | Worker memory | <100MB + Claude |
| WO-NFR-004 | Database lock contention | <1% of requests |

---

## Data Model

### Migration: `007_worker_orchestration.sql`

```sql
-- Worker registration and health tracking
CREATE TABLE workers (
  id TEXT PRIMARY KEY,                    -- worker-[a-z0-9]{8}
  name TEXT NOT NULL,                     -- Human-friendly name
  hostname TEXT NOT NULL,
  pid INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'idle', 'busy', 'stopping', 'dead')),
  registered_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  current_task_id TEXT REFERENCES tasks(id),
  capabilities TEXT DEFAULT '[]',         -- JSON array of agent types
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX idx_workers_status ON workers(status);
CREATE INDEX idx_workers_heartbeat ON workers(last_heartbeat_at);

-- Task claims with lease expiration
CREATE TABLE task_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  renewed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired', 'completed')),
  UNIQUE(task_id, status) -- Only one active claim per task
);

CREATE INDEX idx_claims_task ON task_claims(task_id);
CREATE INDEX idx_claims_worker ON task_claims(worker_id);
CREATE INDEX idx_claims_expiry ON task_claims(lease_expires_at);

-- Orchestrator state (singleton pattern)
CREATE TABLE orchestrator_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton
  status TEXT NOT NULL DEFAULT 'stopped'
    CHECK (status IN ('stopped', 'starting', 'running', 'stopping')),
  pid INTEGER,
  started_at TEXT,
  last_reconcile_at TEXT,
  worker_pool_size INTEGER DEFAULT 1,
  reconcile_interval_seconds INTEGER DEFAULT 60,
  heartbeat_interval_seconds INTEGER DEFAULT 30,
  lease_duration_minutes INTEGER DEFAULT 30,
  metadata TEXT DEFAULT '{}'
);

-- Initialize singleton
INSERT OR IGNORE INTO orchestrator_state (id) VALUES (1);
```

---

## Worker Protocol

### Registration

```typescript
interface WorkerRegistration {
  workerId: string
  name: string
  hostname: string
  pid: number
  capabilities: string[]  // ['tx-implementer', 'tx-tester', ...]
}
```

### Heartbeat

```typescript
interface Heartbeat {
  workerId: string
  timestamp: Date
  status: 'idle' | 'busy'
  currentTaskId?: string
  metrics?: {
    cpuPercent: number
    memoryMb: number
    tasksCompleted: number
  }
}
```

### Task Claim

```typescript
interface TaskClaim {
  taskId: string
  workerId: string
  claimedAt: Date
  leaseExpiresAt: Date
}
```

---

## API Surface

### CLI Commands

```bash
# Orchestrator management
tx orchestrator start [--workers 3] [--daemon]
tx orchestrator stop [--graceful]
tx orchestrator status

# Worker management
tx worker start [--name my-worker] [--capabilities tx-implementer,tx-tester]
tx worker stop [--graceful]
tx worker status
tx worker list

# Manual operations
tx orchestrator reconcile          # Force reconciliation
tx claim <task-id> [--lease 30m]   # Manual task claim
tx claim:release <task-id>         # Release claim
tx claim:renew <task-id>           # Renew lease
```

### Service Interface

```typescript
interface OrchestratorService {
  start: (config: OrchestratorConfig) => Effect<void, OrchestratorError>
  stop: (graceful: boolean) => Effect<void, OrchestratorError>
  status: () => Effect<OrchestratorStatus, DatabaseError>
  reconcile: () => Effect<ReconciliationResult, DatabaseError>
}

interface WorkerService {
  register: (registration: WorkerRegistration) => Effect<Worker, RegistrationError>
  heartbeat: (heartbeat: Heartbeat) => Effect<void, WorkerNotFoundError>
  deregister: (workerId: string) => Effect<void, WorkerNotFoundError>
  list: () => Effect<Worker[], DatabaseError>
}

interface ClaimService {
  claim: (taskId: string, workerId: string, leaseDuration?: Duration) =>
    Effect<TaskClaim, TaskNotFoundError | AlreadyClaimedError>
  release: (taskId: string, workerId: string) =>
    Effect<void, ClaimNotFoundError>
  renew: (taskId: string, workerId: string) =>
    Effect<TaskClaim, ClaimNotFoundError | LeaseExpiredError>
  getExpired: () => Effect<TaskClaim[], DatabaseError>
}
```

---

## Reconciliation Loop

The orchestrator runs a reconciliation loop every `reconcile_interval_seconds`:

```typescript
const reconcile = () =>
  Effect.gen(function* () {
    const results = {
      deadWorkersFound: 0,
      expiredClaimsReleased: 0,
      orphanedTasksRecovered: 0,
      staleStatesFixed: 0
    }

    // 1. Detect dead workers (missed 2+ heartbeats)
    const deadWorkers = yield* workerService.findDead({
      missedHeartbeats: 2
    })

    for (const worker of deadWorkers) {
      yield* workerService.markDead(worker.id)
      results.deadWorkersFound++
    }

    // 2. Expire stale claims
    const expiredClaims = yield* claimService.getExpired()

    for (const claim of expiredClaims) {
      yield* claimService.expire(claim.id)
      // Return task to ready state
      yield* taskService.update(claim.taskId, { status: 'ready' })
      results.expiredClaimsReleased++
    }

    // 3. Find orphaned tasks (status=active but no active claim)
    const orphanedTasks = yield* taskService.findOrphaned()

    for (const task of orphanedTasks) {
      yield* taskService.update(task.id, { status: 'ready' })
      results.orphanedTasksRecovered++
    }

    // 4. Fix state inconsistencies
    // Workers marked busy but no current_task_id
    // Tasks with claims but wrong status
    results.staleStatesFixed = yield* fixStateInconsistencies()

    return results
  })
```

---

## Graceful Shutdown

### Orchestrator Shutdown

1. Set status to `stopping`
2. Stop accepting new worker registrations
3. Signal all workers to enter graceful shutdown
4. Wait for all workers to finish current tasks (with timeout)
5. Force-kill any remaining workers after timeout
6. Set status to `stopped`

### Worker Shutdown

1. Set status to `stopping`
2. Stop heartbeating
3. Finish current task (if any)
4. Release any held claims
5. Deregister from orchestrator
6. Exit

---

## Configuration

```typescript
interface OrchestratorConfig {
  workerPoolSize: number           // Default: 1
  heartbeatIntervalSeconds: number // Default: 30
  leaseDurationMinutes: number     // Default: 30
  reconcileIntervalSeconds: number // Default: 60
  shutdownTimeoutSeconds: number   // Default: 300
  maxClaimRenewals: number         // Default: 10
}

interface WorkerConfig {
  name?: string                    // Default: worker-{random}
  capabilities: string[]           // Default: ['tx-implementer']
  heartbeatIntervalSeconds: number // Default: 30
}
```

---

## Migration Path from ralph.sh

### Phase 1: Parallel Operation
- New orchestrator runs alongside ralph.sh
- Workers use new claim system
- ralph.sh continues for single-worker mode

### Phase 2: Feature Parity
- All ralph.sh features implemented in orchestrator
- Review cycles, circuit breaker, agent selection

### Phase 3: Deprecation
- ralph.sh deprecated
- Migration guide provided
- Removed in next major version

---

## Open Questions

1. **Should workers be processes or threads?**
   - Processes: Better isolation, simpler crash recovery
   - Threads: Lower overhead, shared memory
   - **Recommendation**: Processes for v1, threads as optimization later

2. **What happens if orchestrator crashes?**
   - Workers continue running with current tasks
   - Heartbeats fail (nowhere to send them)
   - On orchestrator restart, reconciliation recovers state
   - **Recommendation**: Workers should buffer heartbeats, retry on restart

3. **Should we support remote workers in v1?**
   - Local-only is simpler
   - Remote requires REST/gRPC server
   - **Recommendation**: Local-only for v1, design API for remote readiness

---

## Dependencies

- **Depends on**: PRD-001 (Core Task Management), DD-001 (Data Model)
- **Blocks**: None (independent feature)

---

## References

- Kubernetes Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Temporal.io Worker Model: https://docs.temporal.io/workers
- Celery Task Queue: https://docs.celeryq.dev/
- Geoffrey Huntley's RALPH: https://ghuntley.com/ralph
