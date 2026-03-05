import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { DocDetail } from "../DocDetail"
import type { DocSerialized, DocsListResponse, DocRenderResponse, DocSourceResponse } from "../../../api/client"

const docFixture: DocSerialized = {
  id: 1,
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

const renderFixture: DocRenderResponse = {
  rendered: ["# Dashboard PRD\n\n**Kind**: prd\n\nRendered body text"],
}

const sourceFixture: DocSourceResponse = {
  name: docFixture.name,
  filePath: docFixture.filePath,
  yamlContent: "name: PRD-001-dashboard\nkind: prd",
  renderedContent: null,
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

        if (pathname === `/api/docs/${encodeURIComponent(docFixture.name)}`) {
          return HttpResponse.json(docFixture)
        }

        if (pathname === `/api/docs/${encodeURIComponent(docFixture.name)}/source`) {
          return HttpResponse.json(sourceFixture)
        }

        if (pathname === "/api/docs") {
          return HttpResponse.json(docsFixture)
        }

        return HttpResponse.json({ error: "not found" }, { status: 404 })
      }),
      http.post("/api/docs/render", () => HttpResponse.json(renderFixture)),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it("renders document details and toggles to YAML source", async () => {
    const onNavigateToDoc = vi.fn()

    renderWithProviders(
      <DocDetail
        docName={docFixture.name}
        onNavigateToDoc={onNavigateToDoc}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: docFixture.title })).toBeInTheDocument()
      expect(screen.getByText("Rendered body text")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "YAML Source" }))

    expect(screen.getByText(/name: PRD-001-dashboard/)).toBeInTheDocument()
    expect(screen.getByText(/kind: prd/)).toBeInTheDocument()
  })
})
