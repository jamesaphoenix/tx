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

})
