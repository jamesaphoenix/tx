# DD-006: LLM Integration (Deduplication + Compaction)

**Status**: Draft
**Implements**: [PRD-005](../prd/PRD-005-llm-deduplication.md), [PRD-006](../prd/PRD-006-task-compaction-learnings.md)
**Last Updated**: 2025-01-28

---

## Overview

This document describes **how** `tx` integrates with Claude for LLM-powered features: deduplication, compaction, and learnings export to CLAUDE.md.

---

## Anthropic Client Layer

### ANTHROPIC_API_KEY Handling

The API key is **optional**. If set as an environment variable, it's used automatically. If not set:
- Core commands (`tx add`, `tx ready`, etc.) work normally
- LLM commands (`tx dedupe`, `tx compact`, `tx reprioritize`) fail with a clear error message
- The MCP server starts and serves core tools; LLM tools return error text

```typescript
// src/layers/AnthropicLayer.ts
import { Effect, Context, Layer, Config, Option } from "effect"
import Anthropic from "@anthropic-ai/sdk"

export class AnthropicClient extends Context.Tag("AnthropicClient")<
  AnthropicClient,
  Anthropic
>() {}

// Live: reads from env var, fails if not set
export const AnthropicClientLive = Layer.effect(
  AnthropicClient,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(
      Effect.mapError(() => new Error(
        "ANTHROPIC_API_KEY environment variable is not set. " +
        "Set it to enable LLM-powered features: export ANTHROPIC_API_KEY=sk-ant-..."
      ))
    )
    return new Anthropic({ apiKey })
  })
)

// Optional: returns None when not configured (for graceful degradation)
export const AnthropicClientOptional = Effect.gen(function* () {
  const apiKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(Effect.option)
  if (Option.isSome(apiKey)) {
    return Option.some(new Anthropic({ apiKey: apiKey.value }))
  }
  return Option.none()
})

// For testing: mock client with deterministic responses
export const AnthropicClientTest = Layer.succeed(
  AnthropicClient,
  {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: '{"summary":"test","learnings":"- test learning"}' }]
      })
    }
  } as unknown as Anthropic
)
```

---

## Deduplication Service

### How It Works

1. Fetch all open tasks (status not `done`)
2. Batch up to 50 tasks in a single LLM prompt
3. LLM returns structured JSON with duplicate groups
4. Each group has confidence score (high/medium/low)
5. Merging transfers children, dependencies, and appends descriptions

```typescript
// src/services/DeduplicationService.ts
export interface DuplicateGroup {
  ids: string[]
  reason: string
  confidence: "high" | "medium" | "low"
  suggestedMergeTarget: string
}

export class DeduplicationService extends Context.Tag("DeduplicationService")<
  DeduplicationService,
  {
    readonly findDuplicates: () => Effect.Effect<DuplicateGroup[]>
    readonly merge: (sourceId: string, targetId: string) => Effect.Effect<Task>
  }
>() {}
```

### Robust LLM Output Parsing

LLMs may return JSON wrapped in markdown fences or with preamble text. The parser handles all these cases:

```typescript
// src/utils/llm-parse.ts
export const parseLlmJson = <T>(raw: string): T | null => {
  // Step 1: Try direct parse
  try { return JSON.parse(raw) } catch {}

  // Step 2: Strip markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch {}
  }

  // Step 3: Find first [ or { and parse from there
  const jsonStart = raw.search(/[\[{]/)
  if (jsonStart >= 0) {
    const candidate = raw.slice(jsonStart)
    try { return JSON.parse(candidate) } catch {}

    // Step 4: Find matching bracket and extract
    const openChar = candidate[0]
    const closeChar = openChar === "[" ? "]" : "}"
    const lastClose = candidate.lastIndexOf(closeChar)
    if (lastClose > 0) {
      try { return JSON.parse(candidate.slice(0, lastClose + 1)) } catch {}
    }
  }

  // Step 5: Give up, log raw response for debugging
  console.error("Failed to parse LLM response:", raw.slice(0, 200))
  return null
}
```

### LLM Prompt

```
Analyze these tasks for potential duplicates that should be merged.

Tasks:
- tx-abc: "Add user authentication" - Implement user auth...
- tx-def: "Implement auth for users" - Auth feature...

Find groups of tasks that:
1. Describe the same work in different words
2. Would result in duplicate effort if both completed
3. Should logically be combined

Return a JSON array:
[{ "ids": ["tx-abc", "tx-def"], "reason": "...", "confidence": "high", "suggestedMergeTarget": "tx-abc" }]
```

### Merge Logic

```typescript
merge: (sourceId, targetId) =>
  Effect.gen(function* () {
    const source = yield* taskService.get(sourceId)
    const target = yield* taskService.get(targetId)

    // 1. Append descriptions
    const mergedDescription = [
      target.description,
      source.description ? `\n\n---\nMerged from ${source.id}:\n${source.description}` : ""
    ].filter(Boolean).join("")

    // 2. Keep higher score
    const mergedScore = Math.max(source.score, target.score)

    // 3. Track merge in metadata
    const mergedMetadata = {
      ...target.metadata,
      mergedFrom: [...(target.metadata.mergedFrom || []), sourceId],
      mergedAt: new Date().toISOString()
    }

    // 4. Transfer children
    const sourceChildren = yield* taskService.getChildren(sourceId)
    for (const child of sourceChildren) {
      yield* taskService.update(child.id, { parentId: targetId })
    }

    // 5. Transfer dependencies
    const sourceBlocking = yield* readyService.getBlocking(sourceId)
    for (const blocked of sourceBlocking) {
      yield* depService.addBlocker(blocked.id, targetId)
    }

    // 6. Update target
    const updated = yield* taskService.update(targetId, {
      description: mergedDescription,
      score: mergedScore,
      metadata: mergedMetadata
    })

    // 7. Delete source
    yield* taskService.delete(sourceId)

    return updated
  })
```

---

## Compaction Service

### How It Works

1. Find completed tasks older than threshold
2. Group by root parent for better summaries
3. LLM generates summary + actionable learnings
4. **Transaction: store in `compaction_log` + delete tasks atomically**
5. **Export learnings to CLAUDE.md** (or configured file)
6. If file export fails, compaction is still committed (learnings are in DB)

### Transaction Safety

Compaction MUST be atomic — the summary is stored and tasks are deleted in a single transaction:

```typescript
// Compaction is transaction-wrapped
compact: (options) =>
  Effect.gen(function* () {
    const tasks = yield* getCompactableTasks(options.before)
    if (tasks.length === 0) return { compactedCount: 0, summary: "No tasks to compact", ... }

    // Generate LLM summary (outside transaction — LLM calls are slow)
    const { summary, learnings } = yield* generateSummary(tasks)

    // Transaction: store log + delete tasks atomically
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to)
                   VALUES (${now}, ${tasks.length}, ${summary}, ${JSON.stringify(taskIds)}, ${options.outputFile || null})`

        for (const task of tasks) {
          yield* sql`DELETE FROM tasks WHERE id = ${task.id}`
        }
      })
    )

    // Export learnings to file (best-effort, outside transaction)
    if (options.outputFile && !options.dryRun) {
      yield* exportLearningsToFile(learnings, options.outputFile).pipe(
        Effect.catchAll((err) => telemetry.log("warn", "Failed to export learnings to file", { error: err }))
      )
    }

    return { compactedCount: tasks.length, summary, learnings, taskIds, learningsExportedTo: options.outputFile }
  })
```

### Implementation

```typescript
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
```

### LLM Prompt for Compaction

```
Analyze these completed tasks and generate two outputs:

Completed Tasks:
- tx-001: Implement JWT service (completed: 2024-01-10)
  Add JWT token generation and validation
- tx-002: Write auth tests (completed: 2024-01-12)
  Unit and integration tests for auth

Generate a JSON response:
{
  "summary": "2-4 paragraph summary of what was accomplished...",
  "learnings": "- Bullet point 1\n- Bullet point 2\n..."
}

Focus learnings on:
- Key technical decisions and why
- Gotchas or pitfalls to avoid
- Patterns that worked well
- Things to do differently next time
```

### Learnings Export to CLAUDE.md

```typescript
const exportLearningsToFile = (
  fs: FileSystem,
  learnings: string,
  targetFile: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const date = new Date().toISOString().split("T")[0]
    const content = `\n\n## Agent Learnings (${date})\n\n${learnings}\n`

    const exists = yield* fs.exists(targetFile)

    if (exists) {
      const existing = yield* fs.readFileString(targetFile)
      yield* fs.writeFileString(targetFile, existing + content)
    } else {
      yield* fs.writeFileString(targetFile, `# Project Context\n${content}`)
    }
  })
```

### Resulting CLAUDE.md

After compaction, the file grows incrementally:

```markdown
# Project Context

## Agent Learnings (2024-01-15)

- JWT tokens should use RS256 for production signing
- Always validate token expiry server-side before trusting claims
- Token validation middleware must run before route handlers
- Handle token refresh race conditions with mutex

## Agent Learnings (2024-01-08)

- Use transactions for multi-table migrations
- Test rollback paths before deploying
- Index foreign keys for query performance
```

---

## Testing LLM Services

### Mocked Anthropic Client

```typescript
const MockAnthropicClient = Layer.succeed(
  AnthropicClient,
  {
    messages: {
      create: async (params) => {
        // Return deterministic responses based on input
        if (params.messages[0].content.includes("duplicates")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify([{
                ids: ["tx-abc", "tx-def"],
                reason: "Same task",
                confidence: "high",
                suggestedMergeTarget: "tx-abc"
              }])
            }]
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              summary: "Test summary",
              learnings: "- Test learning 1\n- Test learning 2"
            })
          }]
        }
      }
    }
  } as unknown as Anthropic
)
```

### Integration Tests

```typescript
describe("CompactionService", () => {
  it("exports learnings to file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* svc.compact({
          before: new Date(),
          outputFile: "/tmp/test-learnings.md"
        })
      }).pipe(Effect.provide(TestLayerWithMockLLM))
    )

    expect(result.learnings).toContain("Test learning")
    expect(result.learningsExportedTo).toBe("/tmp/test-learnings.md")

    // Verify file was written
    const content = fs.readFileSync("/tmp/test-learnings.md", "utf-8")
    expect(content).toContain("Agent Learnings")
    expect(content).toContain("Test learning")
  })
})
```

---

## Robust JSON Parsing Tests

```typescript
describe("parseLlmJson", () => {
  it("parses clean JSON", () => {
    const result = parseLlmJson<any[]>('[{"ids":["tx-a","tx-b"]}]')
    expect(result).toHaveLength(1)
  })

  it("parses JSON wrapped in markdown fences", () => {
    const raw = '```json\n[{"ids":["tx-a","tx-b"]}]\n```'
    const result = parseLlmJson<any[]>(raw)
    expect(result).toHaveLength(1)
  })

  it("parses JSON with preamble text", () => {
    const raw = 'Here are the duplicates:\n\n[{"ids":["tx-a","tx-b"]}]'
    const result = parseLlmJson<any[]>(raw)
    expect(result).toHaveLength(1)
  })

  it("returns null for completely invalid input", () => {
    const result = parseLlmJson("This is not JSON at all")
    expect(result).toBeNull()
  })

  it("handles JSON with trailing text", () => {
    const raw = '[{"ids":["tx-a"]}]\n\nNote: these are high confidence matches.'
    const result = parseLlmJson<any[]>(raw)
    expect(result).toHaveLength(1)
  })
})
```

---

## Related Documents

- [PRD-005: LLM-Powered Deduplication](../prd/PRD-005-llm-deduplication.md)
- [PRD-006: Task Compaction & Learnings](../prd/PRD-006-task-compaction-learnings.md)
- [DD-002: Effect-TS Service Layer](./DD-002-effect-ts-service-layer.md)
- [DD-008: OpenTelemetry Integration](./DD-008-opentelemetry-integration.md)
