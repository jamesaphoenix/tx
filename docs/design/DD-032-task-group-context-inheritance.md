# DD-032: Task Group Context Inheritance

## Overview

Implements: [PRD-032](../prd/PRD-032-task-group-context-inheritance.md)

This design adds task-group context that can be attached to a single task and inherited by related tasks in the same hierarchy (ancestors + descendants). The feature is exposed uniformly across CLI, MCP, API, and SDK.

The implementation is additive and backward-compatible:

- Existing tasks default to no group context.
- Existing commands keep behavior when no context is set.
- New fields are appended to existing task response shapes.

## Design

### Data Model

Add a nullable column on `tasks`:

```sql
ALTER TABLE tasks ADD COLUMN group_context TEXT;
```

Add an index for source lookups:

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_group_context_present
  ON tasks(id, updated_at DESC)
  WHERE group_context IS NOT NULL AND length(trim(group_context)) > 0;
```

### Domain and Serialization

Extend `TaskWithDeps` and serialized task shapes with:

- `groupContext: string | null` (direct context on this task)
- `effectiveGroupContext: string | null` (inherited winner for this task)
- `effectiveGroupContextSourceTaskId: TaskId | null`

### Repository Layer

Add `TaskRepository` operations:

- `setGroupContext(taskId, context)` updates `group_context` and `updated_at`
- `clearGroupContext(taskId)` sets `group_context = NULL` and updates `updated_at`
- `getGroupContextForMany(ids)` for direct context mapping
- `resolveEffectiveGroupContextForMany(ids)` for inherited context winner per target task

`resolveEffectiveGroupContextForMany` uses recursive CTE traversal over parent/child edges as an undirected graph. Candidate sources are tasks with non-empty `group_context`.

Sort rule for winner selection:

1. minimum `distance` (hop count)
2. `source_updated_at` descending
3. `source_id` ascending

### Service Layer

`TaskService` changes:

- Add `setGroupContext(id, context)` and `clearGroupContext(id)` public methods.
- Validate non-empty context on set.
- Include direct + effective context fields in:
  - `getWithDeps`
  - `getWithDepsBatch`
  - `listWithDeps`

`ReadyService` changes:

- `getReady` enriches results with context fields using batch repository methods.

### CLI Changes

Add commands:

- `tx group-context:set <task-id> <context> [--json]`
- `tx group-context:clear <task-id> [--json]`

Update:

- `tx show` text output to display direct/effective context fields.
- `tx ready --json` already emits full task payload; now includes new fields.

### API Changes

New endpoints in tasks group:

- `PUT /api/tasks/:id/group-context` payload `{ context: string }`
- `DELETE /api/tasks/:id/group-context`

Task-returning endpoints continue returning `TaskWithDepsSerialized`, now with new fields.

### MCP Changes

Add tools:

- `tx_group_context_set` (`taskId`, `context`)
- `tx_group_context_clear` (`taskId`)

Existing task tools return updated serialized task payload including context fields.

### SDK Changes

Add `TasksNamespace` methods:

- `setGroupContext(id, context)`
- `clearGroupContext(id)`

Extend both HTTP and direct transports accordingly.

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 1 | `migrations/028_task_group_context.sql` | Add `group_context` column + index |
| 2 | `packages/types/src/task.ts`, `packages/types/src/response.ts`, `packages/types/src/index.ts` | Add task response fields and serializers |
| 3 | `packages/core/src/repo/task-repo.ts` | Add set/clear/direct/effective context repository methods |
| 4 | `packages/core/src/services/task-service.ts`, `packages/core/src/services/ready-service.ts` | Add service methods and context enrichment |
| 5 | `apps/cli/src/commands/group-context.ts`, `apps/cli/src/cli.ts`, `apps/cli/src/help.ts`, `apps/cli/src/output.ts` | Add CLI write commands and display fields |
| 6 | `apps/api-server/src/api.ts`, `apps/api-server/src/routes/tasks.ts` | Add group-context endpoints and handlers |
| 7 | `apps/mcp-server/src/tools/task.ts` | Add MCP tools and wire service methods |
| 8 | `apps/agent-sdk/src/types.ts`, `apps/agent-sdk/src/client.ts` | Add fields + methods in HTTP/direct modes |
| 9 | `test/integration/*` | Add/extend integration and contract tests |

## Testing Strategy

### Requirement Traceability Matrix

| Requirement | Test Type | Test Name | Assertions | File Path |
|------------|-----------|-----------|------------|-----------|
| Set/clear operations exist | Integration | `sets and clears group context via CLI/API/MCP/SDK` | Calls succeed and persisted fields update | `test/integration/group-context.test.ts` |
| Ready responses include fields | Integration | `ready includes group context fields` | `groupContext`, `effectiveGroupContext`, `effectiveGroupContextSourceTaskId` present | `test/integration/group-context.test.ts` |
| Show responses include fields | Integration | `show includes effective inherited context` | fields populated correctly for a target task | `test/integration/group-context.test.ts` |
| Ancestor inheritance | Integration | `ancestor inherits descendant source` | ancestor effective source points to descendant | `test/integration/group-context.test.ts` |
| Descendant inheritance | Integration | `descendant inherits ancestor source` | descendant effective source points to ancestor | `test/integration/group-context.test.ts` |
| Tie-break by distance | Integration | `nearest source wins` | nearest source selected | `test/integration/group-context.test.ts` |
| Tie-break by recency then id | Integration | `equal distance picks newer then task id` | deterministic winner chosen | `test/integration/group-context.test.ts` |
| Interface parity | Integration | `cli/mcp/api/sdk parity for context fields` | normalized payload equality including new fields | `test/integration/interface-parity.test.ts` |
| Contract enforcement | Integration | `task contract includes group context fields` | validators require new fields | `test/integration/api-contract-validator.test.ts` |

### Unit Tests

- Repository-level winner selection and null handling for empty result sets.
- Serializer coverage for new task fields in `serializeTask`.

Target files:

- `packages/core/src/repo/task-repo.ts` tests (if repository unit tests exist)
- `packages/types/src/response.ts` serializer tests (or integration coverage if serializer unit tests are absent)

### Integration Tests

All integration tests use singleton DB pattern:

- `getSharedTestLayer()` from `@jamesaphoenix/tx-test-utils`
- deterministic IDs via `fixtureId(name)`

Scenarios:

1. Set context on a middle task; self/parent/child all resolve inherited value.
2. Set context on root only; descendants inherit.
3. Set context on leaf only; ancestors inherit.
4. Two candidate sources, different distances; nearest wins.
5. Equal distance sources with different `updatedAt`; newer source wins.
6. Equal distance and equal `updatedAt`; lexicographically smaller source task ID wins.
7. Clear active source; fallback source becomes effective.
8. No sources available; effective fields are null.
9. `tx ready` returns enriched context fields for all returned tasks.
10. `tx show` returns enriched context fields for selected task.

### Edge Cases

- Reject empty or whitespace-only context on set.
- Non-existent task ID returns not found for set/clear.
- Context with multiline content persists and returns unchanged.
- Tasks in disconnected hierarchies do not inherit across roots.

### Failure Injection

- Simulate DB write failure in set/clear and assert typed `DatabaseError` handling.
- Validate behavior when recursive query returns no candidate rows.

### Performance

- Ensure ready/list context enrichment uses batch operations, not per-task N+1 queries.
- For 100 returned tasks in a moderate hierarchy, assert response remains under existing test timeout.

## Open Questions

- [ ] Should dashboard task-edit UI expose group context in this milestone or a follow-up?
- [ ] Do we need a max persisted context length guard at schema/service level?
- [ ] Should `tx context` (learning retrieval) also incorporate effective group context text into query expansion in a future iteration?

## Migration

- Additive migration only (`028_task_group_context.sql`).
- Existing rows remain valid with `group_context = NULL`.
- No backfill required.

## References

- PRD: [PRD-032](../prd/PRD-032-task-group-context-inheritance.md)
- Related: [DD-005](DD-005-mcp-agent-sdk-integration.md), [DD-007](DD-007-testing-strategy.md)
