import { Effect, Schema } from "effect"
import { DocService } from "./doc-service.js"
import { SpecTraceService } from "./spec-trace-service.js"

export const SpecHealthSchema = Schema.Struct({
  status: Schema.Literal("synced", "drifting", "broken"),
  specTest: Schema.Struct({
    total: Schema.Number, covered: Schema.Number, uncovered: Schema.Number,
    coveragePercent: Schema.Number, passing: Schema.Number, failing: Schema.Number,
    untested: Schema.Number, docsComplete: Schema.Number, docsHarden: Schema.Number, docsBuild: Schema.Number,
  }),
  docDrift: Schema.Struct({ driftedDocs: Schema.Number, totalDocs: Schema.Number }),
  docs: Schema.Array(Schema.Struct({
    docId: Schema.String, version: Schema.Number, title: Schema.String,
    name: Schema.String, phase: Schema.String, invariants: Schema.Number, passing: Schema.Number,
    failing: Schema.Number, untested: Schema.Number, gaps: Schema.Number, blockers: Schema.Array(Schema.String), drift: Schema.Array(Schema.String),
  })),
})
export type SpecHealth = typeof SpecHealthSchema.Type

/** @spec INV-LEAN-004 Read failures propagate; unavailable evidence never becomes healthy. */
export const getSpecHealth = () => Effect.gen(function* () {
  const docService = yield* DocService
  const specService = yield* SpecTraceService
  const versions = yield* docService.list()
  // Health describes current work. Historical versions remain available through
  // document lookups, but must not duplicate the latest evidence and drift.
  const latest = new Map<string, typeof versions[number]>()
  for (const doc of versions) {
    const key = `${doc.kind}/${doc.name}`
    if ((latest.get(key)?.version ?? 0) < doc.version) latest.set(key, doc)
  }
  const docs = [...latest.values()]
  const fci = yield* specService.fci()
  const statuses = []
  for (const doc of docs) {
    let status = yield* specService.status({ doc: doc.docId })
    // Keep legacy name-based sign-offs valid only when the name is unambiguous.
    if (status.phase === "HARDEN" && docs.filter(d => d.name === doc.name).length === 1) {
      const legacy = yield* specService.status({ doc: doc.name })
      if (legacy.phase === "COMPLETE") status = legacy
    }
    const drift = yield* docService.detectDrift(`${doc.kind}/${doc.name}`)
    statuses.push({ docId:doc.docId, version:doc.version, title:doc.title, name: `${doc.kind}/${doc.name}`, phase: status.phase, invariants:status.total, passing:status.passing, failing:status.failing, untested:status.untested, gaps: status.gaps, blockers:status.total > 0 ? [...status.blockers] : [], drift: [...drift], hasInvariants: status.total > 0 })
  }
  const driftedDocs = statuses.filter(d => d.drift.length > 0).length
  return {
    status: fci.failing > 0 || driftedDocs > docs.length / 2 ? "broken" as const : driftedDocs > 0 || fci.uncovered > 0 || fci.untested > 0 || statuses.some(d => d.hasInvariants && d.phase !== "COMPLETE") ? "drifting" as const : "synced" as const,
    specTest: { total: fci.total, covered: fci.covered, uncovered: fci.uncovered,
      coveragePercent: fci.total > 0 ? Math.round(fci.covered / fci.total * 100) : 0,
      passing: fci.passing, failing: fci.failing, untested: fci.untested,
      docsComplete: statuses.filter(d => d.hasInvariants && d.phase === "COMPLETE").length,
      docsHarden: statuses.filter(d => d.hasInvariants && d.phase === "HARDEN").length,
      docsBuild: statuses.filter(d => d.hasInvariants && d.phase === "BUILD").length },
    docDrift: { driftedDocs, totalDocs: docs.length },
    docs: statuses.map(doc => ({docId:doc.docId, version:doc.version, title:doc.title, name: doc.name, phase: doc.phase, invariants:doc.invariants, passing:doc.passing, failing:doc.failing, untested:doc.untested, gaps: doc.gaps, blockers:doc.blockers, drift: doc.drift})),
  } satisfies SpecHealth
})
