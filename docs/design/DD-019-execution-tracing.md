# DD-019: Execution Tracing System

## Overview

Two-primitive execution tracing for debugging RALPH run failures:
1. **IO Capture** - File paths to transcript/stderr/stdout stored on runs record
2. **Metrics Events** - Operational spans written to events table

→ [PRD-019](../prd/PRD-019-execution-tracing.md)

## Design

### Primitive 1: IO Capture

#### Data Model

The `runs` table stores file paths (not file contents):

```sql
-- Already exists in migration 005
transcript_path TEXT,  -- Path to .jsonl transcript

-- New columns needed
ALTER TABLE runs ADD COLUMN stderr_path TEXT;
ALTER TABLE runs ADD COLUMN stdout_path TEXT;
```

#### File Structure

```
.tx/
├── tasks.db
└── runs/
    ├── run-abc123.jsonl    # Claude transcript (stream-json output)
    ├── run-abc123.stderr   # Stderr capture
    ├── run-abc123.stdout   # Stdout capture (optional)
    ├── run-def456.jsonl
    └── run-def456.stderr
```

#### Orchestrator Responsibility

tx provides the schema (columns on `runs` table). The orchestrator decides:
- Whether to capture stderr/stdout
- Where to store files
- How to set paths on the run record

#### Example: ralph.sh (Reference Implementation)

```bash
run_agent() {
  local run_id="$1"
  local task_id="$2"
  local agent_type="$3"
  local prompt="$4"

  local run_dir="$PROJECT_DIR/.tx/runs"
  mkdir -p "$run_dir"

  local transcript_file="$run_dir/${run_id}.jsonl"
  local stderr_file="$run_dir/${run_id}.stderr"
  local stdout_file="$run_dir/${run_id}.stdout"

  # Update runs table with paths BEFORE running
  sqlite3 "$DB_PATH" "UPDATE runs SET
    transcript_path = 'runs/${run_id}.jsonl',
    stderr_path = 'runs/${run_id}.stderr'
    WHERE id = '$run_id'"

  # Run Claude with structured output
  claude --dangerously-skip-permissions \
         --print \
         --output-format stream-json \
         "$prompt" \
         > "$transcript_file" \
         2> "$stderr_file" &

  local pid=$!
  # ... rest of existing logic
}
```

#### Transcript File Format

Claude's `--output-format stream-json` produces JSONL:

```jsonl
{"type":"assistant","content":{"type":"text","text":"I'll read the task..."}}
{"type":"tool_use","id":"toolu_01...","name":"Bash","input":{"command":"tx show tx-123"}}
{"type":"tool_result","tool_use_id":"toolu_01...","content":"..."}
{"type":"assistant","content":{"type":"text","text":"Now I'll implement..."}}
```

**We DO NOT parse this into the events table.** It stays as a file.

---

### Primitive 3: Transcript Adapters

Different LLM tools produce different transcript formats. Adapters abstract parsing.

#### TranscriptAdapter Interface

```typescript
// packages/core/src/services/transcript-adapter.ts

interface ToolCall {
  timestamp: string
  name: string
  input: Record<string, unknown>
  result?: string
}

interface Message {
  timestamp: string
  role: 'user' | 'assistant'
  content: string
}

interface TranscriptAdapter {
  /**
   * Parse tool calls from transcript lines
   */
  parseToolCalls: (lines: string[]) => ToolCall[]

  /**
   * Parse messages from transcript lines
   */
  parseMessages: (lines: string[]) => Message[]

  /**
   * Check if this adapter can handle the given agent type
   */
  canHandle: (agentType: string) => boolean
}
```

#### ClaudeCodeAdapter Implementation

```typescript
const ClaudeCodeAdapter: TranscriptAdapter = {
  canHandle: (agentType) =>
    agentType.includes('claude') || agentType.includes('tx-'),

  parseToolCalls: (lines) =>
    lines
      .map(line => JSON.parse(line))
      .filter(entry => entry.type === 'tool_use')
      .map(entry => ({
        timestamp: entry.timestamp ?? new Date().toISOString(),
        name: entry.name,
        input: entry.input,
      })),

  parseMessages: (lines) =>
    lines
      .map(line => JSON.parse(line))
      .filter(entry => entry.type === 'assistant' || entry.type === 'user')
      .map(entry => ({
        timestamp: entry.timestamp ?? new Date().toISOString(),
        role: entry.type as 'user' | 'assistant',
        content: typeof entry.content === 'string'
          ? entry.content
          : entry.content?.text ?? '',
      })),
}
```

#### Adapter Registry

```typescript
const adapters: TranscriptAdapter[] = [
  ClaudeCodeAdapter,
  // Future: CodexAdapter, CursorAdapter, etc.
  GenericJSONLAdapter, // Fallback
]

function getAdapter(agentType: string): TranscriptAdapter {
  return adapters.find(a => a.canHandle(agentType)) ?? GenericJSONLAdapter
}
```

#### GenericJSONLAdapter (Fallback)

```typescript
const GenericJSONLAdapter: TranscriptAdapter = {
  canHandle: () => true, // Always matches as fallback

  parseToolCalls: (lines) =>
    lines
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(entry => entry?.tool || entry?.name)
      .map(entry => ({
        timestamp: entry.timestamp ?? new Date().toISOString(),
        name: entry.tool ?? entry.name ?? 'unknown',
        input: entry.input ?? entry.args ?? {},
      })),

  parseMessages: (lines) =>
    lines
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(entry => entry?.role || entry?.type)
      .map(entry => ({
        timestamp: entry.timestamp ?? new Date().toISOString(),
        role: (entry.role ?? entry.type) as 'user' | 'assistant',
        content: entry.content ?? entry.text ?? '',
      })),
}
```

---

### Primitive 2: Metrics Events

#### Data Model

Uses existing `events` table (migration 006). Add 'span' to event types:

```sql
-- Migration to add 'span' event type
-- Update CHECK constraint to include 'span'
```

Events table schema (already exists):

```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,  -- includes 'span' for operational metrics
    run_id TEXT REFERENCES runs(id),
    task_id TEXT REFERENCES tasks(id),
    agent TEXT,
    tool_name TEXT,            -- for span: service name
    content TEXT,              -- for span: span name
    metadata TEXT DEFAULT '{}', -- JSON: attributes, error details
    duration_ms INTEGER        -- timing for spans
);
```

#### TracingService Interface

```typescript
// packages/core/src/services/tracing-service.ts

interface SpanOptions {
  attributes?: Record<string, string | number | boolean>
}

interface TracingService {
  /**
   * Wrap an effect with a named span (records to events table)
   */
  withSpan: <A, E, R>(
    name: string,
    options: SpanOptions,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>

  /**
   * Record a metric event (not a span)
   */
  recordMetric: (
    metricName: string,
    value: number,
    attributes?: Record<string, unknown>
  ) => Effect.Effect<void, DatabaseError>

  /**
   * Set run context for all nested spans
   */
  withRunContext: <A, E, R>(
    runId: string,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>

  /**
   * Get current run context (if any)
   */
  getRunContext: () => Effect.Effect<string | undefined, never>
}

const TracingService = Context.GenericTag<TracingService>("TracingService")
```

#### TracingServiceLive Implementation

```typescript
const TracingServiceLive = Layer.effect(
  TracingService,
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const runContextRef = yield* FiberRef.make<string | undefined>(undefined)

    return {
      withSpan: (name, options, effect) =>
        Effect.gen(function* () {
          const runId = yield* FiberRef.get(runContextRef)
          const startTime = Date.now()

          try {
            const result = yield* effect
            const duration = Date.now() - startTime

            // Record successful span
            yield* sql.run(`
              INSERT INTO events (timestamp, event_type, run_id, content, metadata, duration_ms)
              VALUES (datetime('now'), 'span', ?, ?, ?, ?)
            `, [runId, name, JSON.stringify({
              status: 'ok',
              attributes: options.attributes
            }), duration])

            return result
          } catch (error) {
            const duration = Date.now() - startTime

            // Record failed span
            yield* sql.run(`
              INSERT INTO events (timestamp, event_type, run_id, content, metadata, duration_ms)
              VALUES (datetime('now'), 'span', ?, ?, ?, ?)
            `, [runId, name, JSON.stringify({
              status: 'error',
              error: String(error),
              attributes: options.attributes
            }), duration])

            throw error
          }
        }),

      recordMetric: (metricName, value, attributes) =>
        Effect.gen(function* () {
          const runId = yield* FiberRef.get(runContextRef)
          yield* sql.run(`
            INSERT INTO events (timestamp, event_type, run_id, content, metadata, duration_ms)
            VALUES (datetime('now'), 'metric', ?, ?, ?, ?)
          `, [runId, metricName, JSON.stringify(attributes ?? {}), value])
        }),

      withRunContext: (runId, effect) =>
        FiberRef.locally(runContextRef, runId)(effect),

      getRunContext: () => FiberRef.get(runContextRef)
    }
  })
)
```

#### TracingServiceNoop Implementation

```typescript
const TracingServiceNoop = Layer.succeed(TracingService, {
  withSpan: (_name, _options, effect) => effect,
  recordMetric: () => Effect.void,
  withRunContext: (_runId, effect) => effect,
  getRunContext: () => Effect.succeed(undefined)
})
```

---

### CLI Commands

#### tx trace list

Shows recent runs with event counts:

```bash
$ tx trace list

Recent Runs (last 24h)
─────────────────────────────────────────────────────────────
ID            Agent           Task          Status   Spans   Time
run-abc123    tx-implementer  tx-6407952c   failed   23      2h ago
run-def456    tx-implementer  tx-8a4be920   success  45      3h ago
```

#### tx trace show <run-id>

Shows metrics events (NOT transcript):

```bash
$ tx trace show run-abc123

Run: run-abc123
Agent: tx-implementer
Task: tx-6407952c
Status: failed
Transcript: .tx/runs/run-abc123.jsonl
Stderr: .tx/runs/run-abc123.stderr

Metrics Events:
─────────────────────────────────────────────────────────────
14:23:45  [span] TaskService.show         12ms   ok
14:23:46  [span] ReadyService.getReady    45ms   ok
14:24:12  [span] TaskService.update       8ms    ok
14:27:09  [span] TaskService.done         156ms  error
          └─ ValidationError: Cannot mark blocked task as done
```

#### tx trace transcript <run-id>

Reads transcript file directly:

```bash
$ tx trace transcript run-abc123
# Outputs raw JSONL, pipe to jq for filtering

$ tx trace transcript run-abc123 | jq 'select(.type == "tool_use")'
# Filter to tool calls only
```

#### tx trace stderr <run-id>

Reads stderr file directly:

```bash
$ tx trace stderr run-abc123
Error: SQLITE_BUSY: database is locked
    at Database.exec (/path/to/better-sqlite3.js:...)
```

#### tx trace show <run-id> --full

Combines metrics events with tool calls from transcript (interleaved by timestamp):

```bash
$ tx trace show run-abc123 --full

Combined Timeline:
─────────────────────────────────────────────────────────────
14:23:45.100  [span]     TaskService.show              12ms ok
14:23:45.200  [tool]     Bash: tx show tx-6407952c
14:23:46.000  [span]     ReadyService.getReady         45ms ok
14:23:46.100  [tool]     Read: /path/to/file.ts
14:24:12.000  [span]     TaskService.update            8ms ok
14:24:12.050  [tool]     Edit: /path/to/file.ts
14:27:09.000  [span]     TaskService.done              156ms error
              └─ ValidationError: Cannot mark blocked task as done
```

---

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 1 | `migrations/019_tracing.sql` | Add stderr_path, stdout_path to runs; add 'span' event type |
| 2 | `packages/core/src/services/tracing-service.ts` | New TracingService |
| 3 | `packages/core/src/services/transcript-adapter.ts` | TranscriptAdapter interface + implementations |
| 4 | `packages/core/src/layer.ts` | Add TracingService to layers |
| 5 | `scripts/ralph.sh` | Capture transcript/stderr, store paths |
| 6 | `apps/cli/src/commands/trace.ts` | CLI commands using adapters |
| 7 | `apps/cli/src/cli.ts` | Register trace commands |

---

## Testing Strategy

### Unit Tests
- TracingServiceNoop passes through effects unchanged
- TracingServiceLive records spans to events table

### Integration Tests
- Create run with transcript path, verify file exists
- Execute traced operations, verify events recorded
- Query traces via CLI commands
- Combined view correctly interleaves by timestamp

### Fixtures
```typescript
const fixtureRunId = fixtureId("trace-test-run")
const fixtureTaskId = fixtureId("trace-test-task")
```

---

## Migration

```sql
-- migrations/019_tracing.sql

-- Add IO path columns to runs
ALTER TABLE runs ADD COLUMN stderr_path TEXT;
ALTER TABLE runs ADD COLUMN stdout_path TEXT;

-- Note: transcript_path already exists from migration 005

-- Add 'span' and 'metric' to events event_type
-- SQLite doesn't support ALTER CHECK, so we recreate if needed
-- For now, we can insert 'span' events - SQLite CHECK is advisory

-- Indexes already exist from migration 006
```

---

## Related Documents

- [PRD-019](../prd/PRD-019-execution-tracing.md) - Requirements
- [PRD-008](../prd/PRD-008-observability-opentelemetry.md) - OpenTelemetry (complementary)
- [DD-008](DD-008-opentelemetry-integration.md) - OTEL design
- [DD-002](DD-002-effect-ts-service-layer.md) - Effect-TS patterns
