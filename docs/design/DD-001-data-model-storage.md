# DD-001: Data Model & Storage Architecture

**Status**: Draft
**Implements**: [PRD-001](../prd/PRD-001-core-task-management.md), [PRD-002](../prd/PRD-002-hierarchical-task-structure.md)
**Last Updated**: 2025-01-28

---

## Overview

This document describes **how** `tx` stores and structures data: SQLite schema design, Effect Schema type definitions, ID generation strategy, and data access patterns.

---

## Storage Choice: SQLite

| Considered | Pros | Cons | Decision |
|------------|------|------|----------|
| SQLite | Fast, zero-config, single file | No concurrent writes | **Selected** |
| PostgreSQL | Scalable, concurrent | Requires server | Rejected |
| JSONL files | Git-friendly, simple | Slow queries | Optional export |
| In-memory | Fastest | No persistence | Rejected |

**Rationale**: SQLite provides the best balance of speed, simplicity, and persistence for a single-project task manager. `better-sqlite3` provides synchronous operations that work well with Effect.

### SQLite Configuration

```sql
-- Enable Write-Ahead Logging for better concurrent read performance
PRAGMA journal_mode = WAL;

-- Enable foreign key enforcement (off by default in SQLite)
PRAGMA foreign_keys = ON;

-- Reasonable busy timeout for locked database
PRAGMA busy_timeout = 5000;
```

WAL mode is set once on database creation via `tx init` and persists across connections. It enables concurrent reads during writes, which matters when the MCP server is querying while the CLI is writing.

---

## Database Location

```
project/
└── .tx/
    ├── tasks.db        # SQLite database
    ├── config.json     # Optional configuration
    └── exports/        # JSON exports (optional)
```

The `.tx` directory:
- Should be gitignored by default
- Can be committed for shared task state (team preference)
- Is created by `tx init`

---

## SQLite Schema

```sql
-- Version: 001
-- Migration: initial

-- Core tasks table
CREATE TABLE tasks (
    -- Identity
    id TEXT PRIMARY KEY,                    -- Format: tx-[a-z0-9]{8} (8 hex chars = 32 bits entropy)

    -- Content
    title TEXT NOT NULL,
    description TEXT DEFAULT '',

    -- Status (enum enforced in application)
    status TEXT NOT NULL DEFAULT 'backlog'
        CHECK (status IN (
            'backlog', 'ready', 'planning', 'active',
            'blocked', 'review', 'human_needs_to_review', 'done'
        )),

    -- Hierarchy
    parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,

    -- Scoring
    score INTEGER NOT NULL DEFAULT 0,

    -- Timestamps (ISO 8601)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,

    -- Extensibility
    metadata TEXT DEFAULT '{}'              -- JSON object
);

-- Dependency relationships
CREATE TABLE task_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)        -- No self-blocking
);

-- Compaction history
CREATE TABLE compaction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compacted_at TEXT NOT NULL,
    task_count INTEGER NOT NULL,
    summary TEXT NOT NULL,
    task_ids TEXT NOT NULL,                 -- JSON array of compacted IDs
    learnings_exported_to TEXT              -- Path where learnings were written
);

-- Schema version tracking
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_score ON tasks(score DESC);
CREATE INDEX idx_tasks_created ON tasks(created_at);
CREATE INDEX idx_deps_blocker ON task_dependencies(blocker_id);
CREATE INDEX idx_deps_blocked ON task_dependencies(blocked_id);
```

### Schema Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ID format | `tx-[a-z0-9]{8}` | 8 hex chars = 32 bits entropy, prevents collisions at scale |
| Status as TEXT | CHECK constraint | SQLite lacks native enums; app also validates |
| Timestamps as TEXT | ISO 8601 strings | SQLite lacks native datetime; string sorting works |
| Metadata as TEXT | JSON blob | Flexible, no schema changes for new fields |
| parent_id ON DELETE SET NULL | Orphan children | Safer than CASCADE delete |
| blocker ON DELETE CASCADE | Auto-unblock | When blocker deleted, dependency removed |

---

## Effect Schema Definitions

### Core Schemas

```typescript
// src/schemas/task.ts
import { Schema } from "effect"

// ============ Enums ============

export const TaskStatus = Schema.Literal(
  "backlog", "ready", "planning", "active",
  "blocked", "review", "human_needs_to_review", "done"
)
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>

// ============ Task ID ============

export const TaskId = Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,8}$/),
  Schema.brand("TaskId")
)
export type TaskId = Schema.Schema.Type<typeof TaskId>

// ============ Metadata ============

export const TaskMetadata = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown
})
export type TaskMetadata = Schema.Schema.Type<typeof TaskMetadata>

// ============ Core Task ============

export class Task extends Schema.Class<Task>("Task")({
  id: TaskId,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.String,
  status: TaskStatus,
  parentId: Schema.NullOr(TaskId),
  score: Schema.Int,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  completedAt: Schema.NullOr(Schema.Date),
  metadata: TaskMetadata
}) {
  get isDone(): boolean {
    return this.status === "done"
  }
  get isWorkable(): boolean {
    return !["blocked", "done", "human_needs_to_review"].includes(this.status)
  }
}

// ============ Task with Dependencies (API response type) ============

export class TaskWithDeps extends Schema.Class<TaskWithDeps>("TaskWithDeps")({
  ...Task.fields,
  blockedBy: Schema.Array(TaskId),
  blocks: Schema.Array(TaskId),
  children: Schema.Array(TaskId),
  isReady: Schema.Boolean
}) {}
```

### Input/Query Schemas

```typescript
export const CreateTaskInput = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(TaskId)),
  score: Schema.optional(Schema.Int),
  metadata: Schema.optional(TaskMetadata)
})

export const UpdateTaskInput = Schema.Struct({
  title: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  description: Schema.optional(Schema.String),
  status: Schema.optional(TaskStatus),
  parentId: Schema.optional(Schema.NullOr(TaskId)),
  score: Schema.optional(Schema.Int),
  metadata: Schema.optional(TaskMetadata)
})

export const TaskFilter = Schema.Struct({
  status: Schema.optional(Schema.Union(TaskStatus, Schema.Array(TaskStatus))),
  parentId: Schema.optional(Schema.NullOr(TaskId)),
  hasParent: Schema.optional(Schema.Boolean),
  minScore: Schema.optional(Schema.Int),
  maxScore: Schema.optional(Schema.Int),
  createdAfter: Schema.optional(Schema.Date),
  createdBefore: Schema.optional(Schema.Date)
})

export class TaskDependency extends Schema.Class<TaskDependency>("TaskDependency")({
  id: Schema.Int,
  blockerId: TaskId,
  blockedId: TaskId,
  createdAt: Schema.Date
}) {}
```

---

## ID Generation

Hash-based IDs prevent merge conflicts in multi-agent scenarios:

```typescript
// src/utils/id.ts
import { Effect } from "effect"
import { randomBytes, createHash } from "crypto"

export const generateTaskId = (): Effect.Effect<string> =>
  Effect.sync(() => {
    // Use crypto.randomBytes for proper entropy (not Math.random)
    const random = randomBytes(16).toString("hex")
    const timestamp = Date.now().toString(36)
    const hash = createHash("sha256")
      .update(timestamp + random)
      .digest("hex")
      .substring(0, 8)  // 8 hex chars = 32 bits entropy
    return `tx-${hash}`
  })

// Deterministic ID generation for tests
export const deterministicId = (seed: string): string => {
  const hash = createHash("sha256")
    .update(`fixture:${seed}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}
```

### Why SHA256-based IDs?
- **No collisions**: 8 hex chars = 4 billion unique IDs; uses `crypto.randomBytes` not `Math.random`
- **No coordination**: Agents can generate IDs independently
- **Deterministic for tests**: `deterministicId(name)` produces same ID every run
- **Short**: `tx-a1b2c3d4` is easy to type and reference
- **Regex**: `tx-[a-z0-9]{6,8}` (6-8 chars accepted for backwards compat)

---

## Row-to-Model Conversion

```typescript
// Helper to convert DB row to Task
interface TaskRow {
  id: string
  title: string
  description: string
  status: string
  parent_id: string | null
  score: number
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: string
}

const rowToTask = (row: TaskRow): Task => ({
  id: row.id as TaskId,
  title: row.title,
  description: row.description,
  status: row.status as TaskStatus,
  parentId: row.parent_id as TaskId | null,
  score: row.score,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  completedAt: row.completed_at ? new Date(row.completed_at) : null,
  metadata: JSON.parse(row.metadata || "{}")
})
```

---

## Data Access Patterns

### Common Queries

| Query | SQL | Index Used |
|-------|-----|------------|
| List ready tasks | `WHERE status IN ('backlog','ready','planning')` | idx_tasks_status |
| Get children | `WHERE parent_id = ?` | idx_tasks_parent |
| Get blockers | `WHERE blocked_id = ?` | idx_deps_blocked |
| Top tasks by score | `ORDER BY score DESC LIMIT ?` | idx_tasks_score |

### Ready Detection Query (Optimized)

```sql
SELECT t.*,
       (SELECT COUNT(*) FROM task_dependencies d2
        WHERE d2.blocker_id = t.id) as blocking_count
FROM tasks t
WHERE t.status IN ('backlog', 'ready', 'planning')
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies d
    JOIN tasks blocker ON d.blocker_id = blocker.id
    WHERE d.blocked_id = t.id
      AND blocker.status != 'done'
  )
ORDER BY t.score DESC, blocking_count DESC, t.created_at ASC
LIMIT ?;
```

### Get Task Dependencies

```sql
-- Blockers (tasks that block this one)
SELECT t.* FROM tasks t
JOIN task_dependencies d ON d.blocker_id = t.id
WHERE d.blocked_id = ?;

-- Blocking (tasks this one blocks)
SELECT t.* FROM tasks t
JOIN task_dependencies d ON d.blocked_id = t.id
WHERE d.blocker_id = ?;

-- Children
SELECT * FROM tasks WHERE parent_id = ?;
```

---

## Status Transition Validation

Valid status transitions are enforced in the application layer:

```typescript
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog:                ["ready", "planning", "active", "blocked", "done"],
  ready:                  ["planning", "active", "blocked", "done"],
  planning:               ["ready", "active", "blocked", "done"],
  active:                 ["blocked", "review", "done"],
  blocked:                ["backlog", "ready", "planning", "active"],
  review:                 ["active", "human_needs_to_review", "done"],
  human_needs_to_review:  ["active", "review", "done"],
  done:                   ["backlog"]  // Reopen only to backlog
}

export const isValidTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  VALID_TRANSITIONS[from]?.includes(to) ?? false
```

This prevents invalid transitions like `done → active` and ensures a consistent lifecycle.

---

## Migration Strategy

```typescript
// src/migrations/index.ts
const migrations = [
  {
    version: 1,
    sql: readFileSync("migrations/001_initial.sql", "utf-8")
  }
  // Future migrations added here
]

export const runMigrations = (db: Database) => {
  // Enable WAL mode and foreign keys
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")

  const currentVersion = db.pragma("user_version") as number

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    }
  }
}
```

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| DB file permissions | Created with 0600 (owner-only read/write) |
| SQL injection | All queries use parameterized statements via @effect/sql |
| Path traversal | `--db` path validated to be within project root |
| Metadata injection | Metadata is JSON-parsed and re-serialized, not passed raw |
| API key exposure | `ANTHROPIC_API_KEY` never logged, never stored in DB |

---

## Performance Expectations

| Operation | Target | Approach |
|-----------|--------|----------|
| Insert task | <10ms | Single INSERT |
| Get by ID | <5ms | PRIMARY KEY lookup |
| List (50 tasks) | <20ms | Index scan |
| Ready detection | <100ms | Optimized query with NOT EXISTS |
| Full export (1000 tasks) | <500ms | Batch SELECT |

---

## Testing Strategy

### Schema Tests (Integration)

Test that the SQLite schema enforces all constraints correctly using a real in-memory database:

```typescript
describe("SQLite Schema", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()  // In-memory SQLite with migrations applied
  })

  it("enforces status CHECK constraint", () => {
    expect(() =>
      db.prepare("INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("tx-test01", "Test", "invalid_status", new Date().toISOString(), new Date().toISOString())
    ).toThrow()
  })

  it("enforces self-blocking CHECK constraint", () => {
    seedTask(db, "tx-aaaaaa")
    expect(() =>
      db.prepare("INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
        .run("tx-aaaaaa", "tx-aaaaaa", new Date().toISOString())
    ).toThrow()
  })

  it("enforces unique dependency constraint", () => {
    seedTask(db, "tx-aaaaaa")
    seedTask(db, "tx-bbbbbb")
    const stmt = db.prepare("INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
    stmt.run("tx-aaaaaa", "tx-bbbbbb", new Date().toISOString())
    expect(() => stmt.run("tx-aaaaaa", "tx-bbbbbb", new Date().toISOString())).toThrow()
  })

  it("cascades dependency deletion when blocker is deleted", () => {
    seedTask(db, "tx-aaaaaa")
    seedTask(db, "tx-bbbbbb")
    db.prepare("INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
      .run("tx-aaaaaa", "tx-bbbbbb", new Date().toISOString())

    db.prepare("DELETE FROM tasks WHERE id = ?").run("tx-aaaaaa")

    const deps = db.prepare("SELECT * FROM task_dependencies WHERE blocker_id = ?").all("tx-aaaaaa")
    expect(deps).toHaveLength(0)
  })

  it("orphans children when parent is deleted (SET NULL)", () => {
    seedTask(db, "tx-parent", { parent_id: null })
    seedTask(db, "tx-child1", { parent_id: "tx-parent" })

    db.prepare("DELETE FROM tasks WHERE id = ?").run("tx-parent")

    const child = db.prepare("SELECT parent_id FROM tasks WHERE id = ?").get("tx-child1")
    expect(child.parent_id).toBeNull()
  })

  it("creates all required indexes", () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
    const indexNames = indexes.map((i: any) => i.name)
    expect(indexNames).toContain("idx_tasks_status")
    expect(indexNames).toContain("idx_tasks_parent")
    expect(indexNames).toContain("idx_tasks_score")
    expect(indexNames).toContain("idx_deps_blocker")
    expect(indexNames).toContain("idx_deps_blocked")
  })
})
```

### ID Generation Tests (Unit)

```typescript
describe("generateTaskId", () => {
  it("produces valid format", async () => {
    const id = await Effect.runPromise(generateTaskId())
    expect(id).toMatch(/^tx-[a-z0-9]{6,8}$/)
  })

  it("produces unique IDs", async () => {
    const ids = await Promise.all(Array.from({ length: 100 }, () => Effect.runPromise(generateTaskId())))
    const unique = new Set(ids)
    expect(unique.size).toBe(100)
  })
})
```

### Row-to-Model Tests (Unit)

```typescript
describe("rowToTask", () => {
  it("converts ISO date strings to Date objects", () => {
    const row = { id: "tx-abc123", created_at: "2024-01-15T10:00:00.000Z", /* ... */ }
    const task = rowToTask(row)
    expect(task.createdAt).toBeInstanceOf(Date)
  })

  it("parses metadata JSON", () => {
    const row = { /* ... */ metadata: '{"key":"value"}' }
    const task = rowToTask(row)
    expect(task.metadata).toEqual({ key: "value" })
  })

  it("handles empty metadata gracefully", () => {
    const row = { /* ... */ metadata: "" }
    const task = rowToTask(row)
    expect(task.metadata).toEqual({})
  })

  it("handles null completedAt", () => {
    const row = { /* ... */ completed_at: null }
    const task = rowToTask(row)
    expect(task.completedAt).toBeNull()
  })
})
```

### Migration Tests (Integration)

```typescript
describe("Migrations", () => {
  it("applies initial migration to fresh database", () => {
    const db = new Database(":memory:")
    runMigrations(db)
    const version = db.pragma("user_version")
    expect(version).toBe(1)
  })

  it("is idempotent (running twice is safe)", () => {
    const db = new Database(":memory:")
    runMigrations(db)
    runMigrations(db)  // Should not throw
    const version = db.pragma("user_version")
    expect(version).toBe(1)
  })

  it("creates all tables", () => {
    const db = new Database(":memory:")
    runMigrations(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    const names = tables.map((t: any) => t.name)
    expect(names).toContain("tasks")
    expect(names).toContain("task_dependencies")
    expect(names).toContain("compaction_log")
    expect(names).toContain("schema_version")
  })
})
```

### Performance Tests (Integration)

```typescript
describe("Performance", () => {
  it("inserts a task in under 10ms", () => {
    const db = createTestDb()
    const start = performance.now()
    db.prepare("INSERT INTO tasks (id, title, status, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tx-perf01", "Perf test", "backlog", 0, new Date().toISOString(), new Date().toISOString())
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(10)
  })

  it("runs ready detection query under 100ms with 1000 tasks", () => {
    const db = createTestDb()
    // Seed 1000 tasks
    const insert = db.prepare("INSERT INTO tasks (id, title, status, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    const txn = db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        insert.run(`tx-p${String(i).padStart(5, "0")}`, `Task ${i}`, "backlog", i, new Date().toISOString(), new Date().toISOString())
      }
    })
    txn()

    const start = performance.now()
    db.prepare(`SELECT * FROM tasks WHERE status IN ('backlog','ready','planning') ORDER BY score DESC LIMIT 10`).all()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })
})
```

---

## Error Recovery

### DB Corruption Detection

```typescript
export const checkIntegrity = (db: Database): Effect.Effect<boolean> =>
  Effect.sync(() => {
    const result = db.pragma("integrity_check") as Array<{ integrity_check: string }>
    return result[0]?.integrity_check === "ok"
  })
```

On startup, if integrity check fails:
1. Log error with structured details
2. Attempt to open in read-only mode
3. Suggest `tx init --force` to recreate (with data loss warning)

### Locked Database

```typescript
// busy_timeout handles most cases, but for explicit retry:
export const withRetry = <A>(effect: Effect.Effect<A, DatabaseError>) =>
  effect.pipe(
    Effect.retry({
      times: 3,
      schedule: Schedule.exponential("100 millis")
    })
  )
```

---

## Related Documents

- [PRD-001: Core Task Management](../prd/PRD-001-core-task-management.md)
- [PRD-002: Hierarchical Task Structure](../prd/PRD-002-hierarchical-task-structure.md)
- [DD-002: Effect-TS Service Layer](./DD-002-effect-ts-service-layer.md)
- [DD-007: Testing Strategy](./DD-007-testing-strategy.md)
- [DD-008: OpenTelemetry Integration](./DD-008-opentelemetry-integration.md)
