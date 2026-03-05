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
              cycle: 1,
              name: "Cycle One",
              description: "First cycle",
              startedAt: "2026-02-20T00:00:00.000Z",
              endedAt: null,
              status: "completed",
              rounds: 2,
              totalNewIssues: 1,
              existingIssues: 0,
              finalLoss: 3,
              converged: false,
            },
          ],
        }),
      ),
      http.get("/api/cycles/:id", ({ params }) => {
        if (params.id !== "cycle-1") {
          return HttpResponse.json({ error: "not found" }, { status: 404 })
        }

        return HttpResponse.json({
          cycle: {
            id: "cycle-1",
            cycle: 1,
            name: "Cycle One",
            description: "First cycle",
            startedAt: "2026-02-20T00:00:00.000Z",
            endedAt: null,
            status: "completed",
            rounds: 2,
            totalNewIssues: 1,
            existingIssues: 0,
            finalLoss: 3,
            converged: false,
          },
          roundMetrics: [
            {
              cycle: 1,
              round: 1,
              loss: 3,
              newIssues: 1,
              existingIssues: 0,
              duplicates: 0,
              high: 1,
              medium: 0,
              low: 0,
            },
          ],
          issues: [
            {
              id: "issue-1",
              title: "Sample issue",
              description: "Issue details",
              severity: "high",
              issueType: "quality",
              file: "src/app.ts",
              line: 10,
              cycle: 1,
              round: 1,
            },
          ],
        })
      }),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("loads selected cycle details", async () => {
    renderWithProviders(<CyclePage />)

    expect(screen.getByText("Select a cycle to view details")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText("Cycle 1")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Cycle 1"))

    await waitFor(() => {
      expect(screen.getByText("Issues (1)")).toBeInTheDocument()
      expect(screen.getByText("Loss Convergence — Cycle One")).toBeInTheDocument()
    })
  })
})
