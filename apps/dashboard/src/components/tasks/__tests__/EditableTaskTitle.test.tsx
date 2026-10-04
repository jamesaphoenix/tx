import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { EditableTaskTitle } from "../EditableTaskTitle"

const setup = () => render(<QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false}}})}>
  <EditableTaskTitle taskId="tx-title" title="Original title" />
  <input aria-label="Unrelated field" />
</QueryClientProvider>)
const edit = () => {fireEvent.click(screen.getByRole("button", {name:"Original title"})); return screen.getByRole("textbox", {name:"Task title"})}

describe("EditableTaskTitle", () => {
  it.each(["Escape","Cancel"])("cancels with %s without writing and returns focus to the title", method => {
    const patch = vi.fn()
    server.use(http.patch("/api/tasks/tx-title", patch))
    setup(); const input = edit()
    fireEvent.change(input, {target:{value:"Cancelled title"}})
    if (method === "Escape") fireEvent.keyDown(input, {key:"Escape"})
    else fireEvent.click(screen.getByRole("button", {name:"Cancel title edit"}))
    expect(screen.getByRole("heading", {name:"Original title"})).toBeInTheDocument()
    expect(screen.getByRole("button", {name:"Original title"})).toHaveFocus()
    expect(patch).not.toHaveBeenCalled()
  })
  it("rejects whitespace-only titles", () => {
    setup(); const input = edit()
    fireEvent.change(input, {target:{value:"   "}})
    fireEvent.keyDown(input, {key:"Enter"})
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a task title")
    expect(input).toHaveValue("   ")
  })
  it("keeps the draft after a failed save and allows retry", async () => {
    let calls = 0
    server.use(http.patch("/api/tasks/tx-title", () => {
      calls++
      return calls === 1 ? HttpResponse.json({error:"Storage unavailable"}, {status:500}) : HttpResponse.json({id:"tx-title", title:"Retry title"})
    }))
    setup(); const input = edit()
    fireEvent.change(input, {target:{value:"Retry title"}})
    fireEvent.keyDown(input, {key:"Enter"})
    // jsdom retains focus on disabled inputs; browsers blur during the pending save.
    input.blur()
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable")
    expect(input).toHaveValue("Retry title")
    expect(input).toHaveFocus()
    fireEvent.click(screen.getByRole("button", {name:"Save title"}))
    await waitFor(() => expect(screen.queryByRole("textbox", {name:"Task title"})).not.toBeInTheDocument())
    expect(screen.getByRole("button", {name:"Original title"})).toHaveFocus()
    expect(calls).toBe(2)
  })
  it("disables edits during an in-flight save", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {release = resolve})
    server.use(http.patch("/api/tasks/tx-title", async () => {await gate; return HttpResponse.json({id:"tx-title", title:"Saved title"})}))
    setup(); const input = edit()
    fireEvent.change(input, {target:{value:"Saved title"}})
    fireEvent.keyDown(input, {key:"Enter"})
    await waitFor(() => expect(input).toBeDisabled())
    expect(screen.getByRole("button", {name:"Cancel title edit"})).toBeDisabled()
    release?.()
    await waitFor(() => expect(screen.queryByRole("textbox", {name:"Task title"})).not.toBeInTheDocument())
    expect(screen.getByRole("button", {name:"Original title"})).toHaveFocus()
  })
  it("preserves unrelated focus when a pending save finishes", async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {release = resolve})
    server.use(http.patch("/api/tasks/tx-title", async () => {await gate; return HttpResponse.json({id:"tx-title",title:"Saved title"})}))
    setup(); const input = edit()
    fireEvent.change(input,{target:{value:"Saved title"}})
    fireEvent.keyDown(input,{key:"Enter"})
    await waitFor(() => expect(input).toBeDisabled())
    const other = screen.getByRole("textbox",{name:"Unrelated field"})
    other.focus()
    release()
    await waitFor(() => expect(screen.queryByRole("textbox",{name:"Task title"})).not.toBeInTheDocument())
    expect(other).toHaveFocus()
  })
})
