import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { DocumentLinks } from "../DocumentLinks"

const plan = { id: 2, docId: "doc-222222222222", kind: "plan", title: "Saved agent plan", name: "saved-plan", version: 3 }
const design = { id: 1, docId: "doc-111111111111", kind: "design", title: "Payment design", name: "payment", version: 1 }
const renderLinks = (nodeId: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(<DocumentLinks nodeId={nodeId} />, { wrapper })
}

describe("DocumentLinks", () => {
  it("follows a task's recorded plan link and recomputes links when the task changes", async () => {
    server.use(
      http.get("/api/docs", () => HttpResponse.json({ docs: [design, plan] })),
      http.get("/api/docs/graph", () => HttpResponse.json({ nodes: [], edges: [
        { source: "task:tx-first", target: "doc:2", type: "implements" },
        { source: "task:tx-second", target: "doc:1", type: "references" },
      ] })),
    )
    const view = renderLinks("task:tx-first")
    expect(await screen.findByRole("link", { name: /Saved agent plan/ })).toHaveAttribute("href", "/?tab=docs&docId=doc-222222222222&version=3")
    expect(screen.queryByRole("link", { name: /Payment design/ })).not.toBeInTheDocument()
    view.rerender(<DocumentLinks nodeId="task:tx-second" />)
    expect(await screen.findByRole("link", { name: /Payment design/ })).toHaveAttribute("href", "/?tab=docs&docId=doc-111111111111&version=1")
    expect(screen.queryByRole("link", { name: /Saved agent plan/ })).not.toBeInTheDocument()
  })

  it("describes the design, plan and task link directions in plain language",async () => {
    server.use(
      http.get("/api/docs",() => HttpResponse.json({docs:[design,plan]})),
      http.get("/api/docs/graph",() => HttpResponse.json({nodes:[{id:"task:tx-first",kind:"task",label:"Implement payments"}],edges:[
        {source:"doc:1",target:"doc:2",type:"spec_to_plan"},
        {source:"task:tx-first",target:"doc:2",type:"implements"},
      ]})),
    )
    const view = renderLinks("doc:2")
    expect(await screen.findByRole("link",{name:/Payment design/})).toHaveTextContent("Based on")
    expect(screen.getByRole("link",{name:/Implement payments/})).toHaveTextContent("Implemented by")
    view.rerender(<DocumentLinks nodeId="doc:1" />)
    expect(await screen.findByRole("link",{name:/Saved agent plan/})).toHaveTextContent("Implementation plan")
    view.rerender(<DocumentLinks nodeId="task:tx-first" />)
    expect(await screen.findByRole("link",{name:/Saved agent plan/})).toHaveTextContent("Based on")
  })

  it("does not invent a relationship for an unlinked task", async () => {
    let reads = 0
    server.use(
      http.get("/api/docs", () => { reads++; return HttpResponse.json({ docs: [plan] }) }),
      http.get("/api/docs/graph", () => { reads++; return HttpResponse.json({ nodes: [], edges: [] }) }),
    )
    renderLinks("task:tx-unlinked")
    await waitFor(() => expect(reads).toBe(2))
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("reports unavailable relationship data instead of silently presenting no links", async () => {
    let unavailable = true
    server.use(
      http.get("/api/docs", () => HttpResponse.json({ docs: [plan] })),
      http.get("/api/docs/graph", () => unavailable
        ? HttpResponse.json({ error: "Graph unavailable" }, { status: 500 })
        : HttpResponse.json({nodes:[],edges:[{source:"task:tx-first",target:"doc:2",type:"implements"}]})),
    )
    renderLinks("task:tx-first")
    expect(await screen.findByRole("status")).toHaveTextContent("Could not load document links: Graph unavailable")
    unavailable = false
    fireEvent.click(screen.getByRole("button",{name:"Retry links"}))
    expect(await screen.findByRole("link",{name:/Saved agent plan/})).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
