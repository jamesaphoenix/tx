import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { SpecHealthPage } from "../SpecHealthPage"
const renderPage = () => render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SpecHealthPage /></QueryClientProvider>)
describe("Spec Health", () => {
  it("shows a read error instead of healthy metrics [INV-LEAN-004] [INV-REQ-LEAN-004]", async () => {
    server.use(http.get("/api/spec/health", () => new HttpResponse(null, {status:500})))
    renderPage()
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load spec health")
    expect(screen.queryByText("Complete specs")).not.toBeInTheDocument()
  })
  it("shows missing and failing evidence separately [INV-LEAN-004] [INV-REQ-LEAN-004]", async () => {
    server.use(http.get("/api/spec/health", () => HttpResponse.json({status:"broken", specTest:{total:3,covered:2,uncovered:1,coveragePercent:67,passing:0,failing:1,untested:1,docsComplete:0,docsHarden:0,docsBuild:1}, decisions:{pending:0,approvedUnsynced:0,total:0},docDrift:{driftedDocs:0,totalDocs:1},docs:[{name:"checkout",phase:"BUILD",gaps:1,drift:[]}]})))
    renderPage()
    expect(await screen.findByText("Failing test evidence")).toBeInTheDocument()
    expect(screen.getByText("Failing evidence")).toBeInTheDocument()
    expect(screen.getByText("Missing test results")).toBeInTheDocument()
    expect(screen.getByText("checkout")).toBeInTheDocument()
  })
  it("links to the exact latest version and separates mapping from execution", async () => {
    server.use(http.get("/api/spec/health", () => HttpResponse.json({status:"drifting",
      specTest:{total:2,covered:2,uncovered:0,coveragePercent:100,passing:1,failing:0,untested:1,docsComplete:0,docsHarden:0,docsBuild:1},
      docDrift:{driftedDocs:0,totalDocs:2},docs:[
        {docId:"doc-111111111111",version:2,title:"Checkout design",name:"design/checkout",phase:"BUILD",invariants:2,passing:1,failing:0,untested:1,gaps:0,blockers:["1 untested invariant(s)"],drift:[]},
        {docId:"doc-222222222222",version:1,title:"Checkout plan",name:"plan/checkout",phase:"HARDEN",invariants:0,passing:0,failing:0,untested:0,gaps:0,blockers:[],drift:[]},
      ]})))
    renderPage()
    expect(await screen.findByRole("link",{name:/Checkout design/})).toHaveAttribute("href","/?tab=docs&docId=doc-111111111111&version=2")
    expect(screen.getByText("Missing test evidence")).toBeInTheDocument()
    expect(screen.queryByText("drifting")).not.toBeInTheDocument()
    expect(screen.getByText("2 of 2 (100%)")).toBeInTheDocument()
    expect(screen.getByText("1 untested invariant(s)")).toBeInTheDocument()
    expect(screen.getByText("No invariants")).toBeInTheDocument()
    expect(screen.queryByText("HARDEN")).not.toBeInTheDocument()
  })

  it("allows an explicit retry after a read failure", async () => {
    let failed = true
    server.use(http.get("/api/spec/health", () => failed
      ? HttpResponse.json({error:"Database unavailable"},{status:503})
      : HttpResponse.json({status:"synced",specTest:{total:0,covered:0,uncovered:0,coveragePercent:0,passing:0,failing:0,untested:0,docsComplete:0,docsHarden:0,docsBuild:0},docDrift:{driftedDocs:0,totalDocs:0},docs:[]})))
    renderPage()
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable")
    failed = false
    fireEvent.click(screen.getByRole("button",{name:"Retry spec health"}))
    expect(await screen.findByText(/No specifications yet/)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("explains an empty project without presenting it as healthy [INV-LEAN-004] [INV-REQ-LEAN-004]", async () => {
    server.use(http.get("/api/spec/health", () => HttpResponse.json({status:"synced",specTest:{total:0,covered:0,uncovered:0,coveragePercent:0,passing:0,failing:0,untested:0,docsComplete:0,docsHarden:0,docsBuild:0},decisions:{pending:0,approvedUnsynced:0,total:0},docDrift:{driftedDocs:0,totalDocs:0},docs:[]})))
    renderPage()
    expect(await screen.findByText(/No specifications yet/)).toBeInTheDocument()
    expect(screen.queryByText("synced")).not.toBeInTheDocument()
  })

})
