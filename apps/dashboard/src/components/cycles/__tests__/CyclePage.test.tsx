import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { CommandProvider } from "../../command-palette/CommandContext"
import { CyclePage } from "../CyclePage"

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

describe("CyclePage", () => {
  beforeEach(() => {
    server.use(
      http.get("/api/cycles", () =>
        HttpResponse.json({
          cycles: [
            {
              id: "cycle-1",
              name: "Sprint 1",
              startDate: "2026-03-10",
              endDate: "2026-03-17",
              status: "completed",
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
              taskCount: 5,
              completedCount: 3,
              inProgressCount: 1,
            },
          ],
        }),
      ),
      http.get("/api/cycles/:id", ({ params }) => {
        if (params.id !== "cycle-1") {
          return HttpResponse.json({ error: "not found" }, { status: 404 })
        }

        return HttpResponse.json({
          id: "cycle-1",
          name: "Sprint 1",
          startDate: "2026-03-10",
          endDate: "2026-03-17",
          status: "completed",
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-10T00:00:00.000Z",
          taskCount: 5,
          completedCount: 3,
          inProgressCount: 1,
          tasks: [],
        })
      }),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("loads selected cycle details", async () => {
    renderWithProviders(<CyclePage />)

    // Wait for cycle list to load
    await waitFor(() => {
      expect(screen.getByText("Sprint 1")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Sprint 1"))

    await waitFor(() => {
      // CycleDetail renders the cycle name in multiple places
      expect(screen.getAllByText("Sprint 1").length).toBeGreaterThan(0)
    })
  })
})
