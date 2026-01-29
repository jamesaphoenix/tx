# PRD-005: LLM-Powered Deduplication

**Status**: Draft
**Priority**: P2 (Nice to Have)
**Owner**: TBD
**Last Updated**: 2025-01-28

---

## Problem Statement

As agents create tasks, duplicates emerge:
- Same task created in different sessions
- Slightly different wording for the same work
- Related tasks that should be merged

Manual deduplication is tedious. We need **LLM-powered duplicate detection** that:
- Finds semantically similar tasks (not just exact matches)
- Suggests merges with explanations
- Executes merges safely with audit trail

---

## Deduplication Process

### Step 1: Candidate Detection
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

### Step 2: Merge Execution
```bash
tx dedupe --merge tx-089 tx-045  # Merge tx-089 into tx-045
```

### Merge Actions
1. Append tx-089's description to tx-045
2. Transfer any children of tx-089 to tx-045
3. Update any tasks blocked by tx-089 to be blocked by tx-045
4. Keep higher score of the two
5. Add metadata: `{ mergedFrom: "tx-089", mergedAt: "..." }`
6. Delete tx-089

---

## Requirements

### Deduplication Operations

| ID | Requirement | CLI Command |
|----|-------------|-------------|
| DU-001 | Find and interactively merge duplicates | `tx dedupe` |
| DU-002 | Show duplicates without merging | `tx dedupe --dry-run` |
| DU-003 | Auto-merge high-confidence duplicates | `tx dedupe --auto` |
| DU-004 | Manually merge two tasks | `tx merge <source> <target>` |

### Deduplication API

| Method | Description |
|--------|-------------|
| `DeduplicationService.findDuplicates()` | Returns duplicate groups |
| `DeduplicationService.merge(sourceId, targetId)` | Execute merge |

### LLM Integration

| ID | Requirement |
|----|-------------|
| DU-005 | Use Claude claude-sonnet-4-5-20250929 for cost-effective analysis |
| DU-006 | Batch tasks (up to 50) in single prompt |
| DU-007 | Return structured JSON for parsing |
| DU-008 | Include confidence scores (high/medium/low) |

### Constraints

| ID | Constraint | Rationale |
|----|------------|-----------|
| DU-009 | Only analyze open tasks (not done) | Done tasks are historical |
| DU-010 | Require confirmation for merges (unless --auto) | Safety |
| DU-011 | Preserve all data (append, don't overwrite) | No data loss |
| DU-012 | Log merges in metadata for audit | Traceability |
| DU-013 | `ANTHROPIC_API_KEY` is optional — `tx dedupe` fails gracefully without it | Not all users have API keys |
| DU-014 | LLM output must be robustly parsed (handle markdown fences, malformed JSON) | LLMs are non-deterministic |

---

## API Examples

### Find Duplicates
```bash
$ tx dedupe --dry-run
Analyzing 42 open tasks...

Found 2 potential duplicate groups:

Group 1 (confidence: high):
  - tx-a1b2c3: "Add user authentication"
  - tx-d4e5f6: "Implement auth for users"
  Reason: Both describe implementing user authentication
  Suggested: Merge into tx-a1b2c3 (older, more detailed)

Group 2 (confidence: medium):
  - tx-g7h8i9: "Fix login bug"
  - tx-j0k1l2: "Users can't log in"
  Reason: May be describing the same issue
  Suggested: Review manually

Run `tx dedupe` to interactively merge, or `tx dedupe --auto` to auto-merge high-confidence.
```

### Interactive Merge
```bash
$ tx dedupe
Group 1 (confidence: high):
  - tx-a1b2c3: "Add user authentication"
  - tx-d4e5f6: "Implement auth for users"

Merge tx-d4e5f6 into tx-a1b2c3? [y/n/s(kip)] y

Merged:
  - Description appended
  - 2 children transferred
  - Score: 600 → 700 (kept higher)
  - tx-d4e5f6 deleted
```

### Manual Merge
```bash
$ tx merge tx-source tx-target
Merging tx-source into tx-target...
  - Description appended
  - 0 children transferred
  - 1 dependency updated
  - tx-source deleted
Done.
```

---

## Data Model

```typescript
interface DuplicateGroup {
  ids: string[]
  reason: string
  confidence: "high" | "medium" | "low"
  suggestedMergeTarget: string
}

// After merge, metadata tracks history
interface TaskMetadata {
  mergedFrom?: string[]  // IDs of merged tasks
  mergedAt?: string      // ISO timestamp
}
```

---

## LLM Prompt Template

```
Analyze these tasks for potential duplicates that should be merged.

Tasks:
${tasks.map(t => `- ${t.id}: "${t.title}"${t.description ? ` - ${t.description.slice(0, 100)}` : ""}`).join("\n")}

Find groups of tasks that:
1. Describe the same work in different words
2. Would result in duplicate effort if both completed
3. Should logically be combined

Return a JSON array:
[
  {
    "ids": ["tx-abc", "tx-def"],
    "reason": "Both describe implementing user login",
    "confidence": "high",
    "suggestedMergeTarget": "tx-abc"
  }
]

Rules:
- Only include genuine duplicates (not just related tasks)
- confidence: "high" = definitely same task, "medium" = probably same, "low" = possibly same
- suggestedMergeTarget: prefer the task with more detail or older creation date
- Return [] if no duplicates found
```

---

## Graceful Degradation

When `ANTHROPIC_API_KEY` is not set:
- `tx dedupe` prints: `"LLM deduplication requires ANTHROPIC_API_KEY. Set it as an environment variable to enable this feature."`
- Exit code: 1
- No crash, no stack trace

When the LLM returns malformed output:
- Parse with fallback: strip markdown fences, try JSON.parse, log raw response on failure
- Return empty duplicate groups on parse failure
- Never crash the CLI

---

## Related Documents

- [PRD-001: Core Task Management](./PRD-001-core-task-management.md)
- [PRD-008: Observability & OpenTelemetry](./PRD-008-observability-opentelemetry.md)
- [DD-006: LLM Integration](../design/DD-006-llm-integration.md)
