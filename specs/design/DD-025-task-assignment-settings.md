# Task Assignment Defaults, Settings Page, and Cmd+K Toggle

**Kind**: design
**Status**: changing
**Version**: 1

## Problem Definition

The system has robust lease-based claims but no persistent assignment intent for
human/agent routing. Dashboard task creation and triage are missing default assignment
configuration and fast editing ergonomics.

We need assignment primitives that do not prescribe orchestration, plus a headful UX
for default behavior and rapid assignment switching.

## Goals

- Add first-class assignment fields to task model and payloads
- Keep assignment soft (intent metadata), leaving claim semantics untouched
- Default dashboard-created tasks to human unless explicitly configured otherwise
- Add settings page with config persistence in `.tx/config.toml`
- Add task-context `Cmd+K` assignment type toggle with deterministic shortcut precedence
- Ship extensive test coverage across migration, services, API, and UI
- Preserve backward compatibility through nullable fields and non-breaking defaults

## Architecture

## Components

```
Dashboard UI
  ├─ Settings page (default task assignment)
  ├─ Task composer (default + edit assignment)
  ├─ Task detail (edit assignment)
  └─ CommandContext (Cmd+K toggle precedence)

Dashboard server (apps/dashboard/server/index.ts)
  ├─ GET/PATCH /api/settings
  └─ POST/PATCH /api/tasks assignment read/write

Core + Types
  ├─ Task schema + mapper + repo + service assignment fields
  ├─ TOML config reader/writer extension
  └─ Migration 024_task_assignment.sql
```

## Shortcut precedence model

1. `Cmd+K` in task context (task detail or composer), non-input focus:
   execute `toggle-assignment-type`.
2. Else: existing command palette `Cmd+K` behavior.
3. `Cmd+Shift+K` always opens/closes command palette.

This preserves rapid task triage while keeping palette accessibility deterministic.

## Data Model

## Migration: `migrations/024_task_assignment.sql`

### tasks table additions

| Column | Type | Constraints |
|--------|------|-------------|
| assignee_type | TEXT | NULL, CHECK in ('human', 'agent') |
| assignee_id | TEXT | NULL |
| assigned_at | TEXT | NULL (ISO datetime) |
| assigned_by | TEXT | NULL |

### Backfill

- Set all existing tasks to:
  - `assignee_type = 'agent'`
  - `assignee_id = NULL`
  - `assigned_at = datetime('now')`
  - `assigned_by = 'migration:024_task_assignment'`

### Indexes

- `idx_tasks_assignee_type` on `(assignee_type)`
- `idx_tasks_assignee_type_id` on `(assignee_type, assignee_id)`

## Type/schema updates

- Update Effect Schema task types in `packages/types/src/task.ts`
- Ensure all `TaskWithDeps` surfaces include assignment fields (nullable)
- Update serialization/deserialization in mapper/repo/service paths

## Invariants

| ID | Rule | Enforcement | Reference |
|-----|------|-------------|-----------|
| INV-ASSIGN-001 | Assignment metadata must never block claim/ready logic by default. (tasks) | integration_test | test/integration/assignment-flow.test.ts |
| INV-ASSIGN-002 | All task payloads returned externally include assignment fields (nullable-compatible). (tasks) | integration_test | test/integration/task-payload-parity.test.ts |
| INV-ASSIGN-003 | Dashboard default assignment fallback is always human when config is missing/invalid. (dashboard) | integration_test | apps/dashboard/src/__tests__/settings-defaults.test.tsx |
| INV-ASSIGN-004 | Cmd+K shortcut precedence is deterministic and remains palette-accessible through Cmd+Shift+K. (dashboard) | integration_test | apps/dashboard/src/__tests__/keyboard-shortcuts.test.tsx |
| INV-ASSIGN-005 | Migration 024 backfill is idempotent and safe on already-updated rows. (migrations) | integration_test | test/integration/migrations/024_task_assignment.test.ts |

## Failure Modes

| ID | Description | Mitigation |
|-----|-------------|------------|
| FM-ASSIGN-001 | Malformed `.tx/config.toml` causes settings parse failure. | Fallback to `human`, emit warning log, and keep API responsive. |
| FM-ASSIGN-002 | Invalid assignment type in task/settings payload. | Return HTTP 400 with explicit allowed enum values. |
| FM-ASSIGN-003 | Cmd+K conflicts with global palette behavior. | Apply context-aware precedence and keep Cmd+Shift+K palette fallback. |
| FM-ASSIGN-004 | Partial migration/stale schema in long-running process. | Run migration service at startup and fail early on schema mismatch. |
| FM-ASSIGN-005 | Concurrent updates overwrite assignment fields. | Use merge-safe update semantics and integration tests for concurrent edit flows. |

## Edge Cases

| ID | Description |
|-----|-------------|
| EC-ASSIGN-001 | Task has null assignment fields and receives toggle command. |
| EC-ASSIGN-002 | User presses Cmd+K while focus is inside input/textarea/select. |
| EC-ASSIGN-003 | Settings are updated while composer modal is already open. |
| EC-ASSIGN-004 | Config file exists without [dashboard] section. |
| EC-ASSIGN-005 | Both `default_task_assigment_type` and alias key exist. |
| EC-ASSIGN-006 | Legacy tasks created pre-migration contain malformed metadata JSON. |

## Work Breakdown

- Phase 1: Migration + type/schema changes
- Phase 2: Core mapper/repo/service assignment propagation
- Phase 3: TOML config read/write extension for dashboard defaults
- Phase 4: Dashboard server settings endpoints and task endpoint updates
- Phase 5: Dashboard UI settings page, composer/detail assignment controls
- Phase 6: CommandContext shortcut precedence and Cmd+K toggle behavior
- Phase 7: Full test suite expansion (unit + integration + UI regression)

## Retention

- docs: All versions retained in docs-as-primitives version chain
- config: `.tx/config.toml` remains source of truth for dashboard default assignment
- assignment audit: `assigned_at` and `assigned_by` retained on task row
- migration history: `schema_version` tracks migration 024 application

## Testing Strategy

## Unit tests

- `packages/core/src/utils/toml-config.ts`
  - parse + default behavior for missing/invalid config
  - read/write patch behavior for `[dashboard].default_task_assigment_type`
  - preservation of unrelated sections and comments
- `packages/core/src/mappers/task.ts`
  - mapping of nullable vs non-null assignment columns
  - invalid DB values handling
- `apps/dashboard/src/components/command-palette/CommandContext.tsx`
  - shortcut precedence (`Cmd+K` task toggle vs palette)
  - fallback `Cmd+Shift+K` behavior

## Integration tests (required)

- Use singleton database via `getSharedTestLayer()` (never create DB per test)
- Use deterministic IDs with `fixtureId(name)`
- Migration 024:
  - schema columns created
  - backfill rows set to `agent` + null id
  - idempotent re-run safety
- Task service/repo:
  - create, update, list, get-with-deps include assignment fields
  - null-safe compatibility for historical rows
- Dashboard server:
  - GET/PATCH settings round-trip to `.tx/config.toml`
  - POST/PATCH tasks with assignment fields and validation
  - payload includes assignment fields in all task response shapes

## UI/component tests

- Settings page:
  - load existing value
  - save new value and show success/error states
- Composer:
  - default assignment pulled from settings
  - assignment edits included in create request payload
- Task detail:
  - assignment edit controls render + persist + refresh
- Keyboard behavior:
  - task context `Cmd+K` toggles human/agent
  - input-focused `Cmd+K` does not trigger unintended toggles
  - palette still opens with `Cmd+Shift+K`

## Regression matrix (extensive)

- Existing shortcuts continue to work:
  - Cmd+C copy flows
  - Cmd+A selection flows
  - ESC close/clear flows
- Existing task workflows unaffected:
  - ready ordering
  - block/unblock semantics
  - done/reset transitions
- Existing dashboard tabs unaffected:
  - Tasks, Docs, Runs, Cycles navigation

## Manual validation checklist

- Start dashboard, create task with no config -> human default
- Change setting to agent -> next task defaults to agent
- Toggle assignment with Cmd+K in task detail
- Open palette with Cmd+Shift+K from same view
- Restart dashboard -> persisted setting still applied
