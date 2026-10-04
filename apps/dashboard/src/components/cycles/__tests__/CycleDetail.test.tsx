import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "../../../../test/setup"
import { CommandProvider } from "../../command-palette/CommandContext"
import { CycleDetail } from "../CycleDetail"

const cycle = {id:"cycle-picker",name:"This week",status:"current",startDate:"2026-10-04",endDate:"2026-10-11",
  taskCount:0,completedCount:0,inProgressCount:0,createdAt:"2026-10-04T00:00:00Z",updatedAt:"2026-10-04T00:00:00Z",tasks:[]}

const setup = () => render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>
  <CommandProvider><CycleDetail cycleId={cycle.id} onBack={vi.fn()} /></CommandProvider>
</QueryClientProvider>)

beforeEach(() => {
  window.history.replaceState({},"","/?tab=cycles")
  server.use(
    http.get(`/api/cycles/${cycle.id}`,() => HttpResponse.json(cycle)),
    http.get("/api/cycles",() => HttpResponse.json({cycles:[cycle]})),
    http.get("/api/labels",() => HttpResponse.json({labels:[]})),
    http.get("/api/tasks",({request}) => {
      const older = new URL(request.url).searchParams.has("cursor")
      return HttpResponse.json({tasks:[{id:older ? "tx-older" : "tx-newer",title:older ? "Older task" : "Newer task",status:"ready",
        updatedAt:"2026-10-04T00:00:00Z",createdAt:"2026-10-04T00:00:00Z",metadata:{},blockedBy:[],blocks:[],children:[],isReady:true}],
        hasMore:!older,nextCursor:older ? null : "next",total:2,summary:{total:2,byStatus:{ready:2}}})
    }),
  )
})

describe("CycleDetail",() => {
  it("submits labels and cycle in one request and preserves a failed composition for retry",async () => {
    const writes: unknown[] = []
    let secondaryWrites = 0
    server.use(
      http.get("/api/labels",() => HttpResponse.json({labels:[{id:42,name:"Composition",color:"#123456"}]})),
      http.post("/api/tasks",async ({request}) => {
        writes.push(await request.json())
        return writes.length === 1 ? HttpResponse.json({error:"Attachment failed"},{status:503})
          : HttpResponse.json({id:"tx-composed",title:"New composition",blockedBy:[],blocks:[],children:[]},{status:201})
      }),
      http.post("/api/tasks/:id/labels",() => {secondaryWrites++;return HttpResponse.json({success:true})}),
      http.post(`/api/cycles/${cycle.id}/tasks`,() => {secondaryWrites++;return HttpResponse.json({success:true})}),
    )
    setup()
    fireEvent.click(await screen.findByRole("button",{name:"+ New task"}))
    const title = screen.getByRole("textbox",{name:"Task title"})
    fireEvent.change(title,{target:{value:"New composition"}})
    fireEvent.keyDown(screen.getAllByRole("combobox")[2]!,{key:"ArrowDown"})
    fireEvent.click(await screen.findByText("Composition"))
    fireEvent.click(screen.getByRole("button",{name:"Create & add to cycle"}))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Attachment failed")
    expect(title).toHaveValue("New composition")
    fireEvent.click(screen.getByRole("button",{name:"Create & add to cycle"}))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({title:"New composition",labels:[{labelId:42}],cycleId:cycle.id})
    expect(writes[1]).toEqual(writes[0])
    expect(secondaryWrites).toBe(0)
  })

  it("renames with an accessible control and preserves a failed edit for retry",async () => {
    let calls = 0
    const writes: unknown[] = []
    server.use(http.patch(`/api/cycles/${cycle.id}`,async ({request}) => {
      writes.push(await request.json())
      return ++calls === 1 ? HttpResponse.json({error:"Disk full"},{status:503}) : HttpResponse.json({...cycle,name:"Next sprint"})
    }))
    setup()
    fireEvent.click(await screen.findByRole("button",{name:"Rename cycle This week"}))
    const name = screen.getByRole("textbox",{name:"Cycle name"})
    fireEvent.change(name,{target:{value:"Next sprint"}})
    fireEvent.keyDown(name,{key:"Enter"})
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full")
    expect(name).toHaveValue("Next sprint")
    fireEvent.click(screen.getByRole("button",{name:"Save"}))
    await waitFor(() => expect(writes).toEqual([{name:"Next sprint"},{name:"Next sprint"}]))
    await waitFor(() => expect(screen.queryByRole("textbox",{name:"Cycle name"})).not.toBeInTheDocument())
  })

  it("restores the rename control after cancelling with Escape",async () => {
    setup()
    const opener = await screen.findByRole("button",{name:"Rename cycle This week"})
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(screen.getByRole("textbox",{name:"Cycle name"}),{key:"Escape"})
    expect(screen.getByRole("button",{name:"Rename cycle This week"})).toHaveFocus()
  })

  it("opens an accessible picker, traps tab focus and restores the opener on Escape",async () => {
    setup()
    const opener = await screen.findByRole("button",{name:"+ Add existing"})
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole("dialog",{name:"Add tasks to This week"})
    const search = screen.getByRole("textbox",{name:"Search existing tasks"})
    expect(dialog).toHaveAttribute("aria-modal","true")
    expect(search).toHaveFocus()
    fireEvent.click(await screen.findByRole("checkbox",{name:/Older task/}))
    const close = screen.getByRole("button",{name:"Close add tasks"})
    close.focus()
    fireEvent.keyDown(close,{key:"Tab",shiftKey:true})
    expect(screen.getByRole("button",{name:"Add Selected"})).toHaveFocus()
    fireEvent.keyDown(search,{key:"Escape"})
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it("adds an older task from beyond the first API page",async () => {
    const writes: unknown[] = []
    server.use(http.post(`/api/cycles/${cycle.id}/tasks`,async ({request}) => {
      writes.push(await request.json())
      return HttpResponse.json({success:true})
    }))
    setup()
    fireEvent.click(await screen.findByRole("button",{name:"+ Add existing"}))
    fireEvent.click(await screen.findByRole("checkbox",{name:/Older task/}))
    fireEvent.click(screen.getByRole("button",{name:"Add Selected"}))
    await waitFor(() => expect(writes).toEqual([{taskIds:["tx-older"]}]))
    await waitFor(() => expect(screen.queryByRole("button",{name:"Add Selected"})).not.toBeInTheDocument())
  })

  it("preserves the selection after an add failure and allows a retry",async () => {
    let calls = 0
    server.use(http.post(`/api/cycles/${cycle.id}/tasks`,() => ++calls === 1
      ? HttpResponse.json({error:"Disk full"},{status:503}) : HttpResponse.json({success:true})))
    setup()
    fireEvent.click(await screen.findByRole("button",{name:"+ Add existing"}))
    const checkbox = await screen.findByRole("checkbox",{name:/Older task/})
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole("button",{name:"Add Selected"}))
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full")
    expect(checkbox).toBeChecked()
    fireEvent.click(screen.getByRole("button",{name:"Add Selected"}))
    await waitFor(() => expect(calls).toBe(2))
    await waitFor(() => expect(screen.queryByRole("button",{name:"Add Selected"})).not.toBeInTheDocument())
  })
})
