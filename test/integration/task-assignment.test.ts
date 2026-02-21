import { beforeAll, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { DependencyService, TaskService } from "@jamesaphoenix/tx-core"
import { fixtureId } from "../fixtures.js"
import type { TaskId } from "@jamesaphoenix/tx-types"

interface FixtureTaskInput {
  id: TaskId
  title: string
  status?: string
  parentId?: TaskId | null
  assigneeType?: "human" | "agent" | null
  assigneeId?: string | null
  assignedAt?: string | null
  assignedBy?: string | null
}

const runTaskEffect = <A>(
  shared: SharedTestLayerResult,
  effect: Effect.Effect<A, unknown, TaskService | DependencyService>
): Promise<A> => {
  return Effect.runPromise(effect.pipe(Effect.provide(shared.layer)))
}

const insertFixtureTask = (shared: SharedTestLayerResult, input: FixtureTaskInput): void => {
  const now = "2026-02-21T09:00:00.000Z"
  shared.getDb().prepare(
    `INSERT INTO tasks (
      id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata,
      assignee_type, assignee_id, assigned_at, assigned_by
    )
    VALUES (?, ?, '', ?, ?, 500, ?, ?, NULL, '{}', ?, ?, ?, ?)`
  ).run(
    input.id,
    input.title,
    input.status ?? "backlog",
    input.parentId ?? null,
    now,
    now,
    input.assigneeType ?? null,
    input.assigneeId ?? null,
    input.assignedAt ?? null,
    input.assignedBy ?? null
  )
}

describe("Task assignment integration", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await getSharedTestLayer()
  })

  it("creates assigned tasks and returns assignment fields in TaskWithDeps", async () => {
    const explicitAssignedAt = new Date("2026-02-21T10:30:00.000Z")
    const task = await runTaskEffect(
      shared,
      Effect.gen(function* () {
        const svc = yield* TaskService
        const created = yield* svc.create({
          title: "Assignment create path",
          score: 610,
          assigneeType: "agent",
          assigneeId: "worker-alpha",
          assignedAt: explicitAssignedAt,
          assignedBy: "test:task-assignment",
        })
        return yield* svc.getWithDeps(created.id)
      })
    )

    expect(task.assigneeType).toBe("agent")
    expect(task.assigneeId).toBe("worker-alpha")
    expect(task.assignedAt?.toISOString()).toBe(explicitAssignedAt.toISOString())
    expect(task.assignedBy).toBe("test:task-assignment")
    expect(task.blockedBy).toEqual([])
    expect(task.blocks).toEqual([])
    expect(task.children).toEqual([])
    expect(task.isReady).toBe(true)
  })

  it("updates and clears assignment fields deterministically", async () => {
    const taskId = fixtureId("assignment-update-target") as TaskId
    insertFixtureTask(shared, {
      id: taskId,
      title: "Assignment update target",
      status: "ready",
      assigneeType: "agent",
      assigneeId: "worker-before",
      assignedAt: "2026-02-21T08:00:00.000Z",
      assignedBy: "test:seed",
    })

    const [updated, cleared] = await runTaskEffect(
      shared,
      Effect.gen(function* () {
        const svc = yield* TaskService
        const updatedTask = yield* svc.update(taskId, {
          assigneeType: "human",
          assigneeId: "triager-1",
          assignedBy: "dashboard:test",
        })
        const clearedTask = yield* svc.update(taskId, {
          assigneeType: null,
        })
        return [updatedTask, clearedTask] as const
      })
    )

    expect(updated.assigneeType).toBe("human")
    expect(updated.assigneeId).toBe("triager-1")
    expect(updated.assignedBy).toBe("dashboard:test")
    expect(updated.assignedAt).not.toBeNull()

    expect(cleared.assigneeType).toBeNull()
    expect(cleared.assigneeId).toBeNull()
    expect(cleared.assignedAt).toBeNull()
    expect(cleared.assignedBy).toBeNull()
  })

  it("rejects invalid assigneeType on create and update", async () => {
    const taskId = fixtureId("assignment-invalid-update") as TaskId
    insertFixtureTask(shared, {
      id: taskId,
      title: "Invalid update target",
      status: "backlog",
    })

    const [createResult, updateResult] = await runTaskEffect(
      shared,
      Effect.gen(function* () {
        const svc = yield* TaskService
        const createInvalid = yield* svc.create({
          title: "Invalid create",
          assigneeType: "robot" as never,
        }).pipe(Effect.either)
        const updateInvalid = yield* svc.update(taskId, {
          assigneeType: "robot" as never,
        }).pipe(Effect.either)
        return [createInvalid, updateInvalid] as const
      })
    )

    expect(createResult._tag).toBe("Left")
    if (createResult._tag === "Left") {
      expect((createResult.left as { _tag: string })._tag).toBe("ValidationError")
    }

    expect(updateResult._tag).toBe("Left")
    if (updateResult._tag === "Left") {
      expect((updateResult.left as { _tag: string })._tag).toBe("ValidationError")
    }
  })

  it("keeps dependency fields real alongside assignment data", async () => {
    const parentId = fixtureId("assignment-parent") as TaskId
    const childId = fixtureId("assignment-child") as TaskId
    const blockerId = fixtureId("assignment-blocker") as TaskId
    const blockedId = fixtureId("assignment-blocked") as TaskId

    insertFixtureTask(shared, {
      id: parentId,
      title: "Parent task",
      status: "backlog",
      assigneeType: "human",
      assigneeId: "triage-owner",
      assignedBy: "test:seed",
    })
    insertFixtureTask(shared, {
      id: childId,
      title: "Child task",
      status: "ready",
      parentId,
      assigneeType: "agent",
      assigneeId: "worker-child",
      assignedBy: "test:seed",
    })
    insertFixtureTask(shared, {
      id: blockerId,
      title: "Blocker task",
      status: "ready",
      assigneeType: "agent",
      assigneeId: "worker-blocker",
      assignedBy: "test:seed",
    })
    insertFixtureTask(shared, {
      id: blockedId,
      title: "Blocked task",
      status: "backlog",
      assigneeType: "human",
      assigneeId: "worker-blocked",
      assignedBy: "test:seed",
    })

    const [parent, blocker, blocked] = await runTaskEffect(
      shared,
      Effect.gen(function* () {
        const depSvc = yield* DependencyService
        const taskSvc = yield* TaskService
        yield* depSvc.addBlocker(blockedId, blockerId)
        const parentTask = yield* taskSvc.getWithDeps(parentId)
        const blockerTask = yield* taskSvc.getWithDeps(blockerId)
        const blockedTask = yield* taskSvc.getWithDeps(blockedId)
        return [parentTask, blockerTask, blockedTask] as const
      })
    )

    expect(parent.children).toContain(childId)
    expect(parent.assigneeType).toBe("human")
    expect(parent.assigneeId).toBe("triage-owner")

    expect(blocker.blocks).toContain(blockedId)
    expect(blocker.assigneeType).toBe("agent")
    expect(blocker.assigneeId).toBe("worker-blocker")

    expect(blocked.blockedBy).toContain(blockerId)
    expect(blocked.isReady).toBe(false)
    expect(blocked.assigneeType).toBe("human")
    expect(blocked.assigneeId).toBe("worker-blocked")
  })
})
