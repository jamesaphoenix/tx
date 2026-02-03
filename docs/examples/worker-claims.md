# Worker Claims Example

This example demonstrates the claim system for worker coordination.

## The Golden Path

```
Register → Claim → Work → Release/Renew
```

Claims provide exclusive access to tasks with lease-based expiration.

## CLI Example

### Basic Claim Lifecycle

```bash
# Worker claims a task
tx claim tx-task001 worker-alpha
# Output:
# Task tx-task001 claimed by worker-alpha
#   Lease expires: 2025-01-28T10:30:00.000Z

# Worker does work...

# Release the claim when done
tx claim:release tx-task001 worker-alpha
# Output: Claim on task tx-task001 released by worker-alpha
```

### Renew Lease for Long Tasks

```bash
# Claim with custom lease duration (60 minutes)
tx claim tx-task001 worker-alpha --lease 60

# Renew the lease before it expires
tx claim:renew tx-task001 worker-alpha
# Output:
# Lease on task tx-task001 renewed
#   New expiry: 2025-01-28T11:30:00.000Z
#   Renewals: 1/10

# Can renew up to 10 times
tx claim:renew tx-task001 worker-alpha
# Output:
#   Renewals: 2/10
```

### Multiple Workers

```bash
# Worker Alpha claims task 1
tx claim tx-task001 worker-alpha

# Worker Beta claims task 2
tx claim tx-task002 worker-beta

# Worker Gamma claims task 3
tx claim tx-task003 worker-gamma

# Workers work in parallel...

# Each releases their own task
tx claim:release tx-task001 worker-alpha
tx claim:release tx-task002 worker-beta
tx claim:release tx-task003 worker-gamma
```

### Claim Rejection (Already Claimed)

```bash
# Worker Alpha claims task
tx claim tx-task001 worker-alpha

# Worker Beta tries to claim same task
tx claim tx-task001 worker-beta
# Error: Task already claimed by worker-alpha
```

## Programmatic Example (TypeScript)

```typescript
import { Effect, Layer } from "effect"
import {
  ClaimService,
  TaskRepository,
  WorkerRepository,
  makeAppLayer
} from "@jamesaphoenix/tx-core"

const program = Effect.gen(function* () {
  const claimSvc = yield* ClaimService
  const taskRepo = yield* TaskRepository
  const workerRepo = yield* WorkerRepository

  // Setup: Register worker and create task
  yield* workerRepo.insert({
    id: "worker-alpha",
    name: "Alpha Worker",
    hostname: "localhost",
    pid: process.pid,
    status: "idle",
    registeredAt: new Date(),
    lastHeartbeatAt: new Date(),
    currentTaskId: null,
    capabilities: ["tx-implementer"],
    metadata: {}
  })

  yield* taskRepo.insert({
    id: "tx-mytask01" as any,
    title: "My Task",
    description: "",
    status: "ready",
    parentId: null,
    score: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    metadata: {}
  })

  // Claim the task
  const claim = yield* claimSvc.claim("tx-mytask01", "worker-alpha")
  console.log(`Claimed: ${claim.taskId}`)
  console.log(`Expires: ${claim.leaseExpiresAt}`)

  // Work...

  // Renew if needed
  const renewed = yield* claimSvc.renew("tx-mytask01", "worker-alpha")
  console.log(`Renewed: ${renewed.renewedCount}/10`)

  // Release when done
  yield* claimSvc.release("tx-mytask01", "worker-alpha")
  console.log(`Released!`)

  // Verify no active claim
  const active = yield* claimSvc.getActiveClaim("tx-mytask01")
  console.log(`Active claim: ${active}`) // null
})

const layer = makeAppLayer(".tx/tasks.db")
await Effect.runPromise(Effect.provide(program, layer))
```

## Crash Recovery

### Detecting Expired Claims

```typescript
import { Effect } from "effect"
import { ClaimService, makeAppLayer } from "@jamesaphoenix/tx-core"

const cleanupExpired = Effect.gen(function* () {
  const claimSvc = yield* ClaimService

  // Get all expired active claims
  const expired = yield* claimSvc.getExpired()

  for (const claim of expired) {
    console.log(`Expiring claim: ${claim.taskId} (worker: ${claim.workerId})`)
    yield* claimSvc.expire(claim.id)
  }

  console.log(`Cleaned up ${expired.length} expired claims`)
})

const layer = makeAppLayer(".tx/tasks.db")
await Effect.runPromise(Effect.provide(cleanupExpired, layer))
```

### Release All Claims for Crashed Worker

```typescript
import { Effect } from "effect"
import { ClaimService, makeAppLayer } from "@jamesaphoenix/tx-core"

const handleWorkerCrash = (workerId: string) =>
  Effect.gen(function* () {
    const claimSvc = yield* ClaimService

    // Release all claims held by the crashed worker
    const released = yield* claimSvc.releaseByWorker(workerId)
    console.log(`Released ${released} claims for crashed worker: ${workerId}`)
  })

const layer = makeAppLayer(".tx/tasks.db")
await Effect.runPromise(Effect.provide(handleWorkerCrash("worker-crashed"), layer))
```

## Claim Constraints

### Lease Expiration

```bash
# If lease has expired, renew fails
tx claim:renew tx-task001 worker-alpha
# Error: Lease has expired
```

### Max Renewals (10)

```bash
# After 10 renewals
tx claim:renew tx-task001 worker-alpha
# Error: Maximum renewals exceeded
```

### Wrong Worker

```bash
# Worker Alpha claimed the task
tx claim tx-task001 worker-alpha

# Worker Beta tries to release
tx claim:release tx-task001 worker-beta
# Error: Claim not found
```

## Key Points

1. **Leases** default to 30 minutes, customizable via `--lease`
2. **Renewals** are limited to 10 per claim
3. **Exclusive access** - only one worker can claim a task at a time
4. **Crash recovery** via `getExpired()` and `releaseByWorker()`
5. Released tasks can be reclaimed by any worker

## Related

- [Task Lifecycle](./task-lifecycle.md) - Basic task operations
- [Parallel Workers](./parallel-workers.md) - Multi-worker patterns
