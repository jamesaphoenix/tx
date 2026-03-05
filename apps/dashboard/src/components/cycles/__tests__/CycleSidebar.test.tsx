import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { CycleSidebar } from "../CycleSidebar"
import type { CyclesResponse } from "../../../api/client"

const cyclesFixture: CyclesResponse = {
  cycles: [
    {
      id: "cycle-1",
      cycle: 1,
      name: "Cycle One",
      description: "First cycle",
      startedAt: "2026-02-20T00:00:00.000Z",
      endedAt: null,
      status: "completed",
      rounds: 3,
      totalNewIssues: 5,
      existingIssues: 2,
      finalLoss: 1,
      converged: true,
    },
  ],
}

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
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe("CycleSidebar", () => {
  beforeEach(() => {
    server.use(
      http.get("/api/cycles", () => HttpResponse.json(cyclesFixture)),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("loads cycles and lets users select one", async () => {
    const onSelectCycle = vi.fn()

    renderWithProviders(
      <CycleSidebar
        selectedCycleId={null}
        onSelectCycle={onSelectCycle}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("Cycle 1")).toBeInTheDocument()
      expect(screen.getByText("Cycle One")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Cycle 1"))
    expect(onSelectCycle).toHaveBeenCalledWith("cycle-1")
  })
})
