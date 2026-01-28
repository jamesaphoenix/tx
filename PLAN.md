# tx: PRD & Design Documentation

> A lean task management system for AI agents and humans, built with Effect-TS

**Package Name**: `tx`
**CLI Alias**: `tx`
**Version**: 0.1.0 (MVP)

---

# Part 1: Product Requirements Documents (PRDs)

---

## PRD-001: Core Task Management System

### Problem Statement

AI coding agents struggle with long-horizon tasks because they lose context across sessions. Current approaches have significant limitations:

1. **Markdown-based plans** lack structure, can't be queried, and become stale
2. **Git issue trackers** (GitHub Issues, Linear) are designed for humans, not agents - they're slow to query and lack programmatic access patterns
3. **Beads** (the closest solution) ties tasks to git worktrees, which is heavyweight for subtasks and milestones
4. **Claude Code's built-in TodoWrite** is session-scoped and doesn't persist across conversations

Agents need a **persistent, queryable, dependency-aware** task store that works across sessions and can be programmatically manipulated.

### Target Users

| User Type | Primary Actions | Frequency |
|-----------|-----------------|-----------|
| AI Agents (primary) | Create tasks, query ready tasks, update status, mark complete | High (every session) |
| Human Engineers | Review tasks, reprioritize, approve, add context | Medium (daily) |
| CI/CD Systems | Query task status, trigger workflows | Low (on events) |

### Goals

1. **Persistence**: Tasks survive across agent sessions and machine restarts
2. **Speed**: Sub-100ms queries for common operations (list, ready, get)
3. **Programmatic**: JSON output, typed API, MCP integration
4. **Minimal**: Single dependency (SQLite), no external services required
5. **Composable**: Works with any agent framework (Claude Code, Agent SDK, custom)

### Non-Goals

- Real-time collaboration (sync is explicit, not live)
- Web UI (CLI and API only for v1)
- Multi-project management (one DB per project)
- Integration with external issue trackers (no GitHub/Linear sync)

### Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Task creation latency | <50ms | P95 via CLI |
| Ready query latency | <100ms | P95 with 1000 tasks |
| Agent task completion rate | +20% | A/B vs markdown plans |
| Context retention | 100% | Tasks persist across sessions |

### User Stories

```
As an AI agent,
I want to query tasks that are ready to work on,
So that I can pick the highest-priority unblocked task.

As an AI agent,
I want to create subtasks as I decompose work,
So that I can track granular progress without losing the big picture.

As a human engineer,
I want to see all active tasks sorted by priority,
So that I can adjust scores and ensure agents work on the right things.

As a human engineer,
I want to mark tasks as "human_needs_to_review",
So that agents pause and wait for my input on sensitive changes.
```

### Requirements

#### Must Have (P0)
- [ ] Create, read, update, delete tasks
- [ ] Flexible parent-child hierarchy (N-level nesting)
- [ ] Status lifecycle: backlog → ready → planning → active → blocked → review → human_needs_to_review → done
- [ ] Blocking/blocked-by relationships between tasks
- [ ] Ready detection: find tasks with no open blockers
- [ ] CLI interface with JSON output
- [ ] SQLite persistence

#### Should Have (P1)
- [ ] Priority scoring (numeric, LLM-updateable)
- [ ] MCP server for Claude Code integration
- [ ] Task metadata (arbitrary key-value pairs)
- [ ] Export to JSON/JSONL

#### Nice to Have (P2)
- [ ] LLM-based deduplication
- [ ] LLM-based compaction/summarization with CLAUDE.md/agents.md output
- [ ] Agent SDK integration
- [ ] Git-backed export for version control

---

## PRD-002: Hierarchical Task Structure

### Problem Statement

Existing agent task systems treat all tasks as flat lists or force a rigid hierarchy (Epic → Story → Task). Real work doesn't fit these models:

1. **Flat lists** lose context - which tasks belong together?
2. **Fixed hierarchies** are too rigid - sometimes you need 2 levels, sometimes 5
3. **Git worktrees per task** (beads approach) is heavyweight for subtasks

We need **flexible N-level nesting** where any task can have children, enabling natural decomposition from high-level goals to atomic work items.

### Use Cases

#### Case 1: Feature Development
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

#### Case 2: Bug Investigation
```
Bug: Users can't log in (tx-100)
├── Investigation: Check auth service logs (tx-101)
├── Investigation: Test JWT expiry (tx-102)
└── Fix: Update token refresh (tx-103) [blocked by tx-101, tx-102]
```

#### Case 3: Agent Decomposition
An agent receives: "Add dark mode to the app"
```
Task: Add dark mode (tx-200)
├── Subtask: Research existing theme system (tx-201) [created by agent]
├── Subtask: Add theme toggle component (tx-202) [created by agent]
├── Subtask: Update CSS variables (tx-203) [created by agent]
└── Subtask: Test in all views (tx-204) [created by agent]
```

### Requirements

#### Hierarchy Operations
- [ ] Any task can have a `parent_id` pointing to another task
- [ ] No limit on nesting depth
- [ ] Get all children of a task (direct and recursive)
- [ ] Get all ancestors of a task (path to root)
- [ ] Move task to different parent
- [ ] Orphan detection (parent deleted but children remain)

#### Hierarchy Queries
- [ ] `tx children <id>` - list direct children
- [ ] `tx tree <id>` - show full subtree
- [ ] `tx roots` - list top-level tasks (no parent)
- [ ] `tx path <id>` - show ancestors to root

#### Constraints
- [ ] Circular reference prevention (A → B → A)
- [ ] Parent must exist when setting parent_id
- [ ] Deleting parent: option to orphan or cascade delete children

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hierarchy storage | `parent_id` column | Simple, queryable, matches Effect Schema |
| Recursive queries | Application-level | SQLite recursive CTEs are complex; iterate in code |
| Delete behavior | Orphan by default | Cascade is dangerous; explicit cleanup preferred |

---

## PRD-003: Dependency & Blocking System

### Problem Statement

Tasks have dependencies - you can't deploy before testing, can't test before building. Current task systems either:

1. **Ignore dependencies** - agents work on blocked tasks, wasting effort
2. **Use implicit ordering** - brittle, breaks when tasks are reordered
3. **Require manual tracking** - humans must remember what blocks what

We need **explicit dependency graphs** where tasks can block other tasks, and agents automatically skip blocked work.

### Core Concepts

#### Blocking Relationship
```
Task A "blocks" Task B
  = Task B cannot start until Task A is done
  = Task B is "blocked by" Task A
```

#### Ready Detection
A task is "ready" when:
1. Status is `backlog`, `ready`, or `planning`
2. All tasks that block it have status `done`
3. (Optional) Parent task is not `blocked`

#### Critical Path
The chain of blocking relationships that determines the minimum time to completion. Higher scores should go to tasks that unblock the most other tasks.

### Use Cases

#### Case 1: Sequential Work
```
tx-001: Design database schema (ready)
tx-002: Implement migrations (blocked by tx-001)
tx-003: Write seed data (blocked by tx-002)
```
Agent queries `tx ready` → gets tx-001 only.

#### Case 2: Parallel Work with Join
```
tx-010: Build API endpoint (ready)
tx-011: Build UI component (ready)
tx-012: Integration tests (blocked by tx-010, tx-011)
```
Agent can work on tx-010 and tx-011 in parallel. tx-012 becomes ready only when both are done.

#### Case 3: Unblocking Cascade
```
tx-020: Core library (blocks: tx-021, tx-022, tx-023)
```
Completing tx-020 unblocks three tasks at once - it should have high priority.

### Requirements

#### Dependency Operations
- [ ] Add blocker: `tx block <task> <blocker>`
- [ ] Remove blocker: `tx unblock <task> <blocker>`
- [ ] List blockers: `tx blockers <task>`
- [ ] List tasks this blocks: `tx blocking <task>`

#### Ready Detection
- [ ] `tx ready` - list all ready tasks, sorted by score
- [ ] `tx ready --limit=5` - top 5 ready tasks
- [ ] `tx is-ready <id>` - check if specific task is ready
- [ ] Include blocking count in ready output (tasks this unblocks)

#### Constraints
- [ ] No self-blocking (task can't block itself)
- [ ] No circular dependencies (A blocks B blocks A)
- [ ] Deleting a blocker automatically unblocks dependents

### Blocking Score Bonus

Tasks that block many others should score higher:
```
score_adjustment = base_score + (blocking_count * 25)
```

This ensures agents prioritize unblocking work.

---

## PRD-004: Task Scoring & Prioritization

### Problem Statement

When agents query "what should I work on?", they need a single, comparable metric to rank tasks. Current approaches fail because:

1. **No scoring** - agents pick arbitrarily or by creation order
2. **Human-only scoring** - doesn't adapt to changing conditions
3. **Static priorities** (P0/P1/P2) - too coarse, can't distinguish between 50 P1 tasks

We need **numeric scores** that:
- Can be set by humans for strategic priorities
- Can be updated by LLMs based on context
- Automatically factor in dependencies and blocking relationships

### Scoring Model

#### Base Score (0-1000)
Set by humans or agents to indicate inherent importance:
```
900-1000: Critical / Blocking release
700-899:  High priority / Important feature
400-699:  Medium priority / Normal work
100-399:  Low priority / Nice to have
0-99:     Backlog / Someday
```

#### Dynamic Adjustments
Applied at query time, not stored:

| Factor | Adjustment | Rationale |
|--------|------------|-----------|
| Blocking count | +25 per task | Unblocking work is valuable |
| Age > 48 hours | +100 | Old tasks shouldn't rot |
| Age > 24 hours | +50 | Mild age bonus |
| Depth > 2 | -10 per level | Prefer root tasks over deep subtasks |
| Status = blocked | -1000 | Never show blocked tasks as ready |

#### Final Score Formula
```
final_score = base_score
            + (blocking_count * 25)
            + age_bonus
            - (depth * 10)
            + custom_adjustments
```

### LLM Score Updates

Agents can request score recalculation:
```bash
tx score-update tx-001 --reason "This is now blocking the release"
```

Or batch recalculation:
```bash
tx reprioritize --context "We're focusing on performance this sprint"
```

The LLM considers:
- Task title and description
- Current score and dependencies
- Provided context
- What tasks this blocks

### Requirements

#### Scoring Operations
- [ ] `tx score <id> <value>` - manually set base score
- [ ] `tx score <id>` - show current score breakdown
- [ ] `tx reprioritize` - LLM recalculates all scores (uses Anthropic API)
- [ ] `tx list --sort=score` - list sorted by final score (default)

#### Scoring API
- [ ] `TaskService.setScore(id, score)` - set base score
- [ ] `ScoreService.calculate(task)` - get final score with adjustments
- [ ] `ScoreService.recalculateAll(context?)` - batch LLM update

#### Constraints
- [ ] Scores are integers (no floating point comparison issues)
- [ ] Base score stored in DB; adjustments computed at runtime
- [ ] LLM scoring requires `ANTHROPIC_API_KEY`

---

## PRD-005: LLM-Powered Deduplication

### Problem Statement

As agents create tasks, duplicates emerge:
- Same task created in different sessions
- Slightly different wording for the same work
- Related tasks that should be merged

Manual deduplication is tedious. We need **LLM-powered duplicate detection** that:
- Finds semantically similar tasks (not just exact matches)
- Suggests merges with explanations
- Executes merges safely with audit trail

### Deduplication Process

#### Step 1: Candidate Detection
```bash
tx dedupe --dry-run
```
Output:
```
Found 3 potential duplicate groups:

Group 1 (confidence: high):
  - tx-045: "Add user authentication"
  - tx-089: "Implement auth for users"
  Reason: Both describe implementing user authentication
  Suggested: Merge into tx-045 (older, more detailed)

Group 2 (confidence: medium):
  - tx-102: "Fix login bug"
  - tx-115: "Users can't log in"
  Reason: May be describing the same issue
  Suggested: Review manually
```

#### Step 2: Merge Execution
```bash
tx dedupe --merge tx-089 tx-045  # Merge tx-089 into tx-045
```
Actions:
1. Append tx-089's description to tx-045
2. Transfer any children of tx-089 to tx-045
3. Update any tasks blocked by tx-089 to be blocked by tx-045
4. Keep higher score of the two
5. Add metadata: `{ mergedFrom: "tx-089", mergedAt: "..." }`
6. Delete tx-089

### Requirements

#### Deduplication Operations
- [ ] `tx dedupe` - find and interactively merge duplicates
- [ ] `tx dedupe --dry-run` - show duplicates without merging
- [ ] `tx dedupe --auto` - auto-merge high-confidence duplicates
- [ ] `tx merge <source> <target>` - manually merge two tasks

#### Deduplication API
- [ ] `DeduplicationService.findDuplicates()` - returns duplicate groups
- [ ] `DeduplicationService.merge(sourceId, targetId)` - execute merge

#### LLM Integration
- [ ] Use Claude claude-sonnet-4-5-20250929 for cost-effective analysis
- [ ] Batch tasks (up to 50) in single prompt
- [ ] Return structured JSON for parsing
- [ ] Include confidence scores (high/medium/low)

#### Constraints
- [ ] Only analyze open tasks (not done)
- [ ] Require confirmation for merges (unless --auto)
- [ ] Preserve all data (append, don't overwrite)
- [ ] Log merges in metadata for audit

---

## PRD-006: Task Compaction & Learnings Export

### Problem Statement

Over time, completed tasks accumulate:
- Database grows unbounded
- Historical context becomes noise
- Agents wade through irrelevant old tasks
- **Valuable learnings are lost** - insights from completed work aren't captured

Beads solves this with "semantic compaction" - summarizing completed tasks into learnings. We need similar functionality:
- **Summarize** completed task chains into digestible learnings
- **Export learnings to CLAUDE.md or agents.md** so future agent sessions benefit
- **Archive** raw task data (optional)
- **Preserve** context that helps future work

### Compaction Process

#### Step 1: Identify Compactable Tasks
Tasks eligible for compaction:
- Status = `done`
- Completed more than N days ago (default: 7)
- All children also done

#### Step 2: Generate Summary
```bash
tx compact --before 2024-01-01
```
LLM generates:
```
Compaction Summary (15 tasks):

## Authentication System (tx-001 tree)
Implemented JWT-based authentication with refresh tokens.
Key decisions:
- Used RS256 for token signing
- 15-minute access token expiry
- Refresh tokens stored in httpOnly cookies
Learnings:
- Token validation middleware should run before route handlers
- Need to handle token refresh race conditions

## Bug Fixes
- Fixed login redirect loop (was missing return statement)
- Resolved session timeout issues (increased to 30 minutes)
```

#### Step 3: Store and Export
1. Store summary in `compaction_log` table
2. **Append learnings to CLAUDE.md or agents.md** (configurable target file)
3. Delete compacted tasks (optional, can keep in archive)
4. Keep summary accessible via `tx history`

### Learnings Export Format

Learnings are appended to the configured file (default: `CLAUDE.md`) in a structured format:

```markdown
## Agent Learnings (auto-generated)

### 2024-01-15: Authentication System
- JWT tokens should use RS256 for signing
- Token validation middleware must run before route handlers
- Handle token refresh race conditions with mutex

### 2024-01-10: Database Migrations
- Always use transactions for multi-table migrations
- Test rollback paths before deploying
```

### Requirements

#### Compaction Operations
- [ ] `tx compact` - compact tasks older than 7 days
- [ ] `tx compact --before <date>` - compact tasks before date
- [ ] `tx compact --dry-run` - show what would be compacted
- [ ] `tx compact --output=CLAUDE.md` - specify learnings output file
- [ ] `tx history` - show compaction summaries

#### Compaction API
- [ ] `CompactionService.compact(before: Date, options)` - execute compaction
- [ ] `CompactionService.getSummaries()` - retrieve summaries
- [ ] `CompactionService.exportLearnings(targetFile)` - write to markdown file

#### Summary Content
- [ ] Group by task tree (epic → subtasks)
- [ ] Extract key decisions made
- [ ] Note any learnings or gotchas
- [ ] Keep under 500 words per compaction

#### Learnings Export
- [ ] Append to configurable file (CLAUDE.md, agents.md, or custom)
- [ ] Use consistent markdown format
- [ ] Include date and task tree reference
- [ ] Deduplicate learnings (don't repeat existing entries)

#### Constraints
- [ ] Never compact tasks with open children
- [ ] Store summaries permanently (they're valuable)
- [ ] Require `ANTHROPIC_API_KEY` for summarization
- [ ] Default learnings file: `CLAUDE.md` in project root

---

## PRD-007: Multi-Interface Integration

### Problem Statement

Different consumers need different interfaces:
- **Humans** want CLI for quick commands
- **Claude Code** needs MCP tools
- **Agent SDK** needs programmatic API
- **Scripts** need JSON output

We need **multiple interfaces** that all use the same core logic:
- CLI for human interaction
- TypeScript API for embedding
- MCP server for Claude Code
- JSON mode for scripting

### Interface Matrix

| Interface | Consumer | Protocol | Output Format |
|-----------|----------|----------|---------------|
| CLI (`tx`) | Humans, scripts | stdin/stdout | Text or JSON |
| TypeScript API | Custom agents | Function calls | Effect types |
| MCP Server | Claude Code | JSON-RPC over stdio | MCP format |
| Agent SDK | Anthropic SDK | Tool definitions | SDK format |

### CLI Design

```bash
# Human-friendly output (default)
$ tx ready
3 ready tasks:
  tx-a1b2 [850] Implement JWT validation
  tx-c3d4 [720] Add login endpoint
  tx-e5f6 [650] Write auth tests

# JSON output for scripts
$ tx ready --json
[{"id":"tx-a1b2","title":"Implement JWT validation","score":850},...]

# Pipe-friendly
$ tx ready --json | jq '.[0].id' | xargs tx show
```

### MCP Tools

| Tool | Description | Agent Use Case |
|------|-------------|----------------|
| `tx_ready` | Get ready tasks | "What should I work on?" |
| `tx_add` | Create task | Decomposing work |
| `tx_done` | Complete task | Marking progress |
| `tx_update` | Update task | Changing status/score |
| `tx_list` | List tasks | Understanding scope |
| `tx_show` | Get task details | Reading requirements |
| `tx_block` | Add dependency | Structuring work order |

### Requirements

#### CLI Requirements
- [ ] All commands support `--json` flag
- [ ] Exit codes: 0 = success, 1 = error, 2 = not found
- [ ] Consistent argument patterns (`tx <verb> <id> [options]`)
- [ ] Help text for all commands (`tx <command> --help`)

#### API Requirements
- [ ] All operations return `Effect<T, E>`
- [ ] Errors are typed (TaskNotFoundError, ValidationError, etc.)
- [ ] Composable with Effect Layer system
- [ ] Tree-shakeable exports

#### MCP Requirements
- [ ] Tools have clear descriptions for LLM understanding
- [ ] Input validation with helpful error messages
- [ ] Structured output for parsing
- [ ] Text output for human readability
- [ ] **All dependency info (blockedBy, blocks) must be returned**

#### Agent SDK Requirements
- [ ] Compatible with `@anthropic-ai/claude-agent-sdk`
- [ ] Tools follow SDK naming conventions
- [ ] Supports tool confirmation patterns

---

# Part 2: Design Documents

---

## DD-001: Data Model & Storage Architecture

### Overview

This document describes the data model for `tx`, including SQLite schema, Effect Schema definitions, and data access patterns.

### Storage Choice: SQLite

| Considered | Pros | Cons | Decision |
|------------|------|------|----------|
| SQLite | Fast, zero-config, single file | No concurrent writes | **Selected** |
| PostgreSQL | Scalable, concurrent | Requires server | Rejected |
| JSONL files | Git-friendly, simple | Slow queries | Optional export |
| In-memory | Fastest | No persistence | Rejected |

**Rationale**: SQLite provides the best balance of speed, simplicity, and persistence for a single-project task manager. The `better-sqlite3` or Bun's native SQLite provides synchronous operations that work well with Effect.

### Database Location

```
project/
└── .tx/
    ├── tasks.db        # SQLite database
    ├── config.json     # Optional configuration
    └── exports/        # JSON exports (optional)
```

The `.tx` directory:
- Should be gitignored by default
- Can be committed for shared task state (team preference)
- Is created by `tx init`

### SQLite Schema

```sql
-- Version: 001
-- Migration: initial

-- Core tasks table
CREATE TABLE tasks (
    -- Identity
    id TEXT PRIMARY KEY,                    -- Format: tx-[a-z0-9]{6}

    -- Content
    title TEXT NOT NULL,
    description TEXT DEFAULT '',

    -- Status (enum enforced in application)
    status TEXT NOT NULL DEFAULT 'backlog'
        CHECK (status IN (
            'backlog', 'ready', 'planning', 'active',
            'blocked', 'review', 'human_needs_to_review', 'done'
        )),

    -- Hierarchy
    parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,

    -- Scoring
    score INTEGER NOT NULL DEFAULT 0,

    -- Timestamps (ISO 8601)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,

    -- Extensibility
    metadata TEXT DEFAULT '{}'              -- JSON object
);

-- Dependency relationships
CREATE TABLE task_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)        -- No self-blocking
);

-- Compaction history
CREATE TABLE compaction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compacted_at TEXT NOT NULL,
    task_count INTEGER NOT NULL,
    summary TEXT NOT NULL,
    task_ids TEXT NOT NULL,                 -- JSON array of compacted IDs
    learnings_exported_to TEXT              -- Path where learnings were written
);

-- Schema version tracking
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_score ON tasks(score DESC);
CREATE INDEX idx_tasks_created ON tasks(created_at);
CREATE INDEX idx_deps_blocker ON task_dependencies(blocker_id);
CREATE INDEX idx_deps_blocked ON task_dependencies(blocked_id);
```

### Effect Schema Definitions

```typescript
// src/schemas/task.ts
import { Schema } from "effect"

// ============ Enums ============

export const TaskStatus = Schema.Literal(
  "backlog",
  "ready",
  "planning",
  "active",
  "blocked",
  "review",
  "human_needs_to_review",
  "done"
)
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>

// ============ Task ID ============

// Hash-based ID format: tx-[6-8 alphanumeric chars]
export const TaskId = Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,8}$/),
  Schema.brand("TaskId")
)
export type TaskId = Schema.Schema.Type<typeof TaskId>

// ============ Metadata ============

export const TaskMetadata = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown
}).pipe(Schema.annotations({ description: "Arbitrary key-value metadata" }))
export type TaskMetadata = Schema.Schema.Type<typeof TaskMetadata>

// ============ Core Task ============

export class Task extends Schema.Class<Task>("Task")({
  id: TaskId,
  title: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(200),
    Schema.annotations({ description: "Task title (1-200 chars)" })
  ),
  description: Schema.String.pipe(
    Schema.annotations({ description: "Detailed task description" })
  ),
  status: TaskStatus,
  parentId: Schema.NullOr(TaskId).pipe(
    Schema.annotations({ description: "Parent task ID for hierarchy" })
  ),
  score: Schema.Int.pipe(
    Schema.annotations({ description: "Priority score (higher = more important)" })
  ),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  completedAt: Schema.NullOr(Schema.Date),
  metadata: TaskMetadata
}) {
  // Computed property: is this task terminal (done)?
  get isDone(): boolean {
    return this.status === "done"
  }

  // Computed property: is this task workable (not blocked/done)?
  get isWorkable(): boolean {
    return !["blocked", "done", "human_needs_to_review"].includes(this.status)
  }
}

// ============ Task with Dependencies (for API responses) ============

export class TaskWithDeps extends Schema.Class<TaskWithDeps>("TaskWithDeps")({
  ...Task.fields,
  blockedBy: Schema.Array(TaskId).pipe(
    Schema.annotations({ description: "Task IDs that block this task" })
  ),
  blocks: Schema.Array(TaskId).pipe(
    Schema.annotations({ description: "Task IDs that this task blocks" })
  ),
  children: Schema.Array(TaskId).pipe(
    Schema.annotations({ description: "Child task IDs" })
  ),
  isReady: Schema.Boolean.pipe(
    Schema.annotations({ description: "Whether task is ready to work on" })
  )
}) {}

// ============ Input Schemas ============

export const CreateTaskInput = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(TaskId)),
  score: Schema.optional(Schema.Int),
  metadata: Schema.optional(TaskMetadata)
})
export type CreateTaskInput = Schema.Schema.Type<typeof CreateTaskInput>

export const UpdateTaskInput = Schema.Struct({
  title: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  description: Schema.optional(Schema.String),
  status: Schema.optional(TaskStatus),
  parentId: Schema.optional(Schema.NullOr(TaskId)),
  score: Schema.optional(Schema.Int),
  metadata: Schema.optional(TaskMetadata)
})
export type UpdateTaskInput = Schema.Schema.Type<typeof UpdateTaskInput>

// ============ Query Schemas ============

export const TaskFilter = Schema.Struct({
  status: Schema.optional(Schema.Union(TaskStatus, Schema.Array(TaskStatus))),
  parentId: Schema.optional(Schema.NullOr(TaskId)),
  hasParent: Schema.optional(Schema.Boolean),
  minScore: Schema.optional(Schema.Int),
  maxScore: Schema.optional(Schema.Int),
  createdAfter: Schema.optional(Schema.Date),
  createdBefore: Schema.optional(Schema.Date)
})
export type TaskFilter = Schema.Schema.Type<typeof TaskFilter>

// ============ Dependency ============

export class TaskDependency extends Schema.Class<TaskDependency>("TaskDependency")({
  id: Schema.Int,
  blockerId: TaskId,
  blockedId: TaskId,
  createdAt: Schema.Date
}) {}
```

### ID Generation

Hash-based IDs prevent merge conflicts in multi-agent scenarios:

```typescript
// src/utils/id.ts
import { Effect } from "effect"
import { createHash } from "crypto"

export const generateTaskId = (): Effect.Effect<string> =>
  Effect.sync(() => {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 6)
    const hash = createHash("sha256")
      .update(timestamp + random)
      .digest("hex")
      .substring(0, 6)
    return `tx-${hash}`
  })
```

### Data Access Patterns

#### Common Queries

| Query | SQL | Index Used |
|-------|-----|------------|
| List ready tasks | `WHERE status IN ('backlog','ready','planning')` | idx_tasks_status |
| Get children | `WHERE parent_id = ?` | idx_tasks_parent |
| Get blockers | `WHERE blocked_id = ?` | idx_deps_blocked |
| Top tasks by score | `ORDER BY score DESC LIMIT ?` | idx_tasks_score |

#### Ready Detection Query

```sql
-- Find tasks that have no open blockers
SELECT t.* FROM tasks t
WHERE t.status IN ('backlog', 'ready', 'planning')
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies d
    JOIN tasks blocker ON d.blocker_id = blocker.id
    WHERE d.blocked_id = t.id
      AND blocker.status != 'done'
  )
ORDER BY t.score DESC;
```

---

## DD-002: Effect-TS Service Layer Design

### Overview

This document describes the Effect-TS architecture for `tx`, including service definitions, layer composition, and error handling patterns.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  CLI Commands    │   MCP Server   │   TypeScript API            │
├─────────────────────────────────────────────────────────────────┤
│                        Service Layer                             │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│ TaskService  │ ReadyService │ ScoreService │ HierarchyService  │
├──────────────┴──────────────┴──────────────┴───────────────────┤
│                       LLM Services                               │
├─────────────────────────┬───────────────────────────────────────┤
│  DeduplicationService   │   CompactionService                   │
├─────────────────────────┴───────────────────────────────────────┤
│                      Repository Layer                            │
├─────────────────────────┬───────────────────────────────────────┤
│   TaskRepository        │   DependencyRepository                │
├─────────────────────────┴───────────────────────────────────────┤
│                      Infrastructure Layer                        │
├─────────────────────────┬───────────────────────────────────────┤
│   SqliteClient          │   AnthropicClient                     │
└─────────────────────────┴───────────────────────────────────────┘
```

### Service Definitions

#### TaskService

```typescript
// src/services/TaskService.ts
import { Effect, Context, Layer, pipe } from "effect"
import { Task, CreateTaskInput, UpdateTaskInput, TaskFilter, TaskId, TaskWithDeps } from "../schemas"
import { TaskRepository } from "../repositories"
import { TaskNotFoundError, ValidationError } from "../errors"

// Service interface using Context.Tag
export class TaskService extends Context.Tag("TaskService")<
  TaskService,
  {
    // CRUD operations
    readonly create: (input: CreateTaskInput) => Effect.Effect<Task, ValidationError>
    readonly get: (id: TaskId) => Effect.Effect<Task, TaskNotFoundError>
    readonly getWithDeps: (id: TaskId) => Effect.Effect<TaskWithDeps, TaskNotFoundError>
    readonly update: (id: TaskId, input: UpdateTaskInput) => Effect.Effect<Task, TaskNotFoundError | ValidationError>
    readonly delete: (id: TaskId) => Effect.Effect<void, TaskNotFoundError>

    // Query operations
    readonly list: (filter?: TaskFilter) => Effect.Effect<readonly Task[]>
    readonly listWithDeps: (filter?: TaskFilter) => Effect.Effect<readonly TaskWithDeps[]>
    readonly count: (filter?: TaskFilter) => Effect.Effect<number>

    // Hierarchy operations
    readonly getChildren: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getAncestors: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getRoots: () => Effect.Effect<readonly Task[]>
  }
>() {}
```

#### ReadyService

```typescript
// src/services/ReadyService.ts
export class ReadyService extends Context.Tag("ReadyService")<
  ReadyService,
  {
    readonly getReady: (limit?: number) => Effect.Effect<readonly TaskWithDeps[]>
    readonly isReady: (id: TaskId) => Effect.Effect<boolean>
    readonly getBlockers: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getBlocking: (id: TaskId) => Effect.Effect<readonly Task[]>
    readonly getBlockingCount: (id: TaskId) => Effect.Effect<number>
  }
>() {}

export const ReadyServiceLive = Layer.effect(
  ReadyService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository
    const depRepo = yield* DependencyRepository

    return {
      getReady: (limit = 100) =>
        Effect.gen(function* () {
          // Get candidate tasks (correct statuses)
          const candidates = yield* taskRepo.findAll({
            status: ["backlog", "ready", "planning"]
          })

          // Filter to those with no open blockers
          const ready: TaskWithDeps[] = []
          for (const task of candidates) {
            const blockerIds = yield* depRepo.getBlockerIds(task.id)
            const blockingIds = yield* depRepo.getBlockingIds(task.id)
            const childIds = yield* taskRepo.getChildIds(task.id)

            if (blockerIds.length === 0) {
              ready.push({
                ...task,
                blockedBy: [],
                blocks: blockingIds,
                children: childIds,
                isReady: true
              })
              continue
            }

            // Check if all blockers are done
            const blockers = yield* taskRepo.findByIds(blockerIds)
            const allDone = blockers.every((b) => b.status === "done")

            if (allDone) {
              ready.push({
                ...task,
                blockedBy: blockerIds,
                blocks: blockingIds,
                children: childIds,
                isReady: true
              })
            }
          }

          // Sort by score descending and limit
          return ready
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
        }),

      isReady: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) return false
          if (task.status === "done") return false
          if (task.status === "blocked") return false

          const blockerIds = yield* depRepo.getBlockerIds(id)
          if (blockerIds.length === 0) return true

          const blockers = yield* taskRepo.findByIds(blockerIds)
          return blockers.every((b) => b.status === "done")
        }),

      getBlockers: (id) =>
        Effect.gen(function* () {
          const blockerIds = yield* depRepo.getBlockerIds(id)
          return yield* taskRepo.findByIds(blockerIds)
        }),

      getBlocking: (id) =>
        Effect.gen(function* () {
          const blockingIds = yield* depRepo.getBlockingIds(id)
          return yield* taskRepo.findByIds(blockingIds)
        }),

      getBlockingCount: (id) => depRepo.getBlockingIds(id).pipe(Effect.map((ids) => ids.length))
    }
  })
)
```

### Layer Composition

```typescript
// src/layers/AppLayer.ts
import { Layer } from "effect"

// Infrastructure layer
export const InfraLive = Layer.mergeAll(
  SqliteClientLive,
  IdGeneratorLive
)

// Repository layer (depends on infrastructure)
export const RepositoryLive = Layer.mergeAll(
  TaskRepositoryLive,
  DependencyRepositoryLive
).pipe(Layer.provide(InfraLive))

// Core service layer (depends on repositories)
export const CoreServiceLive = Layer.mergeAll(
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  ScoreServiceLive
).pipe(Layer.provide(RepositoryLive))

// LLM service layer (depends on core services + Anthropic)
export const LlmServiceLive = Layer.mergeAll(
  DeduplicationServiceLive,
  CompactionServiceLive
).pipe(
  Layer.provide(CoreServiceLive),
  Layer.provide(AnthropicClientLive)
)

// Full application layer
export const AppLive = Layer.mergeAll(
  CoreServiceLive,
  LlmServiceLive,
  MigrationLive
)

// Minimal layer (no LLM features)
export const AppMinimalLive = Layer.mergeAll(
  CoreServiceLive,
  MigrationLive
)
```

### Error Handling

```typescript
// src/errors/index.ts
import { Data } from "effect"

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  readonly id: string
}> {
  get message() {
    return `Task not found: ${this.id}`
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly reason: string
}> {
  get message() {
    return `Validation error: ${this.reason}`
  }
}

export class CircularDependencyError extends Data.TaggedError("CircularDependencyError")<{
  readonly taskId: string
  readonly blockerId: string
}> {
  get message() {
    return `Circular dependency: ${this.taskId} and ${this.blockerId} would create a cycle`
  }
}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown
}> {
  get message() {
    return `Database error: ${this.cause}`
  }
}

// Union of all errors for typed handling
export type TaskError =
  | TaskNotFoundError
  | ValidationError
  | CircularDependencyError
  | DatabaseError
```

---

## DD-003: CLI Implementation

### Overview

This document describes the CLI design for `tx`, using `@effect/cli` for type-safe command parsing.

### Command Structure

```
tx <command> [arguments] [options]

Commands:
  init                    Initialize task database
  add <title>             Create a new task
  list                    List tasks
  ready                   List ready tasks (no blockers)
  show <id>               Show task details
  update <id>             Update task
  done <id>               Mark task complete
  delete <id>             Delete task
  block <id> <blocker>    Add blocking dependency
  unblock <id> <blocker>  Remove blocking dependency
  children <id>           List child tasks
  tree <id>               Show task subtree
  score <id> [value]      Get or set task score
  dedupe                  Find duplicate tasks
  compact                 Compact completed tasks
  export                  Export to JSON
  import <file>           Import from JSON

Global Options:
  --json                  Output as JSON
  --db <path>             Database path (default: .tx/tasks.db)
  --help                  Show help
  --version               Show version
```

### Output Formatting

#### Human-Readable (Default)

```
$ tx ready
3 ready task(s):
  tx-a1b2c3 [850] Implement JWT validation (unblocks 2)
    blocked by: (none)
    blocks: tx-d4e5f6, tx-g7h8i9
  tx-d4e5f6 [720] Add login endpoint
    blocked by: (none)
    blocks: tx-j0k1l2
  tx-g7h8i9 [650] Write auth tests
    blocked by: (none)
    blocks: (none)
```

#### JSON Mode (includes full dependency info)

```
$ tx ready --json
[
  {
    "id": "tx-a1b2c3",
    "title": "Implement JWT validation",
    "status": "ready",
    "score": 850,
    "parentId": "tx-parent",
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z",
    "blockedBy": [],
    "blocks": ["tx-d4e5f6", "tx-g7h8i9"],
    "children": [],
    "isReady": true
  }
]
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (validation, runtime) |
| 2 | Not found (task doesn't exist) |

---

## DD-004: Ready Detection Algorithm

### Overview

This document describes the algorithm for determining which tasks are "ready" to work on - the core feature that distinguishes `tx` from simple task lists.

### Definition of Ready

A task is **ready** when all of these conditions are true:

1. **Status is workable**: `backlog`, `ready`, or `planning`
2. **No open blockers**: All tasks in its `blocked_by` list have status `done`
3. **Not explicitly blocked**: Status is not `blocked` or `human_needs_to_review`

### Algorithm

```typescript
// Pseudocode for ready detection
function getReadyTasks(): TaskWithDeps[] {
  // Step 1: Get candidate tasks (correct status)
  const candidates = db.query(`
    SELECT * FROM tasks
    WHERE status IN ('backlog', 'ready', 'planning')
  `)

  // Step 2: Filter by dependency status and enrich with dep info
  const ready: TaskWithDeps[] = []
  for (const task of candidates) {
    const blockerIds = db.getBlockerIds(task.id)
    const blockingIds = db.getBlockingIds(task.id)
    const childIds = db.getChildIds(task.id)

    // Check if all blockers are done
    const blockers = db.findByIds(blockerIds)
    const allBlockersDone = blockerIds.length === 0 || blockers.every(b => b.status === 'done')

    if (allBlockersDone) {
      ready.push({
        ...task,
        blockedBy: blockerIds,
        blocks: blockingIds,
        children: childIds,
        isReady: true
      })
    }
  }

  // Step 3: Sort by final score (with adjustments)
  ready.sort((a, b) => calculateFinalScore(b) - calculateFinalScore(a))

  return ready
}
```

### Score Calculation

```typescript
function calculateFinalScore(task: TaskWithDeps, context: ScoreContext): number {
  let score = task.score  // Base score from DB

  // Blocking bonus: tasks that unblock others are more valuable
  score += task.blocks.length * 25

  // Age bonus: don't let old tasks rot
  const ageHours = (Date.now() - task.createdAt.getTime()) / (1000 * 60 * 60)
  if (ageHours > 48) {
    score += 100
  } else if (ageHours > 24) {
    score += 50
  }

  // Depth penalty: prefer root tasks over deep subtasks
  score -= context.depth * 10

  return score
}
```

---

## DD-005: MCP Server & Agent SDK Integration

### Overview

This document describes how `tx` integrates with Claude Code (via MCP) and the Anthropic Agent SDK.

### MCP Tool Definitions

**CRITICAL**: All tools that return task data MUST include full dependency information (`blockedBy`, `blocks`, `children`, `isReady`).

```typescript
// src/mcp/tools.ts
import { z } from "zod"

// Shared schema for task with dependencies
const TaskWithDepsSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  score: z.number(),
  parentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  blockedBy: z.array(z.string()).describe("Task IDs that block this task"),
  blocks: z.array(z.string()).describe("Task IDs this task blocks"),
  children: z.array(z.string()).describe("Child task IDs"),
  isReady: z.boolean().describe("Whether task can be worked on")
})

export const mcpTools = {
  tx_ready: {
    name: "tx_ready",
    description: `Get tasks that are ready to work on (no open blockers).

Use this when you need to decide what to work on next. Tasks are sorted by priority score.
Returns the highest-priority unblocked tasks with full dependency information.`,
    inputSchema: z.object({
      limit: z.number().min(1).max(20).default(5).describe("Maximum tasks to return")
    }),
    outputSchema: z.object({
      tasks: z.array(TaskWithDepsSchema)
    })
  },

  tx_show: {
    name: "tx_show",
    description: `Get detailed information about a task including all dependencies.

Use this to understand a task's requirements, what blocks it, what it blocks, and its children.`,
    inputSchema: z.object({
      id: z.string().describe("Task ID")
    }),
    outputSchema: z.object({
      task: TaskWithDepsSchema
    })
  },

  tx_list: {
    name: "tx_list",
    description: `List tasks with optional filtering. Includes full dependency information.

Use this to see all tasks or filter by status/parent.`,
    inputSchema: z.object({
      status: z.enum(["backlog", "ready", "planning", "active", "blocked", "review", "human_needs_to_review", "done"]).optional(),
      parentId: z.string().optional(),
      limit: z.number().min(1).max(100).default(20)
    }),
    outputSchema: z.object({
      tasks: z.array(TaskWithDepsSchema),
      total: z.number()
    })
  },

  tx_add: {
    name: "tx_add",
    description: `Create a new task.

Use this to record work that needs to be done. You can set a parent to create subtasks.
Score indicates priority (higher = more important).`,
    inputSchema: z.object({
      title: z.string().min(1).max(200).describe("Task title"),
      description: z.string().optional().describe("Detailed description"),
      parentId: z.string().optional().describe("Parent task ID for subtasks"),
      score: z.number().default(0).describe("Priority score (0-1000)")
    }),
    outputSchema: z.object({
      task: TaskWithDepsSchema
    })
  },

  tx_done: {
    name: "tx_done",
    description: `Mark a task as complete.

Use this when you've finished a task. This may unblock other tasks.
Returns the completed task and list of tasks that are now unblocked.`,
    inputSchema: z.object({
      id: z.string().describe("Task ID to complete")
    }),
    outputSchema: z.object({
      task: TaskWithDepsSchema,
      nowReady: z.array(z.string()).describe("Task IDs now unblocked")
    })
  },

  tx_update: {
    name: "tx_update",
    description: `Update a task's status, score, or details.

Use this to change task status, adjust priority, or update the description.`,
    inputSchema: z.object({
      id: z.string().describe("Task ID"),
      status: z.enum(["backlog", "ready", "planning", "active", "blocked", "review", "human_needs_to_review", "done"]).optional(),
      score: z.number().optional(),
      title: z.string().optional(),
      description: z.string().optional()
    }),
    outputSchema: z.object({
      task: TaskWithDepsSchema
    })
  },

  tx_block: {
    name: "tx_block",
    description: `Add a blocking dependency between tasks.

Use this to indicate that one task must complete before another can start.`,
    inputSchema: z.object({
      taskId: z.string().describe("Task that will be blocked"),
      blockerId: z.string().describe("Task that does the blocking")
    }),
    outputSchema: z.object({
      success: z.boolean(),
      task: TaskWithDepsSchema.describe("Updated blocked task with new dependency")
    })
  },

  tx_children: {
    name: "tx_children",
    description: `List child tasks of a parent task.

Use this to see subtasks of an epic or parent task.`,
    inputSchema: z.object({
      id: z.string().describe("Parent task ID")
    }),
    outputSchema: z.object({
      children: z.array(TaskWithDepsSchema)
    })
  }
}
```

### MCP Server Implementation

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Effect } from "effect"
import { AppLive } from "../layers"
import { TaskService, ReadyService, DependencyService } from "../services"
import { mcpTools } from "./tools"

export const createMcpServer = () => {
  const server = new McpServer({
    name: "tx",
    version: "0.1.0"
  })

  // Register tx_ready - returns TaskWithDeps[]
  server.tool(
    mcpTools.tx_ready.name,
    mcpTools.tx_ready.description,
    mcpTools.tx_ready.inputSchema,
    async (args) => {
      const tasks = await Effect.runPromise(
        Effect.gen(function* () {
          const readyService = yield* ReadyService
          return yield* readyService.getReady(args.limit)
        }).pipe(Effect.provide(AppLive))
      )

      return {
        content: [{
          type: "text",
          text: tasks.length === 0
            ? "No ready tasks. Create tasks with tx_add or check blocked tasks."
            : `${tasks.length} ready task(s):\n${tasks.map((t) =>
                `- ${t.id} [${t.score}]: ${t.title}\n  blocks: ${t.blocks.length > 0 ? t.blocks.join(", ") : "(none)"}`
              ).join("\n")}`
        }],
        structuredContent: { tasks }
      }
    }
  )

  // Register tx_show - returns TaskWithDeps
  server.tool(
    mcpTools.tx_show.name,
    mcpTools.tx_show.description,
    mcpTools.tx_show.inputSchema,
    async (args) => {
      const task = await Effect.runPromise(
        Effect.gen(function* () {
          const taskService = yield* TaskService
          return yield* taskService.getWithDeps(args.id)
        }).pipe(Effect.provide(AppLive))
      )

      return {
        content: [{
          type: "text",
          text: `Task: ${task.id}
Title: ${task.title}
Status: ${task.status}
Score: ${task.score}
Ready: ${task.isReady ? "yes" : "no"}
Blocked by: ${task.blockedBy.length > 0 ? task.blockedBy.join(", ") : "(none)"}
Blocks: ${task.blocks.length > 0 ? task.blocks.join(", ") : "(none)"}
Children: ${task.children.length > 0 ? task.children.join(", ") : "(none)"}
${task.description ? `\nDescription:\n${task.description}` : ""}`
        }],
        structuredContent: { task }
      }
    }
  )

  // ... register other tools with full TaskWithDeps responses

  return server
}
```

---

## DD-006: LLM Integration (Deduplication + Compaction)

### Overview

This document describes how `tx` integrates with Claude for LLM-powered features: deduplication and compaction with learnings export.

### Compaction Service with Learnings Export

```typescript
// src/services/CompactionService.ts
export interface CompactionResult {
  compactedCount: number
  summary: string
  learnings: string
  taskIds: string[]
  learningsExportedTo: string | null
}

export interface CompactionOptions {
  before: Date
  outputFile?: string  // Default: CLAUDE.md
  dryRun?: boolean
}

export class CompactionService extends Context.Tag("CompactionService")<
  CompactionService,
  {
    readonly compact: (options: CompactionOptions) => Effect.Effect<CompactionResult>
    readonly getSummaries: () => Effect.Effect<readonly CompactionSummary[]>
    readonly preview: (before: Date) => Effect.Effect<readonly Task[]>
    readonly exportLearnings: (learnings: string, targetFile: string) => Effect.Effect<void>
  }
>() {}

export const CompactionServiceLive = Layer.effect(
  CompactionService,
  Effect.gen(function* () {
    const taskService = yield* TaskService
    const sql = yield* SqlClient.SqlClient
    const anthropic = yield* AnthropicClient
    const fs = yield* FileSystem.FileSystem

    return {
      preview: (before) =>
        taskService.list({
          status: ["done"],
          completedBefore: before
        }),

      compact: (options) =>
        Effect.gen(function* () {
          const { before, outputFile = "CLAUDE.md", dryRun = false } = options

          // Get compactable tasks
          const tasks = yield* taskService.list({
            status: ["done"],
            completedBefore: before
          })

          if (tasks.length === 0) {
            return {
              compactedCount: 0,
              summary: "No tasks to compact",
              learnings: "",
              taskIds: [],
              learningsExportedTo: null
            }
          }

          // Generate LLM summary AND learnings
          const prompt = `Analyze these completed tasks and generate two outputs:

Completed Tasks:
${tasks.map((t) => `- ${t.id}: ${t.title} (completed: ${t.completedAt?.toISOString()})\n  ${t.description || "(no description)"}`).join("\n")}

Generate a JSON response with two fields:

1. "summary": A 2-4 paragraph summary capturing what was accomplished, grouped by related work.

2. "learnings": Bullet points of actionable learnings that would help an AI agent working on similar tasks in the future. Focus on:
   - Key technical decisions and why they were made
   - Gotchas or pitfalls to avoid
   - Patterns that worked well
   - Things that should be done differently next time

Format learnings as markdown bullet points, suitable for appending to a CLAUDE.md file.

Example response:
{
  "summary": "Implemented user authentication system...",
  "learnings": "- JWT tokens should use RS256 for production\\n- Always validate token expiry server-side\\n- Refresh token rotation prevents replay attacks"
}

JSON only:`

          const response = yield* Effect.tryPromise(() =>
            anthropic.messages.create({
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 1024,
              messages: [{ role: "user", content: prompt }]
            })
          )

          const text = response.content[0].type === "text"
            ? response.content[0].text
            : "{}"

          let summary = "Compacted tasks (summary unavailable)"
          let learnings = ""

          try {
            const parsed = JSON.parse(text)
            summary = parsed.summary || summary
            learnings = parsed.learnings || ""
          } catch {
            // Use defaults
          }

          const taskIds = tasks.map((t) => t.id)

          if (dryRun) {
            return {
              compactedCount: tasks.length,
              summary,
              learnings,
              taskIds,
              learningsExportedTo: null
            }
          }

          // Store compaction log
          yield* sql`
            INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to)
            VALUES (
              ${new Date().toISOString()},
              ${tasks.length},
              ${summary},
              ${JSON.stringify(taskIds)},
              ${outputFile}
            )
          `

          // Export learnings to CLAUDE.md or specified file
          let learningsExportedTo: string | null = null
          if (learnings) {
            yield* exportLearningsToFile(fs, learnings, outputFile)
            learningsExportedTo = outputFile
          }

          // Delete compacted tasks
          for (const task of tasks) {
            yield* taskService.delete(task.id)
          }

          return {
            compactedCount: tasks.length,
            summary,
            learnings,
            taskIds,
            learningsExportedTo
          }
        }),

      exportLearnings: (learnings, targetFile) =>
        exportLearningsToFile(yield* FileSystem.FileSystem, learnings, targetFile),

      getSummaries: () =>
        sql<{ id: number; compacted_at: string; task_count: number; summary: string; learnings_exported_to: string | null }>`
          SELECT id, compacted_at, task_count, summary, learnings_exported_to
          FROM compaction_log
          ORDER BY compacted_at DESC
          LIMIT 20
        `.pipe(
          Effect.map((rows) =>
            rows.map((r) => ({
              id: r.id,
              compactedAt: new Date(r.compacted_at),
              taskCount: r.task_count,
              summary: r.summary,
              learningsExportedTo: r.learnings_exported_to
            }))
          )
        )
    }
  })
)

// Helper function to append learnings to a markdown file
const exportLearningsToFile = (
  fs: FileSystem.FileSystem,
  learnings: string,
  targetFile: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const date = new Date().toISOString().split("T")[0]
    const header = `\n\n## Agent Learnings (${date})\n\n`
    const content = header + learnings + "\n"

    // Check if file exists
    const exists = yield* fs.exists(targetFile)

    if (exists) {
      // Read existing content
      const existing = yield* fs.readFileString(targetFile)

      // Check if we already have a learnings section
      if (existing.includes("## Agent Learnings")) {
        // Append to existing learnings section
        yield* fs.writeFileString(targetFile, existing + content)
      } else {
        // Add new learnings section at the end
        yield* fs.writeFileString(targetFile, existing + content)
      }
    } else {
      // Create new file with learnings
      const newContent = `# Project Context\n${content}`
      yield* fs.writeFileString(targetFile, newContent)
    }
  })
```

### CLI Commands for Compaction

```typescript
// tx compact
const compactCmd = Command.make(
  "compact",
  {
    before: Options.date("before").pipe(
      Options.withDescription("Compact tasks completed before this date"),
      Options.optional
    ),
    output: Options.text("output").pipe(
      Options.withAlias("o"),
      Options.withDescription("File to export learnings to (default: CLAUDE.md)"),
      Options.withDefault("CLAUDE.md")
    ),
    dryRun: Options.boolean("dry-run").pipe(
      Options.withDescription("Preview without compacting"),
      Options.withDefault(false)
    ),
    json: jsonFlag
  },
  ({ before, output, dryRun, json }) =>
    Effect.gen(function* () {
      const compact = yield* CompactionService

      const cutoff = before ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago

      const result = yield* compact.compact({
        before: cutoff,
        outputFile: output,
        dryRun
      })

      if (json) {
        yield* Console.log(JSON.stringify(result, null, 2))
      } else {
        if (dryRun) {
          yield* Console.log(`Would compact ${result.compactedCount} task(s)`)
          yield* Console.log(`\nSummary preview:\n${result.summary}`)
          if (result.learnings) {
            yield* Console.log(`\nLearnings preview:\n${result.learnings}`)
          }
        } else {
          yield* Console.log(`Compacted ${result.compactedCount} task(s)`)
          yield* Console.log(`\nSummary:\n${result.summary}`)
          if (result.learningsExportedTo) {
            yield* Console.log(`\nLearnings exported to: ${result.learningsExportedTo}`)
          }
        }
      }
    })
)
```

---

## DD-007: Testing Strategy

### Overview

This document describes the testing strategy for `tx`, with emphasis on integration tests using deterministic fixtures.

### Test Categories

| Category | Purpose | Tools | Coverage Target |
|----------|---------|-------|-----------------|
| Unit Tests | Individual functions/services | Vitest, Effect Test | 80% |
| Integration Tests | Full system with SQLite | Vitest, real SQLite | 90% core paths |
| Snapshot Tests | CLI output stability | Vitest snapshots | All commands |
| E2E Tests | MCP server communication | Custom harness | Happy paths |

### Integration Test Architecture

Integration tests use **SHA256-hashed fixtures** to ensure deterministic, reproducible test data:

```typescript
// test/fixtures/index.ts
import { createHash } from "crypto"
import { Effect } from "effect"

// Generate deterministic task IDs from fixture names
export const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`fixture:${name}`)
    .digest("hex")
    .substring(0, 6)
  return `tx-${hash}`
}

// Pre-computed fixture IDs for consistency across tests
export const FIXTURES = {
  TASK_AUTH: fixtureId("task-auth"),           // tx-a1b2c3
  TASK_LOGIN: fixtureId("task-login"),         // tx-d4e5f6
  TASK_JWT: fixtureId("task-jwt"),             // tx-g7h8i9
  TASK_BLOCKED: fixtureId("task-blocked"),     // tx-j0k1l2
  TASK_PARENT: fixtureId("task-parent"),       // tx-m3n4o5
  TASK_CHILD: fixtureId("task-child"),         // tx-p6q7r8
} as const

// Fixture data factory
export const createFixtures = (): TaskFixture[] => [
  {
    id: FIXTURES.TASK_AUTH,
    title: "Implement authentication",
    description: "Add user auth to the API",
    status: "active",
    score: 800,
    parentId: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    completedAt: null,
    metadata: {}
  },
  {
    id: FIXTURES.TASK_LOGIN,
    title: "Add login endpoint",
    description: "",
    status: "ready",
    score: 700,
    parentId: FIXTURES.TASK_AUTH,
    createdAt: new Date("2024-01-02T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    completedAt: null,
    metadata: {}
  },
  // ... more fixtures
]

// Fixture dependencies
export const createDependencyFixtures = (): DependencyFixture[] => [
  {
    blockerId: FIXTURES.TASK_JWT,
    blockedId: FIXTURES.TASK_BLOCKED,
  }
]
```

### Integration Test Setup

```typescript
// test/integration/setup.ts
import { Effect, Layer } from "effect"
import Database from "better-sqlite3"
import { createFixtures, createDependencyFixtures, FIXTURES } from "../fixtures"
import { AppLive, SqliteClientLive } from "../../src/layers"

// Create isolated test database
export const createTestDb = (): Database.Database => {
  const db = new Database(":memory:")

  // Run migrations
  db.exec(readMigrationSql("001_initial.sql"))

  return db
}

// Seed with fixtures
export const seedFixtures = (db: Database.Database): void => {
  const tasks = createFixtures()
  const deps = createDependencyFixtures()

  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const task of tasks) {
    insertTask.run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.score,
      task.parentId,
      task.createdAt.toISOString(),
      task.updatedAt.toISOString(),
      task.completedAt?.toISOString() ?? null,
      JSON.stringify(task.metadata)
    )
  }

  const insertDep = db.prepare(`
    INSERT INTO task_dependencies (blocker_id, blocked_id, created_at)
    VALUES (?, ?, ?)
  `)

  for (const dep of deps) {
    insertDep.run(dep.blockerId, dep.blockedId, new Date().toISOString())
  }
}

// Test layer with in-memory SQLite
export const TestLayer = (db: Database.Database) =>
  Layer.succeed(SqliteClient, db).pipe(
    Layer.provideMerge(AppLive)
  )
```

### Integration Test Examples

```typescript
// test/integration/ready-service.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { createTestDb, seedFixtures, TestLayer, FIXTURES } from "./setup"
import { ReadyService } from "../../src/services"

describe("ReadyService Integration", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
  })

  it("returns ready tasks with full dependency info", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady(10)
      }).pipe(Effect.provide(TestLayer(db)))
    )

    expect(result.length).toBeGreaterThan(0)

    // Verify dependency info is populated
    for (const task of result) {
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
      expect(Array.isArray(task.blockedBy)).toBe(true)
      expect(Array.isArray(task.blocks)).toBe(true)
      expect(Array.isArray(task.children)).toBe(true)
      expect(task.isReady).toBe(true)
    }
  })

  it("excludes tasks with open blockers", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady(100)
      }).pipe(Effect.provide(TestLayer(db)))
    )

    // TASK_BLOCKED should not be in ready list (blocked by TASK_JWT which isn't done)
    const blockedTask = result.find(t => t.id === FIXTURES.TASK_BLOCKED)
    expect(blockedTask).toBeUndefined()
  })

  it("returns correct blockedBy for tasks", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getBlockers(FIXTURES.TASK_BLOCKED)
      }).pipe(Effect.provide(TestLayer(db)))
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(FIXTURES.TASK_JWT)
  })

  it("returns correct blocks for tasks", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getBlocking(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(TestLayer(db)))
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(FIXTURES.TASK_BLOCKED)
  })
})

// test/integration/task-service.test.ts
describe("TaskService Integration", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
  })

  it("getWithDeps returns task with all dependency info", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.getWithDeps(FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(TestLayer(db)))
    )

    expect(result.id).toBe(FIXTURES.TASK_AUTH)
    expect(result.blockedBy).toEqual([])
    expect(result.blocks).toEqual([])
    expect(result.children).toContain(FIXTURES.TASK_LOGIN)
    expect(result.isReady).toBe(true)
  })

  it("create generates deterministic IDs from content hash", async () => {
    // Run twice with same input
    const results = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: "Test task", score: 100 })
        }).pipe(Effect.provide(TestLayer(createTestDb())))
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.create({ title: "Test task", score: 100 })
        }).pipe(Effect.provide(TestLayer(createTestDb())))
      )
    ])

    // IDs should be different (random component) but format should match
    expect(results[0].id).toMatch(/^tx-[a-z0-9]{6,8}$/)
    expect(results[1].id).toMatch(/^tx-[a-z0-9]{6,8}$/)
  })
})
```

### MCP Integration Tests

```typescript
// test/integration/mcp-server.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedFixtures, FIXTURES } from "./setup"
import { createMcpServer } from "../../src/mcp/server"

describe("MCP Server Integration", () => {
  let server: McpServer
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    server = createMcpServer(db)
  })

  it("tx_ready returns tasks with blockedBy and blocks", async () => {
    const result = await server.callTool("tx_ready", { limit: 10 })

    expect(result.structuredContent.tasks).toBeDefined()

    for (const task of result.structuredContent.tasks) {
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
    }
  })

  it("tx_show returns full dependency info", async () => {
    const result = await server.callTool("tx_show", { id: FIXTURES.TASK_JWT })

    const task = result.structuredContent.task
    expect(task.id).toBe(FIXTURES.TASK_JWT)
    expect(task.blocks).toContain(FIXTURES.TASK_BLOCKED)
    expect(Array.isArray(task.blockedBy)).toBe(true)
    expect(Array.isArray(task.children)).toBe(true)
  })

  it("tx_block updates and returns updated task with new dependency", async () => {
    const result = await server.callTool("tx_block", {
      taskId: FIXTURES.TASK_LOGIN,
      blockerId: FIXTURES.TASK_AUTH
    })

    expect(result.structuredContent.success).toBe(true)
    expect(result.structuredContent.task.blockedBy).toContain(FIXTURES.TASK_AUTH)
  })
})
```

### Test Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules",
        "test",
        "dist"
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80
      }
    },
    // Separate test pools for unit vs integration
    poolOptions: {
      threads: {
        singleThread: false
      }
    }
  }
})
```

---

# Part 3: Implementation Roadmap

## Phase 1: MVP (v0.1.0)

**Goal**: Core CRUD + hierarchy + CLI with full dependency info

| Task | Dependencies |
|------|--------------|
| Project setup (Effect, TypeScript, build) | - |
| SQLite schema + migrations | - |
| Effect Schema definitions (including TaskWithDeps) | - |
| TaskRepository (with getChildIds) | Schema |
| DependencyRepository (getBlockerIds, getBlockingIds) | Schema |
| TaskService (with getWithDeps, listWithDeps) | Repository |
| DependencyService | Repository |
| ReadyService (returns TaskWithDeps[]) | TaskService, DependencyService |
| HierarchyService | TaskService |
| CLI: init, add, list, show | Services |
| CLI: update, done, delete | Services |
| CLI: block, unblock, ready | Services |
| CLI: children, tree | Services |
| Integration tests with SHA256 fixtures | All services |
| Unit tests | All services |

## Phase 2: Integrations (v0.2.0)

**Goal**: MCP server with full dependency info + JSON export

| Task | Dependencies |
|------|--------------|
| MCP server setup | Phase 1 |
| MCP tools: tx_ready (returns TaskWithDeps[]) | MCP server |
| MCP tools: tx_show (returns TaskWithDeps) | MCP server |
| MCP tools: tx_list (returns TaskWithDeps[]) | MCP server |
| MCP tools: tx_add, tx_done, tx_update | MCP server |
| MCP tools: tx_block (returns updated TaskWithDeps) | MCP server |
| Export service (JSON) | Phase 1 |
| CLI: export, import | Export service |
| MCP integration tests | MCP server |

## Phase 3: LLM Features (v0.3.0)

**Goal**: Deduplication + compaction with learnings export

| Task | Dependencies |
|------|--------------|
| Anthropic client layer | Phase 1 |
| DeduplicationService | Anthropic, TaskService |
| CompactionService with learnings export | Anthropic, TaskService, FileSystem |
| Learnings export to CLAUDE.md/agents.md | CompactionService |
| ScoreService (LLM reprioritize) | Anthropic, TaskService |
| CLI: dedupe, compact (with --output flag), reprioritize | LLM services |
| Tests: LLM services (mocked) | LLM services |

## Phase 4: Polish (v1.0.0)

**Goal**: Production-ready

| Task | Dependencies |
|------|--------------|
| Agent SDK integration | Phase 2 |
| JSONL export (git-friendly) | Phase 2 |
| Performance optimization | All |
| Error messages & UX polish | All |
| Full test coverage (80%+) | All |

---

# Critical Files Summary

| File | Purpose |
|------|---------|
| `src/schemas/task.ts` | Core data model including TaskWithDeps |
| `src/services/TaskService.ts` | CRUD operations with getWithDeps |
| `src/services/ReadyService.ts` | Ready detection returning TaskWithDeps[] |
| `src/services/CompactionService.ts` | Compaction with learnings export |
| `src/layers/AppLayer.ts` | Effect layer composition |
| `src/cli.ts` | CLI entry point |
| `src/mcp/server.ts` | MCP server with full dependency info |
| `src/mcp/tools.ts` | MCP tool definitions with TaskWithDeps schemas |
| `migrations/001_initial.sql` | Database schema |
| `test/fixtures/index.ts` | SHA256-based test fixtures |
| `test/integration/*.test.ts` | Integration tests |
