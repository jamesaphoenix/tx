# PRD-032: Task Group Context Inheritance

## Problem

tx supports contextual learnings (`tx context`) but does not support reusable context attached to a task group. Teams need to attach shared context once and have it available when working related tasks.

Current gap:

- No explicit command/tool/API to set task-group context on a task.
- `tx ready` and `tx show` do not surface inherited group context.
- Interfaces (CLI, MCP, API, SDK) cannot reliably consume shared lineage context.

## Solution

Add first-class task-group context with lineage inheritance.

- Attach context to a specific task.
- Inherit context to all connected ancestors and descendants in that task hierarchy.
- Expose both direct and effective context in all task payloads.
- Provide explicit set/clear operations in CLI, MCP, API, and SDK.

Inheritance resolution:

- Choose context source by nearest graph distance (fewest parent/child hops).
- Tie-break by source task `updatedAt` descending.
- Final tie-break by source task ID ascending.

## Requirements

- [ ] Add nullable `group_context` storage on tasks.
- [ ] Add explicit write operations to set and clear group context.
- [ ] Add `groupContext` and `effectiveGroupContext` fields to task payloads.
- [ ] Add `effectiveGroupContextSourceTaskId` to identify the winning context source.
- [ ] `tx ready` must include inherited group context in returned tasks.
- [ ] `tx show` must include inherited group context for the shown task.
- [ ] All interfaces (CLI, MCP, API, SDK) must expose the same fields.
- [ ] Inheritance must apply to both ancestors and descendants.
- [ ] Tie-break behavior must be deterministic and test-covered.
- [ ] Existing behavior remains unchanged when no group context is defined.

## Acceptance Criteria

1. Setting group context on task `X` makes it visible as effective context on `X`, its ancestors, and its descendants.
2. Clearing group context on `X` removes `X` as a source and recomputes effective context for affected tasks.
3. `tx ready --json` includes `groupContext`, `effectiveGroupContext`, and `effectiveGroupContextSourceTaskId` per task.
4. `tx show --json <id>` includes the same three fields.
5. API `/api/tasks`, `/api/tasks/ready`, and `/api/tasks/:id` return the same fields.
6. MCP task tools (`tx_ready`, `tx_show`, `tx_list`, etc.) return the same fields.
7. SDK task methods (`list/get/ready/tree/...`) return the same fields.
8. When multiple sources apply, nearest source wins; if equal distance, newer `updatedAt` wins; if equal timestamp, lexicographically smaller task ID wins.

## Out of Scope

- Learning retrieval (`tx context`) ranking changes.
- Label/tag-based inheritance semantics.
- Cross-project context sharing.
- Dashboard-specific UX for editing group context.

## References

- → [DD-032](../design/DD-032-task-group-context-inheritance.md)
- Related: [PRD-007](PRD-007-multi-interface-integration.md), [PRD-010](PRD-010-contextual-learnings-system.md)
