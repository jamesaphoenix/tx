# Orchestration Status Layer — Work Summary

## Overview

Quality assurance pass over the "Agent-First UX Relabeling + Orchestration Status Layer" feature. 13 code fixes applied across 3 review rounds, plus 5 new integration tests. All changes reviewed by 7 specialized agent swarms.

---

## Fixes Applied

### Fix 1: `readyAndClaim` used hardcoded status instead of derivation function
**File:** `packages/core/src/services/ready-service.ts`
**Problem:** `readyAndClaim` hardcoded `orchestrationStatus: "claimed"` instead of using `deriveOrchestrationStatus()`. This meant if a task was `active` at claim time, it would incorrectly show `"claimed"` instead of `"running"`.
**Fix:** Replaced hardcoded value with `deriveOrchestrationStatus(claim, task.status, new Date())`.

### Fix 2: `now` timestamp captured inside pagination loop
**File:** `packages/core/src/services/ready-service.ts`
**Problem:** `const now = new Date()` was inside the enrichment phase, meaning different pages could get different timestamps. In edge cases, a claim could appear valid on one page and expired on another within the same `getReady` call.
**Fix:** Moved `now` capture to before the pagination loop (line 67).

### Fix 3: `enrichWithDepsBatch` crashed when `claimRepo` absent
**File:** `packages/core/src/services/task-service/internals.ts`
**Problem:** `enrichWithDepsBatch` called `deriveOrchestrationStatus` unconditionally, but when `claimRepo` is absent (single-agent workflows), the claim map is empty and the function could return `"unclaimed"` instead of `null`.
**Fix:** Added guard: when `claimRepo` is absent, return `{ orchestrationStatus: null, claimedBy: null, claimExpiresAt: null }` directly.

### Fix 4: CLI `ready` command did redundant `AttemptService` query
**File:** `apps/cli/src/commands/task.ts`
**Problem:** The `ready` function fetched `failedAttemptCount` separately from `AttemptService` and overlaid it onto the already-enriched `TaskWithDeps` results. Since `ReadyService.getReady` already populates `failedAttempts`, this was redundant work and a potential data inconsistency.
**Fix:** Removed the separate `AttemptService` query and `failedAttemptCount` overlay. Now uses `task.failedAttempts` directly from the enriched results.

### Fix 5: `deriveOrchestrationStatus` "completed" branch undocumented
**File:** `packages/core/src/services/task-service/internals.ts`
**Problem:** The `completed` claim status branch returned `"unclaimed"` but had no documentation explaining why. Code reviewers flagged it as potentially incorrect.
**Fix:** Added comment explaining this is a safety-net branch (callers typically pre-filter completed claims).

### Fix 6: Sort tie-breaking inconsistent with DB ordering
**File:** `packages/core/src/services/ready-service.ts`
**Problem:** In-memory sort used `a.id.localeCompare(b.id)` for tie-breaking, but the DB query uses `ORDER BY score DESC, id ASC`. While `localeCompare` and SQL `ASC` usually agree for `tx-[hex]` IDs, locale-sensitive sorting could theoretically diverge.
**Fix:** Confirmed `localeCompare` matches for the ID format used. Added comment documenting the sort contract matches DB's `ORDER BY score DESC, id ASC`.

### Fix 7: Dashboard `TaskCard` crashed on unknown orchestration status
**File:** `apps/dashboard/src/components/tasks/TaskCard.tsx`
**Problem:** The `OrchestrationBadge` component's style lookup had no fallback. If a new orchestration status was added, the component would render with `undefined` className.
**Fix:** Added fallback: `styles[status] ?? "bg-gray-500 text-gray-200"`.

### Fix 8: Dashboard `TaskDetail` same missing fallback
**File:** `apps/dashboard/src/components/tasks/TaskDetail.tsx`
**Problem:** Same issue as Fix 7 but in the detail panel.
**Fix:** Same fallback pattern applied.

### Fix 9: Dashboard `TaskDetail` null `failedAttempts` crash
**File:** `apps/dashboard/src/components/tasks/TaskDetail.tsx`
**Problem:** `task.failedAttempts > 0` would throw if `failedAttempts` was `null` or `undefined` (possible if API response is from an older version).
**Fix:** Changed to `(task.failedAttempts ?? 0) > 0`.

### Fix 10: MCP claim tools crashed on non-Date `leaseExpiresAt`
**File:** `apps/mcp-server/src/tools/claim.ts`
**Problem:** Three places called `.toISOString()` directly on `claim.leaseExpiresAt` without checking if it was actually a `Date` object. If the value came through as a string (e.g., from JSON deserialization), this would throw `TypeError: .toISOString is not a function`.
**Fix:** Added `instanceof Date` guards on all three `.toISOString()` calls with `String()` fallback.

### Fix 11: Agent SDK dead null-coalescing in serialization
**File:** `apps/agent-sdk/src/client.ts`
**Problem:** `claimExpiresAt` serialization had `?? null` after a ternary that already handled the null case, making the coalescing dead code.
**Fix:** Simplified to clean ternary without redundant fallback.

### Fix 12: Dashboard test mock missing orchestration fields
**File:** `apps/dashboard/src/components/tasks/__tests__/TasksPage.test.tsx`
**Problem:** Inline mock task object didn't include the new orchestration fields (`orchestrationStatus`, `claimedBy`, `claimExpiresAt`, `failedAttempts`), causing TypeScript compilation errors and potential test failures.
**Fix:** Added all 4 orchestration fields plus related fields (`isReady`, `groupContext`, `effectiveGroupContext`, `effectiveGroupContextSourceTaskId`).

### Fix 13: API contract validator missing orchestration validation
**File:** `test/integration/api-contract-validator.test.ts`
**Problem:** The contract validator that checks all API responses for structural correctness didn't validate the 4 new orchestration fields. This meant broken serialization could pass contract tests.
**Fix:** Extended `SerializedTask` interface and `validateTaskContract` with validation for `orchestrationStatus` (must be valid enum or null), `claimedBy` (string or null), `claimExpiresAt` (ISO date string or null), `failedAttempts` (non-negative integer), and rejection of legacy `failedAttemptCount` field.

---

## New Integration Tests

**File:** `test/integration/orchestration-status.test.ts`

### Test 12: `lease_expired` wins over active status
Verifies that when a task has `status: "active"` but its claim lease has expired, the orchestration status is `"lease_expired"` (not `"running"`). This catches a priority inversion bug.

### Test 13: `failedAttempts` serialization round-trip
Records 3 failed attempts via `AttemptService`, then verifies `failedAttempts: 3` survives the full `enrichWithDeps` → `serializeTask` chain. Catches serialization bugs where the field gets dropped or reset.

### Test 14: `getReady` returns released claim status
Claims and releases a task, then calls `getReady`. Verifies the task appears in ready results with `orchestrationStatus: "released"` (not `"unclaimed"`). Released claims are semantically different from never-claimed.

### Test 15: `readyAndClaim` excludes active tasks
Creates a task with `status: "active"`, calls `readyAndClaim`. Verifies null return — active tasks should not be claimable through the ready queue even if they have no blockers.

### Test 16: Batch enrichment with mixed released/expired claims
Tests `getWithDepsBatch` with two tasks: one with a released claim, one with an expired claim. Verifies each gets the correct orchestration status in a single batch call.

---

## Performance Issues Identified (Deferred)

| Issue | Impact | Confidence |
|-------|--------|------------|
| Correlated `NOT EXISTS` subquery in `findAll` for `excludeClaimed` | O(n) per candidate row | 95% |
| Unconditional recursive CTE for group context resolution | Runs even when no tasks use group context | 88% |
| Page size floor of 200 even when `limit=1` | Fetches 200 rows to return 1 ready task | 80% |

These are optimization opportunities, not correctness bugs. Deferred for a dedicated performance pass.

---

## Review Methodology

- **Round 1:** 2 agent swarms (core logic + test coverage)
- **Round 2:** 5 agent swarms (dashboard, MCP, agent-SDK, test gaps, architecture)
- **Round 3:** 2 agent swarms (contract validation, cross-interface parity)
- All fixes verified with existing test suite + 5 new integration tests
- No mocks — all integration tests use real in-memory SQLite via `getSharedTestLayer()`
