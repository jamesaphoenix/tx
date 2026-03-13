# Task Lifecycle Example

This example demonstrates the complete task lifecycle from creation to completion.

## The Golden Path

```
Create → Ready → Active → Done
```

## CLI Example

```bash
# Initialize tx (creates .tx/tasks.db)
tx init

# Create a task
tx add "Implement user authentication" --score 800

# Output:
# Created task: tx-a1b2c3d4
#   Title: Implement user authentication
#   Score: 800

# List ready tasks (sorted by score)
tx ready

# Output:
# 1 ready task(s):
#   tx-a1b2c3d4 [backlog] Implement user authentication (800)

# View full task details
tx show tx-a1b2c3d4

# Output:
# Task: tx-a1b2c3d4
#   Title: Implement user authentication
#   Status: backlog
#   Score: 800
#   Ready: yes
#   Blocked by: (none)
#   Blocks: (none)
#   Children: (none)

# Update status to active (work starting)
tx update tx-a1b2c3d4 --status active

# Complete the task
tx done tx-a1b2c3d4

# Output:
# Completed: tx-a1b2c3d4 - Implement user authentication
```

## With Parent-Child Hierarchy

```bash
# Create parent task
tx add "Build user authentication" --score 1000
# Output: Created task: tx-parent01

# Create subtasks under parent
tx add "Design auth schema" --parent tx-parent01 --score 700
tx add "Implement login endpoint" --parent tx-parent01 --score 800
tx add "Add session management" --parent tx-parent01 --score 600

# View the hierarchy
tx tree tx-parent01

# Complete subtasks one by one
tx done tx-subtask1
tx done tx-subtask2
tx done tx-subtask3

# Complete parent
tx done tx-parent01
```

## Programmatic Example (TypeScript)

```typescript
import { Effect } from "effect"
import { TaskService, ReadyService, makeAppLayer } from "@jamesaphoenix/tx-core"

const program = Effect.gen(function* () {
  const taskSvc = yield* TaskService
  const readySvc = yield* ReadyService

  // Create task
  const task = yield* taskSvc.create({
    title: "Implement authentication feature",
    description: "Add user login and registration",
    score: 800
  })

  console.log(`Created: ${task.id}`)

  // Check if ready (no blockers)
  const isReady = yield* readySvc.isReady(task.id)
  console.log(`Is ready: ${isReady}`)

  // Get with full dependency info (Rule 1)
  const withDeps = yield* taskSvc.getWithDeps(task.id)
  console.log(`Blocked by: ${withDeps.blockedBy.length}`)
  console.log(`Blocks: ${withDeps.blocks.length}`)

  // Complete the task
  yield* taskSvc.update(task.id, { status: "done" })
  console.log(`Task completed!`)
})

const layer = makeAppLayer(".tx/tasks.db")
await Effect.runPromise(Effect.provide(program, layer))
```

## Key Points

1. **Task IDs** are deterministic SHA256-based strings (format: `tx-[a-z0-9]{8}`)
2. **Default status** is `backlog` when created
3. **Ready detection** excludes tasks with open blockers
4. **TaskWithDeps** always includes `blockedBy`, `blocks`, `children`, and `isReady` (Rule 1)
5. **completedAt** is automatically set when status changes to `done`

## Related

- [Dependency Chain](./dependency-chain.md) - Add blockers to tasks
- [Worker Claims](./worker-claims.md) - Claim tasks for exclusive access
