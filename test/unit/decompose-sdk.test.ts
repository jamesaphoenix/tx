import { afterEach, describe, expect, it, vi } from "vitest"
import { TxClient } from "../../apps/agent-sdk/src/client.js"

describe("TxClient decompose namespace", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses the HTTP transport route for decompose.run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          dryRun: true,
          runtime: "auto",
          model: null,
          doc: {
            docId: "doc-abc123def456",
            name: "auth-flow-design",
            title: "Auth Flow Design",
            kind: "design",
            filePath: "design/auth-flow-design.md",
          },
          parentTaskId: null,
          rootTaskPreview: {
            title: "Implement Auth Flow",
            description: "Deliver the auth flow end-to-end.",
            score: 900,
            existingParentTaskId: null,
          },
          rootTask: null,
          plan: {
            rootTask: {
              title: "Implement Auth Flow",
              description: "Deliver the auth flow end-to-end.",
              score: 900,
            },
            tasks: [],
          },
          createdTasks: [],
          rationale: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ) as any
    )

    const tx = new TxClient({ apiUrl: "http://localhost:3456" })
    const result = await tx.decompose.run({
      docRef: "auth-flow-design",
      runtime: "auto",
      dryRun: true,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://localhost:3456/api/decompose")
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
    })
    expect(result.dryRun).toBe(true)
    expect(result.doc.name).toBe("auth-flow-design")
  })

  it("delegates to the transport from the namespace instance", async () => {
    const tx = new TxClient({ dbPath: ":memory:" })
    const transport = (tx as any).transport
    transport.decomposeRun = vi.fn().mockResolvedValue({
      dryRun: false,
      runtime: "codex",
      model: "gpt-5.4",
      doc: {
        docId: "doc-abc123def456",
        name: "auth-flow-design",
        title: "Auth Flow Design",
        kind: "design",
        filePath: "design/auth-flow-design.md",
      },
      parentTaskId: null,
      rootTaskPreview: {
        title: "Implement Auth Flow",
        description: "Deliver the auth flow end-to-end.",
        score: 900,
        existingParentTaskId: null,
      },
      rootTask: null,
      plan: {
        rootTask: {
          title: "Implement Auth Flow",
          description: "Deliver the auth flow end-to-end.",
          score: 900,
        },
        tasks: [],
      },
      createdTasks: [],
      rationale: null,
    })

    const result = await tx.decompose.run({
      docRef: "auth-flow-design",
      runtime: "codex",
    })

    expect(transport.decomposeRun).toHaveBeenCalledWith({
      docRef: "auth-flow-design",
      runtime: "codex",
    })
    expect(result.runtime).toBe("codex")
  })
})
