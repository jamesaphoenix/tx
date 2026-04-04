import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { DecomposeService } from "@jamesaphoenix/tx-core"
import type { DecomposeResult, TaskWithDeps } from "@jamesaphoenix/tx-types"
import { runDecomposeApi } from "../../apps/api-server/src/routes/decompose.js"

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
    blockedBy: ["tx-api123" as any],
    blocks: [],
    children: ["tx-api123" as any],
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

describe("runDecomposeApi", () => {
  it("delegates to DecomposeService and serializes the result", async () => {
    const seen: unknown[] = []
    const domainResult: DecomposeResult = {
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
        rationale: "Decompose by surface area.",
      },
      createdTasks: [],
      rationale: "Decompose by surface area.",
    }

    const result = await Effect.runPromise(
      runDecomposeApi({
        docRef: "auth-flow-design",
        runtime: "codex",
        dryRun: false,
      }).pipe(
        Effect.provide(
          Layer.succeed(DecomposeService, {
            run: (input: unknown) =>
              Effect.sync(() => {
                seen.push(input)
                return domainResult
              }),
          })
        )
      )
    )

    expect(seen).toEqual([
      {
        docRef: "auth-flow-design",
        runtime: "codex",
        dryRun: false,
      },
    ])
    expect(result.runtime).toBe("codex")
    expect(result.doc.name).toBe("auth-flow-design")
    expect(result.rootTask?.id).toBe("tx-root123")
    expect(result.rootTask?.createdAt).toBe("2026-03-27T12:00:00.000Z")
  })
})
