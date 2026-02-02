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
import { z } from "zod"
import { TASK_STATUSES, type TaskWithDeps, type TaskId } from "@tx/types"
import { fixtureId } from "../fixtures.js"

// -----------------------------------------------------------------------------
// Tool Input Schemas (mirrored from MCP server for unit testing)
// -----------------------------------------------------------------------------

const toolSchemas = {
  tx_ready: z.object({
    limit: z.number().int().positive().optional()
  }),
  tx_show: z.object({
    id: z.string()
  }),
  tx_list: z.object({
    status: z.string().optional(),
    parentId: z.string().optional(),
    limit: z.number().int().positive().optional()
  }),
  tx_children: z.object({
    id: z.string()
  }),
  tx_add: z.object({
    title: z.string(),
    description: z.string().optional(),
    parentId: z.string().optional(),
    score: z.number().int().optional()
  }),
  tx_update: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    parentId: z.string().nullable().optional(),
    score: z.number().int().optional()
  }),
  tx_done: z.object({
    id: z.string()
  }),
  tx_delete: z.object({
    id: z.string()
  }),
  tx_block: z.object({
    taskId: z.string(),
    blockerId: z.string()
  }),
  tx_unblock: z.object({
    taskId: z.string(),
    blockerId: z.string()
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
// ISO 8601 date pattern for validation
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

const TaskWithDepsOutputSchema = z.object({
  id: z.string().regex(/^tx-[a-z0-9]{6,8}$/),
  title: z.string(),
  description: z.string(),
  status: z.enum(TASK_STATUSES),
  parentId: z.string().nullable(),
  score: z.number().int(),
  createdAt: z.string().regex(isoDatePattern),
  updatedAt: z.string().regex(isoDatePattern),
  completedAt: z.string().regex(isoDatePattern).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  blockedBy: z.array(z.string()),
  blocks: z.array(z.string()),
  children: z.array(z.string()),
  isReady: z.boolean()
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

    const result = TaskWithDepsOutputSchema.safeParse(serialized)
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
      expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
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
      const result = TaskWithDepsOutputSchema.safeParse(serialized)
      expect(result.success).toBe(true)
    }
  })

  it("validates task ID format", () => {
    const task = makeTestTask()
    const serialized = serializeTask(task)

    expect(serialized.id).toMatch(/^tx-[a-z0-9]{8}$/)
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
      const result = toolSchemas.tx_ready.safeParse({})
      expect(result.success).toBe(true)
    })

    it("accepts valid limit", () => {
      const result = toolSchemas.tx_ready.safeParse({ limit: 10 })
      expect(result.success).toBe(true)
    })

    it("rejects negative limit", () => {
      const result = toolSchemas.tx_ready.safeParse({ limit: -1 })
      expect(result.success).toBe(false)
    })

    it("rejects zero limit", () => {
      const result = toolSchemas.tx_ready.safeParse({ limit: 0 })
      expect(result.success).toBe(false)
    })

    it("rejects non-integer limit", () => {
      const result = toolSchemas.tx_ready.safeParse({ limit: 1.5 })
      expect(result.success).toBe(false)
    })

    it("rejects string limit", () => {
      const result = toolSchemas.tx_ready.safeParse({ limit: "10" })
      expect(result.success).toBe(false)
    })
  })

  describe("tx_show", () => {
    it("requires id field", () => {
      const result = toolSchemas.tx_show.safeParse({})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = toolSchemas.tx_show.safeParse({ id: "tx-12345678" })
      expect(result.success).toBe(true)
    })

    it("accepts any string as id (validation happens at runtime)", () => {
      const result = toolSchemas.tx_show.safeParse({ id: "invalid-id" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_list", () => {
    it("accepts empty object", () => {
      const result = toolSchemas.tx_list.safeParse({})
      expect(result.success).toBe(true)
    })

    it("accepts status filter", () => {
      const result = toolSchemas.tx_list.safeParse({ status: "ready" })
      expect(result.success).toBe(true)
    })

    it("accepts parentId filter", () => {
      const result = toolSchemas.tx_list.safeParse({ parentId: "tx-12345678" })
      expect(result.success).toBe(true)
    })

    it("accepts limit filter", () => {
      const result = toolSchemas.tx_list.safeParse({ limit: 50 })
      expect(result.success).toBe(true)
    })

    it("accepts all filters combined", () => {
      const result = toolSchemas.tx_list.safeParse({
        status: "active",
        parentId: "tx-12345678",
        limit: 25
      })
      expect(result.success).toBe(true)
    })

    it("rejects invalid limit", () => {
      const result = toolSchemas.tx_list.safeParse({ limit: -5 })
      expect(result.success).toBe(false)
    })
  })

  describe("tx_children", () => {
    it("requires id field", () => {
      const result = toolSchemas.tx_children.safeParse({})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = toolSchemas.tx_children.safeParse({ id: "tx-12345678" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_add", () => {
    it("requires title field", () => {
      const result = toolSchemas.tx_add.safeParse({})
      expect(result.success).toBe(false)
    })

    it("accepts only title", () => {
      const result = toolSchemas.tx_add.safeParse({ title: "New task" })
      expect(result.success).toBe(true)
    })

    it("accepts all optional fields", () => {
      const result = toolSchemas.tx_add.safeParse({
        title: "New task",
        description: "Task description",
        parentId: "tx-12345678",
        score: 750
      })
      expect(result.success).toBe(true)
    })

    it("accepts empty string title (validation at runtime)", () => {
      const result = toolSchemas.tx_add.safeParse({ title: "" })
      expect(result.success).toBe(true) // Schema allows it, runtime validation catches it
    })

    it("rejects non-integer score", () => {
      const result = toolSchemas.tx_add.safeParse({ title: "Task", score: 75.5 })
      expect(result.success).toBe(false)
    })

    it("accepts negative score (valid for low priority)", () => {
      const result = toolSchemas.tx_add.safeParse({ title: "Task", score: -100 })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_update", () => {
    it("requires id field", () => {
      const result = toolSchemas.tx_update.safeParse({})
      expect(result.success).toBe(false)
    })

    it("accepts only id (no updates)", () => {
      const result = toolSchemas.tx_update.safeParse({ id: "tx-12345678" })
      expect(result.success).toBe(true)
    })

    it("accepts all update fields", () => {
      const result = toolSchemas.tx_update.safeParse({
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
      const result = toolSchemas.tx_update.safeParse({
        id: "tx-12345678",
        parentId: null
      })
      expect(result.success).toBe(true)
    })

    it("rejects non-integer score", () => {
      const result = toolSchemas.tx_update.safeParse({
        id: "tx-12345678",
        score: 75.5
      })
      expect(result.success).toBe(false)
    })
  })

  describe("tx_done", () => {
    it("requires id field", () => {
      const result = toolSchemas.tx_done.safeParse({})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = toolSchemas.tx_done.safeParse({ id: "tx-12345678" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_delete", () => {
    it("requires id field", () => {
      const result = toolSchemas.tx_delete.safeParse({})
      expect(result.success).toBe(false)
    })

    it("accepts valid id", () => {
      const result = toolSchemas.tx_delete.safeParse({ id: "tx-12345678" })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_block", () => {
    it("requires both taskId and blockerId", () => {
      expect(toolSchemas.tx_block.safeParse({}).success).toBe(false)
      expect(toolSchemas.tx_block.safeParse({ taskId: "tx-1" }).success).toBe(false)
      expect(toolSchemas.tx_block.safeParse({ blockerId: "tx-2" }).success).toBe(false)
    })

    it("accepts valid taskId and blockerId", () => {
      const result = toolSchemas.tx_block.safeParse({
        taskId: "tx-12345678",
        blockerId: "tx-87654321"
      })
      expect(result.success).toBe(true)
    })
  })

  describe("tx_unblock", () => {
    it("requires both taskId and blockerId", () => {
      expect(toolSchemas.tx_unblock.safeParse({}).success).toBe(false)
      expect(toolSchemas.tx_unblock.safeParse({ taskId: "tx-1" }).success).toBe(false)
      expect(toolSchemas.tx_unblock.safeParse({ blockerId: "tx-2" }).success).toBe(false)
    })

    it("accepts valid taskId and blockerId", () => {
      const result = toolSchemas.tx_unblock.safeParse({
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
      expect(typeof toolSchemas[toolName]).toBe("object")
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
      title: "Task with emoji 🎉 and symbols ™",
      description: "日本語テスト with Arabic العربية and Cyrillic кириллица"
    })
    const serialized = serializeTask(task)
    const json = JSON.stringify(serialized)
    const parsed = JSON.parse(json)

    expect(parsed.title).toBe("Task with emoji 🎉 and symbols ™")
    expect(parsed.description).toContain("日本語テスト")
    expect(parsed.description).toContain("العربية")
    expect(parsed.description).toContain("кириллица")
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
