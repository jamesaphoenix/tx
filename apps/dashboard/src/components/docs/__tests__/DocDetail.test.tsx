import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { DocDetail } from "../DocDetail"
import type { DocSerialized, DocsListResponse, DocSourceResponse } from "../../../api/client"

const docFixture: DocSerialized = {
  id: 1,
  docId: "doc-111111111111",
  hash: "abcdef1234567890",
  kind: "prd",
  name: "PRD-001-dashboard",
  title: "Dashboard PRD",
  version: 3,
  status: "changing",
  filePath: "prd/PRD-001-dashboard.yml",
  parentDocId: null,
  createdAt: "2026-02-20T00:00:00.000Z",
  lockedAt: null,
}

const docsFixture: DocsListResponse = {
  docs: [docFixture],
}

const sourceFixture: DocSourceResponse = {
  docId: docFixture.docId,
  name: docFixture.name,
  version: docFixture.version,
  filePath: docFixture.filePath,
  yamlContent: "name: PRD-001-dashboard\nkind: prd",
  renderedContent: "# Dashboard PRD\n\n**Kind**: prd\n\nRendered body text",
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

describe("DocDetail", () => {
  beforeEach(() => {
    server.use(
      http.get("*", ({ request }) => {
        const pathname = new URL(request.url).pathname

        if (pathname === `/api/docs/by-id/${encodeURIComponent(docFixture.docId)}`) {
          return HttpResponse.json(docFixture)
        }

        if (pathname === `/api/docs/by-id/${encodeURIComponent(docFixture.docId)}/source`) {
          return HttpResponse.json(sourceFixture)
        }

        if (pathname === "/api/docs") {
          return HttpResponse.json(docsFixture)
        }
        if (pathname === "/api/docs/graph") return HttpResponse.json({ nodes: [], edges: [] })

        return HttpResponse.json({ error: "not found" }, { status: 404 })
      }),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("renders document details with rendered content", async () => {
    const onNavigateToDoc = vi.fn()

    renderWithProviders(
      <DocDetail
        docId={docFixture.docId}
        version={docFixture.version}
        onNavigateToDoc={onNavigateToDoc}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: docFixture.title })).toBeInTheDocument()
      expect(screen.getByText("Rendered body text")).toBeInTheDocument()
    })

    // YAML Source toggle was removed; verify metadata is visible instead
    expect(screen.getByText(docFixture.name)).toBeInTheDocument()
  })

  it("does not render the copied plan title twice when the body starts with a blank line", async () => {
    server.use(http.get(`/api/docs/by-id/${docFixture.docId}/source`, () => HttpResponse.json({...sourceFixture,
      renderedContent:`\n# ${docFixture.title}\n\n## Steps\n\n1. Implement the change.\n`})))
    renderWithProviders(<DocDetail docId={docFixture.docId} version={3} onNavigateToDoc={vi.fn()} />)
    await screen.findByText("Implement the change.")
    expect(screen.getAllByRole("heading",{level:1,name:docFixture.title})).toHaveLength(1)
    expect(screen.getByRole("heading",{name:"Steps"})).toBeInTheDocument()
  })

  it("preserves an opening section heading that is not the document title", async () => {
    server.use(http.get(`/api/docs/by-id/${docFixture.docId}/source`, () => HttpResponse.json({...sourceFixture,
      renderedContent:"# Context\n\nDesign context remains meaningful.\n"})))
    renderWithProviders(<DocDetail docId={docFixture.docId} version={3} onNavigateToDoc={vi.fn()} />)
    expect(await screen.findByRole("heading",{name:"Context"})).toBeInTheDocument()
  })

  it("uses stored design and task links even when document names have no shared prefix", async () => {
    const plan = { ...docFixture, id: 2, docId: "doc-222222222222", kind: "plan", name: "agent-plan", title: "Agent's implementation plan", version: 1 }
    const samePrefix = { ...docFixture, id: 3, docId: "doc-333333333333", kind: "design", name: "DD-001-unrelated", title: "Unrelated design" }
    server.use(
      http.get("/api/docs", () => HttpResponse.json({ docs: [docFixture, plan, samePrefix] })),
      http.get("/api/docs/graph", () => HttpResponse.json({ nodes: [
        { id: "doc:1", kind: "prd", label: docFixture.name },
        { id: "doc:2", kind: "plan", label: plan.name },
        { id: "task:tx-linked", kind: "task", label: "Implement payment retry" },
      ], edges: [
        { source: "doc:1", target: "doc:2", type: "spec_to_plan" },
        { source: "task:tx-linked", target: "doc:1", type: "implements" },
      ] })),
    )
    const navigate = vi.fn()
    renderWithProviders(<DocDetail docId={docFixture.docId} version={3} onNavigateToDoc={navigate} />)
    const planLink = await screen.findByRole("link", { name: /Agent's implementation plan/ })
    expect(planLink).toHaveAttribute("href", "/?tab=docs&docId=doc-222222222222&version=1")
    fireEvent.click(planLink)
    expect(navigate).toHaveBeenCalledWith("doc-222222222222", 1)
    expect(screen.getByRole("link", { name: /Implement payment retry/ })).toHaveAttribute("href", "/?view=list&taskId=tx-linked")
    expect(screen.queryByText("DD-001-unrelated")).not.toBeInTheDocument()
  })

  it("shows a source read error and retries without hiding the document metadata", async () => {
    let failed = true
    server.use(http.get(`/api/docs/by-id/${docFixture.docId}/source`, () => failed
      ? HttpResponse.json({ error: "Source unavailable" }, { status: 500 })
      : HttpResponse.json(sourceFixture)))
    renderWithProviders(<DocDetail docId={docFixture.docId} version={3} onNavigateToDoc={vi.fn()} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load document content: Source unavailable")
    expect(screen.getByRole("heading", { name: docFixture.title })).toBeInTheDocument()
    expect(screen.queryByText("No rendered content available")).not.toBeInTheDocument()
    failed = false
    fireEvent.click(screen.getByRole("button", { name: "Retry content" }))
    expect(await screen.findByText("Rendered body text")).toBeInTheDocument()
  })

  it("distinguishes a failed detail request from a document that is not found", async () => {
    server.use(http.get(`/api/docs/by-id/${docFixture.docId}`, () => HttpResponse.json({ error: "Database unavailable" }, { status: 500 })))
    renderWithProviders(<DocDetail docId={docFixture.docId} version={3} onNavigateToDoc={vi.fn()} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load document: Database unavailable")
    expect(screen.queryByText("Doc not found")).not.toBeInTheDocument()
  })
})
