import type { SpecTraceFilter } from "./spec-trace-repo.types.js"

export const buildInvariantFilterSql = (
  filter: SpecTraceFilter | undefined,
  params: unknown[]
): string => {
  const clauses: string[] = ["i.status = 'active'"]

  if (filter?.doc) {
    clauses.push("d.name = ?")
    params.push(filter.doc)
  }

  if (filter?.subsystem) {
    clauses.push("i.subsystem = ?")
    params.push(filter.subsystem)
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
}
