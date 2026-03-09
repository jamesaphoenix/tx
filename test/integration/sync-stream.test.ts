import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { getSharedTestLayer, type SharedTestLayerResult, fixtureId } from "@jamesaphoenix/tx-test-utils"
import { SyncService, SqliteClient, PinService } from "@jamesaphoenix/tx-core"

const readJsonl = (path: string): any[] => {
  if (!existsSync(path)) return []
  const text = readFileSync(path, "utf-8").trim()
  if (!text) return []
  return text.split("\n").filter(Boolean).map(line => JSON.parse(line))
}

const writeStreamEvents = (streamId: string, events: ReadonlyArray<Record<string, unknown>>) => {
  const dir = resolve(".tx", "streams", streamId)
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, "events-2026-03-05.jsonl")
  const jsonl = events.map(e => JSON.stringify(e)).join("\n")
  writeFileSync(file, `${jsonl}\n`, "utf-8")
  return file
}

const writeRawStreamFile = (streamId: string, lines: ReadonlyArray<string>) => {
  const dir = resolve(".tx", "streams", streamId)
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, "events-2026-03-05.jsonl")
  writeFileSync(file, `${lines.join("\n")}\n`, "utf-8")
  return file
}

describe("Sync stream event logs", () => {
  let shared: SharedTestLayerResult
  let originalCwd: string
  let tempProjectDir: string

  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(shared.layer as any)) as Effect.Effect<A, E, never>
    )

  const insertTask = async (name: string, title = "Task"): Promise<string> => {
    const id = fixtureId(name)
    const now = new Date().toISOString()
    await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, title, "", "backlog", null, 100, now, now, null, "{}")
    }))
    return id
  }

  const getTaskCount = async (id: string): Promise<number> =>
    run(Effect.gen(function* () {
      const db = yield* SqliteClient
      const row = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE id = ?").get(id) as { c: number }
      return row.c
    }))

  const getDocCountByName = async (name: string): Promise<number> =>
    run(Effect.gen(function* () {
      const db = yield* SqliteClient
      const row = db.prepare("SELECT COUNT(*) as c FROM docs WHERE name = ?").get(name) as { c: number }
      return row.c
    }))

  const getStreamLastSeq = async (streamId: string): Promise<number | null> =>
    run(Effect.gen(function* () {
      const db = yield* SqliteClient
      const row = db.prepare("SELECT last_seq FROM sync_streams WHERE stream_id = ?").get(streamId) as { last_seq: number } | undefined
      return row?.last_seq ?? null
    }))

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "tx-sync-stream-"))
    mkdirSync(join(tempProjectDir, ".tx"), { recursive: true })
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  it("creates stream config and stream directory on first stream", async () => {
    const info = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.stream()
    }))

    expect(info.streamId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(existsSync(resolve(".tx", "stream.json"))).toBe(true)
    expect(existsSync(resolve(".tx", "streams", info.streamId))).toBe(true)
  })

  it("export writes an event log file", async () => {
    await insertTask("sync-stream-export", "Export task")

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.export()
    }))

    expect(result.eventCount).toBeGreaterThan(0)
    expect(existsSync(result.path)).toBe(true)
  })

  it("exported events use the sync envelope with monotonic seq", async () => {
    await insertTask("sync-stream-seq-a", "Seq A")
    await insertTask("sync-stream-seq-b", "Seq B")

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.export()
    }))

    const events = readJsonl(result.path)
    expect(events.length).toBeGreaterThan(0)
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      expect(ev.v).toBe(2)
      expect(ev.stream_id).toBe(result.streamId)
      if (i > 0) {
        expect(ev.seq).toBeGreaterThan(events[i - 1].seq)
      }
    }
  })

  it("stream sequence advances across multiple exports", async () => {
    await insertTask("sync-stream-advance-a", "Advance A")

    await run(Effect.gen(function* () {
      const sync = yield* SyncService
      yield* sync.export()
    }))

    await insertTask("sync-stream-advance-b", "Advance B")

    const info = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      yield* sync.export()
      return yield* sync.stream()
    }))

    expect(info.lastSeq).toBeGreaterThan(0)
    expect(info.nextSeq).toBe(info.lastSeq + 1)
  })

  it("import returns zero when no stream directories exist", async () => {
    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.import()
    }))

    expect(result.importedEvents).toBe(0)
    expect(result.appliedEvents).toBe(0)
    expect(result.streamCount).toBe(0)
  })

  it("import applies events when stream progress is behind", async () => {
    const taskId = await insertTask("sync-stream-import-apply", "Import me")

    const stream = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      const exported = yield* sync.export()
      const db = yield* SqliteClient
      db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId)
      db.prepare("UPDATE sync_streams SET last_seq = 0 WHERE stream_id = ?").run(exported.streamId)
      return exported.streamId
    }))

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.import()
    }))

    expect(result.streamCount).toBeGreaterThanOrEqual(1)
    expect(result.importedEvents).toBeGreaterThan(0)
    expect(await getTaskCount(taskId)).toBe(1)

    const info = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.stream()
    }))
    expect(info.knownStreams.some(s => s.streamId === stream)).toBe(true)
  })

  it("import is idempotent with no new events", async () => {
    await insertTask("sync-stream-idempotent", "Idempotent")

    await run(Effect.gen(function* () {
      const sync = yield* SyncService
      yield* sync.export()
    }))

    const first = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.import()
    }))

    const second = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.import()
    }))

    expect(first.importedEvents).toBeGreaterThanOrEqual(0)
    expect(second.importedEvents).toBe(0)
    expect(second.appliedEvents).toBe(0)
  })

  it("import recovers after a failed replay once the event payload is corrected", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FB2"
    const taskId = fixtureId("sync-stream-recovery-import")

    const buildEvent = (description: string | null) => ({
      event_id: "01ARZ3NDEKTSV4RRFFQ69G5FB3",
      stream_id: streamId,
      seq: 1,
      ts: "2026-03-05T12:30:00Z",
      type: "task.upsert",
      entity_id: taskId,
      v: 2,
      payload: {
        v: 1,
        op: "upsert",
        ts: "2026-03-05T12:30:00Z",
        eventId: "01ARZ3NDEKTSV4RRFFQ69G5FB3",
        id: taskId,
        data: {
          title: "Recovery import",
          description,
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {}
        }
      }
    })

    writeStreamEvents(streamId, [buildEvent(null)])

    const failed = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.import())
    }))
    expect(failed._tag).toBe("Left")
    expect(await getStreamLastSeq(streamId)).toBeNull()

    writeStreamEvents(streamId, [buildEvent("")])

    const recovered = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.import()
    }))

    expect(recovered.importedEvents).toBe(1)
    expect(recovered.appliedEvents).toBe(1)
    expect(await getTaskCount(taskId)).toBe(1)
    expect(await getStreamLastSeq(streamId)).toBe(1)
  })

  it("hydrate rebuilds tasks from all events", async () => {
    const taskId = await insertTask("sync-stream-hydrate", "Hydrate task")

    await run(Effect.gen(function* () {
      const sync = yield* SyncService
      yield* sync.export()
      const db = yield* SqliteClient
      db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId)
    }))

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.hydrate()
    }))

    expect(result.rebuilt).toBe(true)
    expect(result.appliedEvents).toBeGreaterThan(0)
    expect(await getTaskCount(taskId)).toBe(1)
  })

  it("hydrate is idempotent across repeated runs", async () => {
    const taskId = await insertTask("sync-stream-hydrate-idempotent", "Hydrate idempotent")
    const exported = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.export()
    }))

    await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId)
    }))

    const first = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.hydrate()
    }))
    expect(first.rebuilt).toBe(true)
    expect(first.appliedEvents).toBeGreaterThan(0)
    expect(await getTaskCount(taskId)).toBe(1)
    const firstLastSeq = await getStreamLastSeq(exported.streamId)

    const second = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.hydrate()
    }))
    expect(second.rebuilt).toBe(true)
    expect(second.appliedEvents).toBeGreaterThan(0)
    expect(await getTaskCount(taskId)).toBe(1)
    const secondLastSeq = await getStreamLastSeq(exported.streamId)
    expect(secondLastSeq).toBe(firstLastSeq)
  })

  it("gate pins are represented as pin.upsert events", async () => {
    const gateJson = JSON.stringify({
      approved: false,
      phaseFrom: "docs_harden",
      phaseTo: "feature_build",
      required: true,
      approvedBy: null,
      approvedAt: null,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      note: null,
      createdAt: new Date().toISOString(),
    })

    await run(Effect.gen(function* () {
      const pins = yield* PinService
      yield* pins.set("gate.docs-to-build", gateJson)
      const sync = yield* SyncService
      yield* sync.export()
    }))

    const stream = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.stream()
    }))

    const streamDir = resolve(".tx", "streams", stream.streamId)
    const files = readdirSync(streamDir).filter(f => f.endsWith(".jsonl"))
    const events = files.flatMap(f => readJsonl(resolve(streamDir, f)))

    const gateEvent = events.find(ev => ev.type === "pin.upsert" && ev.entity_id === "gate.docs-to-build")
    expect(gateEvent).toBeDefined()
  })

  it("hydrate restores gate pin state from stream events", async () => {
    const gateJson = JSON.stringify({
      approved: true,
      phaseFrom: "docs_harden",
      phaseTo: "feature_build",
      required: true,
      approvedBy: "james",
      approvedAt: "2026-03-05T12:30:00Z",
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      note: "approved to proceed",
      createdAt: "2026-03-05T12:00:00Z",
    })

    await run(Effect.gen(function* () {
      const pins = yield* PinService
      yield* pins.set("gate.docs-to-build", gateJson)
      const sync = yield* SyncService
      yield* sync.export()
      yield* pins.remove("gate.docs-to-build")
    }))

    await run(Effect.gen(function* () {
      const sync = yield* SyncService
      yield* sync.hydrate()
    }))

    const restored = await run(Effect.gen(function* () {
      const pins = yield* PinService
      return yield* pins.get("gate.docs-to-build")
    }))

    expect(restored).not.toBeNull()
    expect(restored?.content).toBe(gateJson)
  })

  it("hydrate updates known stream progress", async () => {
    await insertTask("sync-stream-progress", "Progress task")

    await run(Effect.gen(function* () {
      const sync = yield* SyncService
      yield* sync.export()
      yield* sync.hydrate()
    }))

    const info = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.stream()
    }))

    expect(info.knownStreams.length).toBeGreaterThan(0)
    expect(info.knownStreams[0].lastSeq).toBeGreaterThan(0)
  })

  it("stream remains stable across repeated reads", async () => {
    const first = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.stream()
    }))

    const second = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.stream()
    }))

    expect(first.streamId).toBe(second.streamId)
    expect(first.eventsDir).toBe(second.eventsDir)
  })

  it("does not advance stream progress when import apply fails", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
    const taskId = fixtureId("sync-stream-invalid-import")

    writeStreamEvents(streamId, [{
      event_id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      stream_id: streamId,
      seq: 1,
      ts: "2026-03-05T10:00:00Z",
      type: "task.upsert",
      entity_id: taskId,
      v: 2,
      payload: {
        v: 1,
        op: "upsert",
        ts: "2026-03-05T10:00:00Z",
        eventId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        id: taskId,
        data: {
          title: "Broken",
          description: null, // invalid: description must be string
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {}
        }
      }
    }])

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.import())
    }))

    expect(result._tag).toBe("Left")

    const progress = await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      return db.prepare("SELECT last_seq FROM sync_streams WHERE stream_id = ?").get(streamId) as { last_seq: number } | undefined
    }))
    expect(progress).toBeNull()
  })

  it("fails import when event stream_id does not match stream directory and does not advance progress", async () => {
    const streamDirId = "01ARZ3NDEKTSV4RRFFQ69G5FB4"
    const payloadStreamId = "01ARZ3NDEKTSV4RRFFQ69G5FB5"
    const taskId = fixtureId("sync-stream-mismatch-stream-id")

    writeStreamEvents(streamDirId, [{
      event_id: "01ARZ3NDEKTSV4RRFFQ69G5FB6",
      stream_id: payloadStreamId,
      seq: 1,
      ts: "2026-03-05T12:00:00Z",
      type: "task.upsert",
      entity_id: taskId,
      v: 2,
      payload: {
        v: 1,
        op: "upsert",
        ts: "2026-03-05T12:00:00Z",
        eventId: "01ARZ3NDEKTSV4RRFFQ69G5FB6",
        id: taskId,
        data: {
          title: "Mismatch",
          description: "",
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {},
        },
      },
    }])

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.import())
    }))

    expect(result._tag).toBe("Left")
    expect(await getTaskCount(taskId)).toBe(0)
    expect(await getStreamLastSeq(streamDirId)).toBeNull()
    expect(await getStreamLastSeq(payloadStreamId)).toBeNull()
  })

  it("rejects doc.upsert events with traversal filePath and keeps stream progress unchanged", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FC8"
    const docName = "unsafe-doc"

    writeStreamEvents(streamId, [{
      event_id: "01ARZ3NDEKTSV4RRFFQ69G5FC9",
      stream_id: streamId,
      seq: 1,
      ts: "2026-03-05T12:15:00Z",
      type: "doc.upsert",
      entity_id: `${docName}:1`,
      v: 2,
      payload: {
        v: 1,
        op: "doc_upsert",
        ts: "2026-03-05T12:15:00Z",
        id: 1,
        contentHash: "unsafe-doc-hash",
        data: {
          kind: "prd",
          name: docName,
          title: "Unsafe doc",
          version: 1,
          status: "changing",
          filePath: "../../../../../etc/passwd",
          hash: "unsafe-doc-version-hash",
          parentDocKey: null,
          lockedAt: null,
          metadata: {},
        },
      },
    }])

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.import())
    }))

    expect(result._tag).toBe("Left")
    expect(await getDocCountByName(docName)).toBe(0)
    expect(await getStreamLastSeq(streamId)).toBeNull()
  })

  it("rejects doc.upsert events with traversal name and keeps stream progress unchanged", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FDA"

    writeStreamEvents(streamId, [{
      event_id: "01ARZ3NDEKTSV4RRFFQ69G5FDB",
      stream_id: streamId,
      seq: 1,
      ts: "2026-03-05T12:16:00Z",
      type: "doc.upsert",
      entity_id: "unsafe-name-doc:1",
      v: 2,
      payload: {
        v: 1,
        op: "doc_upsert",
        ts: "2026-03-05T12:16:00Z",
        id: 1,
        contentHash: "unsafe-name-doc-hash",
        data: {
          kind: "prd",
          name: "../../unsafe-name-doc",
          title: "Unsafe doc name",
          version: 1,
          status: "changing",
          filePath: "prd/unsafe-name-doc.yml",
          hash: "unsafe-name-doc-version-hash",
          parentDocKey: null,
          lockedAt: null,
          metadata: {},
        },
      },
    }])

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.import())
    }))

    expect(result._tag).toBe("Left")
    expect(await getStreamLastSeq(streamId)).toBeNull()
  })

  it("does not write imported pins to escaped symlink target files", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "tx-sync-stream-pin-outside-"))
    const outsideTarget = join(outsideDir, "AGENTS.md")
    writeFileSync(outsideTarget, "# outside baseline\n", "utf-8")

    const symlinkDir = resolve(".tx", "escaped-targets")
    symlinkSync(outsideDir, symlinkDir)

    await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      db.prepare(`
        INSERT OR REPLACE INTO pin_config (key, value)
        VALUES ('target_files', ?)
      `).run(JSON.stringify([".tx/escaped-targets/AGENTS.md"]))
    }))

    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FD0"
    writeStreamEvents(streamId, [{
      event_id: "01ARZ3NDEKTSV4RRFFQ69G5FD1",
      stream_id: streamId,
      seq: 1,
      ts: "2026-03-05T13:45:00Z",
      type: "pin.upsert",
      entity_id: "pin-outside-attempt",
      v: 2,
      payload: {
        v: 1,
        op: "pin_upsert",
        ts: "2026-03-05T13:45:00Z",
        id: "pin-outside-attempt",
        contentHash: "pin-outside-attempt-hash",
        data: { content: "malicious overwrite attempt" },
      },
    }])

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.import()
    }))

    expect(result.appliedEvents).toBe(1)
    expect(readFileSync(outsideTarget, "utf-8")).toBe("# outside baseline\n")

    rmSync(outsideDir, { recursive: true, force: true })
  })

  it("fails import on malformed JSONL event lines and leaves progress unchanged", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FB7"
    const taskId = fixtureId("sync-stream-malformed-jsonl")

    writeRawStreamFile(streamId, [
      '{"event_id":"broken"',
      JSON.stringify({
        event_id: "01ARZ3NDEKTSV4RRFFQ69G5FB8",
        stream_id: streamId,
        seq: 1,
        ts: "2026-03-05T12:00:00Z",
        type: "task.upsert",
        entity_id: taskId,
        v: 2,
        payload: {
          v: 1,
          op: "upsert",
          ts: "2026-03-05T12:00:00Z",
          eventId: "01ARZ3NDEKTSV4RRFFQ69G5FB8",
          id: taskId,
          data: {
            title: "Should not apply",
            description: "",
            status: "backlog",
            score: 100,
            parentId: null,
            metadata: {},
          },
        },
      }),
    ])

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.import())
    }))

    expect(result._tag).toBe("Left")
    expect(await getTaskCount(taskId)).toBe(0)
    expect(await getStreamLastSeq(streamId)).toBeNull()
  })

  it("fails import when a stream event file exceeds the JSONL size limit", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FB9"
    const dir = resolve(".tx", "streams", streamId)
    mkdirSync(dir, { recursive: true })
    const file = resolve(dir, "events-2026-03-05.jsonl")
    writeFileSync(file, Buffer.alloc(64 * 1024 * 1024 + 1024, 0x61))

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.import())
    }))

    expect(result._tag).toBe("Left")
    expect(JSON.stringify(result)).toContain("exceeds")
    expect(await getStreamLastSeq(streamId)).toBeNull()
  })

  it("hydrate is atomic and leaves existing projection intact on replay failure", async () => {
    const existingTask = await insertTask("sync-stream-hydrate-rollback", "Existing task")
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FAX"

    writeStreamEvents(streamId, [{
      event_id: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
      stream_id: streamId,
      seq: 1,
      ts: "2026-03-05T11:00:00Z",
      type: "task.upsert",
      entity_id: fixtureId("sync-stream-hydrate-invalid"),
      v: 2,
      payload: {
        v: 1,
        op: "upsert",
        ts: "2026-03-05T11:00:00Z",
        eventId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        id: fixtureId("sync-stream-hydrate-invalid"),
        data: {
          title: "Invalid hydrate op",
          description: null, // invalid: description must be string
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {}
        }
      }
    }])

    const result = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* Effect.either(sync.hydrate())
    }))

    expect(result._tag).toBe("Left")
    expect(await getTaskCount(existingTask)).toBe(1)
  })

  it("resolves same-timestamp conflicts deterministically by event_id", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ"
    const taskId = fixtureId("sync-stream-lww-event-id")

    writeStreamEvents(streamId, [
      {
        event_id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
        stream_id: streamId,
        seq: 1,
        ts: "2026-03-05T12:00:00Z",
        type: "task.upsert",
        entity_id: taskId,
        v: 2,
        payload: {
          v: 1,
          op: "upsert",
          ts: "2026-03-05T12:00:00Z",
          eventId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
          id: taskId,
          data: {
            title: "Older by event_id",
            description: "",
            status: "backlog",
            score: 100,
            parentId: null,
            metadata: {}
          }
        }
      },
      {
        event_id: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        stream_id: streamId,
        seq: 2,
        ts: "2026-03-05T12:00:00Z",
        type: "task.upsert",
        entity_id: taskId,
        v: 2,
        payload: {
          v: 1,
          op: "upsert",
          ts: "2026-03-05T12:00:00Z",
          eventId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
          id: taskId,
          data: {
            title: "Newer by event_id",
            description: "",
            status: "backlog",
            score: 100,
            parentId: null,
            metadata: {}
          }
        }
      }
    ])

    const imported = await run(Effect.gen(function* () {
      const sync = yield* SyncService
      return yield* sync.import()
    }))

    expect(imported.appliedEvents).toBeGreaterThanOrEqual(2)

    const title = await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      const row = db.prepare("SELECT title FROM tasks WHERE id = ?").get(taskId) as { title: string } | undefined
      return row?.title ?? null
    }))

    expect(title).toBe("Newer by event_id")
  })

  it("decision sync round-trip: export → clear → import", async () => {
    // 1. Insert a decision directly via SQL
    const decId = "dec-roundtrip01"
    const contentHash = "abc123hash"
    const now = new Date().toISOString()
    await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      db.prepare(
        `INSERT INTO decisions (id, content, question, status, source, commit_sha, task_id, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(decId, "Use WAL mode", "Which journal mode?", "approved", "manual", "sha123", null, contentHash, now, now)
    }))

    // 2. Export to stream
    const syncSvc = await run(Effect.map(SyncService, s => s))
    const exportResult = await run(syncSvc.export())
    expect(exportResult.eventCount).toBeGreaterThan(0)

    // Read the stream file to find decision events
    const streamsDir = resolve(".tx", "streams")
    const streamDirs = readdirSync(streamsDir)
    expect(streamDirs.length).toBeGreaterThan(0)

    const streamDir = join(streamsDir, streamDirs[0])
    const eventFiles = readdirSync(streamDir).filter(f => f.startsWith("events-"))
    expect(eventFiles.length).toBeGreaterThan(0)

    const eventFile = join(streamDir, eventFiles[0])
    const events = readJsonl(eventFile)
    const decisionEvents = events.filter(e => e.type === "decision.upsert")
    expect(decisionEvents.length).toBe(1)
    expect(decisionEvents[0].payload.data.content).toBe("Use WAL mode")

    // 3. Clear decisions table
    await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      db.prepare("DELETE FROM decisions").run()
      const count = db.prepare("SELECT COUNT(*) as c FROM decisions").get() as { c: number }
      expect(count.c).toBe(0)
    }))

    // 4. Hydrate from stream (reimports everything including decisions)
    const hydrateResult = await run(syncSvc.hydrate())
    expect(hydrateResult).toBeDefined()

    // 5. Verify decision was reimported
    const reimported = await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(decId) as Record<string, unknown> | undefined
      return row
    }))

    expect(reimported).toBeDefined()
    expect(reimported!.content).toBe("Use WAL mode")
    expect(reimported!.question).toBe("Which journal mode?")
    expect(reimported!.status).toBe("approved")
    expect(reimported!.source).toBe("manual")
    expect(reimported!.content_hash).toBe(contentHash)
  })

  it("decision import deduplicates by content_hash", async () => {
    const decId = "dec-dedup00001"
    const contentHash = "deduphash123"
    const now = new Date().toISOString()

    // Insert an existing decision
    await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      db.prepare(
        `INSERT INTO decisions (id, content, question, status, source, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(decId, "Existing decision", null, "pending", "manual", contentHash, now, now)
    }))

    // Write a decisions.jsonl with the same content_hash
    const decisionsPath = resolve(".tx", "decisions.jsonl")
    const op = {
      v: 1,
      op: "decision_upsert",
      ts: now,
      id: "dec-differentid",
      contentHash: contentHash,
      data: {
        content: "Existing decision",
        question: null,
        status: "pending",
        source: "manual",
        commitSha: null,
        runId: null,
        taskId: null,
        docKey: null,
        invariantId: null,
        reviewedBy: null,
        reviewNote: null,
        editedContent: null,
        reviewedAt: null,
        supersededBy: null,
        syncedToDoc: false,
      }
    }
    writeFileSync(decisionsPath, JSON.stringify(op) + "\n")

    // Import — should skip the duplicate
    const syncSvc = await run(Effect.map(SyncService, s => s))
    const result = await run(syncSvc.importDecisions(decisionsPath))

    expect(result.skipped).toBe(1)
    expect(result.imported).toBe(0)

    // Only one decision should exist
    const count = await run(Effect.gen(function* () {
      const db = yield* SqliteClient
      const row = db.prepare("SELECT COUNT(*) as c FROM decisions").get() as { c: number }
      return row.c
    }))
    expect(count).toBe(1)
  })
})
