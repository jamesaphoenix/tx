# PRD-025: Task Assignment Defaults, Settings, and Keyboard Toggle

## Problem

tx has lease-based task claiming (`tx claim`) but no persistent assignment primitive for long-lived intent (`human` vs `agent`). In the dashboard:

- New tasks do not have an assignment default model.
- There is no settings surface for assignment defaults.
- There is no fast keyboard action to flip assignment type while triaging tasks.

This creates queue contention and routing ambiguity in mixed human/agent workflows.

## Solution

Add first-class task assignment fields and a dashboard settings flow that controls the default assignment type for headful task creation:

- Default dashboard-created tasks to `human` when no config exists.
- Add a top-right cog that opens a dedicated Settings page.
- Persist settings to `.tx/config.toml` under `[dashboard]`.
- Add `Cmd+K` keyboard toggle for assignment type (`human ↔ agent`) in task contexts.

This remains orchestration-neutral: assignment indicates intent; claim/lease remains the collision-control primitive.

## Requirements

- [ ] Add assignment fields to task domain data:
  - `assigneeType: "human" | "agent" | null`
  - `assigneeId: string | null`
  - `assignedAt: ISO timestamp | null`
  - `assignedBy: string | null`
- [ ] Dashboard headful task creation uses a default assignment type from config.
- [ ] Missing config defaults to `human`.
- [ ] Add a top-right cog that opens a dedicated Settings page.
- [ ] Settings page can switch default assignment type: `human` or `agent`.
- [ ] Settings changes sync to `.tx/config.toml` using:
  - `[dashboard]`
  - `default_task_assigment_type = "human" | "agent"`
- [ ] Existing tasks are backfilled to `assigneeType = "agent"` and `assigneeId = null`.
- [ ] Dashboard task composer and task detail expose full assignment edit controls.
- [ ] `Cmd+K` in task context toggles assignment type `human ↔ agent`.
- [ ] Task payloads returned across interfaces include assignment fields (nullable for compatibility).

## Acceptance Criteria

1. With no `.tx/config.toml` key present, creating a task in dashboard stores `assigneeType = "human"`.
2. Updating the setting to `agent` in Settings page causes newly created dashboard tasks to default to `assigneeType = "agent"`.
3. Settings persist to `.tx/config.toml` at `[dashboard].default_task_assigment_type`.
4. Existing tasks after migration have `assigneeType = "agent"` and `assigneeId = null`.
5. Editing assignment type/id in task detail persists and is visible after reload.
6. In task context, pressing `Cmd+K` flips assignment type:
   - `human → agent`
   - `agent → human`
7. Assignment toggle does not break claim behavior or ready detection semantics.
8. API/SDK/MCP/CLI task payloads include assignment fields (null-safe for older data).

## Out of Scope

- Hard enforcement that only matching assignees can claim tasks.
- Replacing lease-based claim semantics with assignment semantics.
- Multi-user identity resolution, auth, or RBAC for assignment edits.
- Custom keyboard remapping for assignment toggle in this milestone.

## References

- → [DD-025](../design/DD-025-task-assignment-settings.md)
- Related: [PRD-024](PRD-024-dashboard-keyboard-shortcuts.md)
