# Cycle-Based Issue Discovery

**Kind**: design
**Status**: changing
**Version**: 1

## Problem Definition

After agents do heavy development work on a codebase area, there is no systematic
quality gate. Issues accumulate silently and teams cannot measure whether codebase
health is improving. A convergence loop is needed: scan -> fix -> rescan -> fewer
issues -> repeat until clean. This must integrate with the existing tx primitives
(tasks, runs, events) and the Claude Agent SDK for sub-agent dispatch.

## Goals

- Repeatable cycle-based scanning with two tunable prompts (task context + scan instructions)
- Parallel sub-agent dispatch via Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
- LLM-based deduplication via Agent SDK agent comparing against in-memory issue map
- Cycles contain multiple rounds that converge toward zero new issues
- Synthetic loss function tracking composite quality score per round
- Metrics emitted to events table for dashboard time-series plotting
- Dashboard Cycles tab showing decreasing loss curve

## Architecture

## Hierarchy: Cycles -> Rounds -> Runs

A cycle is a group (like a Linear cycle). It contains multiple rounds, each
round being a scan->dedup->fix pass. Rounds repeat until convergence.

```
Cycle 1 (group run)
  Round 1:
    |- Run: scan-agent-1    (explores codebase, returns JSON findings)
    |- Run: scan-agent-2    (explores codebase, returns JSON findings)
    |- Run: scan-agent-3    (explores codebase, returns JSON findings)
    |- Run: dedup-agent     (compares findings against known issues)
    '- Run: fix-agent       (works through new issues)
  Round 2:
    |- Run: scan-agent-1    (rescan after fixes)
    |- Run: dedup-agent     (fewer new issues now)
    '- Run: fix-agent
  Round 3:
    |- Run: scan-agent-1
    '- Run: dedup-agent -> 0 new issues -> CONVERGED
```

## Two-Prompt System

- Task prompt (--task-prompt): describes what area/work is being reviewed
- Scan prompt (--scan-prompt): instructions for what sub-agents look for

These compose into the final agent prompt with a structured JSON output format.

## Deduplication

The script maintains an in-memory Map<id, Issue> of all known issues for the
current cycle. A dedup agent (Claude via Agent SDK) receives new findings +
the serialized map and returns only genuinely new issues. LLM semantic
understanding catches duplicates that string matching would miss.

## Agent SDK Usage

- Scan agents: Read, Glob, Grep tools, bypassPermissions, read-only
- Dedup agent: no tools, pure reasoning
- Fix agent: Read, Edit, Write, Bash, Glob, Grep, acceptEdits

## Metrics Emission

Each round emits a 'metric' event to the events table with:
- cycle.round.loss: per-round loss + severity breakdown + newIssues + existingIssues
- cycle.complete: per-cycle aggregate stats

Dashboard reads from events table for time-series plotting.

## Data Model

## No New Migrations Required

Uses existing tables with metadata conventions:

### Task Metadata (for issues found by scan)
```json
{
  "foundByScan": true,
  "cycleId": "run-abc123",
  "cycle": 1,
  "round": 2,
  "severity": "high",
  "issueType": "bug",
  "file": "packages/core/src/service.ts",
  "line": 42
}
```

### Run Metadata (for cycle group runs)
```json
{
  "type": "cycle",
  "cycle": 1,
  "rounds": 3,
  "totalNewIssues": 26,
  "existingIssues": 26,
  "finalLoss": 0,
  "converged": true
}
```

### Run Metadata (for child runs)
```json
{
  "type": "scan|dedup|fix",
  "cycle": 1,
  "round": 2,
  "cycleRunId": "run-abc123"
}
```

### Events (metric type)
```json
{
  "metric": "cycle.round.loss",
  "cycleId": "run-abc123",
  "cycle": 1,
  "round": 2,
  "loss": 17,
  "newIssues": 5,
  "existingIssues": 21,
  "duplicates": 7,
  "high": 2,
  "medium": 3,
  "low": 5
}
```

## Invariants

| ID | Rule | Enforcement | Reference |
|-----|------|-------------|-----------|
| INV-CYCLE-001 | Every cycle group run records metadata with type, cycle number, and final loss (cycles) | integration_test | test/integration/cycle-scan.test.ts |
| INV-CYCLE-002 | Duplicate findings never create duplicate tasks within a cycle (cycles) | integration_test | test/integration/cycle-scan.test.ts |
| INV-CYCLE-003 | All scan-created tasks have metadata.foundByScan true and metadata.cycleId set (cycles) | integration_test | test/integration/cycle-scan.test.ts |
| INV-CYCLE-004 | Each round emits a cycle.round.loss metric event to the events table (cycles) | integration_test | test/integration/cycle-scan.test.ts |

## Failure Modes

| ID | Description | Mitigation |
|-----|-------------|------------|
| - | LLM returns unparseable JSON | Skip finding, log warning, continue with other agents' results |
| - | All scan agents fail in a round | Mark round as failed, skip to next round or end cycle |
| - | Dedup agent fails | Treat all findings as new (conservative fallback) |
| - | Fix agent fails to resolve issues | Leave tasks open, continue to next round |
| - | Fix agent modifies code that breaks subsequent scan | Scan agents are independent; next round will detect regressions |

## Edge Cases

| ID | Description |
|-----|-------------|
| - | First round in first cycle has no existing issues to dedup against |
| - | Same issue found by multiple scan agents in one round (within-round dedup by dedup agent) |
| - | Issue was fixed but scan finds it again (false positive from stale analysis) |
| - | Fix agent introduces new issues while fixing old ones (next round catches them) |
| - | Very large issuesMap serialization exceeds LLM context (need to summarize/truncate) |
| - | --scan-only mode runs all rounds without fix phase |

## Work Breakdown

- Phase 1: Create PRD-023 and DD-023 via tx doc CLI
- Phase 2: Build scripts/cycle-scan.ts with Agent SDK integration
- Phase 3: Add Dashboard Cycles tab with loss chart
- Phase 4: Add config.toml [cycles] section
- Phase 5: Integration tests

## Retention

- docs: All versions retained, locked on approval
- metrics: Events table retains all cycle.round.loss and cycle.complete events
- tasks: Issue tasks persist with cycleId metadata for historical queries

## Testing Strategy

Integration tests using shared test layer (getSharedTestLayer, DOCTRINE Rule 8):

1. Agent SDK dedup: Mock dedup agent, verify it receives existing issues + new findings
2. Cycle metadata: Run creation -> verify type "cycle" format
3. Task creation: New findings -> tasks with foundByScan + cycleId metadata
4. In-memory map growth: Issues from round 1 appear in round 2 dedup context
5. Loss computation: Verify 3*H + 2*M + 1*L formula
6. Metrics emission: Verify events table gets cycle.round.loss records
7. Dry-run: No tasks created
8. Parse failure: Malformed JSON from agent -> graceful skip
9. Dashboard API: /api/cycles/stats returns correct aggregation from events

## Open Questions

1. Context window limits: When the issuesMap grows very large (100+ issues),
   the serialized JSON may exceed the dedup agent's context. Should we
   summarize/truncate older issues, or paginate the dedup?

2. Convergence definition: Is loss == 0 the right convergence criterion,
   or should there be a configurable threshold (e.g., loss < 5)?

3. Cross-cycle memory: Should issues from cycle 1 carry over into cycle 2's
   dedup map, or should each cycle start fresh?

4. Prompt versioning: Should the task-prompt and scan-prompt be stored as
   metadata on the cycle run so they can be reproduced later?
