import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import App from "../App"
import { server } from "../../test/setup"
import { selectionStore } from "../stores/selection-store"
import type { PaginatedTasksResponse, TaskDetailResponse, TaskWithDeps } from "../api/client"

function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 10)}`,
    title: "Task",
    description: "",
    status: "backlog",
    parentId: null,
    score: 100,
    createdAt: "2026-01-30T12:00:00Z",
    updatedAt: "2026-01-30T12:00:00Z",
    completedAt: null,
    assigneeType: "agent",
    assigneeId: null,
    assignedAt: "2026-01-30T12:00:00Z",
    assignedBy: "test",
    metadata: {},
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: false,
    labels: [],
    ...overrides,
  }
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        refetchInterval: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function dispatchCmdShiftK() {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
}

function dispatchCmdA() {
  const event = new KeyboardEvent("keydown", {
    key: "a",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
}

async function runCommand(label: string) {
  if (!screen.queryByPlaceholderText("Type a command...")) {
    for (let attempt = 0; attempt < 3 && !screen.queryByPlaceholderText("Type a command..."); attempt += 1) {
      act(() => {
        dispatchCmdShiftK()
      })
      await act(async () => {
        await Promise.resolve()
      })
    }

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument()
    })
  }

  const paletteInput = screen.getByPlaceholderText("Type a command...")
  fireEvent.change(paletteInput, { target: { value: "" } })

  const matchingNodes = await screen.findAllByText(label)
  const commandButton = matchingNodes
    .map((node) => node.closest("button"))
    .find((button): button is HTMLButtonElement => Boolean(button?.hasAttribute("data-item-index")))

  if (!commandButton) {
    throw new Error(`Unable to locate command button for label: ${label}`)
  }

  fireEvent.click(commandButton)
}

describe("Task CMD+K operations", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, "", "/")
    queryClient = createQueryClient()
    selectionStore.setState((s) => ({ ...s, taskIds: new Set() }))
  })

  afterEach(() => {
    server.resetHandlers()
  })

  function renderApp() {
    return render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )
  }

  it("executes all single-item CMD+K operations in task detail", async () => {
    const parentTask = createTask({
      id: "tx-parent-cmdk",
      title: "Parent CMDK",
      status: "backlog",
      isReady: true,
      labels: [{ id: 2, name: "Feature", color: "#10b981", createdAt: "", updatedAt: "" }],
    })
    const childA = createTask({ id: "tx-child-a", title: "Child CMDK A", parentId: "tx-parent-cmdk" })
    const childB = createTask({ id: "tx-child-b", title: "Child CMDK B", parentId: "tx-parent-cmdk" })

    const patchPayloads: Array<{ id: string; status?: string }> = []
    const deletedTaskIds: string[] = []
    const createdTaskPayloads: Array<{ parentId?: string | null; title?: string }> = []
    const assignPayloads: Array<{ id: string; labelId?: number; name?: string }> = []
    const unassignPayloads: Array<{ id: string; labelId: number }> = []

    const writeText = vi.fn(async () => {})
    Object.assign(navigator, {
      clipboard: { writeText },
    })

    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.spyOn(window, "prompt").mockReturnValue("CmdkLabel")

    server.use(
      http.get("*/api/stats", () => HttpResponse.json({ tasks: 3, done: 0, ready: 1, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get("*/api/ralph", () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get("*/api/settings", () => HttpResponse.json({ dashboard: { defaultTaskAssigmentType: "human" } })),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get("*/api/docs", () => HttpResponse.json({ docs: [] })),
      http.get("*/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get("*/api/cycles", () => HttpResponse.json({ cycles: [] })),
      http.get("*/api/tasks/ready", () => HttpResponse.json({ tasks: [] })),
      http.get("*/api/labels", () => HttpResponse.json({ labels: [
        { id: 1, name: "Bug", color: "#ef4444", createdAt: "", updatedAt: "" },
        { id: 2, name: "Feature", color: "#10b981", createdAt: "", updatedAt: "" },
      ] })),
      http.get("*/api/tasks", () =>
        HttpResponse.json({
          tasks: [parentTask],
          nextCursor: null,
          hasMore: false,
          total: 1,
          summary: { total: 1, byStatus: { backlog: 1 } },
        } satisfies PaginatedTasksResponse)
      ),
      http.get("*/api/tasks/:id", ({ params }) => {
        const id = String(params.id)
        if (id === "tx-child-a") {
          return HttpResponse.json({
            task: childA,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        }

        return HttpResponse.json({
          task: parentTask,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [childA, childB],
        } satisfies TaskDetailResponse)
      }),
      http.post("*/api/tasks", async ({ request }) => {
        const payload = await request.json() as { parentId?: string | null; title?: string }
        createdTaskPayloads.push(payload)
        return HttpResponse.json(createTask({ id: "tx-child-new", title: payload.title ?? "Child via command", parentId: payload.parentId ?? null }), { status: 201 })
      }),
      http.patch("*/api/tasks/:id", async ({ params, request }) => {
        const payload = await request.json() as { status?: string }
        patchPayloads.push({ id: String(params.id), status: payload.status })
        return HttpResponse.json(createTask({ id: String(params.id), status: payload.status ?? "backlog" }))
      }),
      http.post("*/api/tasks/:id/labels", async ({ params, request }) => {
        const payload = await request.json() as { labelId?: number; name?: string }
        assignPayloads.push({ id: String(params.id), labelId: payload.labelId, name: payload.name })
        return HttpResponse.json({
          success: true,
          task: parentTask,
          label: payload.labelId
            ? { id: payload.labelId, name: payload.labelId === 1 ? "Bug" : "Feature", color: "#000", createdAt: "", updatedAt: "" }
            : { id: 99, name: payload.name ?? "new", color: "#000", createdAt: "", updatedAt: "" },
        })
      }),
      http.delete("*/api/tasks/:id/labels/:labelId", ({ params }) => {
        unassignPayloads.push({ id: String(params.id), labelId: Number(params.labelId) })
        return HttpResponse.json({ success: true, task: parentTask })
      }),
      http.delete("*/api/tasks/:id", ({ params }) => {
        deletedTaskIds.push(String(params.id))
        return HttpResponse.json({ success: true, id: String(params.id) })
      }),
    )

    renderApp()

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    await waitFor(() => {
      expect(screen.getByText("Parent CMDK")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Parent CMDK"))
    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument()
    })

    await runCommand("Copy task reference")
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled()
    })

    await runCommand("Create + assign label")
    await waitFor(() => {
      expect(assignPayloads.some((payload) => payload.name === "CmdkLabel")).toBe(true)
    })

    await runCommand("Add label: Bug")
    await waitFor(() => {
      expect(assignPayloads.some((payload) => payload.labelId === 1)).toBe(true)
    })

    await runCommand("Remove label: Feature")
    await waitFor(() => {
      expect(unassignPayloads.some((payload) => payload.labelId === 2)).toBe(true)
    })

    await runCommand("Set status: Backlog")
    await runCommand("Set status: In Progress")
    await runCommand("Set status: Done")
    await runCommand("Cycle status (Backlog → In Progress → Done)")

    await waitFor(() => {
      const statuses = patchPayloads.filter((payload) => payload.id === "tx-parent-cmdk").map((payload) => payload.status)
      expect(statuses).toContain("backlog")
      expect(statuses).toContain("active")
      expect(statuses).toContain("done")
    })

    await runCommand("Create sub-task")
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task title")).toBeInTheDocument()
    })
    fireEvent.keyDown(window, { key: "Escape" })

    await runCommand("Create new sub-task")
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task title")).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Subtask via command" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create sub-task" }))

    await waitFor(() => {
      expect(createdTaskPayloads.some((payload) => payload.parentId === "tx-parent-cmdk")).toBe(true)
    })

    await runCommand("Back to task list")
    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument()
    })

    await runCommand("Select all child tasks")
    await runCommand("Copy selected child task IDs")

    await waitFor(() => {
      const copies = (writeText.mock.calls as unknown as Array<[string]>).map(([text]) => String(text))
      expect(copies.some((text) => text.includes("tx-child-a") && text.includes("tx-child-b"))).toBe(true)
    })

    await runCommand("Set selected child tasks to Backlog")
    await runCommand("Set selected child tasks to In Progress")
    await runCommand("Set selected child tasks to Done")

    await runCommand("Open child: Child CMDK A")
    await waitFor(() => {
      expect(screen.getByText("Child CMDK A")).toBeInTheDocument()
    })

    await runCommand("Back to task list")
    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument()
    })

    await runCommand("Select all child tasks")
    await runCommand("Clear selected child tasks")
    await runCommand("Select all child tasks")
    await runCommand("Delete selected child tasks")

    await waitFor(() => {
      expect(deletedTaskIds).toContain("tx-child-a")
      expect(deletedTaskIds).toContain("tx-child-b")
    })

    await runCommand("Delete current task")
    await waitFor(() => {
      expect(deletedTaskIds).toContain("tx-parent-cmdk")
    })
  })

  it("keeps parent detail selected when create-more is enabled for new sub-tasks", async () => {
    const parentTask = createTask({
      id: "tx-parent-create-more",
      title: "Create more parent",
      status: "backlog",
      isReady: true,
    })

    let childTasks: TaskWithDeps[] = []
    const detailRequestIds: string[] = []
    const createTaskPayloads: Array<{ parentId?: string | null; title?: string }> = []

    server.use(
      http.get("*/api/stats", () => HttpResponse.json({ tasks: 1, done: 0, ready: 1, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get("*/api/ralph", () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get("*/api/docs", () => HttpResponse.json({ docs: [] })),
      http.get("*/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get("*/api/cycles", () => HttpResponse.json({ cycles: [] })),
      http.get("*/api/tasks/ready", () => HttpResponse.json({ tasks: [] })),
      http.get("*/api/labels", () => HttpResponse.json({ labels: [] })),
      http.get("*/api/tasks", () =>
        HttpResponse.json({
          tasks: [parentTask],
          nextCursor: null,
          hasMore: false,
          total: 1,
          summary: { total: 1, byStatus: { backlog: 1 } },
        } satisfies PaginatedTasksResponse)
      ),
      http.get("*/api/tasks/:id", ({ params }) => {
        const id = String(params.id)
        detailRequestIds.push(id)

        if (id === "tx-parent-create-more") {
          return HttpResponse.json({
            task: parentTask,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks,
          } satisfies TaskDetailResponse)
        }

        const child = childTasks.find((task) => task.id === id) ?? createTask({
          id,
          title: "Unknown child",
          parentId: "tx-parent-create-more",
        })
        return HttpResponse.json({
          task: child,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [],
        } satisfies TaskDetailResponse)
      }),
      http.post("*/api/tasks", async ({ request }) => {
        const payload = await request.json() as { parentId?: string | null; title?: string }
        createTaskPayloads.push(payload)

        const created = createTask({
          id: `tx-created-child-${createTaskPayloads.length}`,
          title: payload.title ?? "Created child",
          parentId: payload.parentId ?? null,
        })
        childTasks = [...childTasks, created]
        return HttpResponse.json(created, { status: 201 })
      }),
    )

    renderApp()

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    await waitFor(() => {
      expect(screen.getByText("Create more parent")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Create more parent"))
    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument()
      expect(screen.getByText("Children (0)")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "Create new sub-task" }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task title")).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "First child with create more" },
    })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Create sub-task" }))

    await waitFor(() => {
      expect(createTaskPayloads.length).toBe(1)
      expect(createTaskPayloads[0]?.parentId).toBe("tx-parent-create-more")
    })

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("taskId")).toBe("tx-parent-create-more")
    })

    await waitFor(() => {
      expect(screen.getByText("Children (1)")).toBeInTheDocument()
    })

    expect(detailRequestIds.filter((id) => id === "tx-parent-create-more").length).toBeGreaterThan(1)
    expect(detailRequestIds).not.toContain("tx-created-child-1")
    expect(screen.getByPlaceholderText("Task title")).toHaveValue("")
  })

  it("executes all composer-modal CMD+K operations and handles label-create 404 fallback", async () => {
    const parentTask = createTask({ id: "tx-parent-modal", title: "Modal parent" })
    const createdTask = createTask({ id: "tx-created-modal", title: "Created from modal", status: "done" })

    const createTaskPayloads: Array<{ status?: string; title?: string }> = []
    const assignPayloads: Array<{ labelId?: number; name?: string; color?: string }> = []
    const createLabelAttempts: string[] = []

    vi.spyOn(window, "prompt").mockReturnValue("NewFromCommand")

    server.use(
      http.get("*/api/stats", () => HttpResponse.json({ tasks: 1, done: 0, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get("*/api/ralph", () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get("*/api/docs", () => HttpResponse.json({ docs: [] })),
      http.get("*/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get("*/api/cycles", () => HttpResponse.json({ cycles: [] })),
      http.get("*/api/tasks/ready", () => HttpResponse.json({ tasks: [] })),
      http.get("*/api/labels", () => HttpResponse.json({ labels: [
        { id: 1, name: "Bug", color: "#ef4444", createdAt: "", updatedAt: "" },
        { id: 2, name: "Feature", color: "#10b981", createdAt: "", updatedAt: "" },
      ] })),
      http.get("*/api/tasks", () =>
        HttpResponse.json({
          tasks: [parentTask],
          nextCursor: null,
          hasMore: false,
          total: 1,
          summary: { total: 1, byStatus: { backlog: 1 } },
        } satisfies PaginatedTasksResponse)
      ),
      http.get("*/api/tasks/:id", ({ params }) =>
        HttpResponse.json({
          task: String(params.id) === "tx-created-modal" ? createdTask : parentTask,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [],
        } satisfies TaskDetailResponse)
      ),
      http.post("*/api/labels", async ({ request }) => {
        const payload = await request.json() as { name: string }
        createLabelAttempts.push(payload.name)
        return HttpResponse.json({ error: "Not found" }, { status: 404 })
      }),
      http.post("*/api/task-labels", async ({ request }) => {
        const payload = await request.json() as { name: string }
        createLabelAttempts.push(payload.name)
        return HttpResponse.json({ error: "Not found" }, { status: 404 })
      }),
      http.post("*/api/tasks", async ({ request }) => {
        const payload = await request.json() as { title?: string; status?: string }
        createTaskPayloads.push(payload)
        return HttpResponse.json(createdTask, { status: 201 })
      }),
      http.post("*/api/tasks/:id/labels", async ({ request }) => {
        const payload = await request.json() as { labelId?: number; name?: string; color?: string }
        assignPayloads.push(payload)
        return HttpResponse.json({ success: true, task: createdTask, label: payload.labelId ? { id: payload.labelId, name: "x", color: "#000", createdAt: "", updatedAt: "" } : undefined })
      }),
    )

    renderApp()

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    await waitFor(() => {
      expect(screen.getByText("Modal parent")).toBeInTheDocument()
    })

    await runCommand("Create new task")
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task title")).toBeInTheDocument()
    })

    await runCommand("Close composer")
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Task title")).not.toBeInTheDocument()
    })

    await runCommand("Create new task")
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task title")).toBeInTheDocument()
    })

    await runCommand("Focus description")
    expect(screen.getByPlaceholderText("Describe the task (optional)...")).toHaveFocus()

    await runCommand("Focus title")
    expect(screen.getByPlaceholderText("Task title")).toHaveFocus()

    await runCommand("Select all labels")
    await runCommand("Clear selected labels")

    await runCommand("Enable create more")
    expect(screen.getByRole("checkbox")).toBeChecked()

    await runCommand("Disable create more")
    expect(screen.getByRole("checkbox")).not.toBeChecked()

    await runCommand("Set status: Backlog")
    await runCommand("Set status: In Progress")
    await runCommand("Set status: Done")

    await runCommand("Add label: Bug")
    await runCommand("Add label: Feature")
    await runCommand("Remove label: Feature")
    await runCommand("Create new label")
    await waitFor(() => {
      expect(createLabelAttempts).toContain("NewFromCommand")
      expect(screen.getByText("NewFromCommand")).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Created from modal" },
    })
    expect(screen.getByPlaceholderText("Task title")).toHaveValue("Created from modal")

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })

    await waitFor(() => {
      expect(createTaskPayloads.length).toBe(1)
      expect(createTaskPayloads[0]?.status).toBe("done")
      expect(createTaskPayloads[0]?.title).toBe("Created from modal")
    })

    expect(createLabelAttempts).toContain("NewFromCommand")
    expect(assignPayloads.some((payload) => payload.labelId === 1)).toBe(true)
    expect(assignPayloads.some((payload) => payload.name === "NewFromCommand")).toBe(true)
    expect(assignPayloads.some((payload) => payload.labelId === 2)).toBe(false)

  })

  it("executes modal submit via CMD+K command", async () => {
    const parentTask = createTask({ id: "tx-parent-submit-cmdk", title: "Parent submit cmdk" })
    const createdTask = createTask({ id: "tx-created-submit-cmdk", title: "Created submit cmdk", status: "backlog" })
    const createTaskPayloads: Array<{ status?: string; title?: string }> = []

    server.use(
      http.get("*/api/stats", () => HttpResponse.json({ tasks: 1, done: 0, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get("*/api/ralph", () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get("*/api/docs", () => HttpResponse.json({ docs: [] })),
      http.get("*/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get("*/api/cycles", () => HttpResponse.json({ cycles: [] })),
      http.get("*/api/tasks/ready", () => HttpResponse.json({ tasks: [] })),
      http.get("*/api/labels", () => HttpResponse.json({ labels: [] })),
      http.get("*/api/tasks", () =>
        HttpResponse.json({
          tasks: [parentTask],
          nextCursor: null,
          hasMore: false,
          total: 1,
          summary: { total: 1, byStatus: { backlog: 1 } },
        } satisfies PaginatedTasksResponse)
      ),
      http.get("*/api/tasks/:id", ({ params }) =>
        HttpResponse.json({
          task: String(params.id) === "tx-created-submit-cmdk" ? createdTask : parentTask,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [],
        } satisfies TaskDetailResponse)
      ),
      http.post("*/api/tasks", async ({ request }) => {
        const payload = await request.json() as { title?: string; status?: string }
        createTaskPayloads.push(payload)
        return HttpResponse.json(createdTask, { status: 201 })
      }),
    )

    renderApp()

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    await waitFor(() => {
      expect(screen.getByText("Parent submit cmdk")).toBeInTheDocument()
    })

    await runCommand("Create new task")
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task title")).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Created submit cmdk" },
    })

    await runCommand("Create task")

    await waitFor(() => {
      expect(createTaskPayloads.length).toBe(1)
      expect(createTaskPayloads[0]?.title).toBe("Created submit cmdk")
    })
  })

  it("executes list-view selection CMD+K operations", async () => {
    const taskA = createTask({ id: "tx-del-a", title: "Delete A" })
    const taskB = createTask({ id: "tx-del-b", title: "Delete B" })
    const deleted: string[] = []
    const patchPayloads: Array<{ id: string; status?: string }> = []
    const writeText = vi.fn(async () => {})

    Object.assign(navigator, {
      clipboard: { writeText },
    })

    vi.spyOn(window, "confirm").mockReturnValue(true)

    server.use(
      http.get("*/api/stats", () => HttpResponse.json({ tasks: 2, done: 0, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get("*/api/ralph", () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get("*/api/docs", () => HttpResponse.json({ docs: [] })),
      http.get("*/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get("*/api/cycles", () => HttpResponse.json({ cycles: [] })),
      http.get("*/api/tasks/ready", () => HttpResponse.json({ tasks: [] })),
      http.get("*/api/labels", () => HttpResponse.json({ labels: [] })),
      http.get("*/api/tasks", () =>
        HttpResponse.json({
          tasks: [taskA, taskB],
          nextCursor: null,
          hasMore: false,
          total: 2,
          summary: { total: 2, byStatus: { backlog: 2 } },
        } satisfies PaginatedTasksResponse)
      ),
      http.patch("*/api/tasks/:id", async ({ params, request }) => {
        const payload = await request.json() as { status?: string }
        patchPayloads.push({ id: String(params.id), status: payload.status })
        return HttpResponse.json(createTask({ id: String(params.id), status: payload.status ?? "backlog" }))
      }),
      http.delete("*/api/tasks/:id", ({ params }) => {
        deleted.push(String(params.id))
        return HttpResponse.json({ success: true, id: String(params.id) })
      }),
    )

    renderApp()
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))

    await waitFor(() => {
      expect(screen.getByText("Delete A")).toBeInTheDocument()
    })

    act(() => {
      dispatchCmdA()
    })

    await runCommand("Copy selected task IDs")
    expect(writeText).toHaveBeenCalled()

    await runCommand("Set selected tasks to Backlog")
    await runCommand("Set selected tasks to In Progress")
    await runCommand("Set selected tasks to Done")

    await waitFor(() => {
      const statuses = patchPayloads.map((payload) => payload.status)
      expect(statuses).toContain("backlog")
      expect(statuses).toContain("active")
      expect(statuses).toContain("done")
    })

    await runCommand("Clear task selection")
    await waitFor(() => {
      expect(selectionStore.state.taskIds.size).toBe(0)
    })

    act(() => {
      dispatchCmdA()
    })

    await runCommand("Delete selected tasks")

    await waitFor(() => {
      expect(deleted).toContain("tx-del-a")
      expect(deleted).toContain("tx-del-b")
    })
  })

  it("reflects single-item CMD+K mutations in task state", async () => {
    const bugLabel = { id: 1, name: "Bug", color: "#ef4444", createdAt: "", updatedAt: "" }
    const featureLabel = { id: 2, name: "Feature", color: "#10b981", createdAt: "", updatedAt: "" }
    const labels = [bugLabel, featureLabel]

    const taskState = createTask({
      id: "tx-stateful-detail",
      title: "Stateful detail task",
      status: "backlog",
      labels: [featureLabel],
    })

    const patchPayloads: Array<{ id: string; status?: string }> = []
    const assignedLabelIds: number[] = []
    const removedLabelIds: number[] = []

    server.use(
      http.get("*/api/stats", () => HttpResponse.json({ tasks: 1, done: 0, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get("*/api/ralph", () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get("*/api/docs", () => HttpResponse.json({ docs: [] })),
      http.get("*/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get("*/api/cycles", () => HttpResponse.json({ cycles: [] })),
      http.get("*/api/tasks/ready", () => HttpResponse.json({ tasks: [] })),
      http.get("*/api/labels", () => HttpResponse.json({ labels })),
      http.get("*/api/tasks", ({ request }) => {
        const url = new URL(request.url)
        const statusFilter = url.searchParams.get("status")
        const statuses = statusFilter?.split(",").filter(Boolean) ?? []
        const tasks = statuses.length === 0 || statuses.includes(taskState.status)
          ? [taskState]
          : []
        return HttpResponse.json({
          tasks,
          nextCursor: null,
          hasMore: false,
          total: tasks.length,
          summary: { total: tasks.length, byStatus: tasks.length ? { [taskState.status]: tasks.length } : {} },
        } satisfies PaginatedTasksResponse)
      }),
      http.get("*/api/tasks/:id", ({ params }) => {
        if (String(params.id) !== taskState.id) {
          return HttpResponse.json({ error: "Task not found" }, { status: 404 })
        }
        return HttpResponse.json({
          task: taskState,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [],
        } satisfies TaskDetailResponse)
      }),
      http.patch("*/api/tasks/:id", async ({ params, request }) => {
        const id = String(params.id)
        const payload = await request.json() as { status?: string }
        patchPayloads.push({ id, status: payload.status })
        if (id === taskState.id && payload.status) {
          taskState.status = payload.status
        }
        return HttpResponse.json(taskState)
      }),
      http.post("*/api/tasks/:id/labels", async ({ params, request }) => {
        if (String(params.id) !== taskState.id) {
          return HttpResponse.json({ error: "Task not found" }, { status: 404 })
        }
        const payload = await request.json() as { labelId?: number }
        if (payload.labelId) {
          assignedLabelIds.push(payload.labelId)
          const label = labels.find((item) => item.id === payload.labelId)
          if (label && !taskState.labels?.some((item) => item.id === label.id)) {
            taskState.labels = [...(taskState.labels ?? []), label]
          }
        }
        return HttpResponse.json({ success: true, task: taskState })
      }),
      http.delete("*/api/tasks/:id/labels/:labelId", ({ params }) => {
        if (String(params.id) !== taskState.id) {
          return HttpResponse.json({ error: "Task not found" }, { status: 404 })
        }
        const labelId = Number(params.labelId)
        removedLabelIds.push(labelId)
        taskState.labels = (taskState.labels ?? []).filter((label) => label.id !== labelId)
        return HttpResponse.json({ success: true, task: taskState })
      }),
    )

    renderApp()

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    await waitFor(() => {
      expect(screen.getByText("Stateful detail task")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Stateful detail task"))
    await waitFor(() => {
      expect(screen.getByText("Internal status: backlog")).toBeInTheDocument()
      expect(screen.getByText("1 selected")).toBeInTheDocument()
    })

    await runCommand("Set status: Done")
    await waitFor(() => {
      expect(screen.getByText("Internal status: done")).toBeInTheDocument()
    })

    await runCommand("Set status: Backlog")
    await waitFor(() => {
      expect(screen.getByText("Internal status: backlog")).toBeInTheDocument()
    })

    await runCommand("Add label: Bug")
    await waitFor(() => {
      expect(screen.getByText("2 selected")).toBeInTheDocument()
    })

    await runCommand("Remove label: Feature")
    await waitFor(() => {
      expect(screen.getByText("1 selected")).toBeInTheDocument()
    })

    expect(assignedLabelIds).toContain(1)
    expect(removedLabelIds).toContain(2)
    expect(patchPayloads.some((payload) => payload.status === "done")).toBe(true)
    expect(patchPayloads.some((payload) => payload.status === "backlog")).toBe(true)
  })

  it("covers list CMD+K navigation, filtering, and state updates", async () => {
    const backlogA = createTask({ id: "tx-list-a", title: "List A", status: "backlog" })
    const backlogB = createTask({ id: "tx-list-b", title: "List B", status: "backlog" })
    const inProgress = createTask({ id: "tx-list-active", title: "List In Progress", status: "active" })
    const done = createTask({ id: "tx-list-done", title: "List Done", status: "done" })

    const taskState = new Map<string, TaskWithDeps>([
      [backlogA.id, backlogA],
      [backlogB.id, backlogB],
      [inProgress.id, inProgress],
      [done.id, done],
    ])
    const patchPayloads: Array<{ id: string; status?: string }> = []
    const deletedTaskIds: string[] = []
    vi.spyOn(window, "confirm").mockReturnValue(true)

    server.use(
      http.get("*/api/stats", () => HttpResponse.json({ tasks: taskState.size, done: 1, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get("*/api/ralph", () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get("*/api/docs", () => HttpResponse.json({ docs: [] })),
      http.get("*/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get("*/api/cycles", () => HttpResponse.json({ cycles: [] })),
      http.get("*/api/tasks/ready", () => HttpResponse.json({ tasks: [] })),
      http.get("*/api/labels", () => HttpResponse.json({ labels: [] })),
      http.get("*/api/tasks", ({ request }) => {
        const url = new URL(request.url)
        const statusFilter = url.searchParams.get("status")
        const statuses = statusFilter?.split(",").filter(Boolean) ?? []
        const tasks = Array.from(taskState.values()).filter((task) => (
          statuses.length === 0 || statuses.includes(task.status)
        ))
        const byStatus = tasks.reduce<Record<string, number>>((acc, task) => {
          acc[task.status] = (acc[task.status] ?? 0) + 1
          return acc
        }, {})

        return HttpResponse.json({
          tasks,
          nextCursor: null,
          hasMore: false,
          total: tasks.length,
          summary: { total: tasks.length, byStatus },
        } satisfies PaginatedTasksResponse)
      }),
      http.get("*/api/tasks/:id", ({ params }) => {
        const id = String(params.id)
        const task = taskState.get(id)
        if (!task) {
          return HttpResponse.json({ error: "Task not found" }, { status: 404 })
        }
        return HttpResponse.json({
          task,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [],
        } satisfies TaskDetailResponse)
      }),
      http.patch("*/api/tasks/:id", async ({ params, request }) => {
        const id = String(params.id)
        const payload = await request.json() as { status?: string }
        patchPayloads.push({ id, status: payload.status })
        const existing = taskState.get(id)
        if (existing && payload.status) {
          taskState.set(id, { ...existing, status: payload.status })
        }
        return HttpResponse.json(taskState.get(id) ?? createTask({ id, status: payload.status ?? "backlog" }))
      }),
      http.delete("*/api/tasks/:id", ({ params }) => {
        const id = String(params.id)
        deletedTaskIds.push(id)
        taskState.delete(id)
        return HttpResponse.json({ success: true, id })
      }),
    )

    renderApp()
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))

    await waitFor(() => {
      expect(screen.getByText("List A")).toBeInTheDocument()
      expect(screen.getByText("List B")).toBeInTheDocument()
    })

    await runCommand("View Done")
    await waitFor(() => {
      expect(screen.getByText("List Done")).toBeInTheDocument()
      expect(screen.queryByText("List A")).not.toBeInTheDocument()
    })

    await runCommand("View In Progress")
    await waitFor(() => {
      expect(screen.getByText("List In Progress")).toBeInTheDocument()
      expect(screen.queryByText("List Done")).not.toBeInTheDocument()
    })

    await runCommand("View Backlog")
    await waitFor(() => {
      expect(screen.getByText("List A")).toBeInTheDocument()
      expect(screen.getByText("List B")).toBeInTheDocument()
    })

    await runCommand("List A")
    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument()
      expect(screen.getByRole("heading", { name: "List A" })).toBeInTheDocument()
    })

    await runCommand("Back to task list")
    await waitFor(() => {
      expect(screen.getByText("List A")).toBeInTheDocument()
      expect(screen.queryByText("Properties")).not.toBeInTheDocument()
    })

    await runCommand("Select all tasks")
    await waitFor(() => {
      expect(selectionStore.state.taskIds.size).toBe(4)
    })

    await runCommand("Set selected tasks to Done")
    await waitFor(() => {
      expect(patchPayloads.some((payload) => payload.id === "tx-list-a" && payload.status === "done")).toBe(true)
      expect(patchPayloads.some((payload) => payload.id === "tx-list-b" && payload.status === "done")).toBe(true)
      expect(screen.getByText("No tasks found")).toBeInTheDocument()
    })

    await runCommand("View Done")
    await waitFor(() => {
      expect(screen.getByText("List A")).toBeInTheDocument()
      expect(screen.getByText("List B")).toBeInTheDocument()
      expect(screen.getByText("List Done")).toBeInTheDocument()
    })

    await runCommand("Select all tasks")
    await waitFor(() => {
      expect(selectionStore.state.taskIds.size).toBe(4)
    })

    await runCommand("Delete selected tasks")
    await waitFor(() => {
      expect(deletedTaskIds).toEqual(expect.arrayContaining([
        "tx-list-a",
        "tx-list-b",
        "tx-list-active",
        "tx-list-done",
      ]))
      expect(screen.getByText("No tasks found")).toBeInTheDocument()
    })
  })
})
