import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { KanbanBoard } from "../KanbanBoard"
import type { TaskWithDeps } from "../../../api/client"
import type { TaskFilters, UseInfiniteTasksResult } from "../../../hooks/useInfiniteTasks"

const mockUseInfiniteTasks = vi.fn()
const mockUpdateTask = vi.fn()

vi.mock("../../../hooks/useInfiniteTasks", () => ({
  useInfiniteTasks: (filters: TaskFilters) => mockUseInfiniteTasks(filters),
}))

vi.mock("../../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/client")>("../../../api/client")
  return {
    ...actual,
    fetchers: {
      ...actual.fetchers,
      updateTask: (...args: unknown[]) => mockUpdateTask(...args),
    },
  }
})

vi.mock("../TaskCard", () => ({
  TaskCard: ({
    task,
    onClick,
  }: {
    task: TaskWithDeps
    onClick?: () => void
  }) => (
    <button type="button" data-testid={`task-card-${task.id}`} onClick={onClick}>
      {task.title}
    </button>
  ),
}))

function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 10)}`,
    title: "Task",
    description: "",
    status: "backlog",
    parentId: null,
    score: 100,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    completedAt: null,
    assigneeType: "agent",
    assigneeId: null,
    assignedAt: null,
    assignedBy: null,
    metadata: {},
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

function createHookResult(
  tasks: TaskWithDeps[],
  overrides: Partial<UseInfiniteTasksResult> = {},
): UseInfiniteTasksResult {
  return {
    tasks,
    data: undefined,
    fetchNextPage: vi.fn().mockResolvedValue(undefined),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    total: tasks.length,
    ...overrides,
  }
}

function configureHookMocks(
  nonDoneResult: UseInfiniteTasksResult,
  doneResult: UseInfiniteTasksResult,
): void {
  mockUseInfiniteTasks.mockImplementation((filters: TaskFilters) => {
    if (filters.status?.length === 1 && filters.status[0] === "done") {
      return doneResult
    }
    return nonDoneResult
  })
}

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    getData: (type: string) => store.get(type) ?? "",
    clearData: () => {
      store.clear()
    },
    dropEffect: "move",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
  } as DataTransfer
}

describe("KanbanBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateTask.mockResolvedValue(undefined)
  })

  it("renders all 8 status columns and groups tasks", () => {
    const nonDoneTasks = [
      createTask({ id: "tx-backlog", title: "Backlog Task", status: "backlog" }),
      createTask({ id: "tx-ready", title: "Ready Task", status: "ready" }),
      createTask({ id: "tx-planning", title: "Planning Task", status: "planning" }),
      createTask({ id: "tx-active", title: "Active Task", status: "active" }),
      createTask({ id: "tx-blocked", title: "Blocked Task", status: "blocked" }),
      createTask({ id: "tx-review", title: "Review Task", status: "review" }),
      createTask({ id: "tx-needs", title: "Needs Review Task", status: "human_needs_to_review" }),
    ]
    const doneTasks = [createTask({ id: "tx-done", title: "Done Task", status: "done", completedAt: "2026-02-02T00:00:00.000Z" })]

    configureHookMocks(createHookResult(nonDoneTasks), createHookResult(doneTasks, { total: 1 }))

    render(<KanbanBoard onSelectTask={vi.fn()} />)

    expect(screen.getByTestId("kanban-column-backlog")).toBeInTheDocument()
    expect(screen.getByTestId("kanban-column-ready")).toBeInTheDocument()
    expect(screen.getByTestId("kanban-column-planning")).toBeInTheDocument()
    expect(screen.getByTestId("kanban-column-active")).toBeInTheDocument()
    expect(screen.getByTestId("kanban-column-blocked")).toBeInTheDocument()
    expect(screen.getByTestId("kanban-column-review")).toBeInTheDocument()
    expect(screen.getByTestId("kanban-column-human_needs_to_review")).toBeInTheDocument()
    expect(screen.getByTestId("kanban-column-done")).toBeInTheDocument()

    expect(within(screen.getByTestId("kanban-column-backlog")).getByText("Backlog Task")).toBeInTheDocument()
    expect(within(screen.getByTestId("kanban-column-done")).getByText("Done Task")).toBeInTheDocument()
  })

  it("calls onSelectTask when a card is clicked", () => {
    const onSelectTask = vi.fn()
    configureHookMocks(
      createHookResult([createTask({ id: "tx-click", title: "Clickable", status: "ready" })]),
      createHookResult([]),
    )

    render(<KanbanBoard onSelectTask={onSelectTask} />)

    fireEvent.click(screen.getByTestId("task-card-tx-click"))

    expect(onSelectTask).toHaveBeenCalledWith("tx-click")
  })

  it("rejects invalid transitions and shows a brief error", async () => {
    const doneTask = createTask({ id: "tx-done-invalid", title: "Done Task", status: "done", completedAt: "2026-02-03T00:00:00.000Z" })
    configureHookMocks(createHookResult([]), createHookResult([doneTask], { total: 1 }))

    render(<KanbanBoard onSelectTask={vi.fn()} />)

    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(screen.getByTestId("kanban-draggable-tx-done-invalid"), { dataTransfer })
    fireEvent.dragOver(screen.getByTestId("kanban-column-review"), { dataTransfer })
    fireEvent.drop(screen.getByTestId("kanban-column-review"), { dataTransfer })

    await waitFor(() => {
      expect(screen.getByText("Invalid transition: done → review")).toBeInTheDocument()
    })

    expect(mockUpdateTask).not.toHaveBeenCalled()
    expect(within(screen.getByTestId("kanban-column-done")).getByText("Done Task")).toBeInTheDocument()
  })

  it("optimistically moves task on valid transition and calls update endpoint", async () => {
    const nonDoneRefetch = vi.fn().mockResolvedValue(undefined)
    const doneRefetch = vi.fn().mockResolvedValue(undefined)

    configureHookMocks(
      createHookResult(
        [createTask({ id: "tx-move", title: "Move Me", status: "ready" })],
        { refetch: nonDoneRefetch },
      ),
      createHookResult([], { refetch: doneRefetch }),
    )

    let resolveUpdate: (() => void) | null = null
    mockUpdateTask.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve
        }),
    )

    render(<KanbanBoard onSelectTask={vi.fn()} />)

    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(screen.getByTestId("kanban-draggable-tx-move"), { dataTransfer })
    fireEvent.dragOver(screen.getByTestId("kanban-column-active"), { dataTransfer })
    fireEvent.drop(screen.getByTestId("kanban-column-active"), { dataTransfer })

    await waitFor(() => {
      expect(within(screen.getByTestId("kanban-column-active")).getByText("Move Me")).toBeInTheDocument()
    })

    expect(mockUpdateTask).toHaveBeenCalledWith("tx-move", { status: "active" })
    await act(async () => {
      resolveUpdate?.()
      await Promise.resolve()
    })
  })

  it("shows done total count and reveals 10 more tasks per click", async () => {
    const doneTasks = Array.from({ length: 18 }, (_, index) => {
      const order = index + 1
      return createTask({
        id: `tx-done-${order}`,
        title: `Done ${order}`,
        status: "done",
        completedAt: `2026-02-${String(30 - order).padStart(2, "0")}T00:00:00.000Z`,
      })
    })

    configureHookMocks(
      createHookResult([]),
      createHookResult(doneTasks, {
        total: 18,
      }),
    )

    render(<KanbanBoard onSelectTask={vi.fn()} />)

    const doneColumn = screen.getByTestId("kanban-column-done")

    expect(screen.getByTestId("kanban-count-done")).toHaveTextContent("18")
    expect(within(doneColumn).getAllByTestId(/task-card-tx-done-/)).toHaveLength(5)

    fireEvent.click(screen.getByRole("button", { name: "Show more" }))

    await waitFor(() => {
      expect(within(doneColumn).getAllByTestId(/task-card-tx-done-/)).toHaveLength(15)
    })
  })
})
