# All Uncommitted Changes — Full Summary

**92 files changed** | +1,788 / -1,252 lines

---

## 1. Orchestration Status Layer (NEW FEATURE)

The biggest change. Adds a computed second layer of status (`orchestrationStatus`) alongside workflow status, derived from the `task_claims` table at enrichment time. **Not stored in the database** — computed on the fly.

### New Types (`packages/types/`)

- **`task.ts`**: Added `ORCHESTRATION_STATUSES` array, `OrchestrationStatusSchema`, `OrchestrationStatus` type. Values: `"unclaimed"`, `"claimed"`, `"running"`, `"lease_expired"`, `"released"`.
- **`task.ts`**: Extended `TaskWithDepsSchema` with 4 new fields:
  - `orchestrationStatus: NullOr(OrchestrationStatusSchema)` — null when claims not in use
  - `claimedBy: NullOr(String)` — worker ID
  - `claimExpiresAt: NullOr(DateFromSelf)` — lease expiry
  - `failedAttempts: Number (int)` — from AttemptService
- **`response.ts`**: Mirrored fields in `TaskWithDepsSerializedSchema` (Date -> ISO string for claimExpiresAt). Updated `serializeTask()`.
- **`index.ts`**: Exports `ORCHESTRATION_STATUSES`, `OrchestrationStatusSchema`, `OrchestrationStatus`.

### Core Logic (`packages/core/`)

- **`services/task-service/internals.ts`**: Added `deriveOrchestrationStatus()` — pure function that maps claim state to orchestration status. Updated `enrichWithDeps()` (single task) and `enrichWithDepsBatch()` (batch) to optionally resolve claims and failed attempts, populating the 4 new fields. When `claimRepo` is absent, returns `null` (not `"unclaimed"`).
- **`repo/claim-repo.ts`**: Added 4 new repository methods:
  - `findActiveByTaskIds()` — batch fetch active claims
  - `findLatestByTaskId()` — most recent non-completed claim (single)
  - `findLatestByTaskIds()` — batch version using `MAX(id)` subquery
  - All use `chunkBySqlLimit()` for safe IN clause sizes
- **`services/claim-service.ts`**: Added `getActiveClaimsForTasks()` batch method.
- **`services/ready-service.ts`**: Multiple changes:
  - Resolves `ClaimRepository` and `AttemptRepository` via `Effect.serviceOption` (optional)
  - `getReadyImpl`: `now` timestamp captured before pagination loop (was inside enrichment phase)
  - Added `MAX_PAGES = 50` cap to prevent unbounded scans
  - Sort tie-breaking now uses `a.id.localeCompare(b.id)` to match DB's `ORDER BY score DESC, id ASC`
  - Final enrichment phase batch-fetches claims + failed attempts for response set
  - `readyAndClaim`: Uses `deriveOrchestrationStatus()` instead of hardcoded `"claimed"`
- **`services/task-service.ts`**: Updated to pass `claimRepo` and `attemptRepo` to enrichment functions.

### CLI (`apps/cli/`)

- **`commands/task.ts`**: Removed redundant `AttemptService` query from `ready` command — now uses `task.failedAttempts` directly from enriched results instead of separate overlay.
- **`output.ts`**: Added orchestration status formatting.
- **`help.ts`**: Updated `tx show` description to mention orchestration status. Updated `tx claim` to mention `orchestrationStatus`. Changed gate description from "Human-in-the-loop phase gates" to "Phase gates (approval checkpoints)".

### Dashboard (`apps/dashboard/`)

- **`TaskCard.tsx`**: Added `OrchestrationBadge` component with color-coded badges (cyan=claimed, yellow=running, red=lease_expired). Shows next to status badge when not `null`/`"unclaimed"`.
- **`TaskDetail.tsx`**: Added `OrchestrationBadge` + full orchestration section in sidebar showing worker ID, lease expiry, and failed attempts count. Defensive null check on `failedAttempts`.
- **`TaskPropertySelects.tsx`**: Updates for label display.
- **`api/client.ts`**: Updated TypeScript types with orchestration fields.
- **`server/index.ts`**: Server-side updates for new fields.
- **Tests**: Updated `TaskCard.test.tsx` (74+ lines), `TaskDetail.test.tsx` (205+ lines), `TasksPage.test.tsx`, `TaskList.test.tsx`, and others with orchestration field mocks.

### MCP Server (`apps/mcp-server/`)

- **`tools/claim.ts`**: Added `instanceof Date` guards on 3 `.toISOString()` calls (prevents TypeError if value is string). Updated tool descriptions to mention `orchestrationStatus`.
- **`tools/task.ts`**: Minor description updates.

### Agent SDK (`apps/agent-sdk/`)

- **`client.ts`**: Added orchestration fields to task serialization. Fixed dead `?? null` on `claimExpiresAt`.
- **`types.ts`**: Extended `SerializedTaskWithDeps` interface with 4 new fields.

### API Server (`apps/api-server/`)

- **`api.ts`**: Added orchestration field handling.
- **`routes/docs.ts`**: Doc route updates.

---

## 2. Docs Path Migration (`docs/` -> `specs/`)

All internal documentation moved from `docs/` to `specs/`:

- **CLAUDE.md**: All `docs/design/DD-*.md` links updated to `specs/design/DD-*.md`, same for `docs/prd/PRD-*.md`.
- **specs/index.md**: Simplified from 247-line verbose index to 25-line clean table format.
- **Flow tests**: `triangle-approval-flows.test.ts` and `docs-code-spec-detection.test.ts` updated: `path = ".tx/docs"` -> `path = "specs"`, `.tx/docs/prd/` -> `specs/prd/`.
- **help.ts**: `.tx/docs/prd/` path in examples -> `specs/prd/`.
- **eslint-plugin-tx**: Updated doc path references in rules and tests.
- **Multiple test files**: Updated doc path references (~15 test files).

---

## 3. Agent-First Relabeling

- **`help.ts` line 6**: `"Task management for AI agents and humans"` -> `"Headless task infrastructure for AI agents"`
- **`help.ts` gate command**: `"Human-in-the-loop phase gates"` -> `"Phase gates (approval checkpoints)"`
- **`apps/cli/src/templates/claude/CLAUDE.md`**: Agent-first template updates.
- **`apps/cli/src/templates/codex/AGENTS.md`**: Mirror of CLAUDE.md template changes.
- **Root `AGENTS.md`**: Agent-first language updates (46 lines changed).
- **`apps/docs/content/docs/getting-started.mdx`**: Minor language updates.
- **`apps/docs/content/docs/primitives/docs.mdx`**: Agent-first language.

---

## 4. Flow Test Timeout Fix (CI FIX)

- **`triangle-approval-flows.test.ts`**: Added `FLOW_TEST_TIMEOUT` (120s CI / 60s local) and passed it as `{ timeout: FLOW_TEST_TIMEOUT }` to `describe()` block. Tests were timing out at vitest's default 10s because each spawns 10-20+ CLI commands via `spawnSync`.
- **`docs-code-spec-detection.test.ts`**: Same fix.

---

## 5. Integration Test Updates

- **`api-contract-validator.test.ts`**: Extended `SerializedTask` and `validateTaskContract` with validation for all 4 orchestration fields + rejection of legacy `failedAttemptCount`.
- **`interface-parity.test.ts`**: 148+ lines added — orchestration fields in NormalizedTask, serialization, MCP runtime, and API test app. Includes claim derivation queries.
- **`orchestration-status.test.ts`** (from previous work): 5 new integration tests for lease expiry, serialization round-trip, released claims, readyAndClaim exclusion, batch enrichment.
- **~15 other test files**: Updated mock objects with new orchestration fields (`orchestrationStatus: null, claimedBy: null, claimExpiresAt: null, failedAttempts: 0`).

---

## 6. Spec/Design Doc Updates

- **`specs/design/DD-025-task-assignment-settings.md`**: Streamlined (-358/+lines net reduction).
- **`specs/design/DD-031-ears-requirements.md`**: Streamlined.
- **`specs/design/DD-033-spec-test-traceability.md`**: Streamlined.
- **`specs/prd/PRD-025-task-assignment-settings.md`**: Updated.
- **`specs/prd/PRD-031-ears-requirements.md`**: Updated.
- **`specs/prd/PRD-033-spec-test-traceability.md`**: Updated.

---

## 7. Misc

- **`packages/core/src/utils/toml-config.ts`**: Config path updates.
- **`packages/core/src/utils/doc-renderer.ts`**: 6 lines added.
- **`packages/core/src/internal/doc-service-impl.ts`**: Minor doc service changes.
- **`packages/core/src/services/swarm-verification.ts`**: 2-line change.
- **`packages/core/src/repo/task-repo/read.ts`**: 11-line query adjustment.
- **`apps/docs/.source/server.ts`**: Source path update.
- **`.claude/skills/verify-build/SKILL.md`**: 4-line update.
- **`.tx/streams/.../events-2026-03-12.jsonl`**: Stream events (10 lines).
- **CLAUDE.md**: Added Orchestration Status section to Quick Reference, updated all `docs/` links to `specs/`.

---

## Summary by Area

| Area | Files | Net Lines |
|------|-------|-----------|
| Core types + services | 14 | +243 |
| Dashboard UI + tests | 21 | +435 |
| CLI + MCP + Agent SDK + API | 17 | +61 |
| Integration tests | 28 | +186 |
| Docs/specs/config | 11 | -399 |
| Root CLAUDE.md/AGENTS.md | 1 | ~0 (rewording) |
| **Total** | **92** | **+536 net** |
