# DD-005: MCP Server & Agent SDK Integration

**Status**: Draft
**Implements**: [PRD-007](../prd/PRD-007-multi-interface-integration.md)
**Last Updated**: 2025-01-28

---

## Overview

This document describes **how** `tx` integrates with Claude Code (via MCP) and the Anthropic Agent SDK. All tools return `TaskWithDeps` with full dependency information.

---

## Architecture

```
┌─────────────────────────────────────────┐
│           Claude Code / Agent           │
│         (MCP Client)                    │
└─────────────────┬───────────────────────┘
                  │ JSON-RPC over stdio
                  ▼
┌─────────────────────────────────────────┐
│         tx MCP Server          │
│  ┌─────────────────────────────────┐    │
│  │         Tool Handlers           │    │
│  │  tx_ready, tx_add, tx_done...   │    │
│  └─────────────┬───────────────────┘    │
│                │                         │
│  ┌─────────────▼───────────────────┐    │
│  │       Effect Services           │    │
│  │  TaskService, ReadyService...   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

## Critical Design Decision: Always Return TaskWithDeps

Every MCP tool that returns task data MUST include full dependency information:

```typescript
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
```

**Rationale**: Without dependency info, agents can't make informed decisions. An MCP tool that returns tasks without `blockedBy`/`blocks` is broken.

---

## MCP Tool Definitions

### tx_ready

```typescript
{
  name: "tx_ready",
  description: `Get tasks that are ready to work on (no open blockers).
Returns the highest-priority unblocked tasks with full dependency information including blockedBy, blocks, and children.`,
  inputSchema: z.object({
    limit: z.number().min(1).max(20).default(5)
  }),
  outputSchema: z.object({
    tasks: z.array(TaskWithDepsSchema)
  })
}
```

### tx_show

```typescript
{
  name: "tx_show",
  description: `Get detailed information about a task including all dependencies.
Returns blockedBy (what blocks this task), blocks (what this task blocks), children, and isReady status.`,
  inputSchema: z.object({
    id: z.string()
  }),
  outputSchema: z.object({
    task: TaskWithDepsSchema
  })
}
```

### tx_list

```typescript
{
  name: "tx_list",
  description: `List tasks with optional filtering. Includes full dependency information.`,
  inputSchema: z.object({
    status: z.enum([...TaskStatusValues]).optional(),
    parentId: z.string().optional(),
    limit: z.number().min(1).max(100).default(20)
  }),
  outputSchema: z.object({
    tasks: z.array(TaskWithDepsSchema),
    total: z.number()
  })
}
```

### tx_add

```typescript
{
  name: "tx_add",
  description: `Create a new task. Returns the created task with dependency info.`,
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    parentId: z.string().optional(),
    score: z.number().default(0)
  }),
  outputSchema: z.object({
    task: TaskWithDepsSchema
  })
}
```

### tx_done

```typescript
{
  name: "tx_done",
  description: `Mark a task as complete. Returns the completed task and list of tasks now unblocked.`,
  inputSchema: z.object({
    id: z.string()
  }),
  outputSchema: z.object({
    task: TaskWithDepsSchema,
    nowReady: z.array(z.string()).describe("Task IDs now unblocked by completing this task")
  })
}
```

### tx_update

```typescript
{
  name: "tx_update",
  description: `Update a task's status, score, or details. Returns updated task with dependency info.`,
  inputSchema: z.object({
    id: z.string(),
    status: z.enum([...TaskStatusValues]).optional(),
    score: z.number().optional(),
    title: z.string().optional(),
    description: z.string().optional()
  }),
  outputSchema: z.object({
    task: TaskWithDepsSchema
  })
}
```

### tx_block

```typescript
{
  name: "tx_block",
  description: `Add a blocking dependency. Returns the blocked task with updated dependency info.`,
  inputSchema: z.object({
    taskId: z.string().describe("Task that will be blocked"),
    blockerId: z.string().describe("Task that does the blocking")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    task: TaskWithDepsSchema.describe("Updated blocked task showing new dependency")
  })
}
```

### tx_children

```typescript
{
  name: "tx_children",
  description: `List child tasks with dependency info.`,
  inputSchema: z.object({
    id: z.string()
  }),
  outputSchema: z.object({
    children: z.array(TaskWithDepsSchema)
  })
}
```

---

## MCP Server Implementation

### Critical Design Decisions

1. **`AppMinimalLive` created once at startup** — not per-request (expensive layer construction)
2. **No `structuredContent`** — not part of MCP spec. Return text content + JSON block.
3. **Error handling** — every tool wraps `Effect.runPromise` in try/catch, returns error as text content
4. **Migrations on startup** — MCP server runs migrations before accepting tool calls

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Effect, Runtime, Layer } from "effect"

// Create runtime ONCE at server startup
let runtime: Runtime.Runtime<TaskService | ReadyService | DependencyService | HierarchyService>

const initRuntime = async () => {
  runtime = await Effect.runPromise(
    Layer.toRuntime(AppMinimalLive).pipe(Effect.scoped)
  )
}

// Helper: run an Effect using the pre-built runtime
const runEffect = <A>(effect: Effect.Effect<A, any, any>): Promise<A> =>
  Runtime.runPromise(runtime)(effect)

// Helper: format MCP response (text + JSON)
const mcpResponse = (text: string, data: unknown) => ({
  content: [
    { type: "text" as const, text },
    { type: "text" as const, text: JSON.stringify(data) }
  ]
})

// Helper: format error response
const mcpError = (error: unknown) => ({
  content: [{
    type: "text" as const,
    text: `Error: ${error instanceof Error ? error.message : String(error)}`
  }],
  isError: true
})

export const createMcpServer = () => {
  const server = new McpServer({
    name: "tx",
    version: "0.1.0"
  })

  // tx_ready — returns TaskWithDeps[]
  server.tool("tx_ready", "Get ready tasks with dependency info", {
    limit: z.number().min(1).max(20).default(5)
  }, async (args) => {
    try {
      const tasks = await runEffect(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady(args.limit)
        })
      )

      const text = tasks.length === 0
        ? "No ready tasks."
        : `${tasks.length} ready task(s):\n${tasks.map((t) =>
            `- ${t.id} [${t.score}]: ${t.title}\n  blocked by: ${t.blockedBy.length > 0 ? t.blockedBy.join(", ") : "(none)"}\n  blocks: ${t.blocks.length > 0 ? t.blocks.join(", ") : "(none)"}`
          ).join("\n")}`

      return mcpResponse(text, { tasks })
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_show — returns TaskWithDeps
  server.tool("tx_show", "Get task details with dependencies", {
    id: z.string()
  }, async (args) => {
    try {
      const task = await runEffect(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.getWithDeps(args.id)
        })
      )

      const text = [
        `Task: ${task.id}`,
        `Title: ${task.title}`,
        `Status: ${task.status}`,
        `Score: ${task.score}`,
        `Ready: ${task.isReady}`,
        `Blocked by: ${task.blockedBy.join(", ") || "(none)"}`,
        `Blocks: ${task.blocks.join(", ") || "(none)"}`,
        `Children: ${task.children.join(", ") || "(none)"}`
      ].join("\n")

      return mcpResponse(text, { task })
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_add — returns TaskWithDeps
  server.tool("tx_add", "Create a new task", {
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    parentId: z.string().optional(),
    score: z.number().default(0)
  }, async (args) => {
    try {
      const task = await runEffect(
        Effect.gen(function* () {
          const svc = yield* TaskService
          const created = yield* svc.create(args)
          return yield* svc.getWithDeps(created.id)
        })
      )

      return mcpResponse(`Created: ${task.id} - ${task.title}`, { task })
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_done — returns TaskWithDeps + nowReady
  server.tool("tx_done", "Complete task, returns newly unblocked tasks", {
    id: z.string()
  }, async (args) => {
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const taskService = yield* TaskService
          const readyService = yield* ReadyService

          yield* taskService.update(args.id, { status: "done" })
          const task = yield* taskService.getWithDeps(args.id)

          const blocking = yield* readyService.getBlocking(args.id)
          const nowReady: string[] = []
          for (const b of blocking) {
            if (yield* readyService.isReady(b.id)) nowReady.push(b.id)
          }

          return { task, nowReady }
        })
      )

      const text = `Completed: ${result.task.id} - ${result.task.title}${
        result.nowReady.length > 0 ? `\nNow unblocked: ${result.nowReady.join(", ")}` : ""
      }`

      return mcpResponse(text, result)
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_update — returns TaskWithDeps
  server.tool("tx_update", "Update task status, score, or details", {
    id: z.string(),
    status: z.enum(["backlog", "ready", "planning", "active", "blocked", "review", "human_needs_to_review", "done"]).optional(),
    score: z.number().optional(),
    title: z.string().optional(),
    description: z.string().optional()
  }, async (args) => {
    try {
      const { id, ...input } = args
      const task = await runEffect(
        Effect.gen(function* () {
          const svc = yield* TaskService
          yield* svc.update(id, input)
          return yield* svc.getWithDeps(id)
        })
      )

      return mcpResponse(`Updated: ${task.id} - ${task.title} [${task.status}]`, { task })
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_list — returns TaskWithDeps[]
  server.tool("tx_list", "List tasks with optional filtering", {
    status: z.enum(["backlog", "ready", "planning", "active", "blocked", "review", "human_needs_to_review", "done"]).optional(),
    parentId: z.string().optional(),
    limit: z.number().min(1).max(100).default(20)
  }, async (args) => {
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const svc = yield* TaskService
          const tasks = yield* svc.listWithDeps({
            status: args.status,
            parentId: args.parentId
          })
          return { tasks: tasks.slice(0, args.limit), total: tasks.length }
        })
      )

      const text = result.tasks.length === 0
        ? "No tasks found."
        : `${result.total} task(s):\n${result.tasks.map(t =>
            `- ${t.id} [${t.status}] ${t.title} (score: ${t.score})`
          ).join("\n")}`

      return mcpResponse(text, result)
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_block — add dependency, returns TaskWithDeps
  server.tool("tx_block", "Add blocking dependency", {
    taskId: z.string(),
    blockerId: z.string()
  }, async (args) => {
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const depService = yield* DependencyService
          const taskService = yield* TaskService
          yield* depService.addBlocker(args.taskId, args.blockerId)
          const task = yield* taskService.getWithDeps(args.taskId)
          return { success: true, task }
        })
      )

      return mcpResponse(
        `${args.blockerId} now blocks ${args.taskId}\nBlocked by: ${result.task.blockedBy.join(", ")}`,
        result
      )
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_unblock — remove dependency
  server.tool("tx_unblock", "Remove blocking dependency", {
    taskId: z.string(),
    blockerId: z.string()
  }, async (args) => {
    try {
      await runEffect(
        Effect.gen(function* () {
          const depService = yield* DependencyService
          yield* depService.removeBlocker(args.taskId, args.blockerId)
        })
      )

      return mcpResponse(`${args.blockerId} no longer blocks ${args.taskId}`, { success: true })
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_children — list child tasks
  server.tool("tx_children", "List child tasks with dependency info", {
    id: z.string()
  }, async (args) => {
    try {
      const children = await runEffect(
        Effect.gen(function* () {
          const svc = yield* TaskService
          const kids = yield* svc.getChildren(args.id)
          // Enrich each child with deps
          const enriched = []
          for (const child of kids) {
            enriched.push(yield* svc.getWithDeps(child.id))
          }
          return enriched
        })
      )

      const text = children.length === 0
        ? "No children."
        : `${children.length} child task(s):\n${children.map(c =>
            `- ${c.id} [${c.status}] ${c.title}`
          ).join("\n")}`

      return mcpResponse(text, { children })
    } catch (error) {
      return mcpError(error)
    }
  })

  // tx_delete — delete a task
  server.tool("tx_delete", "Delete a task", {
    id: z.string()
  }, async (args) => {
    try {
      await runEffect(
        Effect.gen(function* () {
          const svc = yield* TaskService
          yield* svc.delete(args.id)
        })
      )

      return mcpResponse(`Deleted: ${args.id}`, { success: true, id: args.id })
    } catch (error) {
      return mcpError(error)
    }
  })

  return server
}

// Entry point — runs migrations then starts server
export const startMcpServer = async () => {
  // Initialize runtime (runs migrations, builds service layer ONCE)
  await initRuntime()

  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

---

## Claude Code Configuration

```json
{
  "mcpServers": {
    "tx": {
      "command": "npx",
      "args": ["tx", "mcp-server"],
      "env": {
        "TX_DB": ".tx/tasks.db"
      }
    }
  }
}
```

---

## Agent SDK Integration

The Agent SDK does NOT require `ANTHROPIC_API_KEY` for core task operations. The SDK tools work with local subscriptions and any Anthropic-compatible setup.

```typescript
// src/agent-sdk/tools.ts
import { tool } from "@anthropic-ai/agent-sdk"
import { Runtime, Effect, Layer } from "effect"

// Build runtime once, share across all tool executions
let _runtime: Runtime.Runtime<TaskService | ReadyService | DependencyService> | null = null

const getRuntime = async () => {
  if (!_runtime) {
    _runtime = await Effect.runPromise(
      Layer.toRuntime(AppMinimalLive).pipe(Effect.scoped)
    )
  }
  return _runtime
}

const run = async <A>(effect: Effect.Effect<A, any, any>): Promise<A> => {
  const rt = await getRuntime()
  return Runtime.runPromise(rt)(effect)
}

export const agentTasksTools = [
  tool({
    name: "tx_ready",
    description: "Get ready tasks with full dependency info (blockedBy, blocks, children, isReady)",
    parameters: z.object({ limit: z.number().min(1).max(10).default(5) }),
    execute: async (args) => {
      return await run(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady(args.limit)
        })
      )
    }
  }),

  tool({
    name: "tx_add",
    description: "Create a new task, returns task with dependency info",
    parameters: z.object({
      title: z.string(),
      description: z.string().optional(),
      parentId: z.string().optional(),
      score: z.number().default(0)
    }),
    execute: async (args) => {
      return await run(
        Effect.gen(function* () {
          const svc = yield* TaskService
          const task = yield* svc.create(args)
          return yield* svc.getWithDeps(task.id)
        })
      )
    }
  }),

  tool({
    name: "tx_done",
    description: "Complete task, returns newly unblocked tasks",
    parameters: z.object({ id: z.string() }),
    execute: async (args) => {
      return await run(
        Effect.gen(function* () {
          const taskService = yield* TaskService
          const readyService = yield* ReadyService
          yield* taskService.update(args.id, { status: "done" })
          const task = yield* taskService.getWithDeps(args.id)
          const blocking = yield* readyService.getBlocking(args.id)
          const nowReady: string[] = []
          for (const b of blocking) {
            if (yield* readyService.isReady(b.id)) nowReady.push(b.id)
          }
          return { task, nowReady }
        })
      )
    }
  }),

  tool({
    name: "tx_show",
    description: "Get task details with full dependency info",
    parameters: z.object({ id: z.string() }),
    execute: async (args) => {
      return await run(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.getWithDeps(args.id)
        })
      )
    }
  }),

  tool({
    name: "tx_list",
    description: "List tasks with optional filtering",
    parameters: z.object({
      status: z.string().optional(),
      limit: z.number().default(20)
    }),
    execute: async (args) => {
      return await run(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.listWithDeps({ status: args.status as any })
        })
      )
    }
  })
]
```

---

## Known Issues (Bug Scan Findings)

### DirectTransport Status Filter Bug Pattern

**Issue**: When using `DirectTransport` (in-process transport for Agent SDK), the `tx_list` tool's status filter may silently return unfiltered results if the filter parameter is passed incorrectly.

**Root cause**: The `status` parameter type casting `as any` in the tool execution bypasses schema validation:

```typescript
// Problematic pattern
execute: async (args) => {
  return await run(
    Effect.gen(function* () {
      const svc = yield* TaskService
      return yield* svc.listWithDeps({ status: args.status as any })  // ← as any
    })
  )
}
```

**Symptoms**:
- Calling `tx_list({ status: "ready" })` returns tasks with all statuses
- No error is thrown; the filter is silently ignored
- Only manifests with DirectTransport (MCP server via stdio works correctly)

**Fix**:
1. Remove `as any` cast — let TypeScript enforce the union type
2. Validate status against `TaskStatusValues` before passing to service
3. Add integration test that verifies filtering works in DirectTransport mode

**Workaround** (until fixed):
```typescript
// Explicit validation
const validStatuses = ["backlog", "ready", "planning", "active", "blocked", "review", "human_needs_to_review", "done"]
if (args.status && !validStatuses.includes(args.status)) {
  throw new Error(`Invalid status: ${args.status}`)
}
```

### Database Singleton in Agent SDK

**Issue**: Each Agent SDK client instance was creating a new database connection, violating RULE 8 (singleton database pattern).

**Status**: Fixed in commit `d62f554` — `DirectTransport` now uses singleton runtime pattern.

**Verification**: Tests in `packages/agent-sdk/` should verify single database instance across multiple tool calls.

---

## Testing Strategy

### Tool Definition Tests (Unit)

Validate tool schemas and configuration without a database:

```typescript
describe("MCP Tool Definitions (Unit)", () => {
  // === Schema Validation ===

  it("TaskWithDepsSchema validates a complete task", () => {
    const valid = {
      id: "tx-abc123", title: "Test", description: "", status: "ready",
      score: 500, parentId: null, createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z", completedAt: null,
      blockedBy: [], blocks: ["tx-def456"], children: [], isReady: true
    }
    expect(() => TaskWithDepsSchema.parse(valid)).not.toThrow()
  })

  it("TaskWithDepsSchema rejects task missing blockedBy", () => {
    const invalid = {
      id: "tx-abc123", title: "Test", status: "ready", score: 500
      // Missing blockedBy, blocks, children, isReady
    }
    expect(() => TaskWithDepsSchema.parse(invalid)).toThrow()
  })

  it("TaskWithDepsSchema rejects task with non-array blockedBy", () => {
    const invalid = {
      id: "tx-abc123", title: "Test", description: "", status: "ready",
      score: 500, parentId: null, createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z", completedAt: null,
      blockedBy: "tx-other",  // Should be array
      blocks: [], children: [], isReady: true
    }
    expect(() => TaskWithDepsSchema.parse(invalid)).toThrow()
  })

  // === Tool Input Validation ===

  it("tx_ready input rejects limit > 20", () => {
    const schema = mcpTools.tx_ready.inputSchema
    expect(() => schema.parse({ limit: 21 })).toThrow()
  })

  it("tx_ready input defaults limit to 5", () => {
    const schema = mcpTools.tx_ready.inputSchema
    const parsed = schema.parse({})
    expect(parsed.limit).toBe(5)
  })

  it("tx_add input rejects empty title", () => {
    const schema = mcpTools.tx_add.inputSchema
    expect(() => schema.parse({ title: "" })).toThrow()
  })

  it("tx_add input rejects title > 200 chars", () => {
    const schema = mcpTools.tx_add.inputSchema
    expect(() => schema.parse({ title: "a".repeat(201) })).toThrow()
  })

  it("tx_update input accepts partial fields", () => {
    const schema = mcpTools.tx_update.inputSchema
    const parsed = schema.parse({ id: "tx-abc123", score: 800 })
    expect(parsed.id).toBe("tx-abc123")
    expect(parsed.score).toBe(800)
    expect(parsed.status).toBeUndefined()
  })

  it("tx_update input validates status enum", () => {
    const schema = mcpTools.tx_update.inputSchema
    expect(() => schema.parse({ id: "tx-abc123", status: "invalid" })).toThrow()
  })

  // === All Tools Registered ===

  it("all required tools are defined", () => {
    const toolNames = Object.keys(mcpTools)
    expect(toolNames).toContain("tx_ready")
    expect(toolNames).toContain("tx_show")
    expect(toolNames).toContain("tx_list")
    expect(toolNames).toContain("tx_add")
    expect(toolNames).toContain("tx_done")
    expect(toolNames).toContain("tx_update")
    expect(toolNames).toContain("tx_block")
    expect(toolNames).toContain("tx_children")
  })

  it("all tools have descriptions for LLM understanding", () => {
    for (const [name, tool] of Object.entries(mcpTools)) {
      expect(tool.description).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(20)  // Not a stub
    }
  })

  // === Output Formatting ===

  it("formats empty ready list with helpful message", () => {
    const text = formatReadyText([])
    expect(text).toContain("No ready tasks")
  })

  it("formats ready list with dependency info", () => {
    const tasks = [{
      id: "tx-abc123", title: "Test", score: 500,
      blockedBy: [], blocks: ["tx-def456"], children: [], isReady: true
    }]
    const text = formatReadyText(tasks)
    expect(text).toContain("tx-abc123")
    expect(text).toContain("blocks:")
    expect(text).toContain("tx-def456")
  })
})
```

### MCP Tool Response Tests (Integration)

Every MCP tool must be tested to verify it returns `TaskWithDeps` with correct dependency data:

```typescript
describe("MCP Server Integration", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
  })

  // === TaskWithDeps Compliance ===

  it("tx_ready returns tasks with all TaskWithDeps fields", async () => {
    const result = await callMcpTool(db, "tx_ready", { limit: 10 })

    for (const task of result.structuredContent.tasks) {
      expect(task).toHaveProperty("id")
      expect(task).toHaveProperty("title")
      expect(task).toHaveProperty("status")
      expect(task).toHaveProperty("score")
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
      expect(Array.isArray(task.blockedBy)).toBe(true)
      expect(Array.isArray(task.blocks)).toBe(true)
      expect(Array.isArray(task.children)).toBe(true)
      expect(typeof task.isReady).toBe("boolean")
    }
  })

  it("tx_show returns TaskWithDeps", async () => {
    const result = await callMcpTool(db, "tx_show", { id: FIXTURES.TASK_JWT })
    const task = result.structuredContent.task

    expect(task.id).toBe(FIXTURES.TASK_JWT)
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")
    expect(task.blocks).toContain(FIXTURES.TASK_BLOCKED)
  })

  it("tx_list returns TaskWithDeps[]", async () => {
    const result = await callMcpTool(db, "tx_list", { limit: 20 })

    for (const task of result.structuredContent.tasks) {
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
    }
  })

  it("tx_add returns created task as TaskWithDeps", async () => {
    const result = await callMcpTool(db, "tx_add", {
      title: "New MCP task",
      score: 600
    })

    const task = result.structuredContent.task
    expect(task.title).toBe("New MCP task")
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task.blockedBy).toEqual([])
    expect(task.blocks).toEqual([])
    expect(task.children).toEqual([])
    expect(task.isReady).toBe(true)
  })

  it("tx_update returns updated task as TaskWithDeps", async () => {
    const result = await callMcpTool(db, "tx_update", {
      id: FIXTURES.TASK_LOGIN,
      score: 999
    })

    expect(result.structuredContent.task.score).toBe(999)
    expect(result.structuredContent.task).toHaveProperty("blockedBy")
  })

  // === Dependency Data Accuracy ===

  it("tx_show returns correct blockedBy for blocked task", async () => {
    const result = await callMcpTool(db, "tx_show", { id: FIXTURES.TASK_BLOCKED })
    const task = result.structuredContent.task

    expect(task.blockedBy).toEqual(
      expect.arrayContaining([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
    )
    expect(task.isReady).toBe(false)
  })

  it("tx_block returns task with updated blockedBy", async () => {
    const result = await callMcpTool(db, "tx_block", {
      taskId: FIXTURES.TASK_LOGIN,
      blockerId: FIXTURES.TASK_AUTH
    })

    expect(result.structuredContent.success).toBe(true)
    expect(result.structuredContent.task.blockedBy).toContain(FIXTURES.TASK_AUTH)
  })

  it("tx_done returns nowReady list", async () => {
    // Complete both blockers
    await callMcpTool(db, "tx_done", { id: FIXTURES.TASK_JWT })
    const result = await callMcpTool(db, "tx_done", { id: FIXTURES.TASK_LOGIN })

    expect(result.structuredContent).toHaveProperty("nowReady")
    expect(result.structuredContent.nowReady).toContain(FIXTURES.TASK_BLOCKED)
  })

  // === Text Output ===

  it("tx_ready text output includes dependency info", async () => {
    const result = await callMcpTool(db, "tx_ready", { limit: 5 })
    const text = result.content[0].text

    expect(text).toContain("blocked by:")
    expect(text).toContain("blocks:")
  })

  it("tx_show text output includes all fields", async () => {
    const result = await callMcpTool(db, "tx_show", { id: FIXTURES.TASK_AUTH })
    const text = result.content[0].text

    expect(text).toContain("Blocked by:")
    expect(text).toContain("Blocks:")
    expect(text).toContain("Children:")
    expect(text).toContain("Ready:")
  })

  // === Error Handling ===

  it("tx_show returns error for nonexistent task", async () => {
    await expect(callMcpTool(db, "tx_show", { id: "tx-nonexist" }))
      .rejects.toThrow()
  })

  it("tx_block returns error for circular dependency", async () => {
    await expect(
      callMcpTool(db, "tx_block", {
        taskId: FIXTURES.TASK_JWT,
        blockerId: FIXTURES.TASK_BLOCKED
      })
    ).rejects.toThrow()
  })
})
```

### Agent SDK Tool Tests

```typescript
describe("Agent SDK Tools", () => {
  it("tx_ready tool returns TaskWithDeps[]", async () => {
    const db = createTestDb()
    seedFixtures(db)
    const tool = agentTasksTools.find(t => t.name === "tx_ready")!
    const result = await tool.execute({ limit: 5 })

    for (const task of result) {
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("isReady")
    }
  })

  it("tx_done tool returns nowReady list", async () => {
    const db = createTestDb()
    seedFixtures(db)
    // Complete both blockers
    const doneTool = agentTasksTools.find(t => t.name === "tx_done")!
    await doneTool.execute({ id: FIXTURES.TASK_JWT })
    const result = await doneTool.execute({ id: FIXTURES.TASK_LOGIN })

    expect(result).toHaveProperty("nowReady")
    expect(Array.isArray(result.nowReady)).toBe(true)
  })
})
```

### Test Helper

```typescript
// test/helpers/mcp.ts
async function callMcpTool(db: Database.Database, toolName: string, args: Record<string, unknown>) {
  const server = createMcpServer(db)  // Server accepts db for testing
  return await server.callTool(toolName, args)
}
```

---

## Related Documents

- [PRD-007: Multi-Interface Integration](../prd/PRD-007-multi-interface-integration.md)
- [DD-002: Effect-TS Service Layer](./DD-002-effect-ts-service-layer.md)
- [DD-003: CLI Implementation](./DD-003-cli-implementation.md)
- [DD-008: OpenTelemetry Integration](./DD-008-opentelemetry-integration.md)
