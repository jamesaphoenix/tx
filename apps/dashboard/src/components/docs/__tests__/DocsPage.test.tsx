import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { CommandProvider, useCommandContext } from "../../command-palette/CommandContext"
import { DocsPage } from "../DocsPage"
import {selectionActions, selectionStore} from "../../../stores/selection-store"

vi.mock("../DocSidebar", () => ({
  DocSidebar: ({ onToggleMap, onSelectDoc, onKindFilterChange }: {
    onToggleMap: () => void
    onSelectDoc: (ref: string) => void
    onKindFilterChange: (kind:string) => void
  }) => (
    <div>
      <button onClick={onToggleMap}>Open Graph</button>
      <button onClick={() => onSelectDoc("doc-111111111111:1")}>Select Doc</button>
      <button onClick={() => onKindFilterChange("plan")}>Filter plans</button>
    </div>
  ),
}))

vi.mock("../DocGraph", () => ({
  DocGraph: ({ onSelectDoc }: { onSelectDoc?: (docDbId: number) => void }) => (
    <button onClick={() => onSelectDoc?.(1)}>Graph Select Doc</button>
  ),
}))

vi.mock("../DocDetail", () => ({
  DocDetail: ({ docId, version }: { docId: string; version: number }) => <div>Detail:{docId}:{version}</div>,
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

function CommandActions() {
  const {commands, executeCommand} = useCommandContext()
  return <>{commands.filter(command => ["action:copy-selected-docs", "action:delete-selected-docs"].includes(command.id)).map(command =>
    <button key={command.id} onClick={() => {void executeCommand(command)}}>{command.label}</button>)}</>
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandProvider>{ui}<CommandActions /></CommandProvider>
    </QueryClientProvider>,
  )
}

describe("DocsPage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/")
    selectionActions.clearAll()
    server.use(
      http.get("/api/docs", () =>
        HttpResponse.json({
          docs: [
            {
              id: 1,
              docId: "doc-111111111111",
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
    window.history.replaceState({}, "", "/")
  })

  it("copies all selected documents even when a kind filter hides one", async () => {
    const docs = [
      {id:1,docId:"doc-111111111111",version:1,kind:"prd",name:"requirements",title:"Requirements",status:"changing"},
      {id:2,docId:"doc-222222222222",version:1,kind:"plan",name:"implementation",title:"Implementation",status:"changing"},
    ]
    server.use(http.get("/api/docs", () => HttpResponse.json({docs})))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}})
    renderWithProviders(<DocsPage />)
    fireEvent.click(screen.getByRole("button",{name:"Select Doc"}))
    await screen.findByText("Detail:doc-111111111111:1")
    act(() => selectionActions.selectAllDocs(["doc-111111111111:1","doc-222222222222:1"]))
    fireEvent.click(screen.getByRole("button",{name:"Filter plans"}))
    fireEvent.click(screen.getByRole("button",{name:"Copy selected doc names"}))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("requirements (prd) - Requirements\nimplementation (plan) - Implementation"))
  })

  it("keeps failed deletions selected and refreshes after partial success", async () => {
    let docs = [
      {id:1,docId:"doc-111111111111",version:1,kind:"prd",name:"requirements",title:"Requirements",status:"changing"},
      {id:2,docId:"doc-222222222222",version:1,kind:"plan",name:"implementation",title:"Implementation",status:"changing"},
    ]
    const deletes: string[] = []
    server.use(
      http.get("/api/docs", () => HttpResponse.json({docs})),
      http.delete("/api/docs/by-id/:id", ({params}) => {
        deletes.push(String(params.id))
        if (params.id === "doc-222222222222") return HttpResponse.json({error:"File is read-only"},{status:500})
        docs = docs.filter(doc => doc.docId !== params.id)
        return HttpResponse.json({success:true})
      }),
    )
    const confirm = vi.spyOn(window,"confirm").mockReturnValue(true)
    renderWithProviders(<DocsPage />)
    fireEvent.click(screen.getByRole("button",{name:"Select Doc"}))
    await screen.findByText("Detail:doc-111111111111:1")
    act(() => selectionActions.selectAllDocs(["doc-111111111111:1","doc-222222222222:1"]))
    fireEvent.click(screen.getByRole("button",{name:"Filter plans"}))
    fireEvent.click(screen.getByRole("button",{name:"Delete selected docs"}))
    expect(await screen.findByRole("alert")).toHaveTextContent("File is read-only")
    expect(deletes).toEqual(["doc-111111111111","doc-222222222222"])
    expect(selectionStore.state.docRefs).toEqual(new Set(["doc-222222222222:1"]))
    expect(screen.queryByText("Detail:doc-111111111111:1")).not.toBeInTheDocument()
    confirm.mockRestore()
  })

  it("switches between list and map flows while preserving selected doc", async () => {
    renderWithProviders(<DocsPage />)

    expect(screen.getByText("Select a document to view details")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Select Doc" }))
    await waitFor(() => {
      expect(screen.getByText("Detail:doc-111111111111:1")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "Open Graph" }))
    expect(screen.getByRole("button", { name: "Graph Select Doc" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Graph Select Doc" }))
    await waitFor(() => {
      expect(screen.getByText("Detail:doc-111111111111:1")).toBeInTheDocument()
    })
  })

  it("opens the exact document version from a task's permalink", async () => {
    window.history.replaceState({}, "", "/?tab=docs&docId=doc-111111111111&version=1")
    renderWithProviders(<DocsPage />)
    expect(await screen.findByText("Detail:doc-111111111111:1")).toBeInTheDocument()
  })

  it("can follow a graph node outside the sidebar filter", async () => {
    renderWithProviders(<DocsPage />)
    fireEvent.click(screen.getByRole("button",{name:"Select Doc"}))
    await screen.findByText("Detail:doc-111111111111:1")
    fireEvent.click(screen.getByRole("button",{name:"Filter plans"}))
    fireEvent.click(screen.getByRole("button",{name:"Open Graph"}))
    fireEvent.click(screen.getByRole("button",{name:"Graph Select Doc"}))
    await screen.findByText("Detail:doc-111111111111:1")
    expect(screen.queryByRole("button",{name:"Graph Select Doc"})).not.toBeInTheDocument()
  })
})
