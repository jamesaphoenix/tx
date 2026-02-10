/**
 * MCP Tool Schema Unit Tests
 *
 * Tests:
 * 1. TaskWithDeps schema validation
 * 2. Tool input schema validation (limits, required fields, enum values)
 * 3. Tool registration verification
 * 4. Text output formatter tests
 */
import { describe, it, expect } from "vitest"
import { Schema, Either } from "effect"
import { TASK_STATUSES, type TaskWithDeps, type TaskId } from "@jamesaphoenix/tx-types"
import { fixtureId } from "../fixtures.js"

// -----------------------------------------------------------------------------
// Helper: safeParse using Effect Schema (replaces Zod safeParse)
// -----------------------------------------------------------------------------

function safeParse<A, I>(schema: Schema.Schema<A, I>, data: unknown): { success: boolean } {
  const result = Schema.decodeUnknownEither(schema)(data)
  return { success: Either.isRight(result) }
}

// -----------------------------------------------------------------------------
// Tool Input Schemas (mirrored from MCP server for unit testing)
// Using Effect Schema per DOCTRINE Rule 10
// -----------------------------------------------------------------------------

const PositiveInt = Schema.Number.pipe(Schema.int(), Schema.positive())

const TaskStatusEnum = Schema.Literal(...TASK_STATUSES)

const toolSchemas = {
  tx_ready: Schema.Struct({
    limit: Schema.optional(PositiveInt)
  }),
  tx_show: Schema.Struct({
    id: Schema.String
  }),
  tx_list: Schema.Struct({
    status: Schema.optional(TaskStatusEnum),
    parentId: Schema.optional(Schema.String),
    limit: Schema.optional(PositiveInt)
  }),
  tx_children: Schema.Struct({
    id: Schema.String
  }),
  tx_add: Schema.Struct({
    title: Schema.String,
    description: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.String),
    score: Schema.optional(Schema.Number.pipe(Schema.int()))
  }),
  tx_update: Schema.Struct({
    id: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    status: Schema.optional(TaskStatusEnum),
    parentId: Schema.optional(Schema.NullOr(Schema.String)),
    score: Schema.optional(Schema.Number.pipe(Schema.int()))
  }),
  tx_done: Schema.Struct({
    id: Schema.String
  }),
  tx_delete: Schema.Struct({
    id: Schema.String
  }),
  tx_block: Schema.Struct({
    taskId: Schema.String,
    blockerId: Schema.String
  }),
  tx_unblock: Schema.Struct({
    taskId: Schema.String,
    blockerId: Schema.String
  })
} as const

// All registered tool names
const REGISTERED_TOOLS = [
  "tx_ready",
  "tx_show",
  "tx_list",
  "tx_children",
  "tx_add",
  "tx_update",
  "tx_done",
  "tx_delete",
  "tx_block",
  "tx_unblock"
] as const

// -----------------------------------------------------------------------------
// TaskWithDeps Serialization (mirrored from MCP server)
// -----------------------------------------------------------------------------

const serializeTask = (task: TaskWithDeps): Record<string, unknown> => ({
  id: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  parentId: task.parentId,
  score: task.score,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  completedAt: task.completedAt?.toISOString() ?? null,
  metadata: task.metadata,
  blockedBy: task.blockedBy,
  blocks: task.blocks,
  children: task.children,
  isReady: task.isReady
})

// TaskWithDeps validation schema for serialized output
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

const TaskWithDepsOutputSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^tx-[a-z0-9]{6,12}$/)),
  title: Schema.String,
  description: Schema.String,
  status: TaskStatusEnum,
  parentId: Schema.NullOr(Schema.String),
  score: Schema.Number.pipe(Schema.int()),
  createdAt: Schema.String.pipe(Schema.pattern(isoDatePattern)),
  updatedAt: Schema.String.pipe(Schema.pattern(isoDatePattern)),
  completedAt: Schema.NullOr(Schema.String.pipe(Schema.pattern(isoDatePattern))),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  blockedBy: Schema.Array(Schema.String),
  blocks: Schema.Array(Schema.String),
  children: Schema.Array(Schema.String),
  isReady: Schema.Boolean
})

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

function makeTestTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: fixtureId("test-task"),
    title: "Test Task",
    description: "A test task description",
    status: "backlog",
    parentId: null,
    score: 500,
    createdAt: new Date("2026-01-15T10:00:00Z"),
    updatedAt: new Date("2026-01-15T10:00:00Z"),
    completedAt: null,
    metadata: {},
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: true,
    ...overrides
  }
}

// -----------------------------------------------------------------------------
// TaskWithDeps Schema Validation Tests
// -----------------------------------------------------------------------------

describe("TaskWithDeps Schema Validation", () => {
  it("validates correct TaskWithDeps structure", () => {
    const task = makeTestTask()
    const serialized = serializeTask(task)

    const result = safeParse(TaskWithDepsOutputSchema, serialized)
    expect(result.success).toBe(true)
  })

  it("includes all required TaskWithDeps fields", () => {
    const task = makeTestTask()
    const serialized = serializeTask(task)

    // Core Task fields
    expect(serialized).toHaveProperty("id")
    expect(serialized).toHaveProperty("title")
    expect(serialized).toHaveProperty("description")
    expect(serialized).toHaveProperty("status")
    expect(serialized).toHaveProperty("parentId")
    expect(serialized).toHaveProperty("score")
    expect(serialized).toHaveProperty("createdAt")
    expect(serialized).toHaveProperty("updatedAt")
    expect(serialized).toHaveProperty("completedAt")
    expect(serialized).toHaveProperty("metadata")

    // TaskWithDeps-specific fields (Rule 1)
    expect(serialized).toHaveProperty("blockedBy")
    expect(serialized).toHaveProperty("blocks")
    expect(serialized).toHaveProperty("children")
    expect(serialized).toHaveProperty("isReady")
  })

  it("validates blockedBy is an array of task IDs", () => {
    const task = makeTestTask({
      blockedBy: [fixtureId("blocker-1"), fixtureId("blocker-2")]
    })
    const serialized = serializeTask(task)

    expect(Array.isArray(serialized.blockedBy)).toBe(true)
    expect(serialized.blockedBy).toHaveLength(2)
    for (const id of serialized.blockedBy as string[]) {
      expect(id).toMatch(/^tx-[a-z0-9]{6,12}$/)
    }
  })

  it("validates blocks is an array of task IDs", () => {
    const task = makeTestTask({
      blocks: [fixtureId("blocked-1"), fixtureId("blocked-2"), fixtureId("blocked-3")]
    })
    const serialized = serializeTask(task)

    expect(Array.isArray(serialized.blocks)).toBe(true)
    expect(serialized.blocks).toHaveLength(3)
  })

  it("validates children is an array of task IDs", () => {
    const task = makeTestTask({
      children: [fixtureId("child-1")]
    })
    const serialized = serializeTask(task)

    expect(Array.isArray(serialized.children)).toBe(true)
    expect(serialized.children).toHaveLength(1)
  })

  it("validates isReady is a boolean", () => {
    const readyTask = makeTestTask({ isReady: true })
    const notReadyTask = makeTestTask({ isReady: false })

    expect(serializeTask(readyTask).isReady).toBe(true)
    expect(serializeTask(notReadyTask).isReady).toBe(false)
  })

  it("serializes dates to ISO strings", () => {
    const task = makeTestTask({
      createdAt: new Date("2026-01-15T10:00:00.000Z"),
      updatedAt: new Date("2026-01-15T12:00:00.000Z"),
      completedAt: new Date("2026-01-15T14:00:00.000Z")
    })
    const serialized = serializeTask(task)

    expect(serialized.createdAt).toBe("2026-01-15T10:00:00.000Z")
    expect(serialized.updatedAt).toBe("2026-01-15T12:00:00.000Z")
    expect(serialized.completedAt).toBe("2026-01-15T14:00:00.000Z")
  })

  it("serializes null completedAt correctly", () => {
    const task = makeTestTask({ completedAt: null })
    const serialized = serializeTask(task)

    expect(serialized.completedAt).toBeNull()
  })

  it("validates all valid task statuses", () => {
    for (const status of TASK_STATUSES) {
      const task = makeTestTask({ status })
      const serialized = serializeTask(task)
      const result = safeParse(TaskWithDepsOutputSchema, serialized)
      expect(result.success).toBe(true)
    }
  })

  it("validates task ID format", () => {
    const task = makeTestTask()
    const serialized = serializeTask(task)

    expect(serialized.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
  })

  it("preserves metadata as object", () => {
    const task = makeTestTask({
      metadata: { key: "value", nested: { deep: true }, count: 42 }
    })
    const serialized = serializeTask(task)

    expect(serialized.metadata).toEqual({ key: "value", nested: { deep: true }, count: 42 })
  })
})

// -----------------------------------------------------------------------------
// Tool Input Schema Validation Tests
// -----------------------------------------------------------------------------

describe("Tool Input Schema Validation", () => {
  describe("tx_ready", () => {
    it("accepts empty object (no parameters)", () => {
      const result = safeParse(toolSchemas.tx_ready, {})
      expect(result.success).toBe(true)
    })

    it("accepts valid limit", () => {
      const result = safeParse(toolSchemas.tx_ready, { limit: 10 })
      expect(result.success).toBe(true)
    })

    it("rejects negative limit", () => {
      const result = safeParse(toolSchemas.tx_ready, { limit: -1 })
      expect(result.success).toBe(false)
    })

    it("rejects zero limit", () => {
      const result = safeParse(toolSchemas.tx_ready, { limit: 0 })
      expect(result.success).toBe(false)
    })

    it("rejects non-integer limit", () => {
      const result = safeParse(toolSchemas.tx_ready, { limit: 1.5 })
      expect(result.success).toBe(false)
    })

    it("rejects string limit", () => {
      const result = safeParse(toolSchemas.tx_ready, { limit: "10" })
      expect(result.success).toBe(false)
    })
  })

  describe("tx_show", () => {
    it("requires id field", () => {
      const result = safeParse(toolSchemas.tx_show, {})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = safeParse(toolSchemas.tx_show, { id: "tx-12345678" })
      expect(result.success).toBe(true)
    })

    it("accepts any string as id (validation happens at runtime)", () => {
      const result = safeParse(toolSchemas.tx_show, { id: "invalid-id" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_list", () => {
    it("accepts empty object", () => {
      const result = safeParse(toolSchemas.tx_list, {})
      expect(result.success).toBe(true)
    })

    it("accepts status filter", () => {
      const result = safeParse(toolSchemas.tx_list, { status: "ready" })
      expect(result.success).toBe(true)
    })

    it("accepts parentId filter", () => {
      const result = safeParse(toolSchemas.tx_list, { parentId: "tx-12345678" })
      expect(result.success).toBe(true)
    })

    it("accepts limit filter", () => {
      const result = safeParse(toolSchemas.tx_list, { limit: 50 })
      expect(result.success).toBe(true)
    })

    it("accepts all filters combined", () => {
      const result = safeParse(toolSchemas.tx_list, {
        status: "active",
        parentId: "tx-12345678",
        limit: 25
      })
      expect(result.success).toBe(true)
    })

    it("rejects invalid limit", () => {
      const result = safeParse(toolSchemas.tx_list, { limit: -5 })
      expect(result.success).toBe(false)
    })

    it("rejects invalid status value", () => {
      const result = safeParse(toolSchemas.tx_list, { status: "invalid_status" })
      expect(result.success).toBe(false)
    })

    it("accepts all valid status values", () => {
      for (const status of TASK_STATUSES) {
        const result = safeParse(toolSchemas.tx_list, { status })
        expect(result.success).toBe(true)
      }
    })
  })

  describe("tx_children", () => {
    it("requires id field", () => {
      const result = safeParse(toolSchemas.tx_children, {})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = safeParse(toolSchemas.tx_children, { id: "tx-12345678" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_add", () => {
    it("requires title field", () => {
      const result = safeParse(toolSchemas.tx_add, {})
      expect(result.success).toBe(false)
    })

    it("accepts only title", () => {
      const result = safeParse(toolSchemas.tx_add, { title: "New task" })
      expect(result.success).toBe(true)
    })

    it("accepts all optional fields", () => {
      const result = safeParse(toolSchemas.tx_add, {
        title: "New task",
        description: "Task description",
        parentId: "tx-12345678",
        score: 750
      })
      expect(result.success).toBe(true)
    })

    it("accepts empty string title (validation at runtime)", () => {
      const result = safeParse(toolSchemas.tx_add, { title: "" })
      expect(result.success).toBe(true) // Schema allows it, runtime validation catches it
    })

    it("rejects non-integer score", () => {
      const result = safeParse(toolSchemas.tx_add, { title: "Task", score: 75.5 })
      expect(result.success).toBe(false)
    })

    it("accepts negative score (valid for low priority)", () => {
      const result = safeParse(toolSchemas.tx_add, { title: "Task", score: -100 })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_update", () => {
    it("requires id field", () => {
      const result = safeParse(toolSchemas.tx_update, {})
      expect(result.success).toBe(false)
    })

    it("accepts only id (no updates)", () => {
      const result = safeParse(toolSchemas.tx_update, { id: "tx-12345678" })
      expect(result.success).toBe(true)
    })

    it("accepts all update fields", () => {
      const result = safeParse(toolSchemas.tx_update, {
        id: "tx-12345678",
        title: "Updated title",
        description: "Updated description",
        status: "active",
        parentId: "tx-87654321",
        score: 900
      })
      expect(result.success).toBe(true)
    })

    it("accepts null parentId (to remove parent)", () => {
      const result = safeParse(toolSchemas.tx_update, {
        id: "tx-12345678",
        parentId: null
      })
      expect(result.success).toBe(true)
    })

    it("rejects non-integer score", () => {
      const result = safeParse(toolSchemas.tx_update, {
        id: "tx-12345678",
        score: 75.5
      })
      expect(result.success).toBe(false)
    })

    it("rejects invalid status value", () => {
      const result = safeParse(toolSchemas.tx_update, {
        id: "tx-12345678",
        status: "invalid_status"
      })
      expect(result.success).toBe(false)
    })

    it("accepts all valid status values", () => {
      for (const status of TASK_STATUSES) {
        const result = safeParse(toolSchemas.tx_update, { id: "tx-12345678", status })
        expect(result.success).toBe(true)
      }
    })
  })

  describe("tx_done", () => {
    it("requires id field", () => {
      const result = safeParse(toolSchemas.tx_done, {})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = safeParse(toolSchemas.tx_done, { id: "tx-12345678" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_delete", () => {
    it("requires id field", () => {
      const result = safeParse(toolSchemas.tx_delete, {})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = safeParse(toolSchemas.tx_delete, { id: "tx-12345678" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_block", () => {
    it("requires both taskId and blockerId", () => {
      expect(safeParse(toolSchemas.tx_block, {}).success).toBe(false)
      expect(safeParse(toolSchemas.tx_block, { taskId: "tx-1" }).success).toBe(false)
      expect(safeParse(toolSchemas.tx_block, { blockerId: "tx-2" }).success).toBe(false)
    })

    it("accepts valid taskId and blockerId", () => {
      const result = safeParse(toolSchemas.tx_block, {
        taskId: "tx-12345678",
        blockerId: "tx-87654321"
      })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_unblock", () => {
    it("requires both taskId and blockerId", () => {
      expect(safeParse(toolSchemas.tx_unblock, {}).success).toBe(false)
      expect(safeParse(toolSchemas.tx_unblock, { taskId: "tx-1" }).success).toBe(false)
      expect(safeParse(toolSchemas.tx_unblock, { blockerId: "tx-2" }).success).toBe(false)
    })

    it("accepts valid taskId and blockerId", () => {
      const result = safeParse(toolSchemas.tx_unblock, {
        taskId: "tx-12345678",
        blockerId: "tx-87654321"
      })
      expect(result.success).toBe(true)
    })
  })
})

// -----------------------------------------------------------------------------
// Tool Registration Verification Tests
// -----------------------------------------------------------------------------

describe("Tool Registration Verification", () => {
  it("has schema for all registered tools", () => {
    for (const toolName of REGISTERED_TOOLS) {
      expect(toolSchemas).toHaveProperty(toolName)
      expect(toolSchemas[toolName]).toBeDefined()
    }
  })

  it("registers correct number of tools", () => {
    expect(Object.keys(toolSchemas)).toHaveLength(REGISTERED_TOOLS.length)
  })

  it("tool names follow tx_ prefix convention", () => {
    for (const toolName of REGISTERED_TOOLS) {
      expect(toolName).toMatch(/^tx_[a-z_]+$/)
    }
  })

  it("has read-only tools", () => {
    const readOnlyTools = ["tx_ready", "tx_show", "tx_list", "tx_children"]
    for (const tool of readOnlyTools) {
      expect(REGISTERED_TOOLS).toContain(tool)
    }
  })

  it("has write tools", () => {
    const writeTools = ["tx_add", "tx_update", "tx_done", "tx_delete"]
    for (const tool of writeTools) {
      expect(REGISTERED_TOOLS).toContain(tool)
    }
  })

  it("has dependency management tools", () => {
    const depTools = ["tx_block", "tx_unblock"]
    for (const tool of depTools) {
      expect(REGISTERED_TOOLS).toContain(tool)
    }
  })
})

// -----------------------------------------------------------------------------
// Text Output Formatter Tests
// -----------------------------------------------------------------------------

describe("Text Output Formatter", () => {
  it("serializes basic task correctly", () => {
    const task = makeTestTask()
    const serialized = serializeTask(task)

    expect(typeof serialized.id).toBe("string")
    expect(typeof serialized.title).toBe("string")
    expect(typeof serialized.description).toBe("string")
    expect(typeof serialized.status).toBe("string")
    expect(typeof serialized.score).toBe("number")
    expect(typeof serialized.isReady).toBe("boolean")
  })

  it("produces valid JSON", () => {
    const task = makeTestTask({
      metadata: { special: "chars: \"quotes\" and 'apostrophes'" }
    })
    const serialized = serializeTask(task)

    const json = JSON.stringify(serialized)
    expect(() => JSON.parse(json)).not.toThrow()
    expect(JSON.parse(json).metadata.special).toBe("chars: \"quotes\" and 'apostrophes'")
  })

  it("handles complex metadata", () => {
    const task = makeTestTask({
      metadata: {
        string: "value",
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { deep: { value: "found" } }
      }
    })
    const serialized = serializeTask(task)
    const json = JSON.stringify(serialized)
    const parsed = JSON.parse(json)

    expect(parsed.metadata.string).toBe("value")
    expect(parsed.metadata.number).toBe(42)
    expect(parsed.metadata.boolean).toBe(true)
    expect(parsed.metadata.null).toBeNull()
    expect(parsed.metadata.array).toEqual([1, 2, 3])
    expect(parsed.metadata.nested.deep.value).toBe("found")
  })

  it("handles empty arrays for dependency fields", () => {
    const task = makeTestTask({
      blockedBy: [],
      blocks: [],
      children: []
    })
    const serialized = serializeTask(task)

    expect(serialized.blockedBy).toEqual([])
    expect(serialized.blocks).toEqual([])
    expect(serialized.children).toEqual([])
  })

  it("handles populated dependency fields", () => {
    const task = makeTestTask({
      blockedBy: [fixtureId("b1"), fixtureId("b2")] as TaskId[],
      blocks: [fixtureId("blocked-a")] as TaskId[],
      children: [fixtureId("c1"), fixtureId("c2"), fixtureId("c3")] as TaskId[]
    })
    const serialized = serializeTask(task)

    expect(serialized.blockedBy).toHaveLength(2)
    expect(serialized.blocks).toHaveLength(1)
    expect(serialized.children).toHaveLength(3)
  })

  it("preserves task with all statuses", () => {
    for (const status of TASK_STATUSES) {
      const task = makeTestTask({ status })
      const serialized = serializeTask(task)
      expect(serialized.status).toBe(status)
    }
  })

  it("serializes task with parent ID", () => {
    const task = makeTestTask({
      parentId: fixtureId("parent")
    })
    const serialized = serializeTask(task)

    expect(serialized.parentId).toBe(fixtureId("parent"))
  })

  it("serializes task without parent ID as null", () => {
    const task = makeTestTask({ parentId: null })
    const serialized = serializeTask(task)

    expect(serialized.parentId).toBeNull()
  })

  it("handles Unicode in title and description", () => {
    const task = makeTestTask({
      title: "Task with emoji \u{1F389} and symbols \u2122",
      description: "\u65E5\u672C\u8A9E\u30C6\u30B9\u30C8 with Arabic \u0627\u0644\u0639\u0631\u0628\u064A\u0629 and Cyrillic \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430"
    })
    const serialized = serializeTask(task)
    const json = JSON.stringify(serialized)
    const parsed = JSON.parse(json)

    expect(parsed.title).toBe("Task with emoji \u{1F389} and symbols \u2122")
    expect(parsed.description).toContain("\u65E5\u672C\u8A9E\u30C6\u30B9\u30C8")
    expect(parsed.description).toContain("\u0627\u0644\u0639\u0631\u0628\u064A\u0629")
    expect(parsed.description).toContain("\u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430")
  })

  it("handles very long strings", () => {
    const longString = "a".repeat(10000)
    const task = makeTestTask({
      title: longString,
      description: longString
    })
    const serialized = serializeTask(task)

    expect(serialized.title).toHaveLength(10000)
    expect(serialized.description).toHaveLength(10000)
  })

  it("handles extreme score values", () => {
    const highScore = makeTestTask({ score: Number.MAX_SAFE_INTEGER })
    const lowScore = makeTestTask({ score: Number.MIN_SAFE_INTEGER })
    const zeroScore = makeTestTask({ score: 0 })

    expect(serializeTask(highScore).score).toBe(Number.MAX_SAFE_INTEGER)
    expect(serializeTask(lowScore).score).toBe(Number.MIN_SAFE_INTEGER)
    expect(serializeTask(zeroScore).score).toBe(0)
  })
})
