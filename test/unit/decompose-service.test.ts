import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import {
  AgentService,
  DecomposeService,
  DecomposeServiceLive,
  DependencyService,
  DocService,
  TaskService,
} from "@jamesaphoenix/tx"
import type { AgentRunResult } from "@jamesaphoenix/tx"
import type { Doc, Task, TaskId, TaskWithDeps } from "@jamesaphoenix/tx/types"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { asDocKind } from "@jamesaphoenix/tx/types"

let sandboxDir = ""
let previousCwd = ""

const DESIGN_DOC: Doc = {
  id: 1 as any,
  docId: "doc-abc123def456" as any,
  hash: "hash",
  kind: asDocKind("design"),
  name: "auth-flow-design",
  title: "Auth Flow Design",
  version: 1,
  status: "changing",
  filePath: "design/auth-flow-design.md",
  parentDocId: null,
  createdAt: new Date("2026-03-27T12:00:00Z"),
  lockedAt: null,
  metadata: {},
}

type LinkedDocRef = TaskWithDeps["linkedDocs"][number]

function makeTask(id: string, overrides?: Partial<Task>): Task {
  const now = new Date("2026-03-27T12:00:00Z")
  return {
    id: id as any,
    title: overrides?.title ?? id,
    description: overrides?.description ?? "",
    status: overrides?.status ?? "backlog",
    parentId: overrides?.parentId ?? null,
    score: overrides?.score ?? 500,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
    completedAt: overrides?.completedAt ?? null,
    assigneeType: null,
    assigneeId: null,
    assignedAt: null,
    assignedBy: null,
    metadata: overrides?.metadata ?? {},
  }
}

function createTaskServiceHarness() {
  let counter = 1
  const tasks = new Map<string, Task>()
  const links = new Map<string, LinkedDocRef[]>()

  const toTaskWithDeps = (task: Task): TaskWithDeps => ({
    ...task,
    blockedBy: [],
    blocks: [],
    children: [...tasks.values()].filter((candidate) => candidate.parentId === task.id).map((candidate) => candidate.id as TaskId),
    isReady: false,
    groupContext: null,
    effectiveGroupContext: null,
    effectiveGroupContextSourceTaskId: null,
    orchestrationStatus: null,
    claimedBy: null,
    claimExpiresAt: null,
    failedAttempts: 0,
    linkedDocs: links.get(task.id) ?? [],
  })

  return {
    tasks,
    links,
    layer: Layer.succeed(TaskService, {
      create: (input: { title: string; description?: string; parentId?: string | null; score?: number; metadata?: Record<string, unknown> }) =>
        Effect.sync(() => {
          const id = `tx-generated-${counter++}`
          const task = makeTask(id, {
            title: input.title,
            description: input.description ?? "",
            parentId: (input.parentId as any) ?? null,
            score: input.score ?? 500,
            metadata: input.metadata ?? {},
          })
          tasks.set(id, task)
          return task
        }),
      get: (id: string) =>
        Effect.sync(() => {
          const task = tasks.get(id)
          if (!task) throw new Error(`missing task ${id}`)
          return task
        }),
      getWithDeps: (id: string) =>
        Effect.sync(() => {
          const task = tasks.get(id)
          if (!task) throw new Error(`missing task ${id}`)
          return toTaskWithDeps(task)
        }),
      getWithDepsBatch: (ids: readonly string[]) =>
        Effect.sync(() => ids.map((id) => toTaskWithDeps(tasks.get(id)!))),
      update: () => Effect.die(new Error("not implemented")),
      setGroupContext: () => Effect.die(new Error("not implemented")),
      clearGroupContext: () => Effect.die(new Error("not implemented")),
      forceStatus: () => Effect.die(new Error("not implemented")),
      remove: () => Effect.die(new Error("not implemented")),
      list: () => Effect.sync(() => [...tasks.values()]),
      listWithDeps: () => Effect.sync(() => [...tasks.values()].map((task) => toTaskWithDeps(task))),
      count: () => Effect.sync(() => tasks.size),
    }),
  }
}

beforeEach(() => {
  previousCwd = process.cwd()
  sandboxDir = mkdtempSync(join(tmpdir(), "tx-decompose-service-"))
  mkdirSync(join(sandboxDir, ".tx"), { recursive: true })
  mkdirSync(join(sandboxDir, "specs", "design"), { recursive: true })
  writeFileSync(join(sandboxDir, ".tx", "config.toml"), ['[docs]', 'path = "specs"'].join("\n"))
  writeFileSync(
    join(sandboxDir, "specs", "design", "auth-flow-design.md"),
    "# Auth Flow Design\n\n## Summary\nDesign details.\n"
  )
  process.chdir(sandboxDir)
})

afterEach(() => {
  process.chdir(previousCwd)
  rmSync(sandboxDir, { recursive: true, force: true })
})

describe("DecomposeService", () => {
  it("materializes a root-backed task graph from a valid decomposition plan", async () => {
    const harness = createTaskServiceHarness()
    const blockers: Array<{ taskId: string; blockerId: string }> = []

    const serviceLayer = DecomposeServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          harness.layer,
          Layer.succeed(DocService, {
            get: () => Effect.succeed(DESIGN_DOC),
            attachTask: (taskId: string, _docName: string, linkType = "implements") =>
              Effect.sync(() => {
                const linked = harness.links.get(taskId) ?? []
                linked.push({
                  docId: DESIGN_DOC.docId,
                  name: DESIGN_DOC.name,
                  title: DESIGN_DOC.title,
                  kind: DESIGN_DOC.kind,
                  version: DESIGN_DOC.version,
                  status: DESIGN_DOC.status,
                  filePath: DESIGN_DOC.filePath,
                  linkType: linkType as any,
                })
                harness.links.set(taskId, linked)
              }),
          } as any),
          Layer.succeed(DependencyService, {
            addBlocker: (taskId: string, blockerId: string) =>
              Effect.sync(() => {
                blockers.push({ taskId, blockerId })
              }),
            removeBlocker: () => Effect.die(new Error("not implemented")),
          }),
          Layer.succeed(AgentService, {
            run: () =>
              Effect.succeed({
                text: "",
                structuredOutput: {
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
                    {
                      localId: "tests",
                      title: "Add auth integration tests",
                      description: "Cover happy and failure paths.",
                      score: 600,
                      parentLocalId: null,
                      dependsOn: ["api"],
                    },
                  ],
                  rationale: "API first, then prove the behavior end-to-end.",
                },
              } satisfies AgentRunResult),
          })
        )
      )
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DecomposeService
        return yield* svc.run({
          docRef: "auth-flow-design",
          runtime: "auto",
          dryRun: false,
        })
      }).pipe(Effect.provide(serviceLayer))
    )

    expect(result.dryRun).toBe(false)
    expect(result.rootTask?.title).toBe("Implement Auth Flow")
    expect(result.rootTaskPreview.title).toBe("Implement Auth Flow")
    expect(result.createdTasks).toHaveLength(2)
    expect(harness.tasks.size).toBe(3)

    const createdTasks = [...harness.tasks.values()]
    expect(createdTasks[0]?.title).toBe("Implement Auth Flow")
    expect(createdTasks[1]?.parentId).toBe(createdTasks[0]?.id)
    expect(createdTasks[2]?.parentId).toBe(createdTasks[0]?.id)

    expect(harness.links.get(createdTasks[0]!.id)?.[0]?.linkType).toBe("implements")
    expect(harness.links.get(createdTasks[1]!.id)?.[0]?.linkType).toBe("references")
    expect(harness.links.get(createdTasks[2]!.id)?.[0]?.linkType).toBe("references")

    expect(blockers).toEqual([
      { taskId: createdTasks[2]!.id, blockerId: createdTasks[1]!.id },
      { taskId: createdTasks[0]!.id, blockerId: createdTasks[1]!.id },
      { taskId: createdTasks[0]!.id, blockerId: createdTasks[2]!.id },
    ])
  })

  it("returns a validated dry-run result without creating tasks", async () => {
    const harness = createTaskServiceHarness()

    const serviceLayer = DecomposeServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          harness.layer,
          Layer.succeed(DocService, {
            get: () => Effect.succeed(DESIGN_DOC),
            attachTask: () => Effect.die(new Error("should not attach in dry-run")),
          } as any),
          Layer.succeed(DependencyService, {
            addBlocker: () => Effect.die(new Error("should not add blockers in dry-run")),
            removeBlocker: () => Effect.die(new Error("not implemented")),
          }),
          Layer.succeed(AgentService, {
            run: () =>
              Effect.succeed({
                text: "",
                structuredOutput: {
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
                },
              } satisfies AgentRunResult),
          })
        )
      )
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DecomposeService
        return yield* svc.run({
          docRef: "auth-flow-design",
          runtime: "codex",
          dryRun: true,
        })
      }).pipe(Effect.provide(serviceLayer))
    )

    expect(result.dryRun).toBe(true)
    expect(result.rootTask).toBeNull()
    expect(result.createdTasks).toEqual([])
    expect(harness.tasks.size).toBe(0)
  })

  it("rejects non-design docs before runtime execution", async () => {
    const harness = createTaskServiceHarness()

    const serviceLayer = DecomposeServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          harness.layer,
          Layer.succeed(DocService, {
            get: () => Effect.succeed({ ...DESIGN_DOC, kind: asDocKind("prd") } as Doc),
          } as any),
          Layer.succeed(DependencyService, {
            addBlocker: () => Effect.die(new Error("not implemented")),
            removeBlocker: () => Effect.die(new Error("not implemented")),
          }),
          Layer.succeed(AgentService, {
            run: () => Effect.die(new Error("runtime should not be called")),
          })
        )
      )
    )

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* DecomposeService
        return yield* svc.run({
          docRef: "auth-flow-design",
          runtime: "auto",
        })
      }).pipe(Effect.provide(serviceLayer))
    )

    expect(result._tag).toBe("Failure")
  })

  it("rejects invalid plans before partial graph creation", async () => {
    const harness = createTaskServiceHarness()

    const serviceLayer = DecomposeServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          harness.layer,
          Layer.succeed(DocService, {
            get: () => Effect.succeed(DESIGN_DOC),
            attachTask: () => Effect.die(new Error("should not attach invalid plans")),
          } as any),
          Layer.succeed(DependencyService, {
            addBlocker: () => Effect.die(new Error("should not add blockers for invalid plans")),
            removeBlocker: () => Effect.die(new Error("not implemented")),
          }),
          Layer.succeed(AgentService, {
            run: () =>
              Effect.succeed({
                text: "",
                structuredOutput: {
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
                      dependsOn: ["missing"],
                    },
                  ],
                },
              } satisfies AgentRunResult),
          })
        )
      )
    )

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* DecomposeService
        return yield* svc.run({
          docRef: "auth-flow-design",
          runtime: "auto",
        })
      }).pipe(Effect.provide(serviceLayer))
    )

    expect(result._tag).toBe("Failure")
    expect(harness.tasks.size).toBe(0)
  })
})
