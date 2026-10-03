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
