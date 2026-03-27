import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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
})
