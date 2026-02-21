import { afterEach, describe, expect, it, vi } from "vitest"
import { rowToTask } from "../../packages/core/src/mappers/task.js"
import { fixtureId } from "../fixtures.js"
import type { TaskRow } from "@jamesaphoenix/tx-types"

const baseRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: fixtureId("unit-task-row"),
  title: "Task row fixture",
  description: "Row-to-task conversion fixture",
  status: "ready",
  parent_id: null,
  score: 500,
  created_at: "2026-02-21T10:00:00.000Z",
  updated_at: "2026-02-21T10:05:00.000Z",
  completed_at: null,
  assignee_type: null,
  assignee_id: null,
  assigned_at: null,
  assigned_by: null,
  metadata: "{\"scope\":\"task-mapper\"}",
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("rowToTask assignment mapping", () => {
  it("maps valid assignee fields", () => {
    const row = baseRow({
      id: fixtureId("unit-task-row-valid"),
      assignee_type: "agent",
      assignee_id: "worker-1",
      assigned_at: "2026-02-21T11:00:00.000Z",
      assigned_by: "test:mapper",
    })

    const task = rowToTask(row)
    expect(task.assigneeType).toBe("agent")
    expect(task.assigneeId).toBe("worker-1")
    expect(task.assignedAt?.toISOString()).toBe("2026-02-21T11:00:00.000Z")
    expect(task.assignedBy).toBe("test:mapper")
  })

  it("keeps nullable assignment fields null", () => {
    const row = baseRow({
      id: fixtureId("unit-task-row-null"),
      assignee_type: null,
      assignee_id: null,
      assigned_at: null,
      assigned_by: null,
    })

    const task = rowToTask(row)
    expect(task.assigneeType).toBeNull()
    expect(task.assigneeId).toBeNull()
    expect(task.assignedAt).toBeNull()
    expect(task.assignedBy).toBeNull()
  })

  it("falls back to null for invalid assignee_type and logs a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const row = baseRow({
      id: fixtureId("unit-task-row-invalid"),
      assignee_type: "robot",
      assignee_id: "worker-invalid",
      assigned_at: "2026-02-21T11:30:00.000Z",
      assigned_by: "test:mapper",
    })

    const task = rowToTask(row)
    expect(task.assigneeType).toBeNull()
    expect(task.assigneeId).toBe("worker-invalid")
    expect(task.assignedAt?.toISOString()).toBe("2026-02-21T11:30:00.000Z")
    expect(task.assignedBy).toBe("test:mapper")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Invalid assignee_type")
  })
})
