import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

function runTx(args: string[], dbPath: string, cwd: string): ExecResult {
  const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
    encoding: "utf-8",
    cwd,
    timeout: 30000,
  })

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  }
}

function writeTaskUpsertEvent(params: {
  cwd: string
  streamId: string
  eventId: string
  seq: number
  ts: string
  taskId: string
  title: string
  description: string | null
}) {
  const eventsDir = resolve(params.cwd, ".tx", "streams", params.streamId)
  mkdirSync(eventsDir, { recursive: true })
  writeFileSync(
    resolve(eventsDir, "events-2026-03-05.jsonl"),
    `${JSON.stringify({
      event_id: params.eventId,
      stream_id: params.streamId,
      seq: params.seq,
      ts: params.ts,
      type: "task.upsert",
      entity_id: params.taskId,
      v: 2,
      payload: {
        v: 1,
        op: "upsert",
        ts: params.ts,
        eventId: params.eventId,
        id: params.taskId,
        data: {
          title: params.title,
          description: params.description,
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {}
        }
      }
    })}\n`,
    "utf-8"
  )
}

describe("CLI sync stream events", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-cli-"))
    dbPath = join(tmpDir, "test.db")

    const init = runTx(["init"], dbPath, tmpDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("exports stream events", () => {
    const add = runTx(["add", "CLI sync export task", "--json"], dbPath, tmpDir)
    expect(add.status).toBe(0)

    const exported = runTx(["sync", "export", "--json"], dbPath, tmpDir)
    expect(exported.status).toBe(0)

    const parsed = JSON.parse(exported.stdout)
    expect(parsed.eventCount).toBeGreaterThan(0)
    expect(parsed.streamId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(existsSync(parsed.path)).toBe(true)
  })

  it("reports stream identity and sequence as JSON", () => {
    const streamInfo = runTx(["sync", "stream", "--json"], dbPath, tmpDir)
    expect(streamInfo.status).toBe(0)
    const parsed = JSON.parse(streamInfo.stdout) as {
      streamId: string
      nextSeq: number
      lastSeq: number
      eventsDir: string
      configPath: string
      knownStreams: Array<{ streamId: string; lastSeq: number; lastEventAt: string | null }>
    }
    expect(parsed.streamId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(parsed.nextSeq).toBeGreaterThanOrEqual(1)
    expect(parsed.lastSeq).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(parsed.knownStreams)).toBe(true)
  })

  it("reports status using eventOpCount (no legacy jsonlOpCount)", () => {
    const status = runTx(["sync", "status", "--json"], dbPath, tmpDir)
    expect(status.status).toBe(0)
    const parsed = JSON.parse(status.stdout) as Record<string, unknown>
    expect(typeof parsed.dbTaskCount).toBe("number")
    expect(typeof parsed.eventOpCount).toBe("number")
    expect(parsed).not.toHaveProperty("jsonlOpCount")
  })

  it("imports stream events from .tx/streams", () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FC0"
    const taskId = "tx-syncsa"

    writeTaskUpsertEvent({
      cwd: tmpDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
      seq: 1,
      ts: "2026-03-05T12:00:00Z",
      taskId,
      title: "Imported via stream",
      description: "",
    })

    const imported = runTx(["sync", "import", "--json"], dbPath, tmpDir)
    expect(imported.status).toBe(0)
    const parsed = JSON.parse(imported.stdout)
    expect(parsed.appliedEvents).toBeGreaterThanOrEqual(1)

    const shown = runTx(["show", taskId, "--json"], dbPath, tmpDir)
    expect(shown.status).toBe(0)
    const task = JSON.parse(shown.stdout)
    expect(task.title).toBe("Imported via stream")
  })

  it("hydrates stream events and remains convergent on repeated hydrate runs", () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FC2"
    const taskId = "tx-syncsb"

    writeTaskUpsertEvent({
      cwd: tmpDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FC3",
      seq: 1,
      ts: "2026-03-05T13:00:00Z",
      taskId,
      title: "Hydrated via stream",
      description: "",
    })

    const firstHydrate = runTx(["sync", "hydrate", "--json"], dbPath, tmpDir)
    expect(firstHydrate.status).toBe(0)
    const firstHydrateJson = JSON.parse(firstHydrate.stdout) as { rebuilt: boolean; appliedEvents: number }
    expect(firstHydrateJson.rebuilt).toBe(true)
    expect(firstHydrateJson.appliedEvents).toBeGreaterThanOrEqual(1)

    const secondHydrate = runTx(["sync", "hydrate", "--json"], dbPath, tmpDir)
    expect(secondHydrate.status).toBe(0)
    const secondHydrateJson = JSON.parse(secondHydrate.stdout) as { rebuilt: boolean; appliedEvents: number }
    expect(secondHydrateJson.rebuilt).toBe(true)
    expect(secondHydrateJson.appliedEvents).toBeGreaterThanOrEqual(1)

    const listed = runTx(["list", "--json"], dbPath, tmpDir)
    expect(listed.status).toBe(0)
    const tasks = JSON.parse(listed.stdout) as Array<{ id: string; title: string }>
    const hydratedTasks = tasks.filter(task => task.id === taskId)
    expect(hydratedTasks).toHaveLength(1)
    expect(hydratedTasks[0].title).toBe("Hydrated via stream")
  }, 30_000)

  it("recovers import after invalid stream event is corrected", () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FC4"
    const taskId = "tx-syncsc"

    writeTaskUpsertEvent({
      cwd: tmpDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FC5",
      seq: 1,
      ts: "2026-03-05T13:30:00Z",
      taskId,
      title: "Recoverable import task",
      description: null,
    })

    const failedImport = runTx(["sync", "import", "--json"], dbPath, tmpDir)
    expect(failedImport.status).toBe(1)

    writeTaskUpsertEvent({
      cwd: tmpDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FC5",
      seq: 1,
      ts: "2026-03-05T13:30:00Z",
      taskId,
      title: "Recoverable import task",
      description: "",
    })

    const recoveredImport = runTx(["sync", "import", "--json"], dbPath, tmpDir)
    expect(recoveredImport.status).toBe(0)
    const recoveredJson = JSON.parse(recoveredImport.stdout) as { appliedEvents: number }
    expect(recoveredJson.appliedEvents).toBeGreaterThanOrEqual(1)

    const shown = runTx(["show", taskId, "--json"], dbPath, tmpDir)
    expect(shown.status).toBe(0)
    const task = JSON.parse(shown.stdout) as { title: string }
    expect(task.title).toBe("Recoverable import task")
  })

  it("exports repeatedly and hydrate restores deleted tasks", () => {
    const created = runTx(["add", "CLI export replay task", "--json"], dbPath, tmpDir)
    expect(created.status).toBe(0)
    const createdTask = JSON.parse(created.stdout) as { id: string; title: string }

    const firstExport = runTx(["sync", "export", "--json"], dbPath, tmpDir)
    expect(firstExport.status).toBe(0)
    const firstExportJson = JSON.parse(firstExport.stdout) as { eventCount: number }
    expect(firstExportJson.eventCount).toBeGreaterThan(0)

    const secondExport = runTx(["sync", "export", "--json"], dbPath, tmpDir)
    expect(secondExport.status).toBe(0)
    const secondExportJson = JSON.parse(secondExport.stdout) as { eventCount: number }
    expect(secondExportJson.eventCount).toBe(firstExportJson.eventCount)

    const deleted = runTx(["delete", createdTask.id], dbPath, tmpDir)
    expect(deleted.status).toBe(0)

    const missing = runTx(["show", createdTask.id, "--json"], dbPath, tmpDir)
    expect(missing.status).not.toBe(0)

    const hydrated = runTx(["sync", "hydrate", "--json"], dbPath, tmpDir)
    expect(hydrated.status).toBe(0)
    const hydratedJson = JSON.parse(hydrated.stdout) as { rebuilt: boolean }
    expect(hydratedJson.rebuilt).toBe(true)

    const restored = runTx(["show", createdTask.id, "--json"], dbPath, tmpDir)
    expect(restored.status).toBe(0)
    const restoredTask = JSON.parse(restored.stdout) as { title: string }
    expect(restoredTask.title).toBe(createdTask.title)
  }, 30_000)

  it("rejects legacy sync file options", () => {
    const exportWithPath = runTx(["sync", "export", "--path", "tasks.jsonl"], dbPath, tmpDir)
    expect(exportWithPath.status).toBe(1)
    expect(exportWithPath.stderr).toContain("no longer supported")

    const importWithPath = runTx(["sync", "import", "--path", "tasks.jsonl"], dbPath, tmpDir)
    expect(importWithPath.status).toBe(1)
    expect(importWithPath.stderr).toContain("no longer supported")
  })

})
