import { describe, it, expect, afterEach } from "vitest"
import { Effect } from "effect"
import { Database } from "bun:sqlite"
import { getSharedTestLayer } from "@jamesaphoenix/tx/testing"
import { TaskService, ReadyService } from "@jamesaphoenix/tx"
import { FIXTURES, seedFixtures } from "../fixtures.js"

type LinkedDocFixture = {
  docId: string
  name: string
  title: string
  kind: "prd" | "design"
  version: number
  status: "changing" | "locked"
  filePath: string
  linkType: "implements" | "references"
}

const insertLinkedDoc = (
  db: Database,
  taskId: string,
  overrides: Partial<LinkedDocFixture> = {}
): LinkedDocFixture => {
  const now = "2026-03-27T12:00:00.000Z"
  const fixture: LinkedDocFixture = {
    docId: overrides.docId ?? "doc-111111111111",
    name: overrides.name ?? "auth-linked-spec",
    title: overrides.title ?? "Auth Linked Spec",
    kind: overrides.kind ?? "prd",
    version: overrides.version ?? 1,
    status: overrides.status ?? "changing",
    filePath: overrides.filePath ?? "specs/prd/auth-linked-spec.md",
    linkType: overrides.linkType ?? "implements",
  }

  const docInsert = db.prepare(
    `INSERT INTO docs (doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '{}')`
  )
  const docResult = docInsert.run(
    fixture.docId,
    `hash-${fixture.docId}-${fixture.version}`,
    fixture.kind,
    fixture.name,
    fixture.title,
    fixture.version,
    fixture.status,
    fixture.filePath,
    now
  )

  db.prepare(
    "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
  ).run(taskId, docResult.lastInsertRowid, fixture.linkType, now)

  return fixture
}

describe("Task linked-doc integration", () => {
  afterEach(async () => {
    const shared = await getSharedTestLayer()
    await shared.reset()
  })

  it("TaskService.getWithDeps returns linked docs with stable doc ids", async () => {
    const { layer, getDb } = await getSharedTestLayer()
    seedFixtures({ db: getDb() } as any)

    const expected = insertLinkedDoc(getDb(), FIXTURES.TASK_JWT)

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.getWithDeps(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(task.linkedDocs).toEqual([expected])
  })

  it("ReadyService.getReady includes linked docs for ready tasks", async () => {
    const { layer, getDb } = await getSharedTestLayer()
    seedFixtures({ db: getDb() } as any)

    const expected = insertLinkedDoc(getDb(), FIXTURES.TASK_JWT, {
      docId: "doc-222222222222",
      name: "jwt-design",
      title: "JWT Design",
      kind: "design",
      filePath: "specs/design/jwt-design.md",
      linkType: "references",
    })

    const readyTasks = await Effect.runPromise(
      Effect.gen(function* () {
        const readyService = yield* ReadyService
        return yield* readyService.getReady(10)
      }).pipe(Effect.provide(layer))
    )

    const jwtTask = readyTasks.find((task) => task.id === FIXTURES.TASK_JWT)
    expect(jwtTask).toBeDefined()
    expect(jwtTask?.linkedDocs).toEqual([expected])
    expect(readyTasks.every((task) => task.status !== "done")).toBe(true)
  })
})
