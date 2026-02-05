---
name: debug-hooks
description: Debug Claude Code hook artifacts. Use when investigating why ralph failed, what hooks fired, what was blocked, or reviewing hook behavior for a run.
argument-hint: "[run-id]"
allowed-tools: Bash(cat *), Bash(grep *), Bash(wc *), Bash(ls *), Bash(jq *), Read, Grep, Glob
---

# Debug Hook Artifacts

All Claude Code hooks in this project write structured JSONL artifacts to `.tx/hook-artifacts/<run-id>.jsonl`. Each line is a JSON object representing one hook invocation.

## Quick Start

### List all runs with artifact data

```bash
ls -lhtr .tx/hook-artifacts/*.jsonl 2>/dev/null
```

### View all hook events for a specific run

If `$ARGUMENTS` is provided, use it as the run-id. Otherwise, use the most recent JSONL file.

```bash
# Pretty-print all events
cat .tx/hook-artifacts/$ARGUMENTS.jsonl | jq .

# If no run-id given, use the latest file
ls -t .tx/hook-artifacts/*.jsonl | head -1 | xargs cat | jq .
```

### Filter by hook type

```bash
# Only safety decisions
grep "pre-safety" .tx/hook-artifacts/$ARGUMENTS.jsonl | jq .

# Only stop-hook results (did ralph get blocked?)
grep "stop-ensure-completion" .tx/hook-artifacts/$ARGUMENTS.jsonl | jq .

# Only lint check results
grep "post-lint-check" .tx/hook-artifacts/$ARGUMENTS.jsonl | jq .

# Only failure recovery events
grep "post-bash-recovery" .tx/hook-artifacts/$ARGUMENTS.jsonl | jq .
```

### Summary statistics

```bash
# Count events per hook type
cat .tx/hook-artifacts/$ARGUMENTS.jsonl | jq -r '._meta.hook' | sort | uniq -c | sort -rn

# Show all deny/block decisions
cat .tx/hook-artifacts/$ARGUMENTS.jsonl | jq 'select(._meta.decision == "deny" or .passed == false)'

# Timeline of events
cat .tx/hook-artifacts/$ARGUMENTS.jsonl | jq -r '"\(._meta.timestamp) \(._meta.hook) \(._meta.decision // .passed // "info")"'
```

## Artifact Schema

Each JSONL line has a `_meta` object plus hook-specific fields:

```json
{
  "_meta": {
    "hook": "pre-safety",           // Hook name
    "timestamp": "2026-02-05T...",  // UTC ISO 8601
    "tool": "Bash",                 // (PreToolUse only) Which tool triggered
    "decision": "deny|allow|warn",  // (PreToolUse only) Safety decision
    "exit_code": 1,                 // (PostToolUse only) Command exit code
    "failure_type": "test",         // (recovery only) test|lint|build
    "ralph_mode": "true",           // (stop only) Whether RALPH was active
    "task_id": "tx-abc123",         // (prompt-context only) Task being discussed
    "source": "search"              // (prompt-context only) How learnings were found
  },
  "reason": "...",                  // Why blocked/warned
  "failures": "...",                // Stop hook failure codes
  "passed": true,                   // Stop hook pass/fail
  "context": "...",                 // Injected context content
  "command": "...",                 // Command that triggered the hook
  "learnings": "..."                // Injected learnings content
}
```

## Hook Inventory

| Hook | Event | Fires When |
|------|-------|------------|
| `pre-safety` | PreToolUse | Every Bash/Write/Edit call — checks for dangerous ops |
| `pre-validate-paths` | PreToolUse | Every Write/Edit/Read — blocks paths outside project |
| `post-bash` | PostToolUse | Every Bash call — tracks test status, dispatches recovery |
| `post-bash-recovery` | PostToolUse | Bash failures — parses test/lint/build errors |
| `post-lint-check` | PostToolUse | Every Write/Edit on .ts files — runs ESLint |
| `session-start-context` | SessionStart | Session begins — loads task context + learnings |
| `prompt-context` | UserPromptSubmit | Every prompt — searches for relevant learnings |
| `stop-ensure-completion` | Stop | Agent tries to stop — checks task done, tests, coverage, uncommitted changes |
| `pre-compact` | PreCompact | Auto-compact — archives transcript + learnings |

## Common Debugging Scenarios

### "Why did ralph get blocked from stopping?"
```bash
grep "stop-ensure-completion" .tx/hook-artifacts/<run-id>.jsonl | jq .
```
Look at the `failures` field — it lists codes like `TASK_NOT_DONE`, `TESTS_FAILED`, `UNCOMMITTED_CHANGES`, `COVERAGE_LOW`.

### "What safety decisions were made?"
```bash
grep "pre-safety" .tx/hook-artifacts/<run-id>.jsonl | jq '._meta.decision'
```

### "What context did the agent receive?"
```bash
grep -E "(session-start|prompt-context)" .tx/hook-artifacts/<run-id>.jsonl | jq .context
```

### "What lint errors were found?"
```bash
grep "post-lint-check" .tx/hook-artifacts/<run-id>.jsonl | jq '{file: ._meta.file, errors: ._meta.errors, warnings: ._meta.warnings}'
```
