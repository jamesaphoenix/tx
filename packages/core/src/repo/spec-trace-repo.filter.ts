import type { SpecTraceFilter } from "./spec-trace-repo.types.js"
import type { SqliteDatabase } from "../db.js"

/** Stable IDs unify qualified references while retaining unambiguous legacy sign-offs. */
export const docScopeAliases = (db: SqliteDatabase, value: string): readonly string[] => {
  const docs = db.prepare<{doc_id:string;kind:string;name:string}>(
    "SELECT DISTINCT doc_id,kind,name FROM docs WHERE doc_id=? OR name=? OR kind || '/' || name=?"
  ).all(value,value,value)
  if (docs.length !== 1) return [value]
  const doc = docs[0]!
  const names = db.prepare<{n:number}>("SELECT count(DISTINCT doc_id) AS n FROM docs WHERE name=?").get(doc.name)
  return [...new Set([doc.doc_id,`${doc.kind}/${doc.name}`,...(names?.n === 1 ? [doc.name] : [])])]
}

export const buildInvariantFilterSql = (
  filter: SpecTraceFilter | undefined,
  params: unknown[],
  projectionKey: string
): string => {
  const clauses: string[] = ["i.projection_key = ?", "i.status = 'active'"]
  params.push(projectionKey)

  if (filter?.doc) {
    // `--doc` accepts both the human-readable name and the stable lineage ID.
    // Names can be ambiguous across kinds; stable IDs must still scope exactly
    // to the requested document lineage.
    clauses.push("(d.name = ? OR d.doc_id = ? OR d.kind || '/' || d.name = ?)")
    params.push(filter.doc, filter.doc, filter.doc)
  }

  if (filter?.subsystem) {
    clauses.push("i.subsystem = ?")
    params.push(filter.subsystem)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
}
