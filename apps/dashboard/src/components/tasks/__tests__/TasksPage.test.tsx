import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { CommandProvider } from "../../command-palette/CommandContext"
import { TasksPage } from "../TasksPage"

vi.mock("../TaskList", () => ({
  TaskList: ({ onSelectTask }: { onSelectTask: (taskId: string) => void }) => (
    <button onClick={() => onSelectTask("tx-open-1")}>Open Mock Task</button>
  ),
}))

vi.mock("../TaskDetail", () => ({
  TaskDetail: ({ taskId }: { taskId: string }) => <div>TaskDetail:{taskId}</div>,
}))

vi.mock("../TaskComposerModal", () => ({
  TaskComposerModal: ({ open, heading }: { open: boolean; heading: string }) => (
    open ? <div>Composer:{heading}</div> : null
  ),
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandProvider>{ui}</CommandProvider>
    </QueryClientProvider>,
  )
}

describe("TasksPage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/")

    server.use(
      http.get("/api/labels", () => HttpResponse.json({ labels: [] })),
      http.get("/api/tasks/:id", ({ params }) => {
        const id = String(params.id)
        return HttpResponse.json({
          task: {
            id,
            title: `Task ${id}`,
            description: "Task detail",
            status: "ready",
            parentId: null,
            score: 500,
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:00:00.000Z",
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
            groupContext: null,
            effectiveGroupContext: null,
            effectiveGroupContextSourceTaskId: null,
            orchestrationStatus: null,
            claimedBy: null,
            claimExpiresAt: null,
            failedAttempts: 0,
          },
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [],
        })
      }),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("opens the composer from the New Task button", () => {
    renderWithProviders(<TasksPage />)

    fireEvent.click(screen.getByRole("button", { name: "New Task" }))

    expect(screen.getByText("Composer:New task")).toBeInTheDocument()
  })

  it("navigates from task list to task detail and back", async () => {
    renderWithProviders(<TasksPage />)

    fireEvent.click(screen.getByRole("button", { name: "Open Mock Task" }))

    await waitFor(() => {
      expect(screen.getByText("TaskDetail:tx-open-1")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "← Back to Tasks" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Mock Task" })).toBeInTheDocument()
    })
  })
})
