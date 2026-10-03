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
        selectedNodeId={null}
        onSelectDoc={onSelectDoc}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("PRD-001")).toBeInTheDocument()
      expect(screen.getByText("DD-001")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("PRD-001"))
    expect(onSelectDoc).toHaveBeenCalledWith(1)
  })

  it("renders configured document kinds without treating object property names as built-ins", async () => {
    server.use(http.get("/api/docs/graph", () => HttpResponse.json({nodes:[
      {id:"doc:9",label:"Construction notes",kind:"constructor"},
      {id:"doc:10",label:"Implementation plan",kind:"plan"},
    ],edges:[]})))
    const selectDoc = vi.fn()
    renderWithProviders(<DocGraph onSelectDoc={selectDoc} fullPage />)
    const node = await screen.findByRole("button",{name:"constructor: Construction notes"})
    fireEvent.keyDown(node,{key:"Enter"})
    expect(selectDoc).toHaveBeenCalledWith(9)
    expect(screen.getByText("constructor")).toBeInTheDocument()
    expect(node.querySelector('circle')).toHaveAttribute("fill","#9CA3AF")
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
  it("makes document and task nodes keyboard operable", async () => {
    server.use(http.get("/api/docs/graph", () => HttpResponse.json({ nodes: [
      { id: "doc:2", label: "Saved plan", kind: "plan" },
      { id: "task:tx-step", label: "Implement checkout", kind: "task" },
    ], edges: [] })))
    const selectDoc = vi.fn(), selectTask = vi.fn()
    renderWithProviders(<DocGraph onSelectDoc={selectDoc} onSelectTask={selectTask} />)
    const plan = await screen.findByRole("button", { name: "plan: Saved plan" })
    expect(plan).toHaveAttribute("tabindex", "0")
    fireEvent.keyDown(plan, { key: "Enter" })
    expect(selectDoc).toHaveBeenCalledWith(2)
    fireEvent.keyDown(screen.getByRole("button", { name: "task: Implement checkout" }), { key: " " })
    expect(selectTask).toHaveBeenCalledWith("tx-step")
  })
  it("shows a failed graph request as an error and allows retry", async () => {
    let failed = true
    server.use(http.get("/api/docs/graph", () => failed
      ? HttpResponse.json({ error: "Graph unavailable" }, { status: 500 })
      : HttpResponse.json({ nodes: [{ id: "doc:1", label: "Recovered design", kind: "design" }], edges: [] })))
    renderWithProviders(<DocGraph />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load document graph: Graph unavailable")
    expect(screen.queryByText("No doc graph data")).not.toBeInTheDocument()
    failed = false
    fireEvent.click(screen.getByRole("button", { name: "Retry graph" }))
    expect(await screen.findByText("Recovered design")).toBeInTheDocument()
  })
  it("places plans between specs and tasks [INV-LEAN-005]", async () => {
    server.use(http.get("/api/docs/graph", () => HttpResponse.json({nodes:[
      {id:"doc:1",label:"Design spec",kind:"design"},
      {id:"doc:2",label:"Saved plan",kind:"plan"},
      {id:"task:1",label:"Task step",kind:"task"},
    ],edges:[{source:"doc:1",target:"doc:2",type:"spec_to_plan"},{source:"doc:2",target:"task:1",type:"implements"}]})))
    renderWithProviders(<DocGraph fullPage />)
    const plan = await screen.findByText("Saved plan")
    const y = (label: string) => Number(screen.getByText(label).getAttribute("y"))
    expect(y("Design spec")).toBeLessThan(Number(plan.getAttribute("y")))
    expect(Number(plan.getAttribute("y"))).toBeLessThan(y("Task step"))
    expect(screen.getByText("Plan")).toBeInTheDocument()
    expect(screen.queryByText("Decision")).not.toBeInTheDocument()
    expect(screen.queryByText("Runbook")).not.toBeInTheDocument()
  })

  it("keeps the full design and task path visible without highlighting a sibling plan",async () => {
    server.use(http.get("/api/docs/graph",() => HttpResponse.json({nodes:[
      {id:"doc:1",label:"Product contract",kind:"prd"},
      {id:"doc:2",label:"Shared design",kind:"design"},
      {id:"doc:3",label:"Selected plan",kind:"plan"},
      {id:"doc:4",label:"Sibling plan",kind:"plan"},
      {id:"task:tx-step",label:"Linked step",kind:"task"},
    ],edges:[
      {source:"doc:1",target:"doc:2",type:"prd_to_design"},
      {source:"doc:2",target:"doc:3",type:"spec_to_plan"},
      {source:"doc:2",target:"doc:4",type:"spec_to_plan"},
      {source:"task:tx-step",target:"doc:3",type:"implements"},
    ]})))
    renderWithProviders(<DocGraph selectedNodeId="doc:3" onSelectDoc={vi.fn()} onSelectTask={vi.fn()} fullPage />)
    expect(await screen.findByRole("button",{name:"prd: Product contract"})).toHaveStyle({opacity:"1"})
    expect(screen.getByRole("button",{name:"design: Shared design"})).toHaveStyle({opacity:"1"})
    expect(screen.getByRole("button",{name:"task: Linked step"})).toHaveStyle({opacity:"1"})
    expect(screen.getByRole("button",{name:"plan: Sibling plan"})).toHaveStyle({opacity:"0.25"})
  })

})
