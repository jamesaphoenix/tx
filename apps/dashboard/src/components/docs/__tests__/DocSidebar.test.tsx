import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { DocSidebar } from "../DocSidebar"
import type { DocSerialized, DocGraphResponse } from "../../../api/client"

const docsFixture: DocSerialized[] = [
  {
    id: 1,
    hash: "h1",
    kind: "overview",
    name: "overview-dashboard",
    title: "Dashboard Overview",
    version: 1,
    status: "changing",
    filePath: "overview-dashboard.yml",
    parentDocId: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    lockedAt: null,
  },
  {
    id: 2,
    hash: "h2",
    kind: "prd",
    name: "PRD-001-dashboard",
    title: "Dashboard Product Requirements",
    version: 1,
    status: "changing",
    filePath: "prd/PRD-001-dashboard.yml",
    parentDocId: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    lockedAt: null,
  },
  {
    id: 3,
    hash: "h3",
    kind: "design",
    name: "DD-001-dashboard",
    title: "Dashboard Design",
    version: 1,
    status: "changing",
    filePath: "design/DD-001-dashboard.yml",
    parentDocId: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    lockedAt: null,
  },
]

const graphFixture: DocGraphResponse = {
  nodes: [
    { id: "doc:1", label: "overview-dashboard", kind: "overview", status: "changing" },
    { id: "doc:2", label: "PRD-001-dashboard", kind: "prd", status: "changing" },
    { id: "doc:3", label: "DD-001-dashboard", kind: "design", status: "changing" },
  ],
  edges: [
    { source: "doc:1", target: "doc:2", type: "overview_to_prd" },
    { source: "doc:2", target: "doc:3", type: "prd_to_design" },
  ],
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

function renderWithProviders() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <DocSidebar
        selectedDocName={null}
        onSelectDoc={vi.fn()}
        showMap={false}
        onToggleMap={vi.fn()}
        kindFilter=""
        onKindFilterChange={vi.fn()}
        statusFilter=""
        onStatusFilterChange={vi.fn()}
        selectedDocNames={new Set<string>()}
        onToggleSelectDoc={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe("DocSidebar", () => {
  beforeEach(() => {
    server.use(
      http.get("*", ({ request }) => {
        const pathname = new URL(request.url).pathname
        if (pathname === "/api/docs") {
          return HttpResponse.json({ docs: docsFixture })
        }
        if (pathname === "/api/docs/graph") {
          return HttpResponse.json(graphFixture)
        }
        return HttpResponse.json({ error: "not found" }, { status: 404 })
      }),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("renders grouped docs view by default", async () => {
    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText("overview-dashboard")).toBeInTheDocument()
      expect(screen.getByText("PRD-001-dashboard")).toBeInTheDocument()
      expect(screen.getByText("DD-001-dashboard")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: "Grouped" })).toHaveClass("bg-blue-600")
    expect(screen.getByText(/001 -/i)).toBeInTheDocument()
  })

  it("toggles to hierarchy view and uses doc graph relationships", async () => {
    let graphCalls = 0
    server.use(
      http.get("*", ({ request }) => {
        const pathname = new URL(request.url).pathname
        if (pathname === "/api/docs") {
          return HttpResponse.json({ docs: docsFixture })
        }
        if (pathname === "/api/docs/graph") {
          graphCalls += 1
          return HttpResponse.json(graphFixture)
        }
        return HttpResponse.json({ error: "not found" }, { status: 404 })
      }),
    )

    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText("overview-dashboard")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "Hierarchy" }))

    await waitFor(() => {
      expect(graphCalls).toBeGreaterThan(0)
      expect(screen.getByRole("button", { name: "Hierarchy" })).toHaveClass("bg-blue-600")
      expect(screen.queryByText(/001 -/i)).not.toBeInTheDocument()
      expect(screen.getByText("DD-001-dashboard")).toBeInTheDocument()
    })
  })
})
