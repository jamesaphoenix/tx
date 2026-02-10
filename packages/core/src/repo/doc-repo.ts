/**
 * DocRepository — database operations for docs-as-primitives (DD-023).
 *
 * Manages docs, doc_links, task_doc_links, invariants, invariant_checks tables.
 * YAML content lives on disk; DB stores metadata + links only.
 */
import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import {
  rowToDoc,
  rowToDocLink,
  rowToTaskDocLink,
  rowToInvariant,
  rowToInvariantCheck,
} from "../mappers/doc.js"
import type {
  Doc,
  DocLink,
  TaskDocLink,
  Invariant,
  InvariantCheck,
  DocId,
  DocKind,
  DocStatus,
  DocLinkType,
  TaskDocLinkType,
  DocRow,
  DocLinkRow,
  TaskDocLinkRow,
  InvariantRow,
  InvariantCheckRow,
} from "@jamesaphoenix/tx-types"

interface DocInsertInput {
  hash: string
  kind: DocKind
  name: string
  title: string
  version: number
  filePath: string
  parentDocId: DocId | null
  metadata?: string
}

interface DocUpdateInput {
  hash?: string
  title?: string
  status?: DocStatus
  lockedAt?: string
  metadata?: string
}

interface DocFilter {
  kind?: string
  status?: string
}

interface InvariantFilter {
  docId?: number
  subsystem?: string
  enforcement?: string
}

interface InvariantUpsertInput {
  id: string
  rule: string
  enforcement: string
  docId: DocId
  subsystem?: string | null
  testRef?: string | null
  lintRule?: string | null
  promptRef?: string | null
}

export interface DocRepositoryService {
  insert: (input: DocInsertInput) => Effect.Effect<Doc, DatabaseError>
  findById: (id: DocId) => Effect.Effect<Doc | null, DatabaseError>
  findByName: (name: string, version?: number) => Effect.Effect<Doc | null, DatabaseError>
  findAll: (filter?: DocFilter) => Effect.Effect<Doc[], DatabaseError>
  update: (id: DocId, input: DocUpdateInput) => Effect.Effect<void, DatabaseError>
  lock: (id: DocId, lockedAt: string) => Effect.Effect<void, DatabaseError>
  remove: (id: DocId) => Effect.Effect<void, DatabaseError>
  createLink: (fromDocId: DocId, toDocId: DocId, linkType: DocLinkType) => Effect.Effect<DocLink, DatabaseError>
  getLinksFrom: (docId: DocId) => Effect.Effect<DocLink[], DatabaseError>
  getLinksTo: (docId: DocId) => Effect.Effect<DocLink[], DatabaseError>
  getAllLinks: () => Effect.Effect<DocLink[], DatabaseError>
  createTaskLink: (taskId: string, docId: DocId, linkType: TaskDocLinkType) => Effect.Effect<TaskDocLink, DatabaseError>
  getTaskLinksForDoc: (docId: DocId) => Effect.Effect<TaskDocLink[], DatabaseError>
  getDocForTask: (taskId: string) => Effect.Effect<Doc | null, DatabaseError>
  getUnlinkedTaskIds: () => Effect.Effect<string[], DatabaseError>
  upsertInvariant: (input: InvariantUpsertInput) => Effect.Effect<Invariant, DatabaseError>
  findInvariantById: (id: string) => Effect.Effect<Invariant | null, DatabaseError>
  findInvariants: (filter?: InvariantFilter) => Effect.Effect<Invariant[], DatabaseError>
  deprecateInvariantsNotIn: (docId: DocId, activeIds: string[]) => Effect.Effect<void, DatabaseError>
  insertInvariantCheck: (invariantId: string, passed: boolean, details: string | null, durationMs: number | null) => Effect.Effect<InvariantCheck, DatabaseError>
  getInvariantChecks: (invariantId: string, limit?: number) => Effect.Effect<InvariantCheck[], DatabaseError>
  countInvariantsByDoc: (docId: DocId) => Effect.Effect<number, DatabaseError>
}

export class DocRepository extends Context.Tag("DocRepository")<
  DocRepository,
  DocRepositoryService
>() {}

export const DocRepositoryLive = Layer.effect(
  DocRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input: DocInsertInput) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                `INSERT INTO docs (hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
               VALUES (?, ?, ?, ?, ?, 'changing', ?, ?, ?, ?)`
              )
              .run(
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
              .prepare("SELECT * FROM docs WHERE id = ?")
              .get(result.lastInsertRowid) as DocRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "doc",
                id: result.lastInsertRowid as number,
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
              .prepare("SELECT * FROM docs WHERE id = ?")
              .get(id) as DocRow | undefined
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findByName: (name: string, version?: number) =>
        Effect.try({
          try: () => {
            const row =
              version !== undefined
                ? (db
                    .prepare(
                      "SELECT * FROM docs WHERE name = ? AND version = ?"
                    )
                    .get(name, version) as DocRow | undefined)
                : (db
                    .prepare(
                      "SELECT * FROM docs WHERE name = ? ORDER BY version DESC LIMIT 1"
                    )
                    .get(name) as DocRow | undefined)
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
            const rows = db.prepare(sql).all(...params) as DocRow[]
            return rows.map(rowToDoc)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      update: (id: DocId, input: DocUpdateInput) =>
        Effect.try({
          try: () => {
            const sets: string[] = []
            const params: unknown[] = []
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
              .prepare("SELECT * FROM doc_links WHERE id = ?")
              .get(result.lastInsertRowid) as DocLinkRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "doc_link",
                id: result.lastInsertRowid as number,
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
              .prepare("SELECT * FROM doc_links WHERE from_doc_id = ?")
              .all(docId) as DocLinkRow[]
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getLinksTo: (docId: DocId) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare("SELECT * FROM doc_links WHERE to_doc_id = ?")
              .all(docId) as DocLinkRow[]
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getAllLinks: () =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare("SELECT * FROM doc_links ORDER BY created_at")
              .all() as DocLinkRow[]
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
              .prepare("SELECT * FROM task_doc_links WHERE id = ?")
              .get(result.lastInsertRowid) as TaskDocLinkRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "task_doc_link",
                id: result.lastInsertRowid as number,
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
              .prepare("SELECT * FROM task_doc_links WHERE doc_id = ?")
              .all(docId) as TaskDocLinkRow[]
            return rows.map(rowToTaskDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getDocForTask: (taskId: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare(
                `SELECT d.* FROM docs d
               JOIN task_doc_links tdl ON tdl.doc_id = d.id
               WHERE tdl.task_id = ?
               ORDER BY d.version DESC LIMIT 1`
              )
              .get(taskId) as DocRow | undefined
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getUnlinkedTaskIds: () =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare(
                `SELECT t.id FROM tasks t
               LEFT JOIN task_doc_links tdl ON tdl.task_id = t.id
               WHERE tdl.id IS NULL
               ORDER BY t.id`
              )
              .all() as Array<{ id: string }>
            return rows.map((r) => r.id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      // Invariants
      upsertInvariant: (input: InvariantUpsertInput) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            db.prepare(
              `INSERT INTO invariants (id, rule, enforcement, doc_id, subsystem, test_ref, lint_rule, prompt_ref, status, created_at, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '{}')
               ON CONFLICT(id) DO UPDATE SET
                 rule = excluded.rule,
                 enforcement = excluded.enforcement,
                 doc_id = excluded.doc_id,
                 subsystem = excluded.subsystem,
                 test_ref = excluded.test_ref,
                 lint_rule = excluded.lint_rule,
                 prompt_ref = excluded.prompt_ref,
                 status = 'active'`
            ).run(
              input.id,
              input.rule,
              input.enforcement,
              input.docId,
              input.subsystem ?? null,
              input.testRef ?? null,
              input.lintRule ?? null,
              input.promptRef ?? null,
              now
            )
            const row = db
              .prepare("SELECT * FROM invariants WHERE id = ?")
              .get(input.id) as InvariantRow | undefined
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
              .prepare("SELECT * FROM invariants WHERE id = ?")
              .get(id) as InvariantRow | undefined
            return row ? rowToInvariant(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findInvariants: (filter?: InvariantFilter) =>
        Effect.try({
          try: () => {
            let sql = "SELECT * FROM invariants"
            const params: unknown[] = []
            const conditions: string[] = []
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
            const rows = db.prepare(sql).all(...params) as InvariantRow[]
            return rows.map(rowToInvariant)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      deprecateInvariantsNotIn: (docId: DocId, activeIds: string[]) =>
        Effect.try({
          try: () => {
            if (activeIds.length === 0) {
              db.prepare(
                "UPDATE invariants SET status = 'deprecated' WHERE doc_id = ? AND status = 'active'"
              ).run(docId)
              return
            }
            const placeholders = activeIds.map(() => "?").join(", ")
            db.prepare(
              `UPDATE invariants SET status = 'deprecated'
               WHERE doc_id = ? AND status = 'active' AND id NOT IN (${placeholders})`
            ).run(docId, ...activeIds)
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
            const now = new Date().toISOString()
            const result = db
              .prepare(
                "INSERT INTO invariant_checks (invariant_id, passed, details, checked_at, duration_ms) VALUES (?, ?, ?, ?, ?)"
              )
              .run(invariantId, passed ? 1 : 0, details, now, durationMs)
            const row = db
              .prepare("SELECT * FROM invariant_checks WHERE id = ?")
              .get(result.lastInsertRowid) as InvariantCheckRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "invariant_check",
                id: result.lastInsertRowid as number,
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
              .prepare(
                "SELECT * FROM invariant_checks WHERE invariant_id = ? ORDER BY checked_at DESC LIMIT ?"
              )
              .all(invariantId, limit) as InvariantCheckRow[]
            return rows.map(rowToInvariantCheck)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      countInvariantsByDoc: (docId: DocId) =>
        Effect.try({
          try: () => {
            const result = db
              .prepare(
                "SELECT COUNT(*) as cnt FROM invariants WHERE doc_id = ? AND status = 'active'"
              )
              .get(docId) as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
    }
  })
)
