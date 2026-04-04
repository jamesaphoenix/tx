import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import App from "../App"
import { server } from "../../test/setup"
import { selectionStore } from "../stores/selection-store"
import type { PaginatedTasksResponse, TaskWithDeps, Cycle, CycleDetail } from "../api/client"

// ─── Fixtures ──────────────────────────────────────────────────────────

function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 10)}`,
    title: "Test task",
    description: "",
    status: "ready",
    parentId: null,
    score: 500,
    createdAt: "2026-01-30T12:00:00Z",
    updatedAt: "2026-01-30T12:00:00Z",
    completedAt: null,
    assigneeType: "agent",
    assigneeId: null,
    assignedAt: "2026-01-30T12:00:00Z",
    assignedBy: "test",
    metadata: {},
    labels: [],
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: true,
    groupContext: null,
    effectiveGroupContext: null,
    effectiveGroupContextSourceTaskId: null,
    orchestrationStatus: null,
    claimedBy: null,
    claimExpiresAt: null,
    failedAttempts: 0,
    ...overrides,
  }
}

function createCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: "cycle-test-1",
    name: "Sprint 1",
    startDate: "2026-03-10T00:00:00Z",
    endDate: "2026-03-17T00:00:00Z",
    status: "current",
    createdAt: "2026-03-10T00:00:00Z",
    updatedAt: "2026-03-10T00:00:00Z",
    taskCount: 3,
    completedCount: 1,
    inProgressCount: 1,
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

function dispatchCmdN() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, bubbles: true, cancelable: true }),
  )
}

function dispatchCmdShiftK() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }),
  )
}

function dispatchEscape() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  )
}

/** Open the command palette reliably */
async function openPalette() {
  if (!screen.queryByPlaceholderText(/command|filter/i)) {
    act(() => { dispatchCmdShiftK() })
  }
  await waitFor(() => {
    expect(screen.getByPlaceholderText(/command|filter/i)).toBeInTheDocument()
  })
}

// ─── Shared API handlers ───────────────────────────────────────────────

function baseHandlers({
  tasks = [] as TaskWithDeps[],
  cycles = [] as Cycle[],
  cycleDetails = {} as Record<string, CycleDetail>,
}: {
  tasks?: TaskWithDeps[]
  cycles?: Cycle[]
  cycleDetails?: Record<string, CycleDetail>
} = {}) {
  return [
    http.get("/api/settings", () =>
      HttpResponse.json({ dashboard: { defaultTaskAssigmentType: "human", defaultTaskView: "list" } })
    ),
    http.get("/api/stats", () =>
      HttpResponse.json({ tasks: tasks.length, done: 0, ready: tasks.length, learnings: 0, runsRunning: 0, runsTotal: 0 })
    ),
    http.get("/api/ralph", () =>
      HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })
    ),
    http.get("/api/runs", () =>
      HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })
    ),
    http.get("/api/docs", () => HttpResponse.json({ docs: [] })),
    http.get("/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
    http.get("/api/labels", () => HttpResponse.json({ labels: [] })),
    http.get("/api/tasks/ready", () =>
      HttpResponse.json({ tasks: tasks.filter((t) => t.isReady) })
    ),
    http.get("/api/tasks", ({ request }) => {
      const statuses = new URL(request.url).searchParams.get("status")?.split(",") ?? []
      const filtered = tasks.filter((t) => statuses.length === 0 || statuses.includes(t.status))
      return HttpResponse.json({
        tasks: filtered,
        nextCursor: null,
        hasMore: false,
        total: filtered.length,
        summary: {
          total: filtered.length,
          byStatus: filtered.reduce<Record<string, number>>((acc, t) => {
            acc[t.status] = (acc[t.status] ?? 0) + 1
            return acc
          }, {}),
        },
      } satisfies PaginatedTasksResponse)
    }),
    http.get("/api/cycles", () => HttpResponse.json({ cycles })),
    http.get("/api/cycles/:id", ({ params }) => {
      const detail = cycleDetails[String(params.id)]
      if (!detail) return HttpResponse.json({ error: "not found" }, { status: 404 })
      return HttpResponse.json(detail)
    }),
  ]
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe("Cycles page CMD+N behavior", () => {
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
      </QueryClientProvider>,
    )
  }

  async function navigateToCycles() {
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cycles" })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole("button", { name: "Cycles" }))
    // Wait for cycle page heading to appear
    await waitFor(() => {
      expect(screen.getByText("Plan weekly scope, track progress, and carry work forward.")).toBeInTheDocument()
    })
  }

  it("CMD+N on cycles list page creates a new cycle instead of navigating to tasks", async () => {
    const existingCycle = createCycle()
    let createCycleCalled = false

    server.use(
      ...baseHandlers({
        cycles: [existingCycle],
        cycleDetails: { [existingCycle.id]: { ...existingCycle, tasks: [] } },
      }),
      http.post("/api/cycles", () => {
        createCycleCalled = true
        return HttpResponse.json(createCycle({ id: "cycle-new", name: "Sprint 2" }), { status: 201 })
      }),
    )

    renderApp()
    await navigateToCycles()

    await waitFor(() => {
      expect(screen.getByText("Sprint 1")).toBeInTheDocument()
    })

    // CMD+N should create a new cycle, NOT navigate to tasks
    act(() => { dispatchCmdN() })

    await waitFor(() => {
      expect(createCycleCalled).toBe(true)
    })
  })

  it("cycles list provides cycle names in CMD+K palette", async () => {
    const cycle1 = createCycle({ id: "c1", name: "Sprint Alpha" })
    const cycle2 = createCycle({ id: "c2", name: "Sprint Beta", status: "upcoming" })

    server.use(
      ...baseHandlers({
        cycles: [cycle1, cycle2],
        cycleDetails: {
          c1: { ...cycle1, tasks: [] },
          c2: { ...cycle2, tasks: [] },
        },
      }),
    )

    renderApp()
    await navigateToCycles()

    await waitFor(() => {
      expect(screen.getByText("Sprint Alpha")).toBeInTheDocument()
    })

    // Open palette and search
    await openPalette()
    const input = screen.getByPlaceholderText(/command/i)
    fireEvent.change(input, { target: { value: "Sprint" } })

    await waitFor(() => {
      // At least one match should be a palette item
      const alphaMatches = screen.getAllByText("Sprint Alpha")
      expect(alphaMatches.some((el) => el.closest("[data-item-index]"))).toBe(true)
      const betaMatches = screen.getAllByText("Sprint Beta")
      expect(betaMatches.some((el) => el.closest("[data-item-index]"))).toBe(true)
    })

    act(() => { dispatchEscape() })
  })
})

describe("Hierarchical command palette (integration)", () => {
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
      </QueryClientProvider>,
    )
  }

  async function openTaskDetail(task: TaskWithDeps) {
    await waitFor(() => {
      expect(screen.getByText(task.title)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(task.title))
    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument()
    })
  }

  it("drill into 'Set status' → select child → executes PATCH", async () => {
    const task = createTask({ id: "tx-hier-1", title: "Hierarchical task", status: "backlog" })
    const patchPayloads: Array<{ id: string; status?: string }> = []

    server.use(
      ...baseHandlers({ tasks: [task], cycles: [createCycle()] }),
      http.get("/api/tasks/:id", () =>
        HttpResponse.json({ task, blockedByTasks: [], blocksTasks: [], childTasks: [] })
      ),
      http.patch("/api/tasks/:id", async ({ params, request }) => {
        const payload = (await request.json()) as { status?: string }
        patchPayloads.push({ id: String(params.id), status: payload.status })
        return HttpResponse.json({ ...task, status: payload.status ?? task.status })
      }),
    )

    renderApp()
    await openTaskDetail(task)

    // Search for "Set status" to surface the hierarchical parent
    await openPalette()
    const input = screen.getByPlaceholderText(/command/i)
    fireEvent.change(input, { target: { value: "Set status" } })

    // Find the "Set status" palette button and drill in
    await waitFor(() => {
      const matches = screen.getAllByText("Set status")
      expect(matches.some((el) => el.closest("[data-item-index]"))).toBe(true)
    })
    const parentBtn = screen.getAllByText("Set status")
      .map((n) => n.closest("button"))
      .find((b): b is HTMLButtonElement => Boolean(b?.hasAttribute("data-item-index")))!
    fireEvent.click(parentBtn)

    // Now inside the hierarchy — find "Active" as a palette item
    await waitFor(() => {
      const items = screen.getAllByText("Active")
      expect(items.some((el) => el.closest("[data-item-index]"))).toBe(true)
    })
    const activeBtn = screen.getAllByText("Active")
      .map((n) => n.closest("button"))
      .find((b): b is HTMLButtonElement => Boolean(b?.hasAttribute("data-item-index")))!
    fireEvent.click(activeBtn)

    await waitFor(() => {
      expect(patchPayloads.some((p) => p.status === "active")).toBe(true)
    })
  })

  it("ESC in drilled hierarchy goes back one level, then closes palette", async () => {
    const task = createTask({ id: "tx-esc-1", title: "ESC test task", status: "backlog" })

    server.use(
      ...baseHandlers({ tasks: [task], cycles: [createCycle()] }),
      http.get("/api/tasks/:id", () =>
        HttpResponse.json({ task, blockedByTasks: [], blocksTasks: [], childTasks: [] })
      ),
    )

    renderApp()
    await openTaskDetail(task)

    // Open palette and drill into "Set status"
    await openPalette()
    fireEvent.change(screen.getByPlaceholderText(/command/i), { target: { value: "Set status" } })
    await waitFor(() => {
      expect(screen.getAllByText("Set status").some((el) => el.closest("[data-item-index]"))).toBe(true)
    })
    const parentBtn = screen.getAllByText("Set status")
      .map((n) => n.closest("button"))
      .find((b): b is HTMLButtonElement => Boolean(b?.hasAttribute("data-item-index")))!
    fireEvent.click(parentBtn)

    // Inside hierarchy
    await waitFor(() => {
      expect(screen.getByTestId("breadcrumb-root")).toBeInTheDocument()
    })

    // ESC goes back to top level (palette stays open)
    act(() => { dispatchEscape() })
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/command/i)).toBeInTheDocument()
      expect(screen.queryByTestId("breadcrumb-root")).not.toBeInTheDocument()
    })

    // ESC again closes palette
    act(() => { dispatchEscape() })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/command/i)).not.toBeInTheDocument()
    })
  })

  it("breadcrumb 'All' click returns to root", async () => {
    const task = createTask({ id: "tx-bread-1", title: "Breadcrumb task", status: "backlog" })

    server.use(
      ...baseHandlers({ tasks: [task], cycles: [createCycle()] }),
      http.get("/api/tasks/:id", () =>
        HttpResponse.json({ task, blockedByTasks: [], blocksTasks: [], childTasks: [] })
      ),
    )

    renderApp()
    await openTaskDetail(task)

    await openPalette()
    fireEvent.change(screen.getByPlaceholderText(/command/i), { target: { value: "Set status" } })
    await waitFor(() => {
      expect(screen.getAllByText("Set status").some((el) => el.closest("[data-item-index]"))).toBe(true)
    })
    const parentBtn = screen.getAllByText("Set status")
      .map((n) => n.closest("button"))
      .find((b): b is HTMLButtonElement => Boolean(b?.hasAttribute("data-item-index")))!
    fireEvent.click(parentBtn)

    await waitFor(() => {
      expect(screen.getByTestId("breadcrumb-root")).toHaveTextContent("All")
    })

    // Click "All" to return to root
    fireEvent.click(screen.getByTestId("breadcrumb-root"))
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/command/i)).toBeInTheDocument()
      expect(screen.queryByTestId("breadcrumb-root")).not.toBeInTheDocument()
    })
  })

  it("'Move to cycle' drill-down adds task to cycle", async () => {
    const task = createTask({ id: "tx-move-1", title: "Task to move", status: "backlog" })
    const cycle = createCycle({ id: "c-move-1", name: "Target Sprint" })
    const addedToCycle: Array<{ cycleId: string; taskIds: string[] }> = []

    server.use(
      ...baseHandlers({ tasks: [task], cycles: [cycle] }),
      http.get("/api/tasks/:id", () =>
        HttpResponse.json({ task, blockedByTasks: [], blocksTasks: [], childTasks: [] })
      ),
      http.post("/api/cycles/:id/tasks", async ({ params, request }) => {
        const payload = (await request.json()) as { taskIds: string[] }
        addedToCycle.push({ cycleId: String(params.id), taskIds: payload.taskIds })
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderApp()
    await openTaskDetail(task)

    // Search to surface "Move to cycle"
    await openPalette()
    fireEvent.change(screen.getByPlaceholderText(/command/i), { target: { value: "Move to cycle" } })

    await waitFor(() => {
      const matches = screen.getAllByText("Move to cycle")
      expect(matches.some((el) => el.closest("[data-item-index]"))).toBe(true)
    })

    // Drill into cycle options
    const parentBtn = screen.getAllByText("Move to cycle")
      .map((n) => n.closest("button"))
      .find((b): b is HTMLButtonElement => Boolean(b?.hasAttribute("data-item-index")))!
    fireEvent.click(parentBtn)

    // Select the cycle
    await waitFor(() => {
      expect(screen.getByText("Target Sprint")).toBeInTheDocument()
    })
    const cycleBtn = screen.getAllByText("Target Sprint")
      .map((n) => n.closest("button"))
      .find((b): b is HTMLButtonElement => Boolean(b?.hasAttribute("data-item-index")))!
    fireEvent.click(cycleBtn)

    await waitFor(() => {
      expect(addedToCycle.some((e) =>
        e.cycleId === "c-move-1" && e.taskIds.includes("tx-move-1")
      )).toBe(true)
    })
  })
})
