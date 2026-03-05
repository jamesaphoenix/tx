import { Context, Effect, Layer, Schema } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { SqliteClient } from "../db.js"
import { DatabaseError, ValidationError } from "../errors.js"
import { StreamConfigSchema } from "../schemas/sync-events.js"
import { resolvePathWithin } from "../utils/file-path.js"
import { generateUlid } from "../utils/ulid.js"

const DEFAULT_STREAM_CONFIG_PATH = ".tx/stream.json"
const DEFAULT_STREAMS_DIR = ".tx/streams"

export type StreamInfo = {
  readonly streamId: string
  readonly configPath: string
  readonly eventsDir: string
  readonly name: string | null
  readonly createdAt: string
  readonly lastSeq: number
  readonly nextSeq: number};

export type StreamProgress = {
  readonly streamId: string
  readonly lastSeq: number
  readonly lastEventAt: string | null};

type StreamConfigFile = {
  readonly stream_id: string
  readonly created_at: string
  readonly name?: string};

const validateProjectPath = (path: string): Effect.Effect<string, ValidationError> =>
  Effect.gen(function* () {
    const projectRoot = process.cwd()
    const resolved = resolvePathWithin(projectRoot, path, { useRealpath: true })
    if (!resolved) {
      return yield* Effect.fail(new ValidationError({
        reason: `Path traversal rejected for '${path}': escapes project directory '${projectRoot}'`
      }))
    }
    return resolved
  })

const ensureConfigFile = (path: string): Effect.Effect<StreamConfigFile, DatabaseError> =>
  Effect.gen(function* () {
    const now = new Date().toISOString()

    const readExisting = yield* Effect.tryPromise({
      try: () => readFile(path, "utf-8"),
      catch: (cause) => cause
    }).pipe(Effect.either)

    if (readExisting._tag === "Right") {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(readExisting.right),
        catch: (cause) => new DatabaseError({ cause })
      })
      const config = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(StreamConfigSchema)(parsed),
        catch: (cause) => new DatabaseError({ cause })
      })
      return {
        stream_id: config.stream_id,
        created_at: config.created_at,
        name: config.name
      }
    }

    const config: StreamConfigFile = {
      stream_id: generateUlid(),
      created_at: now,
    }

    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
      },
      catch: (cause) => new DatabaseError({ cause })
    })

    return config
  })

export class StreamService extends Context.Tag("StreamService")<
  StreamService,
  {
    readonly getInfo: () => Effect.Effect<StreamInfo, DatabaseError | ValidationError>
    readonly reserveSeq: (count: number) => Effect.Effect<{ streamId: string; startSeq: number }, DatabaseError | ValidationError>
    readonly touchStream: (streamId: string, lastSeq: number, lastEventAt?: string | null) => Effect.Effect<void, DatabaseError>
    readonly listProgress: () => Effect.Effect<readonly StreamProgress[], DatabaseError>
  }
>() {}

export const StreamServiceLive = Layer.effect(
  StreamService,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    const getConfigAndPath = () =>
      Effect.gen(function* () {
        const configPath = yield* validateProjectPath(DEFAULT_STREAM_CONFIG_PATH)
        const streamsRoot = yield* validateProjectPath(DEFAULT_STREAMS_DIR)
        const config = yield* ensureConfigFile(configPath)
        const eventsDir = resolve(streamsRoot, config.stream_id)

        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(eventsDir, { recursive: true })
          },
          catch: (cause) => new DatabaseError({ cause })
        })

        return { configPath, streamsRoot, eventsDir, config }
      })

    const ensureStreamRow = (streamId: string, createdAt: string, name?: string) =>
      Effect.try({
        try: () => {
          db.prepare(
            `INSERT INTO sync_streams (stream_id, name, created_at, last_seq)
             VALUES (?, ?, ?, 0)
             ON CONFLICT(stream_id) DO NOTHING`
          ).run(streamId, name ?? null, createdAt)
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const getInfo = () =>
      Effect.gen(function* () {
        const { configPath, eventsDir, config } = yield* getConfigAndPath()
        yield* ensureStreamRow(config.stream_id, config.created_at, config.name)

        const row = yield* Effect.try({
          try: () => db.prepare("SELECT name, last_seq FROM sync_streams WHERE stream_id = ?").get(config.stream_id) as { name: string | null; last_seq: number } | undefined,
          catch: (cause) => new DatabaseError({ cause })
        })

        const lastSeq = row?.last_seq ?? 0

        return {
          streamId: config.stream_id,
          configPath,
          eventsDir,
          name: row?.name ?? config.name ?? null,
          createdAt: config.created_at,
          lastSeq,
          nextSeq: lastSeq + 1,
        }
      })

    return {
      getInfo,

      reserveSeq: (count: number) =>
        Effect.gen(function* () {
          if (!Number.isInteger(count) || count < 1) {
            return yield* Effect.fail(new ValidationError({ reason: "count must be >= 1" }))
          }

          const info = yield* getInfo()

          const transactionResult = yield* Effect.try({
            try: () => {
              db.exec("BEGIN IMMEDIATE")
              try {
                const row = db.prepare("SELECT last_seq FROM sync_streams WHERE stream_id = ?").get(info.streamId) as { last_seq: number } | undefined
                const current = row?.last_seq ?? 0
                const start = current + 1
                const nextLast = current + count
                db.prepare("UPDATE sync_streams SET last_seq = ? WHERE stream_id = ?").run(nextLast, info.streamId)
                db.exec("COMMIT")
                return { _tag: "success" as const, startSeq: start }
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* ignore */ }
                return { _tag: "failure" as const, error: e }
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })

          if (transactionResult._tag === "failure") {
            return yield* Effect.fail(new DatabaseError({ cause: transactionResult.error }))
          }

          const startSeq = transactionResult.startSeq
          return { streamId: info.streamId, startSeq }
        }),

      touchStream: (streamId: string, lastSeq: number, lastEventAt?: string | null) =>
        Effect.try({
          try: () => {
            db.prepare(
              `INSERT INTO sync_streams (stream_id, created_at, last_seq, last_event_at)
               VALUES (?, datetime('now'), ?, ?)
               ON CONFLICT(stream_id) DO UPDATE SET
                 last_seq = CASE
                   WHEN excluded.last_seq > sync_streams.last_seq THEN excluded.last_seq
                   ELSE sync_streams.last_seq
                 END,
                 last_event_at = CASE
                   WHEN excluded.last_event_at IS NOT NULL THEN excluded.last_event_at
                   ELSE sync_streams.last_event_at
                 END`
            ).run(streamId, lastSeq, lastEventAt ?? null)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      listProgress: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT stream_id, last_seq, last_event_at FROM sync_streams ORDER BY stream_id"
            ).all() as Array<{ stream_id: string; last_seq: number; last_event_at: string | null }>
            return rows.map((row) => ({
              streamId: row.stream_id,
              lastSeq: row.last_seq,
              lastEventAt: row.last_event_at,
            }))
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
