import { describe, it, expect, afterEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { DocGraph } from "../DocGraph"

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

describe("DocGraph", () => {
  afterEach(() => {
    server.resetHandlers()
  })

  it("renders graph nodes and allows selecting a doc", async () => {
    server.use(
      http.get("/api/docs/graph", () =>
        HttpResponse.json({
          nodes: [
            { id: "doc:1", label: "PRD-001", kind: "prd", status: "changing" },
            { id: "doc:2", label: "DD-001", kind: "design", status: "changing" },
          ],
          edges: [{ source: "doc:1", target: "doc:2", type: "prd_to_design" }],
        }),
      ),
    )

    const onSelectDoc = vi.fn()

    renderWithProviders(
      <DocGraph
        selectedDocName={null}
        onSelectDoc={onSelectDoc}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("PRD-001")).toBeInTheDocument()
      expect(screen.getByText("DD-001")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("PRD-001"))
    expect(onSelectDoc).toHaveBeenCalledWith("PRD-001")
  })

  it("shows empty-state text when graph has no nodes", async () => {
    server.use(
      http.get("/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [] })),
    )

    renderWithProviders(<DocGraph />)

    await waitFor(() => {
      expect(screen.getByText("No doc graph data")).toBeInTheDocument()
    })
  })
})
