import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import App from "../App"
import { server } from "../../test/setup"
import type { PaginatedTasksResponse, TaskLabel, TaskWithDeps } from "../api/client"
import { selectionActions } from "../stores/selection-store"

function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 10)}`,
    title: "Test task",
    description: "",
    status: "backlog",
    parentId: null,
    score: 100,
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

function createTestQueryClient() {
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

function renderApp() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

function parseStatuses(requestUrl: string): string[] {
  const params = new URL(requestUrl).searchParams
  return params.get("status")?.split(",").filter(Boolean) ?? []
}

function parseSearch(requestUrl: string): string {
  const params = new URL(requestUrl).searchParams
  return params.get("search") ?? ""
}

function setupApi(tasks: TaskWithDeps[], labels: TaskLabel[] = []) {
  server.use(
    http.get("/api/settings", () =>
      HttpResponse.json({ dashboard: { defaultTaskAssigmentType: "human" } })
    ),
    http.patch("/api/settings", () =>
      HttpResponse.json({ dashboard: { defaultTaskAssigmentType: "human" } })
    ),
    http.get("/api/stats", () =>
      HttpResponse.json({ tasks: 0, done: 0, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })
    ),
    http.get("/api/ralph", () =>
      HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })
    ),
    http.get("/api/tasks", ({ request }) => {
      const statuses = parseStatuses(request.url)
      const search = parseSearch(request.url).trim().toLowerCase()

      const filtered = tasks.filter((task) => {
        const statusMatch = statuses.length === 0 || statuses.includes(task.status)
        if (!statusMatch) return false
        if (!search) return true
        return `${task.id} ${task.title} ${task.description}`.toLowerCase().includes(search)
      })

      return HttpResponse.json({
        tasks: filtered,
        nextCursor: null,
        hasMore: false,
        total: filtered.length,
        summary: {
          total: filtered.length,
          byStatus: filtered.reduce<Record<string, number>>((acc, task) => {
            acc[task.status] = (acc[task.status] ?? 0) + 1
            return acc
          }, {}),
        },
      } satisfies PaginatedTasksResponse)
    }),
    http.get("/api/tasks/ready", () =>
      HttpResponse.json({ tasks: tasks.filter((task) => task.status === "ready") })
    ),
    http.get("/api/tasks/:id", ({ params }) => {
      const task = tasks.find((item) => item.id === params.id)
      if (!task) {
        return HttpResponse.json({ message: "not found" }, { status: 404 })
      }
      return HttpResponse.json({
        task,
        blockedByTasks: [],
        blocksTasks: [],
        childTasks: [],
      })
    }),
    http.get("/api/labels", () => HttpResponse.json({ labels })),
    http.get("/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
    http.get("/api/docs", () => HttpResponse.json({ docs: [] })),
    http.get("/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
    http.get("/api/cycles", () => HttpResponse.json({ cycles: [] })),
  )
}

async function openSelectMenu(instanceId: string): Promise<HTMLInputElement> {
  let input = document.getElementById(`react-select-${instanceId}-input`) as HTMLInputElement | null
  if (!input) {
    fireEvent.click(screen.getByRole("button", { name: /^Filter/i }))
    input = document.getElementById(`react-select-${instanceId}-input`) as HTMLInputElement | null
  }
  if (!input) {
    throw new Error(`Could not find react-select input for ${instanceId}`)
  }
  fireEvent.focus(input)
  fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" })
  return input
}

function ensureFilterPopoverOpen() {
  if (!screen.queryByText("Assignment")) {
    fireEvent.click(screen.getByRole("button", { name: /^Filter/i }))
  }
}

async function clickSelectOption(instanceId: string, optionIndex: number) {
  await openSelectMenu(instanceId)

  await waitFor(() => {
    expect(document.getElementById(`react-select-${instanceId}-option-${optionIndex}`)).toBeTruthy()
  })

  const option = document.getElementById(`react-select-${instanceId}-option-${optionIndex}`)
  if (!option) {
    throw new Error(`Could not find option ${optionIndex} for ${instanceId}`)
  }
  fireEvent.click(option)
}

describe("Tasks client filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectionActions.clearAll()
    window.history.replaceState({}, "", "/")
  })

  afterEach(() => {
    selectionActions.clearAll()
    server.resetHandlers()
  })

  it("renders assignment + labels filters on the tasks page", async () => {
    setupApi([createTask({ id: "tx-a", title: "Task A" })])
    renderApp()

    await waitFor(() => {
      expect(screen.getByText("Task A")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: /^Filter/i })).toBeInTheDocument()
    ensureFilterPopoverOpen()
    expect(screen.getByText("Assignment")).toBeInTheDocument()
    expect(screen.getByText("Labels")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear Filters" })).toBeDisabled()
  })

  it("filters by assignment type and syncs taskAssignee in URL", async () => {
    setupApi([
      createTask({ id: "tx-human", title: "Human task", assigneeType: "human" }),
      createTask({ id: "tx-agent", title: "Agent task", assigneeType: "agent" }),
      createTask({ id: "tx-unassigned", title: "Unassigned task", assigneeType: null }),
    ])
    renderApp()

    await waitFor(() => {
      expect(screen.getByText("Human task")).toBeInTheDocument()
      expect(screen.getByText("Agent task")).toBeInTheDocument()
      expect(screen.getByText("Unassigned task")).toBeInTheDocument()
    })

    await clickSelectOption("tasks-filter-assignee", 2) // Agent

    await waitFor(() => {
      expect(screen.queryByText("Human task")).not.toBeInTheDocument()
      expect(screen.getByText("Agent task")).toBeInTheDocument()
      expect(screen.queryByText("Unassigned task")).not.toBeInTheDocument()
    })

    const params = new URLSearchParams(window.location.search)
    expect(params.get("taskAssignee")).toBe("agent")
  })

  it("filters by labels and syncs taskLabels in URL", async () => {
    const labels: TaskLabel[] = [
      { id: 1, name: "bug", color: "#ef4444", createdAt: "", updatedAt: "" },
      { id: 2, name: "ops", color: "#2563eb", createdAt: "", updatedAt: "" },
    ]

    setupApi([
      createTask({
        id: "tx-bug",
        title: "Bug task",
        labels: [labels[0]],
      }),
      createTask({
        id: "tx-ops",
        title: "Ops task",
        labels: [labels[1]],
      }),
      createTask({
        id: "tx-none",
        title: "No label task",
        labels: [],
      }),
    ], labels)
    renderApp()

    await waitFor(() => {
      expect(screen.getByText("Bug task")).toBeInTheDocument()
      expect(screen.getByText("Ops task")).toBeInTheDocument()
    })

    await clickSelectOption("tasks-filter-labels", 0) // bug

    await waitFor(() => {
      expect(screen.getByText("Bug task")).toBeInTheDocument()
      expect(screen.queryByText("Ops task")).not.toBeInTheDocument()
      expect(screen.queryByText("No label task")).not.toBeInTheDocument()
    })

    const params = new URLSearchParams(window.location.search)
    expect(params.get("taskLabels")).toBe("1")
  })

  it("supports combined filters and clear reset", async () => {
    const labels: TaskLabel[] = [
      { id: 1, name: "bug", color: "#ef4444", createdAt: "", updatedAt: "" },
    ]

    setupApi([
      createTask({ id: "tx-match", title: "Match task", assigneeType: "human", labels }),
      createTask({ id: "tx-agent", title: "Agent bug task", assigneeType: "agent", labels }),
      createTask({ id: "tx-human", title: "Human no-label task", assigneeType: "human", labels: [] }),
    ], labels)
    renderApp()

    await waitFor(() => {
      expect(screen.getByText("Match task")).toBeInTheDocument()
      expect(screen.getByText("Agent bug task")).toBeInTheDocument()
      expect(screen.getByText("Human no-label task")).toBeInTheDocument()
    })

    await clickSelectOption("tasks-filter-assignee", 1) // Human
    await clickSelectOption("tasks-filter-labels", 0) // bug

    await waitFor(() => {
      expect(screen.getByText("Match task")).toBeInTheDocument()
      expect(screen.queryByText("Agent bug task")).not.toBeInTheDocument()
      expect(screen.queryByText("Human no-label task")).not.toBeInTheDocument()
    })

    ensureFilterPopoverOpen()
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }))

    await waitFor(() => {
      expect(screen.getByText("Match task")).toBeInTheDocument()
      expect(screen.getByText("Agent bug task")).toBeInTheDocument()
      expect(screen.getByText("Human no-label task")).toBeInTheDocument()
    })

    const params = new URLSearchParams(window.location.search)
    expect(params.get("taskAssignee")).toBeNull()
    expect(params.get("taskLabels")).toBeNull()
  })

  it("keeps label filters active across bucket changes", async () => {
    const labels: TaskLabel[] = [
      { id: 1, name: "bug", color: "#ef4444", createdAt: "", updatedAt: "" },
    ]

    setupApi([
      createTask({ id: "tx-backlog", title: "Backlog bug task", status: "backlog", labels }),
      createTask({ id: "tx-done", title: "Done bug task", status: "done", labels }),
      createTask({ id: "tx-done-other", title: "Done no-label task", status: "done", labels: [] }),
    ], labels)
    renderApp()

    await waitFor(() => {
      expect(screen.getByText("Backlog bug task")).toBeInTheDocument()
    })

    await clickSelectOption("tasks-filter-labels", 0) // bug

    await waitFor(() => {
      expect(screen.getByText("Backlog bug task")).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole("button", { name: "Done" })[0]!)

    await waitFor(() => {
      expect(screen.getByText("Done bug task")).toBeInTheDocument()
      expect(screen.queryByText("Done no-label task")).not.toBeInTheDocument()
    })

    const params = new URLSearchParams(window.location.search)
    expect(params.get("taskBucket")).toBe("done")
    expect(params.get("taskLabels")).toBe("1")
  })
})
