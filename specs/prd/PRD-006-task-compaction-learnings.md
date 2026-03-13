# PRD-006: Task Compaction & Learnings Export

**Status**: Draft
**Priority**: P2 (Nice to Have)
**Owner**: TBD
**Last Updated**: 2025-01-28

---

## Problem Statement

Over time, completed tasks accumulate:
- Database grows unbounded
- Historical context becomes noise
- Agents wade through irrelevant old tasks
- **Valuable learnings are lost** - insights from completed work aren't captured for future sessions

Beads solves this with "semantic compaction" - summarizing completed tasks into learnings. We need similar functionality:
- **Summarize** completed task chains into digestible learnings
- **Export learnings to CLAUDE.md or agents.md** so future agent sessions benefit
- **Archive** raw task data (optional)
- **Preserve** context that helps future work

---

## Compaction Process

### Step 1: Identify Compactable Tasks
Tasks eligible for compaction:
- Status = `done`
- Completed more than N days ago (default: 7)
- All children also done

### Step 2: Generate Summary
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

### Step 3: Store and Export
1. Store summary in `compaction_log` table
2. **Append learnings to CLAUDE.md or agents.md** (configurable target file)
3. Delete compacted tasks (optional, can keep in archive)
4. Keep summary accessible via `tx history`

---

## Learnings Export Format

Learnings are appended to the configured file (default: `CLAUDE.md`) in a structured format:

```markdown
## Agent Learnings (2024-01-15)

- JWT tokens should use RS256 for production signing
- Always validate token expiry server-side before trusting claims
- Refresh token rotation prevents replay attacks
- Token validation middleware must run before route handlers
- Handle token refresh race conditions with mutex or queue
```

---

## Requirements

### Compaction Operations

| ID | Requirement | CLI Command |
|----|-------------|-------------|
| CO-001 | Compact tasks older than 7 days | `tx compact` |
| CO-002 | Compact tasks before specific date | `tx compact --before <date>` |
| CO-003 | Preview without compacting | `tx compact --dry-run` |
| CO-004 | Specify learnings output file | `tx compact --output=CLAUDE.md` |
| CO-005 | View compaction history | `tx history` |

### Compaction API

| Method | Description |
|--------|-------------|
| `CompactionService.compact(options)` | Execute compaction |
| `CompactionService.getSummaries()` | Retrieve summaries |
| `CompactionService.preview(before)` | Preview what would be compacted |
| `CompactionService.exportLearnings(targetFile)` | Write to markdown file |

### Summary Content

| ID | Requirement |
|----|-------------|
| CO-006 | Group by task tree (epic → subtasks) |
| CO-007 | Extract key decisions made |
| CO-008 | Note any learnings or gotchas |
| CO-009 | Keep under 500 words per compaction |

### Learnings Export

| ID | Requirement |
|----|-------------|
| CO-010 | Append to configurable file (CLAUDE.md, agents.md, or custom) |
| CO-011 | Use consistent markdown format |
| CO-012 | Include date and task tree reference |
| CO-013 | Deduplicate learnings (don't repeat existing entries) |

### Constraints

| ID | Constraint | Rationale |
|----|------------|-----------|
| CO-014 | Never compact tasks with open children | Preserve context |
| CO-015 | Store summaries permanently | They're valuable |
| CO-016 | `ANTHROPIC_API_KEY` is optional — `tx compact` fails gracefully without it | Not all users have API keys. If set as env var, use automatically. |
| CO-017 | Default learnings file: CLAUDE.md | Agent reads this |
| CO-018 | Compaction must be atomic (transaction-wrapped) | Export + delete must succeed together or not at all |
| CO-019 | LLM output must be robustly parsed (handle markdown fences) | LLMs return non-deterministic formats |

---

## API Examples

### Preview Compaction
```bash
$ tx compact --dry-run --before 2024-01-15
Would compact 15 task(s):
  - tx-a1b2c3: Implement authentication [done]
    - tx-d4e5f6: Add JWT service [done]
    - tx-g7h8i9: Write tests [done]
  - tx-j0k1l2: Fix login bug [done]
  ...

Summary preview:
## Authentication System
Implemented JWT-based authentication...

Learnings preview:
- JWT tokens should use RS256 for production
- Token validation middleware must run before route handlers
```

### Execute Compaction
```bash
$ tx compact --before 2024-01-15 --output=CLAUDE.md
Compacting 15 tasks...

Summary:
## Authentication System (tx-a1b2c3 tree)
Implemented JWT-based authentication with refresh tokens.
Key decisions:
- Used RS256 for token signing
- 15-minute access token expiry

Learnings exported to: CLAUDE.md

Done. 15 tasks compacted.
```

### View History
```bash
$ tx history
Compaction History:

2024-01-15: 15 tasks → Authentication System, Bug Fixes
  Learnings exported to: CLAUDE.md

2024-01-08: 8 tasks → Database Setup, API Scaffolding
  Learnings exported to: CLAUDE.md
```

---

## Data Model

```sql
CREATE TABLE compaction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compacted_at TEXT NOT NULL,
    task_count INTEGER NOT NULL,
    summary TEXT NOT NULL,
    task_ids TEXT NOT NULL,                 -- JSON array
    learnings_exported_to TEXT              -- Path where learnings were written
);
```

```typescript
interface CompactionResult {
  compactedCount: number
  summary: string
  learnings: string
  taskIds: string[]
  learningsExportedTo: string | null
}

interface CompactionOptions {
  before: Date
  outputFile?: string  // Default: CLAUDE.md
  dryRun?: boolean
}
```

---

## LLM Prompt Template

```
Analyze these completed tasks and generate two outputs:

Completed Tasks:
${tasks.map(t => `- ${t.id}: ${t.title} (completed: ${t.completedAt})\n  ${t.description || "(no description)"}`).join("\n")}

Generate a JSON response with two fields:

1. "summary": A 2-4 paragraph summary capturing what was accomplished, grouped by related work.

2. "learnings": Bullet points of actionable learnings that would help an AI agent working on similar tasks in the future. Focus on:
   - Key technical decisions and why they were made
   - Gotchas or pitfalls to avoid
   - Patterns that worked well
   - Things that should be done differently next time

Format learnings as markdown bullet points, suitable for appending to a CLAUDE.md file.
```

---

## CLAUDE.md Integration

After compaction, learnings are appended to CLAUDE.md:

```markdown
# Project Context

... existing content ...

## Agent Learnings (2024-01-15)

- JWT tokens should use RS256 for production signing
- Always validate token expiry server-side
- Refresh token rotation prevents replay attacks
- Token validation middleware must run before route handlers

## Agent Learnings (2024-01-08)

- Use transactions for multi-table migrations
- Test rollback paths before deploying
- Index foreign keys for query performance
```

This ensures future agent sessions benefit from past learnings automatically.

---

## Graceful Degradation

When `ANTHROPIC_API_KEY` is not set:
- `tx compact` prints: `"Task compaction requires ANTHROPIC_API_KEY. Set it as an environment variable to enable this feature."`
- Exit code: 1
- `tx compact --dry-run` still works (just lists eligible tasks, no LLM needed)
- `tx history` still works (reads from database, no LLM needed)

---

## Known Issues (Bug Scan Findings)

### RULE 2 Violation Risk

**Issue**: Implementations MUST ensure learnings are appended to a markdown file (default: `CLAUDE.md`), not just stored in the `compaction_log` table.

**Why this matters**: Storing learnings only in the database makes them invisible to future agent sessions. The `compaction_log` table is for internal bookkeeping; the markdown export is what agents actually read.

**Compliance checklist**:
- [ ] `CompactionService.compact()` writes to `learningsExportedTo` path
- [ ] File append is atomic with database transaction (RULE CO-018)
- [ ] Integration tests verify file output, not just DB insertion
- [ ] Error on file write failure (don't silently drop learnings)

See: [CLAUDE.md DOCTRINE RULE 2](../../CLAUDE.md)

---

## Related Documents

- [PRD-001: Core Task Management](./PRD-001-core-task-management.md)
- [PRD-008: Observability & OpenTelemetry](./PRD-008-observability-opentelemetry.md)
- [DD-006: LLM Integration](../design/DD-006-llm-integration.md)
