import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import type { DecomposeResult, TaskWithDeps } from "@jamesaphoenix/tx-types"
import { handleDecompose } from "../../apps/mcp-server/src/tools/decompose.js"
import type { McpServices } from "../../apps/mcp-server/src/runtime.js"

function makeRootTask(): TaskWithDeps {
  const now = new Date("2026-03-27T12:00:00Z")
  return {
    id: "tx-root123" as any,
    title: "Implement Auth Flow",
    description: "Deliver the auth flow end-to-end.",
    status: "backlog",
    parentId: null,
    score: 900,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    assigneeType: null,
    assigneeId: null,
    assignedAt: null,
    assignedBy: null,
    metadata: {},
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: false,
    groupContext: null,
    effectiveGroupContext: null,
    effectiveGroupContextSourceTaskId: null,
    orchestrationStatus: null,
    claimedBy: null,
    claimExpiresAt: null,
    failedAttempts: 0,
    linkedDocs: [],
  }
}

describe("handleDecompose", () => {
  it("formats a successful dry-run response using the shared serializer", async () => {
    const result: DecomposeResult = {
      dryRun: true,
      runtime: "auto",
      model: null,
      doc: {
        docId: "doc-abc123def456" as any,
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
        tasks: [
          {
            localId: "api",
            title: "Implement auth API contract",
            description: "Build API endpoints and handlers.",
            score: 700,
            parentLocalId: null,
            dependsOn: [],
          },
        ],
        rationale: "Preview before writing.",
      },
      createdTasks: [],
      rationale: "Preview before writing.",
    }

    const runner = async <A, E>(
      _effect: Effect.Effect<A, E, McpServices>
    ): Promise<A> => result as A

    const response = await handleDecompose(
      {
        docRef: "auth-flow-design",
        runtime: "auto",
        dryRun: true,
      },
      runner
    )

    expect(response.isError).toBe(false)
    expect(response.content[0]?.text).toContain("Prepared decomposition plan")

    const payload = JSON.parse(response.content[1]!.text)
    expect(payload.dryRun).toBe(true)
    expect(payload.doc.name).toBe("auth-flow-design")
    expect(payload.plan.tasks[0].localId).toBe("api")
  })

  it("serializes materialized root task details", async () => {
    const result: DecomposeResult = {
      dryRun: false,
      runtime: "codex",
      model: "gpt-5.4",
      doc: {
        docId: "doc-abc123def456" as any,
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
      rootTask: makeRootTask(),
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
    }

    const runner = async <A, E>(
      _effect: Effect.Effect<A, E, McpServices>
    ): Promise<A> => result as A

    const response = await handleDecompose(
      {
        docRef: "auth-flow-design",
        runtime: "codex",
      },
      runner
    )

    const payload = JSON.parse(response.content[1]!.text)
    expect(payload.rootTask.id).toBe("tx-root123")
    expect(payload.rootTask.createdAt).toBe("2026-03-27T12:00:00.000Z")
  })
})
