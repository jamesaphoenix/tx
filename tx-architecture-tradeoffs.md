# tx Architecture Tradeoffs

Three questions evaluated with research from the codebase.

---

## 1. Should every service have a repository?

**Current state:** 16 repos, 36 services. 15 repos have matching services. 21 services have NO repo.

### The Pattern Today

```
Service (business logic) → Repo (SQL wrapper) → SqliteClient
```

Works well for CRUD-heavy domains (task, learning, anchor, edge).

### Where It Breaks

7 services bypass repos entirely and talk to SQLite directly:
- **sync-service** (bulk imports, transactions)
- **validation-service** (PRAGMA integrity_check)
- **migration-service** (schema migrations)
- **compaction-service** (bulk delete + archive)
- **anchor-verification** (bulk status updates)
- **auto-sync-service** (triggers on file changes)
- **orchestrator-service** (singleton state machine)

These don't fit CRUD. They're transactional, bulk, or schema-aware.

### Thin Wrapper Problem

Some repos are trivially thin:
- **file-learning-repo** (108 lines): 6 prepared statements, no logic
- **attempt-repo** (146 lines): 7 prepared statements, no logic
- **dep-service** (51 lines): just validation + delegation

For these, the repo adds indirection without value.

### Tradeoffs

| Keep repo-per-service | Merge thin repos into services |
|---|---|
| Consistent pattern everywhere | Less indirection for simple cases |
| Easy to test repos in isolation | Fewer files to maintain |
| Clear separation of concerns | Services already know SQL semantics |
| 16 extra files | Risk of business logic mixing with data access |

### Recommendation

**Keep repos for complex domains** (task, learning, anchor, edge, claim) where the SQL layer has real logic (batch operations, prepared statement caching, type mapping).

**Consider merging trivial repos** (file-learning, attempt, tracked-project) into their services. The 108-line file-learning-repo wrapping 6 SQL calls adds no value over inline prepared statements.

**Don't force repos on non-CRUD services.** sync-service, migration-service, validation-service correctly bypass repos because their operations don't map to entity CRUD.

---

## 2. Should packages/types use Effect Schema instead of plain interfaces?

**Current state:** 13 files, ~2,100 lines. Zero external dependencies. 123 files depend on it.

### What You Have Now

- **75% pure types** (interfaces, branded types)
- **25% runtime** (const arrays, validators, serializers)
- **Hand-written boilerplate** for each domain entity:
  - Const array of valid values
  - Union type derived from array
  - Type guard function (isValidX)
  - Assertion function (assertX)
  - Custom error class (InvalidXError)
  - Serializer function (serializeX)

Example: TaskStatus + TaskId = **40+ lines of boilerplate**.

### What Effect Schema Gives You

Same thing in ~6 lines:

```typescript
const TaskStatus = Schema.Literal("backlog", "ready", ...)
type TaskStatus = typeof TaskStatus.Type

const TaskId = Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,8}$/),
  Schema.brand("TaskId")
)
type TaskId = typeof TaskId.Type
```

Validators, type guards, error formatting - all derived automatically.

### Key Facts

- `@effect/schema` is now **built into `effect`** (archived as standalone Jan 2025)
- tx already mandates Effect-TS (DOCTRINE RULE 5)
- Every consumer of packages/types already depends on `effect`
- Effect Schema gives you **two types per schema**: `Type` (runtime) and `Encoded` (wire format)
- This kills the entire serializer layer (serializeTask, TaskWithDepsSerialized)
- Schema.Date does bidirectional string<->Date conversion automatically
- JSONSchema.make() generates JSON Schema for API docs
- Integrates directly with @effect/platform HttpApi for OpenAPI

### Tradeoffs

| Keep plain interfaces | Use Effect Schema |
|---|---|
| Zero runtime deps (but all consumers already have effect) | Depends on effect (already required) |
| Simple, familiar TypeScript | Learning curve for Schema combinators |
| Manual validators (~500 lines boilerplate) | Validators derived automatically |
| Separate serializer layer needed | Bidirectional encoding built-in |
| ~2,100 lines | ~800 lines (estimated 60% reduction) |
| No ecosystem lock-in | Deeper Effect commitment |

### Gotchas

1. **Verbose for trivial types**: `interface Cursor { score: number; id: string }` is 2 lines. Schema equivalent is 5+.
2. **Union discrimination**: Schema.Union doesn't always produce discriminated unions.
3. **Schema.extends limitations**: Known issues extending transformation schemas.
4. **Bidirectional contract**: encode(decode(x)) must equal x, or subtle bugs.
5. **No ISO datetime validator**: Schema.Date parses to Date object (good), but if you want validate-as-string, need custom refinement.

### Recommendation

**Yes, migrate.** The "zero runtime dependencies" selling point protects nobody - every consumer already imports `effect`. You'd eliminate ~1,300 lines of hand-written validators and serializers, and gain automatic JSON Schema generation for the API.

**Phase it:** Start with task.ts (highest impact), then learning.ts, then the rest.

---

## 3. Should you add an ESLint rule to ban console.log?

**Current state:** 761 console calls across the codebase.

### Breakdown

| Location | Count | Legitimate? |
|---|---|---|
| CLI commands | 658 | YES - user-facing output |
| Tests | 62 | YES - performance analysis output |
| API/MCP startup | 14 | YES - server lifecycle messages |
| **Services layer** | **4** | **NO - should be Effect.log** |

### The 4 Problematic Calls

1. `anchor-verification.ts:925,968,1016` - console.error in error handlers
2. `auto-sync-service.ts:94` - console.error for export failures
3. `learning-service.ts:224` - console.error for batch abort
4. `worker-process.ts:115` - console.log in signal handler

These bypass the Effect.log abstraction, which means:
- No OpenTelemetry integration (violates DOCTRINE RULE 6)
- No structured logging
- Can't be caught by monitoring

### Tradeoffs

| Ban console.log everywhere | Ban only in services |
|---|---|
| Consistent, no exceptions | CLI legitimately needs console.log |
| Forces proper logging abstraction | Less friction for CLI development |
| Requires CLI output abstraction | Only catches the real problems |
| 658 CLI calls to refactor | 4 calls to fix |

### Recommendation

**Don't ban console.log globally.** The CLI's job is to print to stdout. 86.5% of console calls are legitimate CLI output.

**DO ban it in services/ and repo/ directories:**

```javascript
// ESLint rule: tx/no-console-in-services
'no-console': ['error', {
  allow: [] // nothing allowed
}]
// Applied only to: packages/core/src/services/**, packages/core/src/repo/**
```

This catches the 4 real violations without disrupting CLI development. If you later add a CLI output abstraction, you can extend the ban.

**Quick fix for now:** Replace those 4 calls with Effect.log / Effect.logError. That's 10 minutes of work, no ESLint rule needed.
