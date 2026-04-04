import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect, Layer } from "effect"
import { DecomposeService } from "@jamesaphoenix/tx-core"
import type { DecomposeResult, TaskWithDeps } from "@jamesaphoenix/tx-types"
import { decompose } from "../../apps/cli/src/commands/decompose.js"

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

const dryRunResult: DecomposeResult = {
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

const materializedResult: DecomposeResult = {
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
  plan: dryRunResult.plan,
  createdTasks: [
    {
      localId: "api",
      taskId: "tx-api123" as any,
      title: "Implement auth API contract",
      parentTaskId: "tx-root123" as any,
      dependsOn: [],
      score: 700,
    },
  ],
  rationale: "API first, then tests.",
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("decompose command", () => {
  it("prints dry-run JSON from the shared service", async () => {
    const logs: string[] = []
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    })

    await Effect.runPromise(
      decompose(["auth-flow-design"], { "dry-run": true, json: true }).pipe(
        Effect.provide(
          Layer.succeed(DecomposeService, {
            run: () => Effect.succeed(dryRunResult),
          })
        )
      )
    )

    expect(logs.join("\n")).toContain('"dryRun": true')
    expect(logs.join("\n")).toContain('"doc"')
  })

  it("prints a human summary for materialized graphs", async () => {
    const logs: string[] = []
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    })

    await Effect.runPromise(
      decompose(["auth-flow-design"], { runtime: "codex" }).pipe(
        Effect.provide(
          Layer.succeed(DecomposeService, {
            run: () => Effect.succeed(materializedResult),
          })
        )
      )
    )

    expect(logs.join("\n")).toContain("Created task graph for auth-flow-design")
    expect(logs.join("\n")).toContain("tx-api123")
  })

  it("rejects invalid runtime flags before calling the shared service", async () => {
    const errors: string[] = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "))
    })

    const result = await Effect.runPromiseExit(
      decompose(["auth-flow-design"], { runtime: "unknown-runtime" }).pipe(
        Effect.provide(
          Layer.succeed(DecomposeService, {
            run: () => Effect.die(new Error("should not be called")),
          })
        )
      )
    )

    expect(result._tag).toBe("Failure")
    expect(errors.join("\n")).toContain("invalid --runtime")
  })
})
