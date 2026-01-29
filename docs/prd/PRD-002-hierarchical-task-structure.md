# PRD-002: Hierarchical Task Structure

**Status**: Draft
**Priority**: P0 (Must Have)
**Owner**: TBD
**Last Updated**: 2025-01-28

---

## Problem Statement

Existing agent task systems treat all tasks as flat lists or force a rigid hierarchy (Epic → Story → Task). Real work doesn't fit these models:

1. **Flat lists** lose context - which tasks belong together?
2. **Fixed hierarchies** are too rigid - sometimes you need 2 levels, sometimes 5
3. **Git worktrees per task** (beads approach) is heavyweight for subtasks

We need **flexible N-level nesting** where any task can have children, enabling natural decomposition from high-level goals to atomic work items.

---

## Use Cases

### Case 1: Feature Development
```
Epic: Implement user authentication (tx-001)
├── Milestone: Backend auth complete (tx-002)
│   ├── Task: Design auth schema (tx-003)
│   ├── Task: Implement JWT service (tx-004)
│   │   ├── Subtask: Add token generation (tx-005)
│   │   ├── Subtask: Add token validation (tx-006)
│   │   └── Subtask: Add refresh logic (tx-007)
│   └── Task: Write auth middleware (tx-008)
└── Milestone: Frontend auth complete (tx-009)
    ├── Task: Build login form (tx-010)
    └── Task: Add auth context (tx-011)
```

### Case 2: Bug Investigation
```
Bug: Users can't log in (tx-100)
├── Investigation: Check auth service logs (tx-101)
├── Investigation: Test JWT expiry (tx-102)
└── Fix: Update token refresh (tx-103) [blocked by tx-101, tx-102]
```

### Case 3: Agent Decomposition
An agent receives: "Add dark mode to the app"
```
Task: Add dark mode (tx-200)
├── Subtask: Research existing theme system (tx-201) [created by agent]
├── Subtask: Add theme toggle component (tx-202) [created by agent]
├── Subtask: Update CSS variables (tx-203) [created by agent]
└── Subtask: Test in all views (tx-204) [created by agent]
```

---

## Requirements

### Hierarchy Operations

| ID | Requirement | CLI Command |
|----|-------------|-------------|
| H-001 | Any task can have a `parent_id` pointing to another task | `tx add "Task" --parent=<id>` |
| H-002 | No limit on nesting depth | N/A (architectural) |
| H-003 | Get all children of a task (direct) | `tx children <id>` |
| H-004 | Get all descendants (recursive subtree) | `tx tree <id>` |
| H-005 | Get all ancestors of a task (path to root) | `tx path <id>` |
| H-006 | Move task to different parent | `tx update <id> --parent=<new-parent>` |
| H-007 | Orphan detection (parent deleted but children remain) | `tx list --orphaned` |

### Hierarchy Queries

| Query | Command | Output |
|-------|---------|--------|
| List direct children | `tx children <id>` | Task list |
| Show full subtree | `tx tree <id>` | Tree visualization |
| List root tasks | `tx list --roots` | Tasks with no parent |
| Show ancestors | `tx path <id>` | Path from task to root |

### Constraints

| ID | Constraint | Enforcement |
|----|------------|-------------|
| C-001 | Circular reference prevention (A → B → A) | Validation on update |
| C-002 | Parent must exist when setting parent_id | Foreign key + validation |
| C-003 | Deleting parent orphans children (default) | ON DELETE SET NULL |
| C-004 | Cascade delete available via flag | `tx delete <id> --cascade` |

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hierarchy storage | `parent_id` column | Simple, queryable, matches Effect Schema |
| Recursive queries | Application-level | SQLite recursive CTEs are complex; iterate in code |
| Delete behavior | Orphan by default | Cascade is dangerous; explicit cleanup preferred |
| Depth tracking | Computed at query time | Avoids maintenance overhead |

---

## API Examples

### Create Subtask
```bash
# Create a child task
tx add "Implement token validation" --parent=tx-a1b2c3

# Create with score
tx add "Write unit tests" --parent=tx-a1b2c3 --score=600
```

### View Hierarchy
```bash
# Show tree
$ tx tree tx-a1b2c3
tx-a1b2c3: Implement JWT service [active]
├── tx-d4e5f6: Add token generation [done]
├── tx-g7h8i9: Add token validation [active]
└── tx-j0k1l2: Add refresh logic [ready]

# Show path to root
$ tx path tx-g7h8i9
tx-g7h8i9 → tx-a1b2c3 → tx-m3n4o5 (root)
```

### Move Task
```bash
# Move to new parent
tx update tx-g7h8i9 --parent=tx-newparent

# Make root task (remove parent)
tx update tx-g7h8i9 --parent=null
```

---

## Data Model

```typescript
// Parent-child relationship via parent_id
interface Task {
  id: TaskId
  parentId: TaskId | null  // null = root task
  // ... other fields
}

// Query result with children populated
interface TaskWithDeps {
  // ... task fields
  children: TaskId[]  // Direct child IDs
}
```

---

## Related Documents

- [PRD-001: Core Task Management](./PRD-001-core-task-management.md)
- [PRD-003: Dependency & Blocking System](./PRD-003-dependency-blocking-system.md)
- [DD-001: Data Model & Storage](../design/DD-001-data-model-storage.md)
- [DD-002: Effect-TS Service Layer](../design/DD-002-effect-ts-service-layer.md)
