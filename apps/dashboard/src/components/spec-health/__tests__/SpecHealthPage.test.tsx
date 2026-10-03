import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
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
    expect(await screen.findByText("broken")).toBeInTheDocument()
    expect(screen.getByText("Failing evidence")).toBeInTheDocument()
    expect(screen.getByText("Missing test results")).toBeInTheDocument()
    expect(screen.getByText("checkout")).toBeInTheDocument()
  })
  it("explains an empty project without presenting it as healthy [INV-LEAN-004] [INV-REQ-LEAN-004]", async () => {
    server.use(http.get("/api/spec/health", () => HttpResponse.json({status:"synced",specTest:{total:0,covered:0,uncovered:0,coveragePercent:0,passing:0,failing:0,untested:0,docsComplete:0,docsHarden:0,docsBuild:0},decisions:{pending:0,approvedUnsynced:0,total:0},docDrift:{driftedDocs:0,totalDocs:0},docs:[]})))
    renderPage()
    expect(await screen.findByText(/No specifications yet/)).toBeInTheDocument()
    expect(screen.queryByText("synced")).not.toBeInTheDocument()
  })

})
