import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { server } from "../../test/setup"
import { fetchers } from "./client"

describe("complete task selection", () => {
  it("follows every cursor so a cycle picker can reach tasks beyond the first page", async () => {
    const cursors: Array<string | null> = []
    server.use(http.get("/api/tasks", ({request}) => {
      const cursor = new URL(request.url).searchParams.get("cursor")
      cursors.push(cursor)
      return HttpResponse.json({tasks:[{id:cursor ? "tx-older" : "tx-newer", title:cursor ? "Older task" : "Newer task"}],
        nextCursor:cursor ? null : "next page:with/slashes",hasMore:!cursor,total:2,summary:{total:2,byStatus:{ready:2}}})
    }))
    const response = await fetchers.allTasks()
    expect(response.tasks.map(task => task.id)).toEqual(["tx-newer","tx-older"])
    expect(cursors).toEqual([null,"next page:with/slashes"])
  })

  it("surfaces a later page error instead of presenting a partial task picker", async () => {
    server.use(http.get("/api/tasks", ({request}) => new URL(request.url).searchParams.has("cursor")
      ? HttpResponse.json({error:"Database unavailable"},{status:503})
      : HttpResponse.json({tasks:[],nextCursor:"next",hasMore:true,total:1,summary:{total:1,byStatus:{}}})))
    await expect(fetchers.allTasks()).rejects.toThrow("Database unavailable")
  })

  it("rejects repeated cursors instead of looping forever", async () => {
    server.use(http.get("/api/tasks", () => HttpResponse.json({tasks:[],nextCursor:"repeat",hasMore:true,total:1,summary:{total:1,byStatus:{}}})))
    await expect(fetchers.allTasks()).rejects.toThrow("repeated cursor")
  })
})
