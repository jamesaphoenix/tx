import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { SpecHealth } from "../SpecHealth"

const renderChecks = (onSelectDoc = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SpecHealth onSelectDoc={onSelectDoc} />
  </QueryClientProvider>)
  return onSelectDoc
}
const issue = { docId: "doc-111111111111", docName: "checkout", kind: "hash_drift", problems: ["Document changed after sync"] }

describe("SpecHealth document checks", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard)
    else Reflect.deleteProperty(navigator, "clipboard")
  })
  it("does not present an empty project as healthy", async () => {
    server.use(http.get("/api/docs/health", () => HttpResponse.json({ total: 0, healthy: 0, issues: [] })))
    renderChecks()
    expect(await screen.findByText("No documents to check yet.")).toBeInTheDocument()
    expect(screen.queryByText("healthy")).not.toBeInTheDocument()
  })
  it("shows read failures without healthy metrics", async () => {
    server.use(http.get("/api/docs/health", () => HttpResponse.json({ error: "Read failed" }, { status: 500 })))
    renderChecks()
    expect(await screen.findByText(/Unable to load health data: Read failed/)).toBeInTheDocument()
    expect(screen.queryByText("Document checks passed")).not.toBeInTheDocument()
  })
  it("opens the affected document from drift details", async () => {
    server.use(http.get("/api/docs/health", () => HttpResponse.json({ total: 1, healthy: 0, issues: [issue] })))
    const select = renderChecks()
    fireEvent.click(await screen.findByRole("button", { name: "Show details (1)" }))
    expect(screen.getByText("Document changed after sync")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /checkout/ }))
    expect(select).toHaveBeenCalledWith(issue.docId)
  })
  it("reports clipboard failure and supports retry without claiming success", async () => {
    server.use(http.get("/api/docs/health", () => HttpResponse.json({ total: 1, healthy: 0, issues: [issue] })))
    const copy = vi.fn().mockRejectedValueOnce(new Error("Denied")).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } })
    renderChecks()
    fireEvent.click(await screen.findByRole("button", { name: "Copy all issue text" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy issues")
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Copy all issue text" }))
    expect(await screen.findByText("Copied!")).toBeInTheDocument()
    expect(copy).toHaveBeenCalledWith("checkout [hash_drift]: Document changed after sync")
  })
})
