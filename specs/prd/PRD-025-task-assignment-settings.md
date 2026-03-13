# Task Assignment Defaults, Settings, and Keyboard Toggle

**Kind**: prd
**Status**: changing

## Problem

tx currently has lease-based `claim` semantics, but lacks persistent assignment intent
that distinguishes human-owned work from agent-owned work. This causes ambiguity in
mixed workflows where humans and swarms operate in parallel.

In the dashboard specifically:
- New headful tasks have no explicit assignment default.
- There is no settings surface to set assignment defaults.
- Assignment type cannot be toggled quickly from keyboard while triaging tasks.

Result: queue ownership is noisy, humans can accidentally lose work slots, and
orchestration scripts must infer intent from brittle status/metadata heuristics.

## Solution

Introduce first-class assignment fields and dashboard-level default assignment settings,
while preserving tx's primitive model (assignment intent vs claim lease mechanics).

Scope:
- Add nullable task assignment fields (`assigneeType`, `assigneeId`, `assignedAt`, `assignedBy`).
- Default dashboard-created tasks to `human` unless configured otherwise.
- Add top-right cog opening a dedicated Settings view.
- Persist settings in `.tx/config.toml` under `[dashboard]`.
- Add task-context `Cmd+K` toggle for `human ↔ agent`.

Assignment remains soft-routing metadata. No hard orchestration enforcement is introduced.

## Requirements

- Add first-class task assignment fields: assigneeType ("human" | "agent" | null), assigneeId (string | null), assignedAt (timestamp | null), assignedBy (string | null).
- Add DB migration for assignment columns and backfill existing tasks to assigneeType="agent", assigneeId=null.
- Dashboard UI task creation must apply default assignment type from config.
- Missing config/key must default dashboard task creation to "human".
- Add dashboard Settings surface reachable from a top-right cog.
- Settings must support `human` and `agent` as default task assignment type values.
- Settings must persist to `.tx/config.toml` at `[dashboard].default_task_assigment_type` with value "human" or "agent".
- Task composer must allow editing assignment type/id before create.
- Task detail must allow editing assignment type/id post-create.
- `Cmd+K` in task context must toggle assignment type (human -> agent, agent -> human).
- Task responses across interfaces must include assignment fields (nullable for compatibility).
- Existing claim lease behavior must remain unchanged.
- Add extensive automated tests for migration, config persistence, API responses, UI behavior, keyboard behavior, and regressions in existing shortcuts.

## Acceptance Criteria

- With no config key present, creating a task in dashboard writes `assigneeType = "human"`.
- Changing default in Settings to `agent` causes subsequent dashboard-created tasks to default to `agent`.
- Settings writes are durable in `.tx/config.toml` and survive dashboard restart.
- Existing tasks are backfilled to `assigneeType = "agent"` and `assigneeId = null` after migration.
- Editing assignment values in task detail is persisted and reloaded correctly.
- In task context, pressing `Cmd+K` flips assignment type between human and agent.
- Command palette remains accessible in task context via fallback shortcut (`Cmd+Shift+K`).
- Task payloads from dashboard API and task-facing interfaces include assignment fields.
- Claim + ready behavior remains unchanged except additional assignment metadata in payloads.
- New tests pass and cover migration, CRUD, settings persistence, and shortcut precedence.

## Out of Scope

- Hard authorization or access control for assignment edits.
- Enforcing assignment identity at claim-time.
- Automatic assignment by classifier/model.
- Team-level assignment groups and load-balancing logic.
- Full keyboard shortcut remapping UI.
