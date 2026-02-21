# DD-025: Task Assignment Defaults, Settings Page, and Cmd+K Toggle

## Overview

This design introduces first-class task assignment data (`human`/`agent`), dashboard-level default assignment settings persisted in `.tx/config.toml`, and a task-context keyboard shortcut (`Cmd+K`) to toggle assignment type.

Implements: [PRD-025](../prd/PRD-025-task-assignment-settings.md)

The design preserves tx's primitive philosophy:

- **Assignment** = intent/routing metadata.
- **Claim** = lease-based collision control.

No orchestration policy is hardcoded.

## Design

### Data Model

#### Task Assignment Columns

Add nullable assignment columns to `tasks`:

```sql
ALTER TABLE tasks ADD COLUMN assignee_type TEXT
  CHECK (assignee_type IN ('human', 'agent'));
ALTER TABLE tasks ADD COLUMN assignee_id TEXT;
ALTER TABLE tasks ADD COLUMN assigned_at TEXT;
ALTER TABLE tasks ADD COLUMN assigned_by TEXT;
```

Migration backfill:

```sql
UPDATE tasks
SET assignee_type = 'agent',
    assignee_id = NULL,
    assigned_at = datetime('now'),
    assigned_by = 'migration:024_task_assignment'
WHERE assignee_type IS NULL;
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_type ON tasks(assignee_type);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_type_id ON tasks(assignee_type, assignee_id);
```

#### Schema and Type Updates

Update Effect Schema definitions for task payloads to include:

- `assigneeType`
- `assigneeId`
- `assignedAt`
- `assignedBy`

These fields are present in `Task` and therefore in `TaskWithDeps` for all external interfaces.

### Config Model (`.tx/config.toml`)

Add dashboard settings section:

```toml
[dashboard]
default_task_assigment_type = "human"
```

Rules:

- Valid values: `"human" | "agent"`.
- Missing key/file defaults to `"human"`.
- Writer patches known key in-place and preserves unrelated sections/lines.
- Reader supports current canonical key spelling `default_task_assigment_type`.

### Service Layer

#### Repository/Mapper

- Extend task row mapping to include assignment columns.
- Extend task insert/update flows to accept optional assignment fields.
- Maintain null-safe behavior for rows predating migration anomalies.

#### Task Service

- `create` accepts optional assignment input.
- `update` accepts partial assignment edits.
- `getWithDeps` / `listWithDeps` / batch variants always emit assignment fields.

#### Completion Invariant (Agent vs Human)

- Add an explicit completion invariant in `TaskService.update`:
  - Default actor context is `agent`.
  - If an `agent` attempts `status -> done` on a task that has any direct child with status != `done`, reject with `ValidationError`.
  - `human` actor context can still mark parent tasks `done` as an intentional override.
- This preserves orchestration safety for autonomous loops while keeping human triage escape hatches in headful UI.

### API/CLI Changes

#### Dashboard Server API

1. `GET /api/settings`
   - Returns:
   - `dashboard.defaultTaskAssigmentType`
2. `PATCH /api/settings`
   - Accepts:
   - `dashboard.defaultTaskAssigmentType`
   - Persists to `.tx/config.toml`.

#### Task Endpoints

- `POST /api/tasks` accepts assignment fields (optional).
- `PATCH /api/tasks/:id` accepts assignment fields (optional).
- Task serialization includes assignment fields in all task responses.

#### CLI/SDK/MCP Surface

- Task payloads include new nullable assignment fields.
- Claim commands stay unchanged.

### Dashboard UI

#### Settings Navigation

- Add top-right cog action.
- Cog opens dedicated `Settings` tab/page.
- Keep theme toggle separate.

#### Settings Page

- Control: default task assignment type (`human` | `agent`).
- Loads from `GET /api/settings`.
- Saves via `PATCH /api/settings`.

#### Task Creation and Editing

- Composer default assignment type comes from settings.
- Task create request includes `assigneeType` (and optional `assigneeId`).
- Task detail exposes assignment type and assignment ID controls.

### Keyboard Shortcut Behavior

Current behavior reserves `Cmd+K` globally for command palette. New behavior introduces contextual precedence:

1. If focused in task context (task detail or task composer), no text input focused, and assignment toggle command is available:
   - `Cmd+K` toggles `assigneeType` (`human ↔ agent`).
2. Otherwise:
   - `Cmd+K` opens/closes command palette (existing behavior).

To preserve deterministic access to the palette from task context, add fallback:

- `Cmd+Shift+K` always opens/closes command palette.

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 1 | `migrations/024_task_assignment.sql` | Add assignment columns, backfill existing tasks to `agent`, add indexes |
| 2 | `packages/types/src/task.ts`, `packages/types/src/index.ts` | Add assignment fields to Effect schemas/types and exports |
| 3 | `packages/core/src/mappers/task.ts`, `packages/core/src/repo/task-repo.ts`, `packages/core/src/services/task-service.ts` | Persist and return assignment fields across task operations |
| 4 | `packages/core/src/utils/toml-config.ts` | Add dashboard config read + patch-write support for `default_task_assigment_type` |
| 5 | `apps/dashboard/server/index.ts` | Add settings endpoints; extend task create/update/serialize with assignment fields |
| 6 | `apps/dashboard/src/App.tsx`, `apps/dashboard/src/api/client.ts` | Add settings tab/cog wiring and settings API client |
| 7 | `apps/dashboard/src/components/tasks/TasksPage.tsx`, `apps/dashboard/src/components/tasks/TaskComposerModal.tsx`, `apps/dashboard/src/components/tasks/TaskDetail.tsx` | Add assignment controls, defaults, and edit persistence |
| 8 | `apps/dashboard/src/components/command-palette/CommandContext.tsx` | Add task-context `Cmd+K` assignment toggle precedence and `Cmd+Shift+K` palette fallback |
| 9 | Dashboard/core test files | Add unit + integration coverage for settings, assignment persistence, and keyboard behavior |

## Testing Strategy (REQUIRED)

### Unit Tests

- `packages/core/src/utils/toml-config.ts`
  - Parse existing config with and without `[dashboard]`.
  - Preserve unknown sections while patching known key.
  - Fallback to `human` on missing/invalid key.
- Task mappers/repo
  - Serialize/deserialize assignment columns (null and populated).
  - Validate allowed `assigneeType`.
- Dashboard keyboard handling
  - `Cmd+K` toggles assignment in task context.
  - `Cmd+K` still opens palette outside task context.
  - `Cmd+Shift+K` always opens palette.

### Integration Tests

- Use singleton shared test DB (`getSharedTestLayer()`).
- Use deterministic SHA256 fixture IDs (`fixtureId(name)`).
- Migration coverage:
  - Applying migration adds columns/indexes.
  - Backfill sets existing tasks to `agent` + null ID.
- Core task lifecycle:
  - Create/update/list/get returns assignment fields.
  - Existing operations (ready/done/block) unaffected.
  - Agent completion invariant blocks parent completion when children are incomplete.
  - Human completion override succeeds for the same parent state.
- Dashboard server endpoints:
  - `GET/PATCH /api/settings` roundtrip to `.tx/config.toml`.
  - `POST/PATCH /api/tasks` assignment persistence.

### Edge Cases

- Invalid `assigneeType` rejected with clear 400 errors.
- Missing config file auto-defaults without crashes.
- `Cmd+K` in text inputs does not hijack input editing behavior.
- Task with `assigneeType = null` can still be toggled to valid values.
- Concurrent edits: assignment update should not erase unrelated metadata fields.

### Performance

- Verify additional assignment columns do not change task list latency materially.
- Confirm index use for assignee filters once exposed.

## Open Questions (REQUIRED)

- [ ] Should CLI gain explicit `tx assign` / `tx unassign` commands in this milestone or follow-up?
- [ ] Should we formalize an alias for `default_task_assignment_type` and auto-migrate spelling later?
- [ ] Should `Cmd+K` toggle be enabled in both macOS (`Cmd`) and non-mac (`Ctrl`) key maps immediately?

## Migration

- One-way additive migration (`024_task_assignment.sql`).
- Backfill all existing tasks to `assigneeType = 'agent'`, `assigneeId = null`.
- No task deletions or ID rewrites.

## References

- PRD: [PRD-025](../prd/PRD-025-task-assignment-settings.md)
- Related keyboard behavior: [PRD-024](../prd/PRD-024-dashboard-keyboard-shortcuts.md), [DD-024](DD-024-dashboard-keyboard-shortcuts.md)
- AGENTS DOCTRINE:
  - Rule 1 (Task payload completeness)
  - Rule 3 (integration test coverage)
  - Rule 10 (Effect Schema for domain types)
