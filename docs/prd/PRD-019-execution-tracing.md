# PRD-019: Execution Tracing System

## Problem

Failed RALPH runs show only "Claude exited with code 1" with no insight into what went wrong. Example from recent failures:

```
run-ccbf7852  tx-implementer  failed  Task: tx-6407952c  Claude exited with code 1
run-8a4be920  tx-implementer  failed  Task: tx-6407952c  Claude exited with code 1
```

Debugging requires:
1. Understanding what the agent was doing when it failed
2. Seeing the full conversation/tool calls leading to failure
3. Correlating failures across runs on the same task
4. Identifying patterns in failures (same error, same task type, etc.)

Currently there is no way to:
- View Claude's output/transcript after a run completes
- See stderr from crashed processes
- Query operational metrics for a run
- Trace Effect-TS service operations within a run

## Solution: Two Primitives

This PRD introduces two distinct primitives:

### Primitive 1: IO Capture (File Paths)

Store **file paths** on the `runs` record pointing to:
- **Transcript** - Claude's full JSONL output (tool calls, messages, responses)
- **Stderr** - Error output for crash debugging (optional)
- **Stdout** - Standard output (optional)

These are file pointers, NOT database storage. Tool calls and messages live in the transcript file and are queried directly - we do NOT duplicate them into the database.

```
runs table:
├── transcript_path  → .tx/runs/{run-id}.jsonl
├── stderr_path      → .tx/runs/{run-id}.stderr (optional)
└── stdout_path      → .tx/runs/{run-id}.stdout (optional)
```

**tx provides the schema. The orchestrator decides what to capture.**

The `runs` table columns exist for storing paths, but it's up to the developer's orchestration code (ralph.sh, custom scripts, etc.) to:
1. Decide whether to capture stderr/stdout
2. Create the actual files
3. Set the paths on the run record

Example orchestrator responsibilities:
- `ralph.sh` → captures transcript + stderr to `.tx/runs/`
- Custom orchestrator → might pipe stderr elsewhere or skip it entirely
- CI/CD integration → might store in cloud storage and set URLs

### Primitive 2: Metrics Events (Operational Spans)

Store **operational metrics** in the `events` table:
- Effect-TS service spans (TaskService.create took 45ms)
- Run lifecycle events (run_started, run_completed, run_failed)
- Task mutation events (task_created, task_updated)
- Custom metric events with timing data

**NOT stored in events:**
- Tool calls (read from transcript file)
- Messages (read from transcript file)
- Claude's responses (read from transcript file)

```
events table:
├── run_id           → links to run
├── event_type       → 'span', 'run_started', 'task_updated', etc.
├── duration_ms      → timing for spans
├── metadata         → JSON attributes
└── timestamp        → when it happened
```

### Primitive 3: Transcript Adapters

Different LLM tools produce different transcript formats:
- **Claude Code** - JSONL with `type: tool_use`, `type: assistant`, etc.
- **Codex** - Different format (TBD)
- **Custom agents** - May have their own formats

Transcript adapters abstract parsing so `tx trace` commands work regardless of source:

```
┌─────────────────────────────────────────────────────────────┐
│  CLI: tx trace transcript <run-id>                          │
├─────────────────────────────────────────────────────────────┤
│  TranscriptAdapter interface                                │
│  ├── ClaudeCodeAdapter    (stream-json JSONL)               │
│  ├── CodexAdapter         (future)                          │
│  └── GenericJSONLAdapter  (fallback)                        │
├─────────────────────────────────────────────────────────────┤
│  Raw transcript file (.jsonl)                               │
└─────────────────────────────────────────────────────────────┘
```

The `runs` table stores which adapter to use via `agent` column (e.g., `claude-code`, `codex`).

### Key Design Principle

**Transcript is source of truth for Claude's activity. Events is source of truth for operational metrics.**

```
┌─────────────────────────────────────────────────────────────┐
│  What Claude Did (tool calls, messages)                     │
│  → Read from transcript files (.tx/runs/*.jsonl)            │
├─────────────────────────────────────────────────────────────┤
│  How Services Performed (spans, timing, errors)             │
│  → Query from events table                                  │
├─────────────────────────────────────────────────────────────┤
│  Run Metadata (paths, status, task, agent)                  │
│  → Query from runs table                                    │
└─────────────────────────────────────────────────────────────┘
```

## Requirements

### Primitive 1: IO Capture

#### Database (runs table)
- [ ] `transcript_path` column (already exists in migration 005)
- [ ] Add `stderr_path` column (nullable)
- [ ] Add `stdout_path` column (nullable)

#### Example: ralph.sh (reference implementation)
- [ ] Capture Claude output to `.tx/runs/{run-id}.jsonl` using `--output-format stream-json`
- [ ] Capture stderr to `.tx/runs/{run-id}.stderr`
- [ ] Set paths on run record after creation

**Note:** Capturing stderr/stdout is orchestrator-specific. tx provides the schema; developers decide what to capture.

#### Example Loops

**Basic: Capture transcript only**
```bash
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  run_id="run-$(openssl rand -hex 4)"
  transcript=".tx/runs/${run_id}.jsonl"
  mkdir -p .tx/runs

  # Create run record
  sqlite3 .tx/tasks.db "INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path)
    VALUES ('$run_id', '$task', 'my-agent', datetime('now'), 'running', 'runs/${run_id}.jsonl')"

  # Run with transcript capture
  claude --output-format stream-json "Work on $task" > "$transcript"

  # Mark complete
  sqlite3 .tx/tasks.db "UPDATE runs SET status='completed', ended_at=datetime('now') WHERE id='$run_id'"
  tx done "$task"
done
```

**Full: Capture transcript + stderr**
```bash
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  run_id="run-$(openssl rand -hex 4)"
  mkdir -p .tx/runs

  transcript=".tx/runs/${run_id}.jsonl"
  stderr_file=".tx/runs/${run_id}.stderr"

  # Create run with paths
  sqlite3 .tx/tasks.db "INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, stderr_path)
    VALUES ('$run_id', '$task', 'my-agent', datetime('now'), 'running',
            'runs/${run_id}.jsonl', 'runs/${run_id}.stderr')"

  # Run with both captures
  if claude --output-format stream-json "Work on $task" > "$transcript" 2> "$stderr_file"; then
    sqlite3 .tx/tasks.db "UPDATE runs SET status='completed', ended_at=datetime('now') WHERE id='$run_id'"
    tx done "$task"
  else
    exit_code=$?
    sqlite3 .tx/tasks.db "UPDATE runs SET status='failed', exit_code=$exit_code, ended_at=datetime('now') WHERE id='$run_id'"
  fi
done
```

**Parallel: Multiple agents with tracing**
```bash
run_traced_agent() {
  local task=$1
  local run_id="run-$(openssl rand -hex 4)"
  mkdir -p .tx/runs

  sqlite3 .tx/tasks.db "INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, stderr_path)
    VALUES ('$run_id', '$task', 'worker', datetime('now'), 'running',
            'runs/${run_id}.jsonl', 'runs/${run_id}.stderr')"

  claude --output-format stream-json "Complete $task" \
    > ".tx/runs/${run_id}.jsonl" \
    2> ".tx/runs/${run_id}.stderr"

  local status=$?
  if [ $status -eq 0 ]; then
    sqlite3 .tx/tasks.db "UPDATE runs SET status='completed', ended_at=datetime('now') WHERE id='$run_id'"
    tx done "$task"
  else
    sqlite3 .tx/tasks.db "UPDATE runs SET status='failed', exit_code=$status, ended_at=datetime('now') WHERE id='$run_id'"
  fi
}

# Spawn 5 parallel workers
for i in {1..5}; do
  (while task=$(tx claim --next 2>/dev/null); do
    run_traced_agent "$task"
  done) &
done
wait
```

#### CLI Commands
- [ ] `tx trace transcript <run-id>` - display raw transcript content
- [ ] `tx trace stderr <run-id>` - display stderr content
- [ ] Support piping to `jq` for filtering tool calls

### Primitive 2: Metrics Events

#### TracingService (Effect-TS)
- [ ] `TracingServiceLive` - writes spans to `events` table with run context
- [ ] `TracingServiceNoop` - zero-cost passthrough when tracing disabled
- [ ] `withSpan(name, attributes, effect)` - wrap service operations
- [ ] `withRunContext(runId, effect)` - set run context for all nested spans

#### Database (events table)
- [ ] Already exists in migration 006
- [ ] Add 'span' to event_type enum for operational spans
- [ ] Ensure indexes exist for run_id queries

#### CLI Commands
- [ ] `tx trace list` - show recent runs with event counts, failure status
- [ ] `tx trace show <run-id>` - display all metrics events for a run
- [ ] `tx trace errors` - show recent errors across all runs

### Primitive 3: Transcript Adapters

#### Adapter Interface
- [ ] `TranscriptAdapter` interface with `parseToolCalls()`, `parseMessages()` methods
- [ ] `ClaudeCodeAdapter` - parses Claude Code's `--output-format stream-json`
- [ ] `GenericJSONLAdapter` - fallback for unknown formats
- [ ] Adapter selection based on `runs.agent` column

#### Extensibility
- [ ] Document adapter interface for future LLM tools (Codex, etc.)
- [ ] Registry pattern for adapter lookup

### Combined View

- [ ] `tx trace show <run-id> --full` - combines events timeline with transcript tool calls
- [ ] Interleave metrics events with tool calls by timestamp for debugging
- [ ] Uses appropriate adapter based on agent type

## Acceptance Criteria

1. **IO persistence**: After a RALPH run, `.tx/runs/{run-id}.jsonl` and `.stderr` exist
2. **Paths stored**: `runs` table has `transcript_path` and `stderr_path` populated
3. **Span recording**: Core service operations record spans to `events` with `duration_ms`
4. **No duplication**: Tool calls are NOT copied from transcript into events table
5. **CLI queryable**: Can view transcript with `tx trace transcript <run-id>`
6. **Metrics queryable**: Can view operational spans with `tx trace show <run-id>`
7. **Combined debugging**: `tx trace show <run-id> --full` shows interleaved timeline

## Out of Scope

- Parsing/indexing transcript content into database (just store file path)
- Full-text search of transcripts (use grep/jq on files)
- OpenTelemetry export (covered by PRD-008)
- Real-time streaming of traces (write after completion)
- Trace visualization UI in dashboard (CLI only for now)

## Related Documents

- [DD-019](../design/DD-019-execution-tracing.md) - Technical design
- [PRD-008](PRD-008-observability-opentelemetry.md) - OpenTelemetry (complementary, not replacement)
- [DD-008](../design/DD-008-opentelemetry-integration.md) - OTEL design
