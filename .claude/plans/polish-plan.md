# tx Codebase Polish Plan

## Summary

Based on exploration of the codebase and user-reported issues, this plan addresses **3 categories** of issues:

1. **Dashboard Bugs** (user-reported, high priority)
2. **PRD Implementation Gap** (PRD-006 not implemented)
3. **Code Quality Issues** (from exploration)

---

## Priority 1: Dashboard Bugs (User-Reported)

### Bug 1: "No conversation transcript available"

**Root Cause**: Two issues compound:
1. `validatePathWithinTx()` in `apps/dashboard/server/index.ts:22-28` only allows paths within `.tx/` directory
2. Claude Code stores transcripts at `~/.claude/projects/...` which fails validation
3. Server returns `{ run, transcript }` (raw string) but client expects `{ run, messages: ChatMessage[] }`

**Files to Modify**:
- `apps/dashboard/server/index.ts` - Lines 22-28, 546-555

**Fix**:
1. Update `validatePathWithinTx()` to also allow `~/.claude/projects/` paths (with proper security checks)
2. Parse JSONL transcript into `ChatMessage[]` array format before returning
3. Match the `RunDetailResponse` interface expected by the client

### Bug 2: "No task" for runs in dashboard

**Root Cause**:
1. Runs stored with `task_id` but no task title lookup performed
2. `RunsList.tsx:98-104` shows "No task" when `taskTitle` is missing
3. API never joins with tasks table to get the title

**Files to Modify**:
- `apps/dashboard/server/index.ts` - Lines 420-445 (runs list query)
- `apps/api-server/src/routes/runs.ts` - Lines 196-269 (listRunsRoute handler)

**Fix**:
1. Join runs with tasks table: `LEFT JOIN tasks ON runs.task_id = tasks.id`
2. Return `taskTitle` field from joined query
3. Ensure snake_case consistency (`task_id`, not `taskId`) in API response

---

## Priority 2: PRD-006 Implementation Gap

**Status**: NOT IMPLEMENTED (DOCTRINE RULE 2 violation)

PRD-006 specifies `tx compact` and `tx history` commands for:
- Archiving completed tasks with summaries
- Exporting learnings to `CLAUDE.md` for persistence

**Files to Create**:
- `packages/core/src/services/compaction-service.ts` - CompactionService implementation
- `apps/cli/src/commands/compact.ts` - CLI commands

**Files to Modify**:
- `apps/cli/src/cli.ts` - Register compact/history commands
- `packages/core/src/layer.ts` - Add CompactionService to layer

**Reference**: `docs/design/DD-006-llm-integration.md` contains the interface specification

---

## Priority 3: Code Quality Issues (from exploration)

### Critical Issues

| Issue | File | Fix |
|-------|------|-----|
| Missing transactions in bulk ops | `packages/core/src/repo/task-repo.ts` | Wrap bulk operations in transactions |
| Silent JSON parse failures | `apps/cli/src/cli.ts` | Add error handling around JSON.parse |
| Type casts without validation | Multiple files | Add runtime validation with Zod |
| Race condition in chaos utils | `packages/test-utils/src/chaos/` | Add mutex/locking |

### Moderate Issues

| Issue | File | Fix |
|-------|------|-----|
| Factory counter not reset | `packages/test-utils/src/factories/` | Add `resetCounters()` function |
| Missing cursor boundary tests | `test/integration/pagination.test.ts` | Add edge case tests |
| Inconsistent error handling | `apps/api-server/src/routes/*.ts` | Use Effect-TS error types |

---

## Implementation Order

1. **Phase 1: Dashboard Fixes** (immediate user impact)
   - Fix transcript loading (Bug 1)
   - Fix task title display (Bug 2)

2. **Phase 2: PRD-006 Implementation**
   - Create CompactionService
   - Implement `tx compact` and `tx history`
   - Ensure learnings export to CLAUDE.md

3. **Phase 3: Code Quality**
   - Add missing transactions
   - Improve error handling
   - Fix race conditions in test utils

---

## Verification

### Dashboard Fixes
```bash
# Start servers
bun run --cwd apps/api-server dev &
bun run --cwd apps/dashboard dev &

# Verify transcript loading
curl http://localhost:5173/api/runs/<run-id> | jq '.messages'

# Verify task titles appear in run list
curl http://localhost:5173/api/runs | jq '.runs[].taskTitle'
```

### PRD-006
```bash
# Verify commands exist
bun apps/cli/src/cli.ts compact --help
bun apps/cli/src/cli.ts history --help

# Verify learnings export
bun apps/cli/src/cli.ts compact
grep "Agent Learnings" CLAUDE.md
```

### Tests
```bash
bun run test
```

---

## Critical Files Summary

| File | Changes |
|------|---------|
| `apps/dashboard/server/index.ts` | Fix path validation, add task title join, parse transcript |
| `apps/api-server/src/routes/runs.ts` | Add task title to response |
| `packages/core/src/services/compaction-service.ts` | CREATE - PRD-006 |
| `apps/cli/src/commands/compact.ts` | CREATE - PRD-006 |
| `packages/core/src/repo/task-repo.ts` | Add transactions to bulk ops |
