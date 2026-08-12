import type { SpecTraceFilter } from "./spec-trace-repo.types.js"

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
    clauses.push("(d.name = ? OR d.doc_id = ?)")
    params.push(filter.doc, filter.doc)
  }

  if (filter?.subsystem) {
    clauses.push("i.subsystem = ?")
    params.push(filter.subsystem)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
}
