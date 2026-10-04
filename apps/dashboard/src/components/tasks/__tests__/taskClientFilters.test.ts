import { describe, it, expect } from "vitest"
import type { TaskWithDeps } from "../../../api/client"
import {
  buildTaskClientFilterPredicate,
  hasActiveTaskClientFilters,
  normalizeTaskClientFilters,
  type TaskClientFilters,
} from "../taskClientFilters"

function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: "tx-default",
    title: "Default task",
    description: "",
    status: "backlog",
    parentId: null,
    score: 0,
    createdAt: "2026-02-22T12:00:00.000Z",
    updatedAt: "2026-02-22T12:00:00.000Z",
    completedAt: null,
    assigneeType: "human",
    assigneeId: null,
    assignedAt: null,
    assignedBy: null,
    metadata: {},
    labels: [],
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: true,
    ...overrides,
  }
}

describe("taskClientFilters", () => {
  it("normalizes to defaults when filters are missing", () => {
    expect(normalizeTaskClientFilters()).toEqual({
      assigneeType: "all",
      labelIds: [],
    })
  })

  it("normalizes invalid assigneeType to all", () => {
    expect(normalizeTaskClientFilters({
      assigneeType: "unknown" as TaskClientFilters["assigneeType"],
    })).toEqual({
      assigneeType: "all",
      labelIds: [],
    })
  })

  it("drops duplicate and invalid label IDs", () => {
    expect(normalizeTaskClientFilters({
      assigneeType: "agent",
      labelIds: [2, 2, 0, -1, 3, 3.2, 5],
    })).toEqual({
      assigneeType: "agent",
      labelIds: [2, 3, 5],
    })
  })

  it("detects when no client filters are active", () => {
    expect(hasActiveTaskClientFilters({ assigneeType: "all", labelIds: [] })).toBe(false)
  })

  it("detects active assignee filter", () => {
    expect(hasActiveTaskClientFilters({ assigneeType: "human", labelIds: [] })).toBe(true)
  })

  it("detects active label filter", () => {
    expect(hasActiveTaskClientFilters({ assigneeType: "all", labelIds: [1] })).toBe(true)
  })

  it("matches all tasks when no filters are active", () => {
    const predicate = buildTaskClientFilterPredicate({
      assigneeType: "all",
      labelIds: [],
    })

    expect(predicate(createTask({ assigneeType: "human" }))).toBe(true)
    expect(predicate(createTask({ assigneeType: "agent" }))).toBe(true)
    expect(predicate(createTask({ assigneeType: null }))).toBe(true)
  })

  it("filters by assignee type", () => {
    const predicate = buildTaskClientFilterPredicate({
      assigneeType: "agent",
      labelIds: [],
    })

    expect(predicate(createTask({ assigneeType: "agent" }))).toBe(true)
    expect(predicate(createTask({ assigneeType: "human" }))).toBe(false)
    expect(predicate(createTask({ assigneeType: null }))).toBe(false)
  })

  it("filters unassigned tasks", () => {
    const predicate = buildTaskClientFilterPredicate({
      assigneeType: "unassigned",
      labelIds: [],
    })

    expect(predicate(createTask({ assigneeType: null }))).toBe(true)
    expect(predicate(createTask({ assigneeType: "agent" }))).toBe(false)
  })

  it("filters by labels with OR semantics", () => {
    const predicate = buildTaskClientFilterPredicate({
      assigneeType: "all",
      labelIds: [10, 20],
    })

    expect(predicate(createTask({
      labels: [{ id: 20, name: "ops", color: "#0ea5e9", createdAt: "", updatedAt: "" }],
    }))).toBe(true)
    expect(predicate(createTask({
      labels: [{ id: 99, name: "other", color: "#f59e0b", createdAt: "", updatedAt: "" }],
    }))).toBe(false)
    expect(predicate(createTask({ labels: [] }))).toBe(false)
    expect(predicate(createTask({ labels: undefined }))).toBe(false)
  })

  it("combines assignee + label filters", () => {
    const predicate = buildTaskClientFilterPredicate({
      assigneeType: "human",
      labelIds: [5],
    })

    expect(predicate(createTask({
      assigneeType: "human",
      labels: [{ id: 5, name: "bug", color: "#ef4444", createdAt: "", updatedAt: "" }],
    }))).toBe(true)
    expect(predicate(createTask({
      assigneeType: "agent",
      labels: [{ id: 5, name: "bug", color: "#ef4444", createdAt: "", updatedAt: "" }],
    }))).toBe(false)
    expect(predicate(createTask({
      assigneeType: "human",
      labels: [{ id: 6, name: "feature", color: "#22c55e", createdAt: "", updatedAt: "" }],
    }))).toBe(false)
  })
})
