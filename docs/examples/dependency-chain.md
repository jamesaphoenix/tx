# Dependency Chain Example

This example demonstrates how to create and manage task dependencies.

## The Golden Path

```
A → B → C  (A blocks B, B blocks C)
```

Tasks are only "ready" when all their blockers are `done`.

## CLI Example

### Serial Dependencies

```bash
# Create tasks
tx add "Design database schema" --score 1000
# Output: Created task: tx-design01

tx add "Implement API endpoints" --score 800
# Output: Created task: tx-api0001

tx add "Write integration tests" --score 600
# Output: Created task: tx-test001

# Create dependency chain: design → api → tests
tx block tx-api0001 tx-design01   # design blocks api
tx block tx-test001 tx-api0001    # api blocks tests

# Check ready tasks - only design should be ready
tx ready
# Output:
# 1 ready task(s):
#   tx-design01 [backlog] Design database schema (1000)

# Complete design
tx done tx-design01
# Output: Completed: tx-design01 - Design database schema
# Now unblocked: tx-api0001

# Now api is ready
tx ready
# Output:
# 1 ready task(s):
#   tx-api0001 [backlog] Implement API endpoints (800)

# Complete api
tx done tx-api0001
# Output: Completed: tx-api0001 - Implement API endpoints
# Now unblocked: tx-test001

# Now tests are ready
tx ready
# Output:
# 1 ready task(s):
#   tx-test001 [backlog] Write integration tests (600)
```

### Parallel Dependencies (Diamond Pattern)

```bash
# Create tasks for diamond pattern:
#        A
#       / \
#      B   C
#       \ /
#        D

tx add "Foundation" --score 1000       # tx-a
tx add "Module B" --score 800          # tx-b
tx add "Module C" --score 800          # tx-c
tx add "Integration" --score 600       # tx-d

# Set up dependencies
tx block tx-b tx-a    # A blocks B
tx block tx-c tx-a    # A blocks C
tx block tx-d tx-b    # B blocks D
tx block tx-d tx-c    # C blocks D

# D is blocked by BOTH B and C
tx show tx-d
# Output:
# Task: tx-d
#   Blocked by: tx-b, tx-c
#   Is Ready: no

# Complete A - now B and C are ready
tx done tx-a

# Complete B - D is still blocked (needs C)
tx done tx-b

# Check D's status
tx show tx-d
# Output:
#   Blocked by: tx-b, tx-c
#   Is Ready: no  (tx-c still open)

# Complete C - now D is ready
tx done tx-c

tx show tx-d
# Output:
#   Is Ready: yes
```

### Remove a Dependency

```bash
# If you need to remove a blocker
tx unblock tx-d tx-b
# Output: tx-b no longer blocks tx-d
```

## Programmatic Example (TypeScript)

```typescript
import { Effect } from "effect"
import { TaskService, DependencyService, ReadyService, makeAppLayer } from "@jamesaphoenix/tx-core"

const program = Effect.gen(function* () {
  const taskSvc = yield* TaskService
  const depSvc = yield* DependencyService
  const readySvc = yield* ReadyService

  // Create tasks
  const taskA = yield* taskSvc.create({ title: "Task A - Foundation", score: 800 })
  const taskB = yield* taskSvc.create({ title: "Task B - Build on A", score: 600 })
  const taskC = yield* taskSvc.create({ title: "Task C - Build on B", score: 400 })

  // Create chain: A → B → C
  yield* depSvc.addBlocker(taskB.id, taskA.id)
  yield* depSvc.addBlocker(taskC.id, taskB.id)

  // Check ready states
  console.log(`A ready: ${yield* readySvc.isReady(taskA.id)}`) // true
  console.log(`B ready: ${yield* readySvc.isReady(taskB.id)}`) // false
  console.log(`C ready: ${yield* readySvc.isReady(taskC.id)}`) // false

  // Complete A
  yield* taskSvc.update(taskA.id, { status: "done" })

  // Now B is ready
  console.log(`B ready after A done: ${yield* readySvc.isReady(taskB.id)}`) // true
  console.log(`C ready after A done: ${yield* readySvc.isReady(taskC.id)}`) // false (B still open)

  // Get full dependency info (Rule 1)
  const bWithDeps = yield* taskSvc.getWithDeps(taskB.id)
  console.log(`B blockedBy: ${bWithDeps.blockedBy}`)  // [taskA.id]
  console.log(`B blocks: ${bWithDeps.blocks}`)        // [taskC.id]
  console.log(`B isReady: ${bWithDeps.isReady}`)      // true (A is done)
})

const layer = makeAppLayer(".tx/tasks.db")
await Effect.runPromise(Effect.provide(program, layer))
```

## Constraints (Rule 4)

### No Self-Blocking

```bash
tx block tx-a tx-a
# Error: A task cannot block itself
```

### No Circular Dependencies

```bash
# If A → B already exists
tx block tx-a tx-b
# Error: Circular dependency detected
```

## Key Points

1. **blockedBy** lists all tasks that must be `done` before this task is ready
2. **blocks** lists all tasks that this task blocks
3. **isReady** is `true` only when ALL blockers are `done`
4. **Cycle detection** prevents circular dependencies (BFS algorithm)
5. **Self-blocking** is prevented at database level (CHECK constraint)
6. Ready list returns tasks sorted by score descending

## Related

- [Task Lifecycle](./task-lifecycle.md) - Basic task operations
- [Worker Claims](./worker-claims.md) - Exclusive task access
