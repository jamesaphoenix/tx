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
6. **Headless by design** - developers control what workers do

## Design Philosophy: Headless Orchestration

**tx provides the orchestration primitives. You decide what workers do.**

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR CODE (what workers do)                                │
│  - Agent selection logic                                    │
│  - Prompt construction                                      │
│  - LLM execution (Claude, Codex, local, etc.)              │
│  - Result handling                                          │
├─────────────────────────────────────────────────────────────┤
│  tx primitives (orchestration mechanics)                    │
│  - Worker registration & heartbeats                         │
│  - Lease-based task claims                                  │
│  - Reconciliation & orphan recovery                         │
│  - Graceful shutdown coordination                           │
└─────────────────────────────────────────────────────────────┘
```

### What tx Controls (Primitives)
- Worker lifecycle (register, heartbeat, deregister)
- Task claims with leases (claim, renew, release)
- Orchestrator state (start, stop, reconcile)
- Health monitoring and recovery

### What You Control (Your Code)
- **Agent selection**: Which agent handles which task type
- **Prompt building**: How to construct prompts for your LLM
- **Execution**: How to run the LLM (subprocess, API, local)
- **Result handling**: What to do with success/failure
- **IO capture**: Whether to capture transcripts, stderr, etc.

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
tx worker start [--name my-worker]
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
  heartbeatIntervalSeconds: number // Default: 30
}
```

---

## Worker Hooks (Customization Points)

Two hooks. That's it.

```typescript
interface WorkerHooks<TContext = {}> {
  /**
   * Execute the work - YOUR logic lives here
   */
  execute: (task: Task, ctx: WorkerContext & TContext) => Promise<ExecutionResult>

  /**
   * Where to capture IO (optional)
   */
  captureIO?: (runId: string, task: Task) => IOCapture
}

interface WorkerContext {
  // tx primitives
  workerId: string
  runId: string
  renewLease: () => Promise<void>
  log: (message: string) => void

  // Mutable state you can update
  state: Record<string, unknown>
}

interface ExecutionResult {
  success: boolean
  output?: string
  error?: string
}

interface IOCapture {
  transcriptPath?: string
  stderrPath?: string
}
```

### Extend ctx with Your Own Primitives

```typescript
// Pass custom context when creating worker
await runWorker({
  // Your custom context - merged into ctx
  context: {
    db: myDatabaseClient,
    llm: myLLMClient,
    notify: (msg: string) => slack.send(msg),
    config: { maxRetries: 3 }
  },

  execute: async (task, ctx) => {
    // Access your custom primitives
    const history = await ctx.db.getTaskHistory(task.id)
    const result = await ctx.llm.complete(task.title)
    await ctx.notify(`Completed ${task.id}`)

    // Update mutable state
    ctx.state.lastResult = result
    ctx.state.attempts = (ctx.state.attempts ?? 0) + 1

    // Use tx primitives
    ctx.log(`Task ${task.id} done`)
    await ctx.renewLease()

    return { success: true }
  }
})
```

tx provides: `workerId`, `runId`, `renewLease()`, `log()`, `state`
You provide: anything else you need via `context`

---

## Example Worker Loops

### Bash: Minimal

```bash
#!/bin/bash
WORKER_ID=$(tx worker register --name my-worker --json | jq -r '.id')
trap 'tx worker deregister "$WORKER_ID"; exit 0' SIGTERM SIGINT

while true; do
  tx worker heartbeat "$WORKER_ID"
  TASK=$(tx ready --limit 1 --json | jq -r '.[0].id')
  [ -z "$TASK" ] && sleep 5 && continue

  tx claim "$TASK" "$WORKER_ID" || continue

  # YOUR CODE HERE - do whatever you want
  my_llm_script "$TASK"

  tx claim:release "$TASK" "$WORKER_ID"
done
```

### Bash: Claude CLI with Capture

```bash
#!/bin/bash
WORKER_ID=$(tx worker register --name claude-worker --json | jq -r '.id')
mkdir -p .tx/runs
trap 'tx worker deregister "$WORKER_ID"; exit 0' SIGTERM SIGINT

while true; do
  tx worker heartbeat "$WORKER_ID"
  TASK=$(tx ready --limit 1 --json | jq -r '.[0].id')
  [ -z "$TASK" ] && sleep 5 && continue

  tx claim "$TASK" "$WORKER_ID" || continue
  RUN_ID="run-$(openssl rand -hex 4)"

  claude --print --output-format stream-json \
    "Task: $TASK. Run tx show $TASK, implement, tx done $TASK" \
    > ".tx/runs/${RUN_ID}.jsonl" \
    2> ".tx/runs/${RUN_ID}.stderr"

  tx claim:release "$TASK" "$WORKER_ID"
done
```

### Bash: Parallel Workers

```bash
#!/bin/bash
for i in {1..3}; do
  (
    WID=$(tx worker register --name "worker-$i" --json | jq -r '.id')
    trap 'tx worker deregister "$WID"; exit 0' SIGTERM SIGINT
    while true; do
      tx worker heartbeat "$WID"
      TASK=$(tx ready --limit 1 --json | jq -r '.[0].id')
      [ -z "$TASK" ] && sleep 5 && continue
      tx claim "$TASK" "$WID" || continue
      claude --print "Task: $TASK. tx show $TASK, implement, tx done $TASK"
      tx claim:release "$TASK" "$WID"
    done
  ) &
done
wait
```

### TypeScript: Simple

```typescript
import { runWorker } from '@tx/core'

await runWorker({
  execute: async (task, ctx) => {
    ctx.log(`Starting ${task.id}`)
    const result = await myLLM.complete(`Complete task ${task.id}: ${task.title}`)
    return { success: true, output: result }
  },

  captureIO: (runId) => ({
    transcriptPath: `.tx/runs/${runId}.jsonl`,
    stderrPath: `.tx/runs/${runId}.stderr`
  })
})
```

### TypeScript: With Custom Context

```typescript
import { runWorker } from '@tx/core'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

await runWorker({
  // Your primitives - available in ctx
  context: {
    claude: anthropic,
    selectAgent: (task: Task) => task.title.includes('test') ? 'tester' : 'implementer',
    buildPrompt: (task: Task, agent: string) =>
      `You are ${agent}. Task: ${task.id} - ${task.title}. Run tx done ${task.id} when complete.`
  },

  execute: async (task, ctx) => {
    const agent = ctx.selectAgent(task)
    const prompt = ctx.buildPrompt(task, agent)

    ctx.log(`Using ${agent} for ${task.id}`)

    const response = await ctx.claude.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })

    return { success: true, output: response.content[0].text }
  }
})
```

### TypeScript: Claude CLI Subprocess

```typescript
import { runWorker } from '@tx/core'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'

await runWorker({
  execute: async (task, ctx) => {
    const transcript = createWriteStream(`.tx/runs/${ctx.runId}.jsonl`)
    const stderr = createWriteStream(`.tx/runs/${ctx.runId}.stderr`)

    return new Promise((resolve) => {
      const proc = spawn('claude', [
        '--print',
        '--output-format', 'stream-json',
        `Task: ${task.id}. Run tx show ${task.id}, implement, tx done ${task.id}`
      ])

      proc.stdout.pipe(transcript)
      proc.stderr.pipe(stderr)

      proc.on('close', (code) => {
        resolve({ success: code === 0 })
      })
    })
  },

  captureIO: (runId) => ({
    transcriptPath: `.tx/runs/${runId}.jsonl`,
    stderrPath: `.tx/runs/${runId}.stderr`
  })
})
```

### TypeScript: Agent SDK V2

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { runWorker } from '@tx/core'
import { createWriteStream } from 'fs'

await runWorker({
  execute: async (task, ctx) => {
    const transcript = createWriteStream(`.tx/runs/${ctx.runId}.jsonl`)

    await using session = unstable_v2_createSession({
      model: 'claude-sonnet-4-5-20250929'
    })

    const prompt = `Task: ${task.id} - ${task.title}
Run tx show ${task.id}, implement, then tx done ${task.id}`

    transcript.write(JSON.stringify({ type: 'user', content: prompt }) + '\n')
    await session.send(prompt)

    let output = ''
    for await (const msg of session.stream()) {
      transcript.write(JSON.stringify(msg) + '\n')
      if (msg.type === 'assistant') {
        output += msg.message.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('')
      }
    }

    transcript.end()
    return { success: true, output }
  },

  captureIO: (runId) => ({
    transcriptPath: `.tx/runs/${runId}.jsonl`
  })
})
```

### TypeScript: Multi-Turn Conversation

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { runWorker } from '@tx/core'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

await runWorker({
  execute: async (task, ctx) => {
    await using session = unstable_v2_createSession({
      model: 'claude-sonnet-4-5-20250929'
    })

    // Turn 1: Start task
    await session.send(`Task: ${task.id}. Run tx show ${task.id}, implement it.`)
    for await (const msg of session.stream()) { /* consume */ }

    // Turn 2: Verify completion
    const { stdout } = await execAsync(`tx show ${task.id} --json`)
    const status = JSON.parse(stdout).status

    if (status !== 'done') {
      await session.send(`Task not done yet (status: ${status}). Please complete and run tx done ${task.id}`)
      for await (const msg of session.stream()) { /* consume */ }
    }

    return { success: true }
  }
})
```

### TypeScript: Chain Multiple LLMs

```typescript
import { runWorker } from '@tx/core'

await runWorker({
  execute: async (task, ctx) => {
    // Step 1: Plan with Claude
    const plan = await claude.complete(`Plan implementation for: ${task.title}`)

    // Step 2: Generate code with GPT-4
    const code = await openai.complete(`Implement this plan:\n${plan}`)

    // Step 3: Review with Claude
    const review = await claude.complete(`Review this code:\n${code}`)

    // Step 4: Apply if approved
    if (review.includes('APPROVED')) {
      await applyCode(code)
      await exec(`tx done ${task.id}`)
    }

    return { success: true, output: review }
  }
})
```

### TypeScript: Session Resume for Long Tasks

```typescript
import { unstable_v2_createSession, unstable_v2_resumeSession } from '@anthropic-ai/claude-agent-sdk'
import { runWorker } from '@tx/core'
import { existsSync, readFileSync, writeFileSync } from 'fs'

await runWorker({
  execute: async (task, ctx) => {
    const sessionFile = `.tx/runs/${ctx.runId}.session`

    // Resume or create session
    const session = existsSync(sessionFile)
      ? unstable_v2_resumeSession(readFileSync(sessionFile, 'utf-8'), { model: 'claude-sonnet-4-5-20250929' })
      : unstable_v2_createSession({ model: 'claude-sonnet-4-5-20250929' })

    await session.send(existsSync(sessionFile)
      ? 'Continue where you left off'
      : `Task: ${task.id}. Implement it.`)

    let sessionId: string | undefined
    for await (const msg of session.stream()) {
      sessionId = msg.session_id

      // Renew lease periodically for long tasks
      if (Date.now() % 60000 < 1000) {
        await ctx.renewLease()
      }
    }

    // Save for potential resume
    if (sessionId) writeFileSync(sessionFile, sessionId)

    session.close()
    return { success: true }
  }
})
```

### TypeScript: Parallel Subtasks

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { runWorker } from '@tx/core'

await runWorker({
  execute: async (task, ctx) => {
    const subtasks = task.children ?? []

    if (subtasks.length === 0) {
      // Single task
      await using session = unstable_v2_createSession({ model: 'claude-sonnet-4-5-20250929' })
      await session.send(`Task: ${task.id}`)
      for await (const _ of session.stream()) {}
      return { success: true }
    }

    // Parallel subtasks
    await Promise.all(subtasks.map(async (id) => {
      await using session = unstable_v2_createSession({ model: 'claude-sonnet-4-5-20250929' })
      await session.send(`Subtask: ${id}`)
      for await (const _ of session.stream()) {}
    }))

    return { success: true }
  }
})
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
