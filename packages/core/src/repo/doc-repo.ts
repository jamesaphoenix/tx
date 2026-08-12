/**
 * DocRepository — database operations for docs-as-primitives (DD-023).
 *
 * Manages docs, doc_links, task_doc_links, invariants, invariant_checks tables.
 * YAML content lives on disk; DB stores metadata + links only.
 */
import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { legacySpecProjectionContext, type SpecProjectionContext } from "../workspace-context.js"
import { ensureSpecProjection } from "./spec-projection.js"
import { coerceDbResult } from "../utils/db-result.js"
import {
  rowToDoc,
  rowToDocLink,
  rowToTaskDocLink,
  isValidTaskDocLinkType,
  rowToInvariant,
  rowToInvariantCheck,
} from "../mappers/doc.js"
import type {
  DocFilter,
  DocInsertInput,
  DocRepositoryService,
  DocUpdateInput,
  InvariantFilter,
  InvariantUpsertInput,
} from "./doc-repo.types.js"
import type {
  DocId,
  DocKind,
  DocLinkType,
  DocStableId,
  TaskDocLinkType,
  TaskLinkedDocRef,
  DocRow,
  DocLinkRow,
  TaskDocLinkRow,
  InvariantRow,
  InvariantCheckRow,
} from "../types/index.js"

export class DocRepository extends Context.Tag("DocRepository")<
  DocRepository,
  DocRepositoryService
>() {}

export const makeDocRepositoryLive = (
  projection: SpecProjectionContext = legacySpecProjectionContext()
) => Layer.effect(
  DocRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const projectionKey = projection.projectionKey
    const getDocsForManyTasksImpl = (taskIds: readonly string[]) =>
      Effect.try({
        try: () => {
          const byTask = new Map<string, TaskLinkedDocRef[]>()
          const seenByTask = new Map<string, Set<string>>()

          for (const taskId of taskIds) {
            byTask.set(taskId, [])
            seenByTask.set(taskId, new Set())
          }

          if (taskIds.length === 0) {
            return byTask
          }

          const placeholders = taskIds.map(() => "?").join(", ")
          const rows = db.prepare<DocRow & {
            task_id: string
            link_type: string
          }>(
            `SELECT
               tdl.task_id,
               tdl.link_type,
               d.*
             FROM task_doc_links tdl
             JOIN docs d ON d.id = tdl.doc_id
             WHERE tdl.task_id IN (${placeholders})
             ORDER BY tdl.task_id, tdl.link_type, d.kind, d.name, d.version DESC`
          ).all(...taskIds)

          for (const row of rows) {
            if (!isValidTaskDocLinkType(row.link_type)) {
              throw new EntityFetchError({
                entity: "task_doc_link",
                id: row.task_id,
                operation: "join-read",
              })
            }

            const doc = rowToDoc(row)
            const refs = byTask.get(row.task_id) ?? []
            const seen = seenByTask.get(row.task_id) ?? new Set<string>()
            const dedupeKey = `${doc.docId}:${doc.version}:${row.link_type}`
            if (seen.has(dedupeKey)) {
              continue
            }

            refs.push({
              docId: doc.docId,
              name: doc.name,
              title: doc.title,
              kind: doc.kind,
              version: doc.version,
              status: doc.status,
              filePath: doc.filePath,
              linkType: row.link_type,
            })
            seen.add(dedupeKey)
            byTask.set(row.task_id, refs)
            seenByTask.set(row.task_id, seen)
          }

          return byTask
        },
        catch: (cause) => new DatabaseError({ cause }),
      })

    return {
      beginImmediate: () =>
        Effect.try({
          try: () => db.exec("BEGIN IMMEDIATE"),
          catch: (cause) => new DatabaseError({ cause }),
        }),

      commit: () =>
        Effect.try({
          try: () => db.exec("COMMIT"),
          catch: (cause) => new DatabaseError({ cause }),
        }),

      rollback: () =>
        Effect.try({
          try: () => db.exec("ROLLBACK"),
          catch: (cause) => new DatabaseError({ cause }),
        }),

      insert: (input: DocInsertInput) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                `INSERT INTO docs (doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
               VALUES (?, ?, ?, ?, ?, ?, 'changing', ?, ?, ?, ?)`
              )
              .run(
                input.docId,
                input.hash,
                input.kind,
                input.name,
                input.title,
                input.version,
                input.filePath,
                input.parentDocId,
                now,
                input.metadata ?? "{}"
              )
            const row = db
              .prepare<DocRow>("SELECT * FROM docs WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "doc",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToDoc(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findById: (id: DocId) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocRow>("SELECT * FROM docs WHERE id = ?")
              .get(id)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findByDocId: (docId: DocStableId, version?: number) =>
        Effect.try({
          try: () => {
            const row =
              version !== undefined
                ? db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE doc_id = ? AND version = ?"
                    )
                    .get(docId, version)
                : db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE doc_id = ? ORDER BY version DESC LIMIT 1"
                    )
                    .get(docId)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findByName: (name: string, version?: number) =>
        Effect.try({
          try: () => {
            const row =
              version !== undefined
                ? db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE name = ? AND version = ?"
                    )
                    .get(name, version)
                : db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE name = ? ORDER BY version DESC LIMIT 1"
                    )
                    .get(name)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findAllByName: (name: string, version?: number) =>
        Effect.try({
          try: () => {
            const rows =
              version !== undefined
                ? db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE name = ? AND version = ? ORDER BY kind ASC, version DESC"
                    )
                    .all(name, version)
                : db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE name = ? ORDER BY kind ASC, version DESC"
                    )
                    .all(name)
            return rows.map(rowToDoc)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findLatestByKindAndName: (kind: DocKind, name: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocRow>(
                "SELECT * FROM docs WHERE kind = ? AND name = ? ORDER BY version DESC LIMIT 1"
              )
              .get(kind, name)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findAll: (filter?: DocFilter) =>
        Effect.try({
          try: () => {
            let sql = "SELECT * FROM docs"
            const params: unknown[] = []
            const conditions: string[] = []
            if (filter?.kind) {
              conditions.push("kind = ?")
              params.push(filter.kind)
            }
            if (filter?.status) {
              conditions.push("status = ?")
              params.push(filter.status)
            }
            if (conditions.length > 0) {
              sql += " WHERE " + conditions.join(" AND ")
            }
            sql += " ORDER BY kind, name, version"
            const rows = db.prepare<DocRow>(sql).all(...params)
            return rows.map(rowToDoc)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      update: (id: DocId, input: DocUpdateInput) =>
        Effect.try({
          try: () => {
            const sets: string[] = []
            const params: unknown[] = []
            if (input.docId !== undefined) {
              sets.push("doc_id = ?")
              params.push(input.docId)
            }
            if (input.hash !== undefined) {
              sets.push("hash = ?")
              params.push(input.hash)
            }
            if (input.title !== undefined) {
              sets.push("title = ?")
              params.push(input.title)
            }
            if (input.status !== undefined) {
              sets.push("status = ?")
              params.push(input.status)
            }
            if (input.lockedAt !== undefined) {
              sets.push("locked_at = ?")
              params.push(input.lockedAt)
            }
            if (input.metadata !== undefined) {
              sets.push("metadata = ?")
              params.push(input.metadata)
            }
            if (sets.length === 0) return
            params.push(id)
            db.prepare(
              `UPDATE docs SET ${sets.join(", ")} WHERE id = ?`
            ).run(...params)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      lock: (id: DocId, lockedAt: string) =>
        Effect.try({
          try: () => {
            db.prepare(
              "UPDATE docs SET status = 'locked', locked_at = ? WHERE id = ?"
            ).run(lockedAt, id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      remove: (id: DocId) =>
        Effect.try({
          try: () => {
            db.prepare("DELETE FROM docs WHERE id = ?").run(id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      // Doc links
      createLink: (
        fromDocId: DocId,
        toDocId: DocId,
        linkType: DocLinkType
      ) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                "INSERT INTO doc_links (from_doc_id, to_doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
              )
              .run(fromDocId, toDocId, linkType, now)
            const row = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "doc_link",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToDocLink(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getLinksFrom: (docId: DocId) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links WHERE from_doc_id = ?")
              .all(docId)
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getLinksTo: (docId: DocId) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links WHERE to_doc_id = ?")
              .all(docId)
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getAllLinks: () =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links ORDER BY created_at")
              .all()
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      // Task-doc links
      createTaskLink: (
        taskId: string,
        docId: DocId,
        linkType: TaskDocLinkType
      ) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
              )
              .run(taskId, docId, linkType, now)
            const row = db
              .prepare<TaskDocLinkRow>("SELECT * FROM task_doc_links WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "task_doc_link",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToTaskDocLink(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getTaskLinksForDoc: (docId: DocId) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<TaskDocLinkRow>("SELECT * FROM task_doc_links WHERE doc_id = ?")
              .all(docId)
            return rows.map(rowToTaskDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getTaskLinksForTask: (taskId: string) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<TaskDocLinkRow>("SELECT * FROM task_doc_links WHERE task_id = ? ORDER BY created_at")
              .all(taskId)
            return rows.map(rowToTaskDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getDocsForTask: (taskId: string) =>
        Effect.gen(function* () {
          const byTask = yield* getDocsForManyTasksImpl([taskId])
          return [...(byTask.get(taskId) ?? [])]
        }),

      getDocsForManyTasks: getDocsForManyTasksImpl,

      getDocForTask: (taskId: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocRow>(
                `SELECT d.* FROM docs d
               JOIN task_doc_links tdl ON tdl.doc_id = d.id
               WHERE tdl.task_id = ?
               ORDER BY d.version DESC LIMIT 1`
              )
              .get(taskId)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getUnlinkedTaskIds: () =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<{ id: string }>(
                `SELECT t.id FROM tasks t
               LEFT JOIN task_doc_links tdl ON tdl.task_id = t.id
               WHERE tdl.id IS NULL
               ORDER BY t.id`
              )
              .all()
            return rows.map((r) => r.id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      // Invariants
      upsertInvariant: (input: InvariantUpsertInput) =>
        Effect.try({
          try: () => {
            ensureSpecProjection(db, projection)
            const now = new Date().toISOString()
            db.prepare(
              `INSERT INTO invariants (projection_key, id, rule, enforcement, doc_id, subsystem, test_ref, lint_rule, prompt_ref, status, created_at, metadata, source, source_ref, pattern, trigger_text, state_text, condition_text, feature, system_name, response, rationale, test_hint)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(projection_key, id) DO UPDATE SET
                 rule = excluded.rule,
                 enforcement = excluded.enforcement,
                 doc_id = excluded.doc_id,
                 subsystem = excluded.subsystem,
                 test_ref = excluded.test_ref,
                 lint_rule = excluded.lint_rule,
                 prompt_ref = excluded.prompt_ref,
                 status = 'active',
                 source = excluded.source,
                 source_ref = excluded.source_ref,
                 pattern = excluded.pattern,
                 trigger_text = excluded.trigger_text,
                 state_text = excluded.state_text,
                 condition_text = excluded.condition_text,
                 feature = excluded.feature,
                 system_name = excluded.system_name,
                 response = excluded.response,
                 rationale = excluded.rationale,
                 test_hint = excluded.test_hint`
            ).run(
              projectionKey,
              input.id,
              input.rule,
              input.enforcement,
              input.docId,
              input.subsystem ?? null,
              input.testRef ?? null,
              input.lintRule ?? null,
              input.promptRef ?? null,
              now,
              input.source ?? "explicit",
              input.sourceRef ?? null,
              input.pattern ?? null,
              input.triggerText ?? null,
              input.stateText ?? null,
              input.conditionText ?? null,
              input.feature ?? null,
              input.systemName ?? null,
              input.response ?? null,
              input.rationale ?? null,
              input.testHint ?? null
            )
            const row = db
              .prepare<InvariantRow>("SELECT * FROM invariants WHERE projection_key = ? AND id = ?")
              .get(projectionKey, input.id)
            if (!row) {
              throw new EntityFetchError({
                entity: "invariant",
                id: input.id,
                operation: "insert",
              })
            }
            return rowToInvariant(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
      findInvariantById: (id: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<InvariantRow>("SELECT * FROM invariants WHERE projection_key = ? AND id = ?")
              .get(projectionKey, id)
            return row ? rowToInvariant(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
      findInvariants: (filter?: InvariantFilter) =>
        Effect.try({
          try: () => {
            let sql = "SELECT * FROM invariants"
            const params: unknown[] = [projectionKey]
            const conditions: string[] = ["projection_key = ?"]
            if (filter?.docId !== undefined) {
              conditions.push("doc_id = ?")
              params.push(filter.docId)
            }
            if (filter?.subsystem) {
              conditions.push("subsystem = ?")
              params.push(filter.subsystem)
            }
            if (filter?.enforcement) {
              conditions.push("enforcement = ?")
              params.push(filter.enforcement)
            }
            if (conditions.length > 0) {
              sql += " WHERE " + conditions.join(" AND ")
            }
            sql += " ORDER BY id"
            const rows = db.prepare<InvariantRow>(sql).all(...params)
            return rows.map(rowToInvariant)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      deprecateInvariantsNotIn: (docId: DocId, activeIds: string[]) =>
        Effect.try({
          try: () => {
            if (activeIds.length === 0) {
              db.prepare(
                "UPDATE invariants SET status = 'deprecated' WHERE projection_key = ? AND doc_id = ? AND status = 'active'"
              ).run(projectionKey, docId)
              return
            }
            const placeholders = activeIds.map(() => "?").join(", ")
            db.prepare(
              `UPDATE invariants SET status = 'deprecated'
               WHERE projection_key = ? AND doc_id = ? AND status = 'active' AND id NOT IN (${placeholders})`
            ).run(projectionKey, docId, ...activeIds)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
      insertInvariantCheck: (
        invariantId: string,
        passed: boolean,
        details: string | null,
        durationMs: number | null
      ) =>
        Effect.try({
          try: () => {
            ensureSpecProjection(db, projection)
            const now = new Date().toISOString()
            const result = db
              .prepare(
                "INSERT INTO invariant_checks (projection_key, invariant_id, passed, details, checked_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?)"
              )
              .run(projectionKey, invariantId, passed ? 1 : 0, details, now, durationMs)
            const row = db
              .prepare<InvariantCheckRow>("SELECT * FROM invariant_checks WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "invariant_check",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToInvariantCheck(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getInvariantChecks: (invariantId: string, limit = 20) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<InvariantCheckRow>(
                "SELECT * FROM invariant_checks WHERE projection_key = ? AND invariant_id = ? ORDER BY checked_at DESC LIMIT ?"
              )
              .all(projectionKey, invariantId, limit)
            return rows.map(rowToInvariantCheck)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      countInvariantsByDoc: (docId: DocId) =>
        Effect.try({
          try: () => {
            const result = db
              .prepare<{ cnt: number }>(
                "SELECT COUNT(*) as cnt FROM invariants WHERE projection_key = ? AND doc_id = ? AND status = 'active'"
              )
              .get(projectionKey, docId)
            if (!result) return 0
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      upsertProjectionSnapshot: (input) =>
        Effect.try({
          try: () => {
            ensureSpecProjection(db, projection)
            db.prepare(
              `INSERT INTO doc_projection_snapshots (
                 projection_key, doc_id, content_hash, title, file_path, head_sha
               ) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(projection_key, doc_id) DO UPDATE SET
                 content_hash = excluded.content_hash,
                 title = excluded.title,
                 file_path = excluded.file_path,
                 head_sha = excluded.head_sha,
                 synced_at = datetime('now')`
            ).run(
              projectionKey,
              input.docId,
              input.contentHash,
              input.title,
              input.filePath,
              input.headSha ?? projection.commit
            )
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findProjectionSnapshot: (docId) =>
        Effect.try({
          try: () => {
            const row = db.prepare<{
              doc_id: number
              content_hash: string
              title: string
              file_path: string
              head_sha: string | null
              synced_at: string
            }>(
              `SELECT doc_id, content_hash, title, file_path, head_sha, synced_at
               FROM doc_projection_snapshots
               WHERE projection_key = ? AND doc_id = ?`
            ).get(projectionKey, docId)
            if (!row) return null
            return {
              docId: coerceDbResult<DocId>(row.doc_id),
              contentHash: row.content_hash,
              title: row.title,
              filePath: row.file_path,
              headSha: row.head_sha,
              syncedAt: new Date(row.synced_at),
            }
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
    }
  })
)

export const DocRepositoryLive = makeDocRepositoryLive()
