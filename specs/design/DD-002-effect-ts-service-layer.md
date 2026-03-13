# DD-002: Effect-TS Service Layer Design

**Status**: Draft
**Implements**: [PRD-001](../prd/PRD-001-core-task-management.md), [PRD-003](../prd/PRD-003-dependency-blocking-system.md)
**Last Updated**: 2025-01-28

---

## Overview

This document describes **how** the Effect-TS service layer is architected: service definitions, layer composition, error handling, and repository patterns.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  CLI Commands    │   MCP Server   │   TypeScript API            │
├─────────────────────────────────────────────────────────────────┤
│                     Telemetry Middleware                          │
│              (Tracing, Metrics, Structured Logging)              │
├─────────────────────────────────────────────────────────────────┤
│                        Service Layer                             │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│ TaskService  │ ReadyService │ ScoreService │ HierarchyService  │
├──────────────┴──────────────┴──────────────┴───────────────────┤
│                   LLM Services (optional)                        │
├─────────────────────────┬───────────────────────────────────────┤
│  DeduplicationService   │   CompactionService                   │
├─────────────────────────┴───────────────────────────────────────┤
│                      Repository Layer                            │
├─────────────────────────┬───────────────────────────────────────┤
│   TaskRepository        │   DependencyRepository                │
├─────────────────────────┴───────────────────────────────────────┤
│                      Infrastructure Layer                        │
├───────────────┬──────────────────┬──────────────────────────────┤
│  SqliteClient │ TelemetryClient  │ AnthropicClient (optional)   │
└───────────────┴──────────────────┴──────────────────────────────┘
```

**Key**: `AnthropicClient` is optional. Core services (TaskService, ReadyService, etc.) never depend on it. Only LLM services (DeduplicationService, CompactionService) require it. `TelemetryClient` auto-detects OTEL configuration and falls back to noop.

---

## Service Definitions

### TaskService

The core CRUD service. Provides both basic `Task` and enriched `TaskWithDeps` variants.

```typescript
// src/services/TaskService.ts
export class TaskService extends Context.Tag("TaskService")<
  TaskService,
  {
    // CRUD operations
    readonly create: (input: CreateTaskInput) => Effect.Effect<Task, ValidationError>
    readonly get: (id: TaskId) => Effect.Effect<Task, TaskNotFoundError>
    readonly getWithDeps: (id: TaskId) => Effect.Effect<TaskWithDeps, TaskNotFoundError>
    readonly update: (id: TaskId, input: UpdateTaskInput) => Effect.Effect<Task, TaskNotFoundError | ValidationError>
    readonly delete: (id: TaskId) => Effect.Effect<void, TaskNotFoundError>

    // Query operations
    readonly list: (filter?: TaskFilter) => Effect.Effect<readonly Task[]>
    readonly listWithDeps: (filter?: TaskFilter) => Effect.Effect<readonly TaskWithDeps[]>
    readonly count: (filter?: TaskFilter) => Effect.Effect<number>

    // Hierarchy operations
    readonly getChildren: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getAncestors: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getRoots: () => Effect.Effect<readonly Task[]>
  }
>() {}
```

**Key design decision**: `getWithDeps` enriches a Task with dependency info by querying the dependency and task repositories. This is the method MCP tools should use.

### ReadyService

Returns `TaskWithDeps[]` so consumers always have dependency info.

```typescript
// src/services/ReadyService.ts
export class ReadyService extends Context.Tag("ReadyService")<
  ReadyService,
  {
    readonly getReady: (limit?: number) => Effect.Effect<readonly TaskWithDeps[]>
    readonly isReady: (id: TaskId) => Effect.Effect<boolean>
    readonly getBlockers: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getBlocking: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getBlockingCount: (id: TaskId) => Effect.Effect<number>
  }
>() {}
```

### DependencyService

Manages blocking relationships with cycle detection.

```typescript
// src/services/DependencyService.ts
export class DependencyService extends Context.Tag("DependencyService")<
  DependencyService,
  {
    readonly addBlocker: (taskId: TaskId, blockerId: TaskId) => Effect.Effect<void, ValidationError | CircularDependencyError>
    readonly removeBlocker: (taskId: TaskId, blockerId: TaskId) => Effect.Effect<void>
    readonly getAll: () => Effect.Effect<readonly TaskDependency[]>
  }
>() {}
```

### HierarchyService

Tree operations for parent-child relationships.

```typescript
// src/services/HierarchyService.ts
export class HierarchyService extends Context.Tag("HierarchyService")<
  HierarchyService,
  {
    readonly getTree: (id: TaskId) => Effect.Effect<TaskTree, TaskNotFoundError>
    readonly getPath: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getDepth: (id: TaskId) => Effect.Effect<number>
  }
>() {}
```

### ScoreService

Score calculation with dynamic adjustments.

```typescript
// src/services/ScoreService.ts
export class ScoreService extends Context.Tag("ScoreService")<
  ScoreService,
  {
    readonly calculate: (task: Task) => Effect.Effect<number>
    readonly recalculateAll: (context?: string) => Effect.Effect<void>
  }
>() {}
```

---

## Service Implementation Pattern

Each service follows the same pattern:

```typescript
export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    // Resolve dependencies
    const repo = yield* TaskRepository
    const depRepo = yield* DependencyRepository
    const idGen = yield* IdGenerator

    // Return service implementation
    return {
      create: (input) =>
        Effect.gen(function* () {
          // 1. Validate input
          const validated = yield* Schema.decodeUnknown(CreateTaskInput)(input).pipe(
            Effect.mapError((e) => new ValidationError({ reason: TreeFormatter.formatErrorSync(e) }))
          )

          // 2. Validate parent exists if specified
          if (validated.parentId) {
            const parent = yield* repo.findById(validated.parentId)
            if (!parent) {
              yield* Effect.fail(new ValidationError({ reason: `Parent ${validated.parentId} not found` }))
            }
          }

          // 3. Generate ID
          const id = yield* idGen.generate()
          const now = new Date()

          // 4. Build task
          const task: Task = {
            id,
            title: validated.title,
            description: validated.description ?? "",
            status: "backlog",
            parentId: validated.parentId ?? null,
            score: validated.score ?? 0,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            metadata: validated.metadata ?? {}
          }

          // 5. Persist
          yield* repo.insert(task)
          return task
        }),

      getWithDeps: (id) =>
        Effect.gen(function* () {
          // Get base task
          const task = yield* repo.findById(id).pipe(
            Effect.flatMap(Effect.fromNullable),
            Effect.mapError(() => new TaskNotFoundError({ id }))
          )

          // Enrich with dependency info
          const blockerIds = yield* depRepo.getBlockerIds(id)
          const blockingIds = yield* depRepo.getBlockingIds(id)
          const children = yield* repo.findByParent(id)
          const childIds = children.map(c => c.id)

          // Check readiness
          let isReady = task.isWorkable
          if (isReady && blockerIds.length > 0) {
            const blockers = yield* repo.findByIds(blockerIds)
            isReady = blockers.every(b => b.status === "done")
          }

          return {
            ...task,
            blockedBy: blockerIds,
            blocks: blockingIds,
            children: childIds,
            isReady
          }
        }),

      // ... other methods
    }
  })
)
```

---

## Layer Composition

```typescript
// src/layers/AppLayer.ts

// Infrastructure layer (always available)
export const InfraLive = Layer.mergeAll(
  SqliteClientLive,
  IdGeneratorLive,
  TelemetryAuto    // Auto-detect OTEL; noop when not configured
)

// Repository layer (depends on infrastructure)
export const RepositoryLive = Layer.mergeAll(
  TaskRepositoryLive,
  DependencyRepositoryLive
).pipe(Layer.provide(InfraLive))

// Core service layer (depends on repositories)
// NEVER depends on AnthropicClient
export const CoreServiceLive = Layer.mergeAll(
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  ScoreServiceLive
).pipe(Layer.provide(RepositoryLive))

// LLM service layer (depends on core services + Anthropic)
// Only constructed when ANTHROPIC_API_KEY is available
export const LlmServiceLive = Layer.mergeAll(
  DeduplicationServiceLive,
  CompactionServiceLive
).pipe(
  Layer.provide(CoreServiceLive),
  Layer.provide(AnthropicClientLive)
)

// Anthropic client: uses env var if present, fails gracefully otherwise
export const AnthropicClientOptional = Layer.unwrapEffect(
  Effect.gen(function* () {
    const apiKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(
      Effect.option
    )
    if (Option.isSome(apiKey)) {
      return Layer.succeed(AnthropicClient, new Anthropic({ apiKey: apiKey.value }))
    }
    // Return a layer that fails when accessed
    return Layer.fail(new Error("ANTHROPIC_API_KEY not set"))
  })
)

// Minimal layer (no LLM features) — used by CLI core commands and MCP server
export const AppMinimalLive = Layer.mergeAll(
  CoreServiceLive,
  MigrationLive
)

// Full application layer — used only when LLM features are explicitly invoked
export const AppLive = Layer.mergeAll(
  CoreServiceLive,
  LlmServiceLive,
  MigrationLive
)
```

### Critical: When to Use Which Layer

| Layer | When | Example |
|-------|------|---------|
| `AppMinimalLive` | All core CLI commands, MCP server startup | `tx add`, `tx ready`, `tx show`, `tx done`, all MCP tools |
| `AppLive` | Only when LLM features are explicitly invoked | `tx dedupe`, `tx compact`, `tx reprioritize` |

The MCP server MUST use `AppMinimalLive` at startup. It should lazy-load LLM services only when dedupe/compact tools are called.

### Layer Composition for Testing

```typescript
// Test layer with in-memory SQLite
export const TestLayer = (db: Database.Database) =>
  Layer.mergeAll(
    Layer.succeed(SqliteClient, db),
    IdGeneratorLive
  ).pipe(
    Layer.provideMerge(RepositoryLive),
    Layer.provideMerge(CoreServiceLive)
  )
```

---

## Error Handling

### Tagged Error Types

```typescript
// src/errors/index.ts
import { Data } from "effect"

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  readonly id: string
}> {
  get message() { return `Task not found: ${this.id}` }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly reason: string
}> {
  get message() { return `Validation error: ${this.reason}` }
}

export class CircularDependencyError extends Data.TaggedError("CircularDependencyError")<{
  readonly taskId: string
  readonly blockerId: string
}> {
  get message() { return `Circular dependency: ${this.taskId} ↔ ${this.blockerId}` }
}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown
}> {
  get message() { return `Database error: ${this.cause}` }
}

export type TaskError =
  | TaskNotFoundError
  | ValidationError
  | CircularDependencyError
  | DatabaseError
```

### Error Handling in CLI

```typescript
// Map errors to exit codes
const handleError = (error: TaskError): Effect.Effect<never> => {
  switch (error._tag) {
    case "TaskNotFoundError":
      return Console.error(error.message).pipe(Effect.flatMap(() => Effect.fail(ExitCode(2))))
    case "ValidationError":
      return Console.error(error.message).pipe(Effect.flatMap(() => Effect.fail(ExitCode(1))))
    default:
      return Console.error(error.message).pipe(Effect.flatMap(() => Effect.fail(ExitCode(1))))
  }
}
```

---

## Effect.sync vs Effect.try (Bug Scan Finding)

### The Problem

`Effect.sync` assumes the wrapped function is **pure and cannot throw**. If the function throws, the error is not caught and propagates as a defect (unrecoverable).

`Effect.try` (or `Effect.tryPromise`) wraps functions that **may throw** and converts exceptions into typed failures.

### Common Mistake

```typescript
// WRONG: JSON.parse can throw
const parseConfig = (raw: string) =>
  Effect.sync(() => JSON.parse(raw))

// WRONG: Database operations can throw
const getUser = (id: string) =>
  Effect.sync(() => db.prepare("SELECT * FROM users WHERE id = ?").get(id))
```

### Correct Usage

```typescript
// CORRECT: Use Effect.try for operations that may throw
const parseConfig = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw),
    catch: (error) => new ParseError({ cause: error })
  })

// CORRECT: Use Effect.try for database operations
const getUser = (id: string) =>
  Effect.try({
    try: () => db.prepare("SELECT * FROM users WHERE id = ?").get(id),
    catch: (error) => new DatabaseError({ cause: error })
  })

// CORRECT: Effect.sync is fine for pure computations
const calculateScore = (base: number, multiplier: number) =>
  Effect.sync(() => base * multiplier)
```

### Guidelines

| Use | When |
|-----|------|
| `Effect.sync` | Pure computations, accessing already-validated data, no I/O |
| `Effect.try` | JSON parsing, file I/O, database queries, external calls |
| `Effect.tryPromise` | Async operations that may reject |
| `Effect.succeed` | Wrapping a known value |

### Service Layer Convention

All repository methods that interact with SQLite MUST use `Effect.try`:

```typescript
readonly findById: (id: TaskId) => Effect.Effect<Task | null, DatabaseError>

// Implementation
findById: (id) =>
  Effect.try({
    try: () => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id),
    catch: (e) => new DatabaseError({ cause: e })
  }).pipe(
    Effect.map((row) => row ? rowToTask(row) : null)
  )
```

---

## Repository Pattern

```typescript
// src/repositories/TaskRepository.ts
export class TaskRepository extends Context.Tag("TaskRepository")<
  TaskRepository,
  {
    readonly insert: (task: Task) => Effect.Effect<void, DatabaseError>
    readonly update: (task: Task) => Effect.Effect<void, DatabaseError>
    readonly delete: (id: TaskId) => Effect.Effect<void, DatabaseError>
    readonly findById: (id: TaskId) => Effect.Effect<Task | null, DatabaseError>
    readonly findByIds: (ids: readonly TaskId[]) => Effect.Effect<readonly Task[], DatabaseError>
    readonly findAll: (filter?: TaskFilter) => Effect.Effect<readonly Task[], DatabaseError>
    readonly findByParent: (parentId: TaskId | null) => Effect.Effect<readonly Task[], DatabaseError>
    readonly getChildIds: (id: TaskId) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly count: (filter?: TaskFilter) => Effect.Effect<number, DatabaseError>
  }
>() {}

// src/repositories/DependencyRepository.ts
export class DependencyRepository extends Context.Tag("DependencyRepository")<
  DependencyRepository,
  {
    readonly insert: (blockerId: TaskId, blockedId: TaskId) => Effect.Effect<void, DatabaseError>
    readonly delete: (blockerId: TaskId, blockedId: TaskId) => Effect.Effect<void, DatabaseError>
    readonly getBlockerIds: (blockedId: TaskId) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getBlockingIds: (blockerId: TaskId) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getAll: () => Effect.Effect<readonly TaskDependency[], DatabaseError>
    readonly exists: (blockerId: TaskId, blockedId: TaskId) => Effect.Effect<boolean, DatabaseError>
  }
>() {}
```

---

## Testing Strategy

### Service Layer Tests (Integration)

Each service must have integration tests that verify the full Effect pipeline against a real in-memory SQLite database.

```typescript
describe("TaskService", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
  })

  it("create returns Task with valid ID and backlog status", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "New task", score: 500 })
      }).pipe(Effect.provide(TestLayer(db)))
    )

    expect(task.id).toMatch(/^tx-[a-z0-9]{6,8}$/)
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(500)
  })

  it("getWithDeps returns TaskWithDeps with blockedBy, blocks, children, isReady", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.getWithDeps(FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(TestLayer(db)))
    )

    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")
    expect(Array.isArray(task.blockedBy)).toBe(true)
    expect(Array.isArray(task.blocks)).toBe(true)
    expect(Array.isArray(task.children)).toBe(true)
  })

  it("get fails with TaskNotFoundError for missing ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.get("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(TestLayer(db)), Effect.either)
    )

    expect(result._tag).toBe("Left")
    expect(result.left._tag).toBe("TaskNotFoundError")
  })

  it("update sets completedAt when status becomes done", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(FIXTURES.TASK_LOGIN, { status: "done" })
      }).pipe(Effect.provide(TestLayer(db)))
    )

    expect(task.status).toBe("done")
    expect(task.completedAt).not.toBeNull()
  })

  it("create fails with ValidationError for empty title", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "" })
      }).pipe(Effect.provide(TestLayer(db)), Effect.either)
    )

    expect(result._tag).toBe("Left")
    expect(result.left._tag).toBe("ValidationError")
  })

  it("create fails with ValidationError for nonexistent parent", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "Task", parentId: "tx-nonexist" })
      }).pipe(Effect.provide(TestLayer(db)), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })
})
```

### DependencyService Tests (Integration)

```typescript
describe("DependencyService", () => {
  it("addBlocker succeeds for valid tasks", async () => {
    const db = createTestDb()
    seedFixtures(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(FIXTURES.TASK_LOGIN, FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(TestLayer(db)))
    )

    // Verify in DB
    const deps = db.prepare("SELECT * FROM task_dependencies WHERE blocked_id = ?").all(FIXTURES.TASK_LOGIN)
    expect(deps.length).toBeGreaterThan(0)
  })

  it("addBlocker fails with CircularDependencyError for cycles", async () => {
    const db = createTestDb()
    seedFixtures(db)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED)
      }).pipe(Effect.provide(TestLayer(db)), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })

  it("addBlocker fails with ValidationError for self-blocking", async () => {
    const db = createTestDb()
    seedFixtures(db)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(TestLayer(db)), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })
})
```

### Error Type Tests (Unit)

```typescript
describe("Error Types", () => {
  it("TaskNotFoundError has correct tag", () => {
    const err = new TaskNotFoundError({ id: "tx-abc123" })
    expect(err._tag).toBe("TaskNotFoundError")
    expect(err.message).toContain("tx-abc123")
  })

  it("ValidationError has correct tag", () => {
    const err = new ValidationError({ reason: "title too long" })
    expect(err._tag).toBe("ValidationError")
    expect(err.message).toContain("title too long")
  })

  it("CircularDependencyError has correct tag", () => {
    const err = new CircularDependencyError({ taskId: "tx-aaa", blockerId: "tx-bbb" })
    expect(err._tag).toBe("CircularDependencyError")
    expect(err.message).toContain("tx-aaa")
    expect(err.message).toContain("tx-bbb")
  })
})
```

### Layer Composition Tests (Integration)

```typescript
describe("Layer Composition", () => {
  it("TestLayer resolves all core services", async () => {
    const db = createTestDb()

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TaskService
        yield* ReadyService
        yield* DependencyService
      }).pipe(Effect.provide(TestLayer(db)))
    )
  })

  it("AppMinimalLive works without Anthropic client", async () => {
    // Should not require ANTHROPIC_API_KEY
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TaskService
        yield* ReadyService
      }).pipe(Effect.provide(AppMinimalLive))
    )
  })
})
```

---

## Logging Strategy

All services emit structured JSON logs via the `Telemetry` service:

```typescript
// Example structured log entry
{
  "timestamp": "2024-01-15T10:00:00.000Z",
  "level": "info",
  "message": "Task created",
  "taskId": "tx-a1b2c3d4",
  "title": "Implement auth",
  "score": 800,
  "parentId": null,
  "traceId": "abc123..."  // Populated when OTEL is enabled
}
```

### Log Levels

| Level | When |
|-------|------|
| `error` | Operation failed (DB error, validation error, cycle detected) |
| `warn` | Degraded operation (LLM unavailable, OTEL exporter down) |
| `info` | Normal lifecycle events (task created, task done, ready query) |
| `debug` | Verbose (SQL queries, LLM prompts) — only when `LOG_LEVEL=debug` |

### Logging Without OTEL

When OTEL is not configured, errors still go to `stderr`. Info/debug are silent unless `LOG_LEVEL` is explicitly set.

---

## Related Documents

- [DD-001: Data Model & Storage](./DD-001-data-model-storage.md)
- [DD-003: CLI Implementation](./DD-003-cli-implementation.md)
- [DD-004: Ready Detection Algorithm](./DD-004-ready-detection-algorithm.md)
- [DD-007: Testing Strategy](./DD-007-testing-strategy.md)
- [DD-008: OpenTelemetry Integration](./DD-008-opentelemetry-integration.md)
