# Parallel Workers Example

This example demonstrates how multiple workers coordinate using tx.

## The Golden Path

```
Workers: [Alpha, Beta, Gamma]
Tasks:   [T1, T2, T3, T4, T5]

Alpha claims T1 → works → releases
Beta  claims T2 → works → releases
Gamma claims T3 → works → releases
...repeat until all tasks done
```

## CLI Example: Simple Parallel Loop

```bash
#!/bin/bash
# Run 3 workers in parallel

for i in {1..3}; do
  (
    WORKER="worker-$i"
    while true; do
      # Get next ready task
      TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
      [ "$TASK" = "null" ] && break

      # Try to claim it
      if tx claim "$TASK" "$WORKER" 2>/dev/null; then
        echo "[$WORKER] Claimed $TASK"

        # Work on task (simulated)
        # In practice: claude "Work on $TASK"
        sleep 2

        # Release and mark done
        tx claim:release "$TASK" "$WORKER"
        tx done "$TASK"
        echo "[$WORKER] Completed $TASK"
      fi
    done
    echo "[$WORKER] No more tasks"
  ) &
done
wait
```

## The RALPH Pattern

From CLAUDE.md - a fresh Claude instance per task:

```bash
#!/bin/bash
# RALPH: Run Agent Loop Per Host

while true; do
  TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
  [ -z "$TASK" ] || [ "$TASK" = "null" ] && break

  # Fresh Claude instance for each task
  claude --print "Read CLAUDE.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"

  git add -A && git commit -m "Complete $TASK"
done
```

**Key insight**: Each task gets a fresh Claude instance. No accumulated context pollution.

## Worker Process Example

```bash
# Start a persistent worker
tx worker start --name "implementer-1" --capabilities "tx-implementer"

# In another terminal, check worker status
tx worker list
# Output:
# Workers:
#   worker-abc123 [idle] implementer-1
#   worker-def456 [busy] implementer-2 → tx-task001

# Stop worker gracefully (SIGTERM)
kill -SIGTERM <worker-pid>
```

## Programmatic Example (TypeScript)

```typescript
import { Effect, Fiber, Schedule } from "effect"
import {
  ClaimService,
  TaskService,
  ReadyService,
  makeAppLayer
} from "@jamesaphoenix/tx-core"

// Worker loop that runs until no tasks remain
const workerLoop = (workerId: string) =>
  Effect.gen(function* () {
    const claimSvc = yield* ClaimService
    const taskSvc = yield* TaskService
    const readySvc = yield* ReadyService

    while (true) {
      // Get next ready task
      const ready = yield* readySvc.getReady(1)
      if (ready.length === 0) {
        console.log(`[${workerId}] No more tasks`)
        break
      }

      const task = ready[0]

      // Try to claim
      const claim = yield* claimSvc.claim(task.id, workerId).pipe(
        Effect.option
      )

      if (claim._tag === "None") {
        // Another worker got it, try next
        continue
      }

      console.log(`[${workerId}] Claimed ${task.id}: ${task.title}`)

      // Do work (your implementation here)
      yield* Effect.sleep("2 seconds")

      // Release and complete
      yield* claimSvc.release(task.id, workerId)
      yield* taskSvc.update(task.id, { status: "done" })
      console.log(`[${workerId}] Completed ${task.id}`)
    }
  })

// Run multiple workers in parallel
const runWorkers = Effect.gen(function* () {
  const workers = ["worker-alpha", "worker-beta", "worker-gamma"]

  // Start all workers as fibers
  const fibers = yield* Effect.all(
    workers.map(id =>
      Effect.fork(workerLoop(id))
    )
  )

  // Wait for all to complete
  yield* Fiber.joinAll(fibers)
  console.log("All workers finished")
})

const layer = makeAppLayer(".tx/tasks.db")
await Effect.runPromise(Effect.provide(runWorkers, layer))
```

## Claim Contention Handling

When two workers try to claim the same task:

```typescript
const claimWithRetry = (taskId: string, workerId: string) =>
  Effect.gen(function* () {
    const claimSvc = yield* ClaimService

    // Try to claim
    const result = yield* claimSvc.claim(taskId, workerId).pipe(
      Effect.either
    )

    if (result._tag === "Left") {
      const error = result.left
      if ((error as any)._tag === "AlreadyClaimedError") {
        // Task was claimed by another worker - that's fine
        console.log(`Task ${taskId} already claimed, moving on`)
        return null
      }
      // Re-throw other errors
      return yield* Effect.fail(error)
    }

    return result.right
  })
```

## Lease Renewal Pattern

For long-running tasks:

```typescript
const workWithRenewal = (taskId: string, workerId: string) =>
  Effect.gen(function* () {
    const claimSvc = yield* ClaimService

    // Claim with 30 minute lease
    yield* claimSvc.claim(taskId, workerId)

    // Start renewal fiber (renew every 25 minutes)
    const renewalFiber = yield* Effect.fork(
      Effect.repeat(
        claimSvc.renew(taskId, workerId),
        Schedule.fixed("25 minutes")
      )
    )

    try {
      // Do long-running work
      yield* doExpensiveWork(taskId)

      // Complete
      yield* claimSvc.release(taskId, workerId)
    } finally {
      // Stop renewal
      yield* Fiber.interrupt(renewalFiber)
    }
  })
```

## Crash Recovery

Handle worker crashes gracefully:

```typescript
const crashRecovery = Effect.gen(function* () {
  const claimSvc = yield* ClaimService

  // Find expired claims
  const expired = yield* claimSvc.getExpired()

  for (const claim of expired) {
    console.log(`Cleaning up expired claim: ${claim.taskId}`)
    yield* claimSvc.expire(claim.id)
    // Task is now available for other workers
  }
})

// Run periodically
const cleanupSchedule = Effect.repeat(
  crashRecovery,
  Schedule.fixed("5 minutes")
)
```

## Key Points

1. **Claim before work** - Prevents duplicate effort
2. **Release when done** - Frees task for others
3. **Handle contention** - Gracefully skip already-claimed tasks
4. **Renew leases** - For long-running work
5. **Clean up expired** - Recover from worker crashes
6. **Fresh instances** - RALPH pattern avoids context pollution

## Related

- [Worker Claims](./worker-claims.md) - Single worker patterns
- [Task Lifecycle](./task-lifecycle.md) - Task operations
