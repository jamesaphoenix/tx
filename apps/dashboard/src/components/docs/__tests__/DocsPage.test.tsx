import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { CommandProvider } from "../../command-palette/CommandContext"
import { DocsPage } from "../DocsPage"

vi.mock("../DocSidebar", () => ({
  DocSidebar: ({ onToggleMap, onSelectDoc }: {
    onToggleMap: () => void
    onSelectDoc: (name: string) => void
  }) => (
    <div>
      <button onClick={onToggleMap}>Open Graph</button>
      <button onClick={() => onSelectDoc("PRD-001-dashboard")}>Select Doc</button>
    </div>
  ),
}))

vi.mock("../DocGraph", () => ({
  DocGraph: ({ onSelectDoc }: { onSelectDoc?: (name: string) => void }) => (
    <button onClick={() => onSelectDoc?.("PRD-001-dashboard")}>Graph Select Doc</button>
  ),
}))

vi.mock("../DocDetail", () => ({
  DocDetail: ({ docName }: { docName: string }) => <div>Detail:{docName}</div>,
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

describe("DocsPage", () => {
  beforeEach(() => {
    server.use(
      http.get("/api/docs", () =>
        HttpResponse.json({
          docs: [
            {
              id: 1,
              hash: "h1",
              kind: "prd",
              name: "PRD-001-dashboard",
              title: "Dashboard PRD",
              version: 1,
              status: "changing",
              filePath: "prd/PRD-001-dashboard.yml",
              parentDocId: null,
              createdAt: "2026-02-20T00:00:00.000Z",
              lockedAt: null,
            },
          ],
        }),
      ),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("switches between list and map flows while preserving selected doc", () => {
    renderWithProviders(<DocsPage />)

    expect(screen.getByText("Select a doc to view details")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Select Doc" }))
    expect(screen.getByText("Detail:PRD-001-dashboard")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open Graph" }))
    expect(screen.getByRole("button", { name: "Graph Select Doc" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Graph Select Doc" }))
    expect(screen.getByText("Detail:PRD-001-dashboard")).toBeInTheDocument()
  })
})
